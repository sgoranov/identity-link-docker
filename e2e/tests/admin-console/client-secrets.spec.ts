import type { Page } from '@playwright/test';
import { chooseFieldOptions, columnCells, field, fieldError, popconfirm, sortBy, tableRow, tableRows } from '../support/antd';
import { requestClientToken, uniqueName, type Api } from '../support/api';
import { consolePath, expect, test } from '../support/console';
import { env } from '../support/env';

const day = 24 * 60 * 60 * 1000;

async function openSecrets(page: Page, clientId: string): Promise<void> {
    await page.goto(`${consolePath}/clients/${clientId}/secrets`);
    await expect(page.getByRole('heading', { level: 2, name: 'Client Secrets' })).toBeVisible();
}

// A client that can get tokens with the client credentials grant, for a scope of an audience Identity Link declares.
async function createServiceClient(api: Api) {
    const group = await api.createClientGroup(uniqueName('e2e-group'), ['users.read']);

    return api.createClient({ audience: env.consoleAudience, groups: [group.id], grantTypes: ['client_credentials'] });
}

test('shows the client and its secrets', async ({ page, api }) => {
    const client = await api.createClient({ description: 'A client with secrets' });
    const secret = await api.issueSecret(client.id, '1y', 'shown hint');
    await openSecrets(page, client.id);

    const main = page.getByRole('main');
    await expect(main.getByText(client.name, { exact: true })).toBeVisible();
    await expect(main.getByText(client.id, { exact: true })).toBeVisible();
    await expect(main.getByText('A client with secrets', { exact: true })).toBeVisible();
    await expect(tableRow(page, 'shown hint').getByRole('cell')).toHaveText([
        'shown hint', secret.expirationDateTime, 'Delete',
    ]);

    await main.getByRole('button', { name: 'Back to clients' }).click();
    await expect(page).toHaveURL(`${env.baseUrl}${consolePath}/clients`);
});

test('generates a secret, which authenticates the client', async ({ page, api, request }) => {
    const client = await createServiceClient(api);
    await openSecrets(page, client.id);
    await expect(tableRows(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Generate secret' }).click();
    const drawer = page.getByRole('dialog', { name: 'Generate secret' });
    await field(drawer, 'Password hint').fill('generated in the console');
    await chooseFieldOptions(drawer, 'Expiration period', ['1 week']);
    await drawer.getByRole('button', { name: 'Generate secret' }).click();
    await expect(drawer).toBeHidden();

    const main = page.getByRole('main');
    await expect(main.getByRole('heading', { level: 5, name: 'Generated secret' })).toBeVisible();
    await expect(main.getByText('You will not be able to view it again once dismissed.')).toBeVisible();
    const password = await main.locator('input[type="password"]').inputValue();
    expect(password).toMatch(/^[0-9a-f]{64}$/);

    const row = tableRow(page, 'generated in the console');
    const expiresAt = new Date((await row.getByRole('cell').nth(1).textContent())!).getTime();
    expect(Math.abs(expiresAt - (Date.now() + 7 * day))).toBeLessThan(5 * 60 * 1000);

    const response = await requestClientToken(request, { id: client.id, secret: password }, 'users.read');
    expect(response.status(), await response.text()).toBe(200);
    expect((await response.json()).scope).toBe('users.read');

    await main.getByRole('button', { name: 'Dismiss' }).click();
    await expect(main.getByRole('heading', { name: 'Generated secret' })).toBeHidden();
    await expect(main.locator('input[type="password"]')).toHaveCount(0);
});

test('copies a generated secret to the clipboard', async ({ page, api, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const client = await api.createClient();
    await openSecrets(page, client.id);

    await page.getByRole('button', { name: 'Generate secret' }).click();
    const drawer = page.getByRole('dialog', { name: 'Generate secret' });
    await chooseFieldOptions(drawer, 'Expiration period', ['1 day']);
    await drawer.getByRole('button', { name: 'Generate secret' }).click();

    const main = page.getByRole('main');
    const password = await main.locator('input[type="password"]').inputValue();
    await main.getByRole('button', { name: 'Copy' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(password);
});

test('the form needs an expiration period, but no hint', async ({ page, api }) => {
    const client = await api.createClient();
    await openSecrets(page, client.id);

    await page.getByRole('button', { name: 'Generate secret' }).click();
    const drawer = page.getByRole('dialog', { name: 'Generate secret' });
    await drawer.getByRole('button', { name: 'Generate secret' }).click();
    await expect(fieldError(drawer, 'Expiration period')).toHaveText('Expiration period is required');

    await field(drawer, 'Password hint').fill('x'.repeat(201));
    await expect(fieldError(drawer, 'Password hint')).toHaveText('Password hint must be 200 characters or less');

    await field(drawer, 'Password hint').fill('');
    await chooseFieldOptions(drawer, 'Expiration period', ['2 years']);
    await drawer.getByRole('button', { name: 'Generate secret' }).click();
    await expect(drawer).toBeHidden();

    // Without a hint, the secret gets one.
    await expect(tableRow(page, 'auto generated')).toBeVisible();
    expect(await api.clientSecrets(client.id)).toMatchObject([{ passwordHint: 'auto generated' }]);
});

test('deletes a secret after confirmation, which then no longer authenticates the client', async ({ page, api, request }) => {
    const client = await createServiceClient(api);
    const kept = await api.issueSecret(client.id, '1y', 'kept');
    const deleted = await api.issueSecret(client.id, '1y', 'deleted');
    await openSecrets(page, client.id);

    const row = tableRow(page, 'deleted');
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirmation = popconfirm(page, 'Delete secret?');
    await expect(confirmation).toContainText('This deletion is permanent.');
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toBeHidden();
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: 'Delete' }).click();
    await confirmation.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toBeHidden();
    await expect(tableRow(page, 'kept')).toBeVisible();

    const refused = await requestClientToken(request, { id: client.id, secret: deleted.password }, 'users.read');
    expect(refused.status()).toBe(401);
    const accepted = await requestClientToken(request, { id: client.id, secret: kept.password }, 'users.read');
    expect(accepted.status()).toBe(200);
});

test('the secrets of a system client cannot be changed', async ({ page, api }) => {
    const client = (await api.findClient(env.system.username))!;
    await openSecrets(page, client.id);

    await expect(page.getByRole('button', { name: 'Generate secret' })).toBeDisabled();
    const row = tableRows(page).filter({ hasText: 'auto generated' });
    await expect(row.getByRole('cell').first().locator('.ant-tag')).toHaveText('System');
    await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

test('sorts by expiry', async ({ page, api }) => {
    const client = await api.createClient();
    for (const period of ['1m', '2y', '1d']) {
        await api.issueSecret(client.id, period, `expires in ${period}`);
    }
    await openSecrets(page, client.id);
    await expect(tableRows(page)).toHaveCount(3);

    const hints = await columnCells(page, 'Password hint');
    await sortBy(page, 'Expires At');
    await expect(hints).toHaveText(['expires in 1d', 'expires in 1m', 'expires in 2y']);
    await sortBy(page, 'Expires At');
    await expect(hints).toHaveText(['expires in 2y', 'expires in 1m', 'expires in 1d']);
});

test('pages through the secrets, ten at a time', async ({ page, api }) => {
    const client = await api.createClient();
    for (let i = 0; i < 11; i++) {
        await api.issueSecret(client.id, '1d', `secret ${i}`);
    }
    await openSecrets(page, client.id);

    const previous = page.getByRole('button', { name: 'Previous' });
    const next = page.getByRole('button', { name: 'Next' });
    await expect(tableRows(page)).toHaveCount(10);
    await expect(previous).toBeDisabled();
    await next.click();
    await expect(tableRows(page)).toHaveCount(1);
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(tableRows(page)).toHaveCount(10);
});

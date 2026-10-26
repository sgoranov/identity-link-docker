import type { Page } from '@playwright/test';
import {
    addTags,
    chooseFieldOptions,
    columnCells,
    field,
    fieldError,
    fillFields,
    formItem,
    notification,
    popconfirm,
    removeSelectedOptions,
    selectedOptions,
    setSwitch,
    sortBy,
    switchField,
    tableRow,
    tableRows,
} from '../support/antd';
import { requestClientToken, uniqueName } from '../support/api';
import { consolePath, expect, search, test } from '../support/console';
import { env } from '../support/env';

async function openClients(page: Page, name?: string): Promise<void> {
    await page.goto(`${consolePath}/clients`);
    await expect(page.getByRole('heading', { level: 2, name: 'Clients' })).toBeVisible();
    if (name) {
        await search(page, 'Search clients by name', name);
    }
}

test('lists a client with its details and groups', async ({ page, api }) => {
    const group = await api.createClientGroup(uniqueName('e2e-group'));
    const client = await api.createClient({ description: 'Listed client', groups: [group.id] });

    await openClients(page, client.name);

    await expect(tableRow(page, client.name).getByRole('cell')).toHaveText([
        client.name, client.id, 'Listed client', 'No', group.name, 'Secrets', 'Edit', 'Delete',
    ]);
});

test('a system client cannot be edited or deleted', async ({ page }) => {
    await openClients(page, env.system.username);

    const row = tableRows(page).filter({ hasText: env.system.username });
    await expect(row.getByRole('cell').first().locator('.ant-tag')).toHaveText('System');
    await expect(row.getByRole('button', { name: 'Secrets' })).toBeEnabled();
    await expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

test('creates a client', async ({ page, api }) => {
    const group = await api.createClientGroup(uniqueName('e2e-group'));
    const name = uniqueName('e2e-client');
    const url = `https://${name}.example.test`;
    await openClients(page);

    await page.getByRole('button', { name: 'Create client' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create client' });
    await expect(formItem(drawer, 'Audience')).toContainText('the audience cannot be changed after the client is created');

    await fillFields(drawer, {
        Name: name,
        Description: 'A client created in the console',
        Audience: url,
        'Application URL': url,
        'Terms of Service URL': `${url}/terms`,
        'Privacy Policy URL': `${url}/privacy`,
        'Logo URL': `${url}/logo.png`,
    });
    await addTags(drawer, 'Redirect URIs', [`${url}/callback`, `${url}/other-callback`]);
    await chooseFieldOptions(drawer, 'Groups', [group.name], { search: true });
    await chooseFieldOptions(drawer, 'Grant types', ['Authorization Code', 'Refresh Token']);
    await setSwitch(drawer, 'Public client', true);
    await setSwitch(drawer, 'Require Consent', true);
    await drawer.getByRole('button', { name: 'Create client' }).click();
    await expect(drawer).toBeHidden();

    expect(await api.findClient(name)).toMatchObject({
        description: 'A client created in the console',
        audience: url,
        redirectUri: [`${url}/callback`, `${url}/other-callback`],
        groups: { data: [group.id] },
        grantTypes: ['authorization_code', 'refresh_token'],
        public: true,
        consentRequired: true,
        applicationUrl: url,
        termsOfServiceUrl: `${url}/terms`,
        privacyPolicyUrl: `${url}/privacy`,
        logoUrl: `${url}/logo.png`,
        isSystem: false,
    });
    await search(page, 'Search clients by name', name);
    await expect(tableRow(page, name).getByRole('cell').nth(3)).toHaveText('Yes');
});

test('the form checks the values before creating a client', async ({ page, api }) => {
    await openClients(page);
    await page.getByRole('button', { name: 'Create client' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create client' });

    await drawer.getByRole('button', { name: 'Create client' }).click();
    await expect(fieldError(drawer, 'Name')).toHaveText('Name is required');
    await expect(fieldError(drawer, 'Description')).toHaveText('Description is required');
    await expect(fieldError(drawer, 'Audience')).toHaveText('Audience is required');
    await expect(fieldError(drawer, 'Redirect URIs')).toHaveText('At least one redirect URI is required');

    const name = `${uniqueName('e2e-client')}!`;
    await fillFields(drawer, {
        Name: name,
        Audience: 'ftp://files.example.test',
        'Application URL': 'not a URL',
        'Logo URL': 'example.test/logo.png',
    });
    await addTags(drawer, 'Redirect URIs', ['callback']);
    await drawer.getByRole('button', { name: 'Create client' }).click();
    await expect(fieldError(drawer, 'Name')).toHaveText('Name can only include letters, numbers, "_" and "-"');
    await expect(fieldError(drawer, 'Audience')).toHaveText('Audience must be a valid HTTP or HTTPS URL');
    await expect(fieldError(drawer, 'Redirect URIs')).toHaveText('Redirect URI must be valid');
    await expect(fieldError(drawer, 'Application URL')).toHaveText('URI must be valid');
    await expect(fieldError(drawer, 'Logo URL')).toHaveText('URI must be valid');

    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await expect(drawer).toBeHidden();
    expect(await api.findClient(name)).toBeUndefined();
});

test('shows why the service refuses a client', async ({ page, api }) => {
    const existing = await api.createClient();
    const url = `https://${uniqueName('e2e-client')}.example.test`;
    await openClients(page);
    await page.getByRole('button', { name: 'Create client' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create client' });

    await fillFields(drawer, { Name: existing.name, Description: 'Duplicate', Audience: url });
    await addTags(drawer, 'Redirect URIs', [`${url}/callback`]);
    await drawer.getByRole('button', { name: 'Create client' }).click();

    await expect(notification(page, 'Unable to save client')).toContainText(
        `Invalid name. The value "${existing.name}" already exists.`,
    );
    await expect(drawer).toBeVisible();
});

test('edits a client, but not its audience', async ({ page, api }) => {
    const oldGroup = await api.createClientGroup(uniqueName('e2e-group'));
    const newGroup = await api.createClientGroup(uniqueName('e2e-group'));
    const client = await api.createClient({
        groups: [oldGroup.id],
        grantTypes: ['client_credentials'],
        applicationUrl: 'https://old.example.test',
        logoUrl: 'https://old.example.test/logo.png',
    });
    await openClients(page, client.name);

    await tableRow(page, client.name).getByRole('button', { name: 'Edit' }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit client' });
    await expect(field(drawer, 'Name')).toHaveValue(client.name);
    await expect(field(drawer, 'Description')).toHaveValue(client.description);
    await expect(field(drawer, 'Audience')).toHaveValue(client.audience);
    await expect(field(drawer, 'Audience')).toBeDisabled();
    await expect(selectedOptions(drawer, 'Redirect URIs')).toHaveText(client.redirectUri);
    await expect(selectedOptions(drawer, 'Groups')).toHaveText([oldGroup.name]);
    await expect(selectedOptions(drawer, 'Grant types')).toHaveText(['Client Credentials']);
    await expect(switchField(drawer, 'Require Consent')).toHaveAttribute('aria-checked', 'false');
    await expect(field(drawer, 'Application URL')).toHaveValue('https://old.example.test');
    // Whether a client is public is set when it is created.
    await expect(formItem(drawer, 'Public client')).toHaveCount(0);

    const name = uniqueName('e2e-edited');
    await fillFields(drawer, {
        Name: name,
        Description: 'An edited client',
        'Application URL': 'https://new.example.test',
        'Logo URL': '',
        'Privacy Policy URL': 'https://new.example.test/privacy',
    });
    await removeSelectedOptions(drawer, 'Redirect URIs', client.redirectUri);
    await addTags(drawer, 'Redirect URIs', ['https://new.example.test/callback']);
    await removeSelectedOptions(drawer, 'Groups', [oldGroup.name]);
    await chooseFieldOptions(drawer, 'Groups', [newGroup.name], { search: true });
    await chooseFieldOptions(drawer, 'Grant types', ['Authorization Code']);
    await setSwitch(drawer, 'Require Consent', true);
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer).toBeHidden();

    expect(await api.getClient(client.id)).toMatchObject({
        name,
        description: 'An edited client',
        audience: client.audience,
        redirectUri: ['https://new.example.test/callback'],
        groups: { data: [newGroup.id] },
        grantTypes: ['client_credentials', 'authorization_code'],
        consentRequired: true,
        applicationUrl: 'https://new.example.test',
        privacyPolicyUrl: 'https://new.example.test/privacy',
        termsOfServiceUrl: null,
        logoUrl: null,
    });
    await search(page, 'Search clients by name', name);
    await expect(tableRow(page, name).getByRole('cell').nth(2)).toHaveText('An edited client');
});

test('deletes a client after confirmation, which ends its secrets', async ({ page, api, request }) => {
    const client = await api.createClient();
    const secret = await api.issueSecret(client.id);
    await openClients(page, client.name);

    const row = tableRow(page, client.name);
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirmation = popconfirm(page, 'Delete client?');
    await expect(confirmation).toContainText('This deletion is permanent.');
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toBeHidden();
    expect(await api.getClient(client.id)).toBeDefined();

    await row.getByRole('button', { name: 'Delete' }).click();
    await confirmation.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toBeHidden();

    expect(await api.getClient(client.id)).toBeUndefined();
    const response = await requestClientToken(request, { id: client.id, secret: secret.password }, 'openid');
    expect(response.status()).toBe(401);
});

test('searches by name', async ({ page, api }) => {
    const tag = uniqueName('find');
    const client = await api.createClient({ name: `e2e-${tag}`, description: `Description ${tag}` });
    await openClients(page);

    await search(page, 'Search clients by name', tag);
    await expect(tableRows(page)).toHaveCount(1);
    await expect(tableRow(page, client.name)).toBeVisible();

    // Only the name is searched.
    await search(page, 'Search clients by name', `Description ${tag}`);
    await expect(tableRows(page)).toHaveCount(0);
});

test('sorts by name', async ({ page, api }) => {
    const tag = uniqueName('sort');
    for (const suffix of ['b', 'c', 'a']) {
        await api.createClient({ name: `${tag}-${suffix}` });
    }
    await openClients(page, tag);
    await expect(tableRows(page)).toHaveCount(3);

    const names = await columnCells(page, 'Name');
    await sortBy(page, 'Name');
    await expect(names).toHaveText([`${tag}-a`, `${tag}-b`, `${tag}-c`]);
    await sortBy(page, 'Name');
    await expect(names).toHaveText([`${tag}-c`, `${tag}-b`, `${tag}-a`]);
});

test('sorts by whether a client is public', async ({ page, api }) => {
    const tag = uniqueName('sort');
    await api.createClient({ name: `${tag}-a`, isPublic: false });
    await api.createClient({ name: `${tag}-b`, isPublic: true });
    await api.createClient({ name: `${tag}-c`, isPublic: false });
    await openClients(page, tag);
    await expect(tableRows(page)).toHaveCount(3);

    const publicCells = await columnCells(page, 'Public');
    await sortBy(page, 'Public');
    await expect(publicCells).toHaveText(['No', 'No', 'Yes']);
    await sortBy(page, 'Public');
    await expect(publicCells).toHaveText(['Yes', 'No', 'No']);
});

test('pages through the clients, ten at a time', async ({ page, api }) => {
    const tag = uniqueName('page');
    for (let i = 0; i < 11; i++) {
        await api.createClient({ name: `${tag}-${String(i).padStart(2, '0')}` });
    }
    await openClients(page, tag);

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

test('opens the secrets of a client', async ({ page, api }) => {
    const client = await api.createClient();
    await openClients(page, client.name);

    await tableRow(page, client.name).getByRole('button', { name: 'Secrets' }).click();
    await expect(page).toHaveURL(`${env.baseUrl}${consolePath}/clients/${client.id}/secrets`);
    await expect(page.getByRole('heading', { level: 2, name: 'Client Secrets' })).toBeVisible();
    await expect(page.getByRole('main').getByText(client.name, { exact: true })).toBeVisible();
});

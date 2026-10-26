import {
    chooseFieldOptions,
    columnCells,
    field,
    fieldError,
    fillFields,
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
import { strongPassword, uniqueName } from '../support/api';
import { consolePath, expect, search, searchUsers, test } from '../support/console';
import { env } from '../support/env';
import type { Page } from '@playwright/test';

async function openUsers(page: Page, username?: string): Promise<void> {
    await page.goto(`${consolePath}/users`);
    await expect(page.getByRole('heading', { level: 2, name: 'Users' })).toBeVisible();
    if (username) {
        await searchUsers(page, 'Username', username);
        await expect(tableRow(page, username)).toBeVisible();
    }
}

test('lists a user with their details and groups', async ({ page, api }) => {
    const group = await api.createUserGroup(uniqueName('e2e-group'));
    const user = await api.createUser({ firstName: 'Listed', lastName: 'Person', groups: [group.id], twoFaEnabled: true });

    await openUsers(page, user.username);

    await expect(tableRow(page, user.username).getByRole('cell')).toHaveText([
        'Listed Person', user.username, user.email, 'Enabled', group.name, 'Edit', 'Delete',
    ]);
});

test('the administrator cannot delete their own account', async ({ page }) => {
    await openUsers(page, env.admin.username);

    const row = tableRow(page, env.admin.username);
    await expect(row.getByRole('button', { name: 'Edit' })).toBeEnabled();
    await expect(row.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('a system user cannot be edited or deleted', async ({ page }) => {
    await openUsers(page, env.system.username);

    const row = tableRow(page, env.system.username);
    await expect(row.getByRole('cell').first()).toContainText('System User');
    await expect(row.getByRole('cell').first().locator('.ant-tag')).toHaveText('System');
    await expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled();
    await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();
});

test('creates a user, who can then sign in', async ({ page, api }) => {
    const group = await api.createUserGroup(uniqueName('e2e-group'));
    const username = uniqueName('e2e-user');
    const password = strongPassword();
    await openUsers(page);

    await page.getByRole('button', { name: 'Create user' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create user' });
    // New users get every grant type and no groups unless the form says otherwise.
    await expect(selectedOptions(drawer, 'Grant types')).toHaveText([
        'Client Credentials', 'Password', 'Authorization Code', 'Refresh Token', 'Implicit',
    ]);
    await expect(selectedOptions(drawer, 'Groups')).toHaveCount(0);
    await expect(switchField(drawer, 'Two-factor authentication')).toHaveAttribute('aria-checked', 'false');

    await fillFields(drawer, {
        Username: username,
        Password: password,
        'First name': 'Created',
        'Last name': 'Person',
        Email: `${username}@example.test`,
    });
    await removeSelectedOptions(drawer, 'Grant types', ['Client Credentials', 'Password', 'Implicit']);
    await chooseFieldOptions(drawer, 'Groups', [group.name], { search: true });
    await drawer.getByRole('button', { name: 'Create user' }).click();
    await expect(drawer).toBeHidden();

    expect(await api.findUser(username)).toMatchObject({
        firstName: 'Created',
        lastName: 'Person',
        email: `${username}@example.test`,
        grantTypes: ['authorization_code', 'refresh_token'],
        groups: { data: [group.id] },
        twoFaEnabled: false,
        isSystem: false,
    });
    await searchUsers(page, 'Username', username);
    await expect(tableRow(page, username).getByRole('cell')).toHaveText([
        'Created Person', username, `${username}@example.test`, 'Disabled', group.name, 'Edit', 'Delete',
    ]);

    // Identity Link accepts the password the console set.
    expect(await api.checkPassword(username, password)).toBe(true);
});

test('the form checks the values before creating a user', async ({ page, api }) => {
    await openUsers(page);
    await page.getByRole('button', { name: 'Create user' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create user' });

    await removeSelectedOptions(drawer, 'Grant types', [
        'Client Credentials', 'Password', 'Authorization Code', 'Refresh Token', 'Implicit',
    ]);
    await drawer.getByRole('button', { name: 'Create user' }).click();
    await expect(fieldError(drawer, 'Username')).toHaveText('Username is required');
    await expect(fieldError(drawer, 'Password')).toHaveText('Password is required');
    await expect(fieldError(drawer, 'First name')).toHaveText('First name is required');
    await expect(fieldError(drawer, 'Last name')).toHaveText('Last name is required');
    await expect(fieldError(drawer, 'Email')).toHaveText('Email is required');
    await expect(fieldError(drawer, 'Grant types')).toHaveText('At least one grant type is required');

    const username = uniqueName('not valid');
    await fillFields(drawer, { Username: username, Email: 'not-an-email', 'First name': 'x'.repeat(101) });
    await drawer.getByRole('button', { name: 'Create user' }).click();
    await expect(fieldError(drawer, 'Username')).toHaveText('Username can only include letters, numbers, "_" and "-"');
    await expect(fieldError(drawer, 'Email')).toHaveText('Email must be valid');
    await expect(fieldError(drawer, 'First name')).toHaveText('First name must be 100 characters or less');

    await drawer.getByRole('button', { name: 'Cancel' }).click();
    await expect(drawer).toBeHidden();
    expect(await api.findUser(username)).toBeUndefined();
});

test('shows why the service refuses a user', async ({ page, api }) => {
    const username = uniqueName('e2e-user');
    await openUsers(page);
    await page.getByRole('button', { name: 'Create user' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create user' });

    await fillFields(drawer, {
        Username: username,
        Password: 'password1',
        'First name': 'Refused',
        'Last name': 'Person',
        Email: `${username}@example.test`,
    });
    await drawer.getByRole('button', { name: 'Create user' }).click();
    const weakPassword = notification(page, 'Unable to save user');
    await expect(weakPassword).toContainText('Invalid password. The password is too weak.');
    await weakPassword.getByRole('button', { name: 'Close' }).click();

    await fillFields(drawer, { Username: env.admin.username, Password: strongPassword() });
    await drawer.getByRole('button', { name: 'Create user' }).click();
    await expect(notification(page, 'Unable to save user')).toContainText(
        `Invalid username. The value "${env.admin.username}" already exists.`,
    );

    // The drawer stays open with the values, to correct them.
    await expect(drawer).toBeVisible();
    await expect(field(drawer, 'First name')).toHaveValue('Refused');
    expect(await api.findUser(username)).toBeUndefined();
});

test('edits a user', async ({ page, api }) => {
    const oldGroup = await api.createUserGroup(uniqueName('e2e-group'));
    const newGroup = await api.createUserGroup(uniqueName('e2e-group'));
    const user = await api.createUser({
        firstName: 'Before',
        lastName: 'Edit',
        groups: [oldGroup.id],
        grantTypes: ['password', 'authorization_code'],
    });
    await openUsers(page, user.username);

    await tableRow(page, user.username).getByRole('button', { name: 'Edit' }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit user' });
    await expect(field(drawer, 'Username')).toHaveValue(user.username);
    await expect(field(drawer, 'Password')).toHaveValue('');
    await expect(field(drawer, 'First name')).toHaveValue('Before');
    await expect(field(drawer, 'Last name')).toHaveValue('Edit');
    await expect(field(drawer, 'Email')).toHaveValue(user.email);
    await expect(selectedOptions(drawer, 'Grant types')).toHaveText(['Password', 'Authorization Code']);
    await expect(selectedOptions(drawer, 'Groups')).toHaveText([oldGroup.name]);

    const username = uniqueName('e2e-edited');
    await fillFields(drawer, {
        Username: username,
        'First name': 'After',
        'Last name': 'Edited',
        Email: `${username}@example.test`,
    });
    await removeSelectedOptions(drawer, 'Grant types', ['Password']);
    await chooseFieldOptions(drawer, 'Grant types', ['Refresh Token']);
    await removeSelectedOptions(drawer, 'Groups', [oldGroup.name]);
    await chooseFieldOptions(drawer, 'Groups', [newGroup.name], { search: true });
    await setSwitch(drawer, 'Two-factor authentication', true);
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer).toBeHidden();

    expect(await api.getUser(user.id)).toMatchObject({
        username,
        firstName: 'After',
        lastName: 'Edited',
        email: `${username}@example.test`,
        grantTypes: ['authorization_code', 'refresh_token'],
        groups: { data: [newGroup.id] },
        twoFaEnabled: true,
    });
    // A blank password keeps the password.
    expect(await api.checkPassword(username, user.password)).toBe(true);

    await searchUsers(page, 'Username', username);
    await expect(tableRow(page, username).getByRole('cell')).toHaveText([
        'After Edited', username, `${username}@example.test`, 'Enabled', newGroup.name, 'Edit', 'Delete',
    ]);
});

test('sets a new password for a user', async ({ page, api }) => {
    const user = await api.createUser();
    const password = strongPassword();
    await openUsers(page, user.username);

    await tableRow(page, user.username).getByRole('button', { name: 'Edit' }).click();
    const drawer = page.getByRole('dialog', { name: 'Edit user' });
    await fillFields(drawer, { Password: password });
    await drawer.getByRole('button', { name: 'Save changes' }).click();
    await expect(drawer).toBeHidden();

    expect(await api.checkPassword(user.username, password)).toBe(true);
    expect(await api.checkPassword(user.username, user.password)).toBe(false);
});

test('deletes a user after confirmation', async ({ page, api }) => {
    const user = await api.createUser();
    await openUsers(page, user.username);

    const row = tableRow(page, user.username);
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirmation = popconfirm(page, 'Delete user?');
    await expect(confirmation).toContainText('This deletion is permanent.');
    await confirmation.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirmation).toBeHidden();
    expect(await api.getUser(user.id)).toBeDefined();

    await row.getByRole('button', { name: 'Delete' }).click();
    await confirmation.getByRole('button', { name: 'Delete' }).click();
    await expect(row).toBeHidden();
    expect(await api.getUser(user.id)).toBeUndefined();
});

test('searches by name, email or username', async ({ page, api }) => {
    const tag = uniqueName('find');
    const user = await api.createUser({
        username: `e2e-${tag}`,
        firstName: `First-${tag}`,
        lastName: `Last-${tag}`,
        email: `mail-${tag}@example.test`,
    });
    await openUsers(page);

    for (const [fieldLabel, term] of [
        ['Name', `First-${tag}`],
        ['Name', `Last-${tag}`],
        ['Email', `mail-${tag}`],
        ['Username', tag],
    ] as const) {
        await searchUsers(page, fieldLabel, term);
        await expect(tableRows(page), `${fieldLabel} ${term}`).toHaveCount(1);
        await expect(tableRow(page, user.username)).toBeVisible();
    }

    // Each field searches only itself.
    await searchUsers(page, 'Name', `mail-${tag}`);
    await expect(tableRows(page)).toHaveCount(0);
    await expect(page.locator('.ant-table-placeholder')).toContainText('No data');

    await search(page, 'Search users', '');
    await expect(tableRows(page)).not.toHaveCount(0);
});

test('sorts by username and email', async ({ page, api }) => {
    const tag = uniqueName('sort');
    // Created in neither order, with the emails in the reverse order of the usernames.
    await api.createUser({ username: `${tag}-b`, email: `${tag}-y@example.test` });
    await api.createUser({ username: `${tag}-c`, email: `${tag}-x@example.test` });
    await api.createUser({ username: `${tag}-a`, email: `${tag}-z@example.test` });
    await openUsers(page);
    await searchUsers(page, 'Username', tag);
    await expect(tableRows(page)).toHaveCount(3);

    const usernames = await columnCells(page, 'Username');
    await sortBy(page, 'Username');
    await expect(usernames).toHaveText([`${tag}-a`, `${tag}-b`, `${tag}-c`]);
    await sortBy(page, 'Username');
    await expect(usernames).toHaveText([`${tag}-c`, `${tag}-b`, `${tag}-a`]);

    await sortBy(page, 'Email');
    await expect(usernames).toHaveText([`${tag}-c`, `${tag}-b`, `${tag}-a`]);
    await expect(await columnCells(page, 'Email')).toHaveText([
        `${tag}-x@example.test`, `${tag}-y@example.test`, `${tag}-z@example.test`,
    ]);
    await sortBy(page, 'Email');
    await expect(usernames).toHaveText([`${tag}-a`, `${tag}-b`, `${tag}-c`]);
});

test('pages through the users, ten at a time', async ({ page, api }) => {
    const tag = uniqueName('page');
    for (let i = 0; i < 11; i++) {
        await api.createUser({ username: `${tag}-${String(i).padStart(2, '0')}` });
    }
    await openUsers(page);
    await searchUsers(page, 'Username', tag);

    const previous = page.getByRole('button', { name: 'Previous' });
    const next = page.getByRole('button', { name: 'Next' });
    await expect(tableRows(page)).toHaveCount(10);
    await expect(previous).toBeDisabled();

    await next.click();
    await expect(tableRows(page)).toHaveCount(1);
    await expect(next).toBeDisabled();

    await previous.click();
    await expect(tableRows(page)).toHaveCount(10);
    await expect(previous).toBeDisabled();
});

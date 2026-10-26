import { field, fieldError, fillFields, formItem, notification, setSwitch, switchField } from '../support/antd';
import { strongPassword, uniqueName } from '../support/api';
import { consolePath, expect, noSession, signInToConsole, test } from '../support/console';
import { env } from '../support/env';

// The scopes of the identity-link.all alias, which the administrator's group holds.
const allScopes = [
    'users.read', 'users.write', 'users.delete', 'users.auth', 'users.query', 'users.self.update',
    'users.groups.read', 'users.groups.write', 'users.groups.delete',
    'clients.read', 'clients.write', 'clients.delete', 'clients.auth', 'clients.query',
    'clients.groups.read', 'clients.groups.write', 'clients.groups.delete',
    'clients.secrets.read', 'clients.secrets.write', 'clients.secrets.delete',
    '2fa.read', '2fa.write', '2fa.reset',
];

test.describe('the administrator', () => {
    test('sees their account, details and access', async ({ page, api }) => {
        const admin = (await api.findUser(env.admin.username))!;
        await page.goto(`${consolePath}/profile`);

        const main = page.getByRole('main');
        await expect(main.getByRole('heading', { level: 2, name: 'Admin User' })).toBeVisible();
        await expect(main.getByText(admin.email, { exact: true })).toBeVisible();

        const account = main.locator('.ant-descriptions').filter({ hasText: 'Account' });
        await expect(account.getByRole('cell', { name: admin.id })).toBeVisible();
        await expect(account.getByRole('cell', { name: 'admin', exact: true })).toBeVisible();
        await expect(account.getByRole('cell', { name: 'Standard user' })).toBeVisible();

        await expect(field(main, 'First name')).toHaveValue('Admin');
        await expect(field(main, 'Last name')).toHaveValue('User');
        await expect(field(main, 'Email')).toHaveValue(admin.email);
        await expect(switchField(main, 'Two-factor authentication')).toHaveAttribute('aria-checked', 'false');

        const access = main.locator('.ant-descriptions').filter({ hasText: 'Access' });
        await expect(access.locator('.ant-tag')).toHaveText([...allScopes, 'Password', 'Authorization Code', 'Refresh Token']);
    });

    test('the start page is the profile', async ({ page }) => {
        await page.goto(`${consolePath}/`);
        await expect(page.getByRole('heading', { level: 4, name: 'Profile details' })).toBeVisible();
    });
});

test.describe('a user', () => {
    test.use({ storageState: noSession });

    test('changes their name and email', async ({ page, api }) => {
        const user = await api.createConsoleUser(['users.query', 'users.self.update']);
        await signInToConsole(page, user);

        const main = page.getByRole('main');
        await expect(field(main, 'First name')).toHaveValue(user.firstName);
        const email = `${uniqueName('e2e-renamed')}@example.test`;
        await fillFields(main, { 'First name': 'Renamed', 'Last name': 'Person', Email: email });
        await main.getByRole('button', { name: 'Save changes' }).click();

        await expect(notification(page, 'Profile updated')).toContainText('Your profile changes were saved.');
        expect(await api.getUser(user.id)).toMatchObject({ firstName: 'Renamed', lastName: 'Person', email });

        await page.reload();
        await expect(field(main, 'First name')).toHaveValue('Renamed');
        await expect(field(main, 'Last name')).toHaveValue('Person');
        await expect(field(main, 'Email')).toHaveValue(email);
    });

    test('changes their password and signs in with it', async ({ page, api }) => {
        const user = await api.createConsoleUser(['users.query', 'users.self.update']);
        await signInToConsole(page, user);

        const main = page.getByRole('main');
        const password = strongPassword();
        await fillFields(main, { 'New password': password, 'Confirm new password': password });
        await main.getByRole('button', { name: 'Save changes' }).click();

        await expect(notification(page, 'Profile updated')).toBeVisible();
        await expect(field(main, 'New password')).toHaveValue('');
        await expect(field(main, 'Confirm new password')).toHaveValue('');
        expect(await api.checkPassword(user.username, user.password)).toBe(false);

        await page.getByRole('button', { name: 'Sign out' }).click();
        await page.waitForURL(`${env.baseUrl}${consolePath}/logout-success`);
        await signInToConsole(page, { username: user.username, password });
    });

    test('turns on two-factor authentication', async ({ page, api }) => {
        const user = await api.createConsoleUser(['users.query', 'users.self.update']);
        await signInToConsole(page, user);

        const main = page.getByRole('main');
        await setSwitch(main, 'Two-factor authentication', true);
        await main.getByRole('button', { name: 'Save changes' }).click();

        await expect(notification(page, 'Profile updated')).toBeVisible();
        expect(await api.getUser(user.id)).toMatchObject({ twoFaEnabled: true });
    });

    test('the form checks the values before saving', async ({ page, api }) => {
        const user = await api.createConsoleUser(['users.query', 'users.self.update']);
        await signInToConsole(page, user);

        const main = page.getByRole('main');
        await fillFields(main, { 'First name': '', Email: 'not-an-email', 'Confirm new password': 'something' });
        await main.getByRole('button', { name: 'Save changes' }).click();

        await expect(fieldError(main, 'First name')).toHaveText('First name is required');
        await expect(fieldError(main, 'Email')).toHaveText('Email must be valid');
        await expect(fieldError(main, 'Confirm new password')).toHaveText('Enter a new password before confirming it');

        await fillFields(main, { 'New password': strongPassword() });
        await main.getByRole('button', { name: 'Save changes' }).click();
        await expect(fieldError(main, 'Confirm new password')).toHaveText('Passwords do not match');

        expect(await api.getUser(user.id)).toMatchObject({ firstName: user.firstName, email: user.email });
    });

    test('shows why the service refuses a change', async ({ page, api }) => {
        const user = await api.createConsoleUser(['users.query', 'users.self.update']);
        await signInToConsole(page, user);

        const main = page.getByRole('main');
        await fillFields(main, { 'New password': 'password1', 'Confirm new password': 'password1' });
        await main.getByRole('button', { name: 'Save changes' }).click();

        await expect(notification(page, 'Unable to update profile')).toContainText('The password is too weak.');
        expect(await api.checkPassword(user.username, user.password)).toBe(true);
    });

    test('without users.self.update, sees the profile read-only', async ({ page, api }) => {
        const user = await api.createConsoleUser(['users.query']);
        await signInToConsole(page, user);

        const main = page.getByRole('main');
        await expect(field(main, 'First name')).toHaveValue(user.firstName);
        await expect(field(main, 'First name')).toBeDisabled();
        await expect(field(main, 'Email')).toBeDisabled();
        await expect(switchField(main, 'Two-factor authentication')).toBeDisabled();
        await expect(formItem(main, 'New password')).toHaveCount(0);
        await expect(main.getByRole('button', { name: 'Save changes' })).toBeDisabled();

        const access = main.locator('.ant-descriptions').filter({ hasText: 'Access' });
        await expect(access.locator('.ant-tag')).toHaveText(['users.query', 'Authorization Code', 'Refresh Token']);
    });

    test('a system user sees the profile read-only', async ({ page }) => {
        await signInToConsole(page, env.system);

        const main = page.getByRole('main');
        await expect(main.getByRole('cell', { name: 'System User' })).toBeVisible();
        await expect(field(main, 'First name')).toHaveValue('System');
        await expect(field(main, 'First name')).toBeDisabled();
        await expect(main.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    });
});

import { chooseOptions } from '../support/antd';
import { consolePath, expect, noSession, openFromMenu, signInToConsole, test } from '../support/console';
import { env } from '../support/env';
import { submitLogin } from '../support/oidc';

test.describe('signed in as the administrator', () => {
    test('the menu leads to every page', async ({ page }) => {
        await page.goto(`${consolePath}/`);
        await expect(page.getByRole('heading', { level: 2, name: 'Admin User' })).toBeVisible();

        const pages = [
            { menu: ['Users', 'Users List'], path: '/users', heading: 'Users' },
            { menu: ['Users', 'User Groups'], path: '/user-groups', heading: 'User Groups' },
            { menu: ['Clients', 'Clients List'], path: '/clients', heading: 'Clients' },
            { menu: ['Clients', 'Client Groups'], path: '/client-groups', heading: 'Client Groups' },
            { menu: ['Profile'], path: '/', heading: 'Admin User' },
        ];
        for (const { menu, path, heading } of pages) {
            await openFromMenu(page, menu[0], menu[1]);
            await expect(page).toHaveURL(`${env.baseUrl}${consolePath}${path}`);
            await expect(page.getByRole('heading', { level: 2, name: heading, exact: true })).toBeVisible();
        }
    });

    test('the header shows who is signed in', async ({ page }) => {
        await page.goto(`${consolePath}/users`);

        const header = page.getByRole('banner');
        await expect(header.getByText('Admin User', { exact: true })).toBeVisible();
        await expect(header.getByText('A', { exact: true })).toBeVisible();
        await expect(header.getByRole('button', { name: 'Sign out' })).toBeVisible();
    });

    test('switches the language to Bulgarian and back', async ({ page }) => {
        await page.goto(`${consolePath}/users`);
        await expect(page.getByRole('heading', { level: 2, name: 'Users' })).toBeVisible();

        // The only select in the header. Its label changes with the language.
        const language = page.getByRole('banner').getByRole('combobox');
        await expect(language).toHaveAccessibleName('Language');
        await chooseOptions(language, ['Български']);
        await expect(page.getByRole('heading', { level: 2, name: 'Потребители' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Създай потребител' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Изход' })).toBeVisible();

        // The console remembers the language.
        await page.reload();
        await expect(page.getByRole('heading', { level: 2, name: 'Потребители' })).toBeVisible();

        await expect(language).toHaveAccessibleName('Език');
        await chooseOptions(language, ['English']);
        await expect(page.getByRole('heading', { level: 2, name: 'Users' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    });

    test('on a small screen, the menu opens in a drawer', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(`${consolePath}/`);
        await expect(page.getByRole('banner').getByRole('menuitem')).toHaveCount(0);

        await page.getByRole('banner').getByRole('button', { name: 'menu' }).click();
        const drawer = page.getByRole('dialog', { name: 'Menu' });
        await expect(drawer.getByText('Admin User', { exact: true })).toBeVisible();
        await expect(drawer.getByRole('button', { name: 'Sign out' })).toBeVisible();

        await drawer.getByRole('menuitem', { name: 'Clients' }).click();
        await drawer.getByRole('menuitem', { name: 'Client Groups', exact: true }).click();
        await expect(page).toHaveURL(`${env.baseUrl}${consolePath}/client-groups`);
        await expect(page.getByRole('heading', { level: 2, name: 'Client Groups' })).toBeVisible();
        await expect(drawer).toBeHidden();
    });
});

test.describe('without a session', () => {
    test.use({ storageState: noSession });

    // The console signs in through the BFF, which then calls db-users through the proxy with the user's token.
    test('the console asks to sign in, then opens the profile', async ({ page }) => {
        await page.goto(`${consolePath}/users`);

        await page.waitForURL((url) => url.pathname.startsWith('/login/'));
        await submitLogin(page, env.admin);

        // The BFF returns to the start page of the console, not to the page that asked to sign in.
        await page.waitForURL(`${env.baseUrl}${consolePath}/`);
        await expect(page.getByRole('heading', { level: 2, name: 'Admin User' })).toBeVisible();
        await expect(page.getByRole('cell', { name: env.admin.username, exact: true })).toBeVisible();
    });

    test('signing out ends the session', async ({ page }) => {
        await signInToConsole(page, env.admin);

        await page.getByRole('button', { name: 'Sign out' }).click();
        await page.waitForURL(`${env.baseUrl}${consolePath}/logout-success`);
        await expect(page.getByText('You logged out successfully')).toBeVisible();
        expect((await page.request.get('/bff/session')).status()).toBe(401);

        // Signing in again needs the password again.
        await page.getByRole('button', { name: 'Sign in again' }).click();
        await page.waitForURL((url) => url.pathname.startsWith('/login/'));
        await submitLogin(page, env.admin);
        await page.waitForURL(`${env.baseUrl}${consolePath}/`);
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    });
});

import type { Page } from '@playwright/test';
import { tableRows } from '../support/antd';
import { uniqueName } from '../support/api';
import { consolePath, expect, noSession, openFromMenu, search, signInToConsole, test } from '../support/console';
import { env } from '../support/env';
import { chooseAudience, openScopes, toggleScope } from './group-pages';

// What a user may do in the console are the scopes their groups hold for the console's audience. The console shows
// only the pages and actions the scopes allow, and the services refuse the rest.

test.use({ storageState: noSession });

const readScopes = [
    'users.read', 'users.query', 'users.groups.read',
    'clients.read', 'clients.query', 'clients.groups.read', 'clients.secrets.read',
];

const listPages = ['/users', '/user-groups', '/clients', '/client-groups'];

function menuItems(page: Page) {
    return page.getByRole('banner').getByRole('menuitem');
}

// Opens a list page and waits for its table to show records.
async function openList(page: Page, path: string, heading: string): Promise<void> {
    await page.goto(`${consolePath}${path}`);
    await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible();
    await expect(tableRows(page).first()).toBeVisible();
}

async function expectRedirectToProfile(page: Page, path: string): Promise<void> {
    await page.goto(`${consolePath}${path}`);
    await expect(page).toHaveURL(new RegExp(`${consolePath}/\\?redirect=`));
    await expect(page.getByRole('heading', { level: 4, name: 'Profile details' })).toBeVisible();
}

test('without console scopes, a user has only the profile', async ({ page, api }) => {
    const user = await api.createConsoleUser([]);
    await signInToConsole(page, user);

    await expect(menuItems(page)).toHaveText(['Profile']);
    await expect(page.getByRole('main').getByRole('heading', { level: 2, name: `${user.firstName} ${user.lastName}` })).toBeVisible();
    for (const path of [...listPages, `/clients/${env.rpClient.id}/secrets`]) {
        await expectRedirectToProfile(page, path);
    }
});

test('each page needs its read scope', async ({ page, api }) => {
    const user = await api.createConsoleUser(['users.read', 'users.query']);
    await signInToConsole(page, user);

    await expect(menuItems(page)).toHaveText(['Profile', 'Users']);
    await page.getByRole('banner').getByRole('menuitem', { name: 'Users' }).hover();
    await expect(page.getByRole('menuitem', { name: 'Users List', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'User Groups', exact: true })).toHaveCount(0);

    await openFromMenu(page, 'Users', 'Users List');
    await expect(tableRows(page).first()).toBeVisible();
    for (const path of ['/user-groups', '/clients', '/client-groups']) {
        await expectRedirectToProfile(page, path);
    }
});

test('with read scopes, a user sees every page but cannot change anything', async ({ page, api }) => {
    const user = await api.createConsoleUser(readScopes);
    await signInToConsole(page, user);

    await expect(menuItems(page)).toHaveText(['Profile', 'Users', 'Clients']);
    const main = page.getByRole('main');

    await openList(page, '/users', 'Users');
    await expect(main.getByRole('button', { name: 'Create user' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^(Edit|Delete)$/ })).toHaveCount(0);

    for (const [path, heading] of [['/user-groups', 'User Groups'], ['/client-groups', 'Client Groups']]) {
        await openList(page, path, heading);
        await expect(main.getByRole('button', { name: 'Create group' })).toHaveCount(0);
        await expect(main.getByRole('button', { name: /^(Scopes|Edit|Delete)$/ })).toHaveCount(0);
    }

    await openList(page, '/clients', 'Clients');
    await expect(main.getByRole('button', { name: 'Create client' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: /^(Edit|Delete)$/ })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Secrets' }).first()).toBeEnabled();

    await page.goto(`${consolePath}/clients/${env.rpClient.id}/secrets`);
    await expect(tableRows(page).first()).toBeVisible();
    await expect(main.getByRole('button', { name: 'Generate secret' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Delete' })).toHaveCount(0);
});

test('writing and deleting are separate scopes', async ({ page, api }) => {
    const user = await api.createConsoleUser([
        'users.read', 'users.query', 'users.write',
        'clients.read', 'clients.query', 'clients.delete',
    ]);
    await signInToConsole(page, user);
    const main = page.getByRole('main');

    await openList(page, '/users', 'Users');
    await expect(main.getByRole('button', { name: 'Create user' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'Edit' }).first()).toBeVisible();
    await expect(main.getByRole('button', { name: 'Delete' })).toHaveCount(0);

    await openList(page, '/clients', 'Clients');
    await expect(main.getByRole('button', { name: 'Create client' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(main.getByRole('button', { name: 'Delete' }).first()).toBeVisible();
    // Without clients.secrets.read, there are no secrets to open.
    await expect(main.getByRole('button', { name: 'Secrets' })).toHaveCount(0);
});

test('the services refuse what the scopes do not allow', async ({ page, api }) => {
    const user = await api.createConsoleUser(readScopes);
    await signInToConsole(page, user);

    // The requests the console would send, through the BFF with the user's session.
    const name = uniqueName('e2e-group');
    const createGroup = await page.request.post('/bff/proxy/users/api/v1/group', { data: { name } });
    expect(createGroup.status()).toBe(403);
    const deleteClient = await page.request.delete(`/bff/proxy/clients/api/v1/client/${env.rpClient.id}`);
    expect(deleteClient.status()).toBe(403);

    expect(await api.findUserGroup(name)).toBeUndefined();
    expect(await api.getClient(env.rpClient.id)).toBeDefined();
});

test('scopes given in the console apply from the next sign-in', async ({ page, api, newSession }) => {
    const group = await api.createUserGroup(uniqueName('e2e-console'));
    const user = await api.createUser({ groups: [group.id], grantTypes: ['authorization_code', 'refresh_token'] });
    await signInToConsole(page, user);
    await expect(menuItems(page)).toHaveText(['Profile']);

    const admin = await newSession('administrator');
    await admin.goto(`${consolePath}/user-groups`);
    await search(admin, 'Search groups by name', group.name);
    const drawer = await openScopes(admin, group.name);
    await chooseAudience(drawer, env.consoleAudience);
    await toggleScope(drawer, 'users.read', true);
    await toggleScope(drawer, 'users.query', true);

    // The session holds the scopes of the sign-in.
    await page.reload();
    await expect(menuItems(page)).toHaveText(['Profile']);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(`${env.baseUrl}${consolePath}/logout-success`);
    await signInToConsole(page, user);
    await expect(menuItems(page)).toHaveText(['Profile', 'Users']);
    await openList(page, '/users', 'Users');
});

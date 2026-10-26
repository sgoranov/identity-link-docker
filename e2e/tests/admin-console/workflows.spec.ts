import type { Page } from '@playwright/test';
import { addTags, chooseFieldOptions, field, fillFields, tableRow } from '../support/antd';
import { requestClientToken, strongPassword, uniqueName } from '../support/api';
import { consolePath, expect, search, searchUsers, test, type Credentials } from '../support/console';
import { env } from '../support/env';
import { authorizeInBrowser, createPkce, decodeJwtPayload, fetchDiscovery, requestToken } from '../support/oidc';
import { chooseAudience, openScopes, toggleScope } from './group-pages';

// Records set up only in the console, then used the way a deployment uses them: to sign in and to get tokens.

async function createUserGroupWithScopes(page: Page, scopes: string[]): Promise<string> {
    const name = uniqueName('e2e-group');
    await page.goto(`${consolePath}/user-groups`);
    await page.getByRole('button', { name: 'Create group' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create group' });
    await field(drawer, 'Name').fill(name);
    await drawer.getByRole('button', { name: 'Create group' }).click();
    await expect(drawer).toBeHidden();

    await search(page, 'Search groups by name', name);
    const scopesDrawer = await openScopes(page, name);
    await chooseAudience(scopesDrawer, env.consoleAudience);
    for (const scope of scopes) {
        await toggleScope(scopesDrawer, scope, true);
    }
    await scopesDrawer.getByRole('button', { name: 'Close' }).click();

    return name;
}

async function createUser(page: Page, group?: string): Promise<Credentials> {
    const credentials = { username: uniqueName('e2e-user'), password: strongPassword() };
    await page.goto(`${consolePath}/users`);
    await page.getByRole('button', { name: 'Create user' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create user' });
    await fillFields(drawer, {
        Username: credentials.username,
        Password: credentials.password,
        'First name': 'Console',
        'Last name': 'Made',
        Email: `${credentials.username}@example.test`,
    });
    if (group) {
        await chooseFieldOptions(drawer, 'Groups', [group], { search: true });
    }
    await drawer.getByRole('button', { name: 'Create user' }).click();
    await expect(drawer).toBeHidden();

    return credentials;
}

test('a user created in the console signs in to an application', async ({ page, api, newSession, request }) => {
    const credentials = await createUser(page);
    const user = (await api.findUser(credentials.username))!;

    const browser = await newSession();
    const discovery = await fetchDiscovery(request);
    const pkce = createPkce();
    const callback = await authorizeInBrowser(browser, discovery, env.rpClient, credentials, {
        scope: 'openid email',
        state: 'workflow',
        codeChallenge: pkce.challenge,
    });
    const code = callback.searchParams.get('code');
    expect(code, callback.toString()).toBeTruthy();

    const tokens = await requestToken(request, discovery, env.rpClient, {
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: env.rpClient.redirectUri,
        code_verifier: pkce.verifier,
    });
    expect(decodeJwtPayload(tokens.id_token!)).toMatchObject({ sub: user.id, aud: env.rpClient.id });
});

test('a user group set up in the console lets its users into the console', async ({ page, newSession }) => {
    const group = await createUserGroupWithScopes(page, ['users.read', 'users.query', 'users.self.update']);
    const credentials = await createUser(page, group);

    const user = await newSession(credentials);
    await expect(user.getByRole('banner').getByRole('menuitem')).toHaveText(['Profile', 'Users']);
    await expect(field(user.getByRole('main'), 'First name')).toBeEnabled();
    await user.goto(`${consolePath}/users`);
    await searchUsers(user, 'Username', credentials.username);
    await expect(tableRow(user, credentials.username)).toBeVisible();
    await expect(user.getByRole('button', { name: 'Create user' })).toHaveCount(0);
});

test('a client set up in the console gets tokens with the scopes of its group', async ({ page, api, request }) => {
    // The client group, with one scope of the console's audience.
    const groupName = uniqueName('e2e-group');
    await page.goto(`${consolePath}/client-groups`);
    await page.getByRole('button', { name: 'Create group' }).click();
    const groupDrawer = page.getByRole('dialog', { name: 'Create group' });
    await field(groupDrawer, 'Name').fill(groupName);
    await groupDrawer.getByRole('button', { name: 'Create group' }).click();
    await expect(groupDrawer).toBeHidden();
    await search(page, 'Search groups by name', groupName);
    const scopesDrawer = await openScopes(page, groupName);
    await chooseAudience(scopesDrawer, env.consoleAudience);
    await toggleScope(scopesDrawer, 'users.read', true);
    await scopesDrawer.getByRole('button', { name: 'Close' }).click();

    // The client, in that group.
    const clientName = uniqueName('e2e-client');
    await page.goto(`${consolePath}/clients`);
    await page.getByRole('button', { name: 'Create client' }).click();
    const clientDrawer = page.getByRole('dialog', { name: 'Create client' });
    await fillFields(clientDrawer, {
        Name: clientName,
        Description: 'A service set up in the console',
        Audience: env.consoleAudience,
    });
    await addTags(clientDrawer, 'Redirect URIs', [`https://${clientName}.example.test/callback`]);
    await chooseFieldOptions(clientDrawer, 'Groups', [groupName], { search: true });
    await chooseFieldOptions(clientDrawer, 'Grant types', ['Client Credentials']);
    await clientDrawer.getByRole('button', { name: 'Create client' }).click();
    await expect(clientDrawer).toBeHidden();

    // Its secret.
    await search(page, 'Search clients by name', clientName);
    const clientId = (await tableRow(page, clientName).getByRole('cell').nth(1).textContent())!;
    await tableRow(page, clientName).getByRole('button', { name: 'Secrets' }).click();
    await page.getByRole('button', { name: 'Generate secret' }).click();
    const secretDrawer = page.getByRole('dialog', { name: 'Generate secret' });
    await chooseFieldOptions(secretDrawer, 'Expiration period', ['1 day']);
    await secretDrawer.getByRole('button', { name: 'Generate secret' }).click();
    const secret = await page.getByRole('main').locator('input[type="password"]').inputValue();

    // The token has the scope of the group and leaves out the one the group does not have.
    const response = await requestClientToken(request, { id: clientId, secret }, 'users.read users.write');
    expect(response.status(), await response.text()).toBe(200);
    const token = await response.json();
    expect(token.scope).toBe('users.read');
    expect(decodeJwtPayload(token.access_token)).toMatchObject({ aud: env.consoleAudience });

    // db-users accepts the token for what the scope allows, and refuses the rest.
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const admin = (await api.findUser(env.admin.username))!;
    expect((await request.get(`/users/api/v1/user/${admin.id}`, { headers })).status()).toBe(200);
    const group = await request.post('/users/api/v1/group', { headers, data: { name: uniqueName('e2e-group') } });
    expect(group.status()).toBe(403);
});

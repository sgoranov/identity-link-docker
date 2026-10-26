import { field, notification } from '../support/antd';
import { uniqueName } from '../support/api';
import { expect, test } from '../support/console';
import { env } from '../support/env';
import {
    chooseAudience,
    groupPageTests,
    openGroups,
    openScopes,
    scopeCheckbox,
    toggleScope,
    type GroupPage,
} from './group-pages';

const clientGroups: GroupPage = {
    path: '/client-groups',
    heading: 'Client Groups',
    members: 'clients',
    createGroup: (api, name, scopes, audience) => api.createClientGroup(name, scopes, audience),
    findGroup: (api, name) => api.findClientGroup(name),
    groupScopes: (api, groupId) => api.clientGroupScopes(groupId),
    addMember: async (api, groupId) => {
        const client = await api.createClient({ groups: [groupId] });
        return async () => (await api.getClient(client.id))!.groups.data;
    },
    systemScopesNote: 'System client group scopes are read-only.',
    scopesHelp: 'Select the scopes this client group should receive for the chosen audience. Changes are saved immediately.',
};

groupPageTests(clientGroups);

test('shows why the service refuses a name that is taken', async ({ page, api }) => {
    const group = await api.createClientGroup(uniqueName('e2e-group'));
    await openGroups(page, clientGroups);

    await page.getByRole('button', { name: 'Create group' }).click();
    const drawer = page.getByRole('dialog', { name: 'Create group' });
    await field(drawer, 'Name').fill(group.name);
    await drawer.getByRole('button', { name: 'Create group' }).click();

    await expect(notification(page, 'Unable to save group')).toContainText(
        `Invalid name. The value "${group.name}" already exists.`,
    );
});

test.describe('scopes', () => {
    test('offers the OpenID Connect scopes for every audience', async ({ page, api }) => {
        const group = await api.createClientGroup(uniqueName('e2e-group'));
        await openGroups(page, clientGroups, group.name);
        const drawer = await openScopes(page, group.name);

        for (const audience of [env.consoleAudience, env.rpClient.audience]) {
            await chooseAudience(drawer, audience);
            const openIdConnect = drawer.locator('section').filter({
                has: page.getByRole('heading', { level: 4, name: 'OpenID Connect' }),
            });
            await expect(openIdConnect.getByRole('checkbox')).toHaveCount(5);
            for (const scope of ['oidc.default', 'openid', 'profile', 'email', 'offline_access']) {
                await expect(scopeCheckbox(openIdConnect, scope)).toBeVisible();
            }
        }

        // The audience of the sign-in client declares no scopes of its own.
        await expect(drawer.getByText('No aliases are available for this audience.')).toBeVisible();
        await expect(drawer.getByText('No individual scopes are available for this audience.')).toBeVisible();
    });

    test('keeps the scopes of each audience apart', async ({ page, api }) => {
        const group = await api.createClientGroup(uniqueName('e2e-group'));
        await openGroups(page, clientGroups, group.name);
        const drawer = await openScopes(page, group.name);

        await chooseAudience(drawer, env.rpClient.audience);
        await toggleScope(drawer, 'oidc.default', true);
        await chooseAudience(drawer, env.consoleAudience);
        await expect(scopeCheckbox(drawer, 'oidc.default')).not.toBeChecked();
        await toggleScope(drawer, 'openid', true);
        await toggleScope(drawer, 'users.read', true);

        const scopes = (await api.clientGroupScopes(group.id)).map(({ audience, scope }) => `${audience} ${scope}`);
        expect(scopes.sort()).toEqual([
            `${env.consoleAudience} openid`,
            `${env.consoleAudience} users.read`,
            `${env.rpClient.audience} oidc.default`,
        ]);
    });
});

import { uniqueName } from '../support/api';
import { expect, test } from '../support/console';
import { env } from '../support/env';
import { chooseAudience, groupPageTests, openGroups, openScopes, type GroupPage } from './group-pages';

const userGroups: GroupPage = {
    path: '/user-groups',
    heading: 'User Groups',
    members: 'users',
    createGroup: (api, name, scopes, audience) => api.createUserGroup(name, scopes, audience),
    findGroup: (api, name) => api.findUserGroup(name),
    groupScopes: (api, groupId) => api.userGroupScopes(groupId),
    addMember: async (api, groupId) => {
        const user = await api.createUser({ groups: [groupId] });
        return async () => (await api.getUser(user.id))!.groups.data;
    },
    systemScopesNote: 'System group scopes are read-only.',
    scopesHelp: 'Select the scopes this group should receive for the chosen audience. Changes are saved immediately.',
};

groupPageTests(userGroups);

test.describe('scopes', () => {
    test('offers no OpenID Connect scopes, which every user holds', async ({ page, api }) => {
        const group = await api.createUserGroup(uniqueName('e2e-group'));
        await openGroups(page, userGroups, group.name);

        const drawer = await openScopes(page, group.name);
        await chooseAudience(drawer, env.consoleAudience);
        await expect(drawer.getByRole('heading', { name: 'Audience scopes' })).toBeVisible();
        await expect(drawer.getByRole('heading', { name: 'OpenID Connect' })).toHaveCount(0);

        // The audience of the sign-in client declares no scopes of its own.
        await chooseAudience(drawer, env.rpClient.audience);
        await expect(drawer.getByText('No scopes are available for this audience.')).toBeVisible();
    });
});

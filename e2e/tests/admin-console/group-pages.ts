import type { Locator, Page } from '@playwright/test';
import {
    chooseOptions,
    columnCells,
    field,
    fieldError,
    notification,
    popconfirm,
    sortBy,
    tableRow,
    tableRows,
} from '../support/antd';
import { uniqueName, type Api, type Group, type GroupScope } from '../support/api';
import { consolePath, expect, search, test } from '../support/console';
import { env } from '../support/env';

// The user groups page and the client groups page are built from the same components. These are the tests they
// share; their spec files add what differs.

export type GroupPage = {
    path: string;
    heading: string;
    // What the groups are assigned to, as the delete confirmation says: users or clients.
    members: 'users' | 'clients';
    createGroup: (api: Api, name: string, scopes?: string[], audience?: string) => Promise<Group>;
    findGroup: (api: Api, name: string) => Promise<Group | undefined>;
    groupScopes: (api: Api, groupId: string) => Promise<GroupScope[]>;
    // Creates a user or a client in the group and returns a function that reads its groups.
    addMember: (api: Api, groupId: string) => Promise<() => Promise<string[]>>;
    systemScopesNote: string;
    scopesHelp: string;
};

export async function openGroups(page: Page, groupPage: GroupPage, name?: string): Promise<void> {
    await page.goto(`${consolePath}${groupPage.path}`);
    await expect(page.getByRole('heading', { level: 2, name: groupPage.heading })).toBeVisible();
    if (name) {
        await search(page, 'Search groups by name', name);
    }
}

export async function openScopes(page: Page, name: string, row = tableRow(page, name)): Promise<Locator> {
    await row.getByRole('button', { name: 'Scopes' }).click();
    const drawer = page.getByRole('dialog', { name: `Scopes for ${name}` });
    await expect(drawer).toBeVisible();

    return drawer;
}

export async function chooseAudience(drawer: Locator, audience: string): Promise<void> {
    await chooseOptions(drawer.getByRole('combobox'), [audience]);
    await expect(drawer.locator('.ant-select-content')).toHaveText(audience);
}

// The checkbox of a scope or an alias in the scopes drawer.
export function scopeCheckbox(drawer: Locator, scope: string): Locator {
    return drawer.getByRole('checkbox', { name: new RegExp(`^${scope.replace(/\./g, '\\.')} (Scope|Alias) `) });
}

// Clicks the checkbox of a scope, which saves at once, and waits until the drawer shows the saved state.
export async function toggleScope(drawer: Locator, scope: string, checked: boolean): Promise<void> {
    const checkbox = scopeCheckbox(drawer, scope);
    await checkbox.click();
    await expect(checkbox).toBeChecked({ checked });
    await expect(checkbox).toBeEnabled();
}

export function groupPageTests(groupPage: GroupPage): void {
    // Named after the page, as the tests are reported under this file for both pages.
    test.describe(groupPage.heading, () => {
        const { members } = groupPage;

        test('lists a group with the audiences of its scopes', async ({ page, api }) => {
            const withScopes = await groupPage.createGroup(api, uniqueName('e2e-group'), ['users.read', 'users.query']);
            const withoutScopes = await groupPage.createGroup(api, uniqueName('e2e-group'));

            await openGroups(page, groupPage, withScopes.name);
            const cells = tableRow(page, withScopes.name).getByRole('cell');
            await expect(cells.nth(0)).toHaveText(withScopes.name);
            await expect(cells.nth(1)).toHaveText(env.consoleAudience);
            for (const action of ['Scopes', 'Edit', 'Delete']) {
                await expect(cells.nth(2).getByRole('button', { name: action })).toBeEnabled();
            }

            await search(page, 'Search groups by name', withoutScopes.name);
            await expect(tableRow(page, withoutScopes.name).getByRole('cell').nth(1)).toHaveText('None');
        });

        test('a system group cannot be edited, deleted or given scopes', async ({ page }) => {
            await openGroups(page, groupPage, env.system.username);

            // The name cell shows a tag after the name.
            const row = tableRows(page).filter({ hasText: env.system.username });
            await expect(row.getByRole('cell').first()).toContainText(env.system.username);
            await expect(row.getByRole('cell').first().locator('.ant-tag')).toHaveText('System');
            await expect(row.getByRole('button', { name: 'Edit' })).toBeDisabled();
            await expect(row.getByRole('button', { name: 'Delete' })).toBeDisabled();

            const drawer = await openScopes(page, env.system.username, row);
            await expect(drawer.getByText(groupPage.systemScopesNote)).toBeVisible();
            await expect(scopeCheckbox(drawer, 'users.read')).toBeChecked();
            await expect(scopeCheckbox(drawer, 'users.read')).toBeDisabled();
            await expect(scopeCheckbox(drawer, 'users.write')).toBeDisabled();
        });

        test('creates a group', async ({ page, api }) => {
            const name = uniqueName('e2e-group');
            await openGroups(page, groupPage);

            await page.getByRole('button', { name: 'Create group' }).click();
            const drawer = page.getByRole('dialog', { name: 'Create group' });
            await field(drawer, 'Name').fill(name);
            await drawer.getByRole('button', { name: 'Create group' }).click();
            await expect(drawer).toBeHidden();

            expect(await groupPage.findGroup(api, name)).toMatchObject({ name, isSystem: false });
            await search(page, 'Search groups by name', name);
            await expect(tableRow(page, name)).toBeVisible();
        });

        test('the form checks the name before saving', async ({ page }) => {
            await openGroups(page, groupPage);
            await page.getByRole('button', { name: 'Create group' }).click();
            const drawer = page.getByRole('dialog', { name: 'Create group' });

            await drawer.getByRole('button', { name: 'Create group' }).click();
            await expect(fieldError(drawer, 'Name')).toHaveText('Name is required');

            await field(drawer, 'Name').fill('x'.repeat(101));
            await expect(fieldError(drawer, 'Name')).toHaveText('Name must be 100 characters or less');

            await drawer.getByRole('button', { name: 'Cancel' }).click();
            await expect(drawer).toBeHidden();
        });

        test('shows why the service refuses a name', async ({ page, api }) => {
            const name = `${uniqueName('e2e-group')}/invalid`;
            await openGroups(page, groupPage);
            await page.getByRole('button', { name: 'Create group' }).click();
            const drawer = page.getByRole('dialog', { name: 'Create group' });

            await field(drawer, 'Name').fill(name);
            await drawer.getByRole('button', { name: 'Create group' }).click();

            await expect(notification(page, 'Unable to save group')).toContainText('Invalid name. This value is not valid.');
            await expect(drawer).toBeVisible();
            expect(await groupPage.findGroup(api, name)).toBeUndefined();
        });

        test('renames a group', async ({ page, api }) => {
            const group = await groupPage.createGroup(api, uniqueName('e2e-group'), ['users.read']);
            const name = uniqueName('e2e-renamed');
            await openGroups(page, groupPage, group.name);

            await tableRow(page, group.name).getByRole('button', { name: 'Edit' }).click();
            const drawer = page.getByRole('dialog', { name: 'Edit group' });
            await expect(field(drawer, 'Name')).toHaveValue(group.name);
            await field(drawer, 'Name').fill(name);
            await drawer.getByRole('button', { name: 'Save changes' }).click();
            await expect(drawer).toBeHidden();

            expect(await groupPage.findGroup(api, name)).toMatchObject({ id: group.id });
            expect(await groupPage.findGroup(api, group.name)).toBeUndefined();
            // Renaming keeps the scopes.
            expect(await groupPage.groupScopes(api, group.id)).toMatchObject([{ scope: 'users.read' }]);
            await search(page, 'Search groups by name', name);
            await expect(tableRow(page, name)).toBeVisible();
        });

        test(`deletes a group after confirmation, saying how many ${members} it has`, async ({ page, api }) => {
            const unused = await groupPage.createGroup(api, uniqueName('e2e-group'));
            const used = await groupPage.createGroup(api, uniqueName('e2e-group'), ['users.read']);
            const memberGroups = await groupPage.addMember(api, used.id);

            await openGroups(page, groupPage, unused.name);
            await tableRow(page, unused.name).getByRole('button', { name: 'Delete' }).click();
            const confirmation = popconfirm(page, 'Delete group?');
            await expect(confirmation).toContainText(`This deletion is permanent. This group is not assigned to any ${members}.`);
            await confirmation.getByRole('button', { name: 'Cancel' }).click();
            await expect(confirmation).toBeHidden();

            await search(page, 'Search groups by name', used.name);
            const row = tableRow(page, used.name);
            await row.getByRole('button', { name: 'Delete' }).click();
            await expect(confirmation).toContainText(`This group is assigned to 1 ${members}.`);
            await confirmation.getByRole('button', { name: 'Delete' }).click();
            await expect(row).toBeHidden();

            expect(await groupPage.findGroup(api, used.name)).toBeUndefined();
            expect(await memberGroups()).toEqual([]);
            expect(await groupPage.findGroup(api, unused.name)).toBeDefined();
        });

        test('searches and sorts by name, newest first by default', async ({ page, api }) => {
            const tag = uniqueName('sort');
            for (const suffix of ['b', 'c', 'a']) {
                await groupPage.createGroup(api, `${tag}-${suffix}`);
            }
            await openGroups(page, groupPage);
            await search(page, 'Search groups by name', tag);

            const names = await columnCells(page, 'Name');
            await expect(names).toHaveText([`${tag}-a`, `${tag}-c`, `${tag}-b`]);
            await sortBy(page, 'Name');
            await expect(names).toHaveText([`${tag}-a`, `${tag}-b`, `${tag}-c`]);
            await sortBy(page, 'Name');
            await expect(names).toHaveText([`${tag}-c`, `${tag}-b`, `${tag}-a`]);
            await sortBy(page, 'Name');
            await expect(names).toHaveText([`${tag}-a`, `${tag}-c`, `${tag}-b`]);
        });

        test('pages through the groups, ten at a time', async ({ page, api }) => {
            const tag = uniqueName('page');
            for (let i = 0; i < 11; i++) {
                await groupPage.createGroup(api, `${tag}-${String(i).padStart(2, '0')}`);
            }
            await openGroups(page, groupPage);
            await search(page, 'Search groups by name', tag);

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

        test.describe('scopes', () => {
            test('assigns and removes scopes, each saved at once', async ({ page, api }) => {
                const group = await groupPage.createGroup(api, uniqueName('e2e-group'));
                await openGroups(page, groupPage, group.name);

                const drawer = await openScopes(page, group.name);
                await expect(drawer.getByText(groupPage.scopesHelp)).toBeVisible();
                await chooseAudience(drawer, env.consoleAudience);
                await expect(scopeCheckbox(drawer, 'users.read')).not.toBeChecked();

                await toggleScope(drawer, 'users.read', true);
                await toggleScope(drawer, 'identity-link.core', true);
                expect(sortScopes(await groupPage.groupScopes(api, group.id))).toEqual([
                    { audience: env.consoleAudience, scope: 'identity-link.core' },
                    { audience: env.consoleAudience, scope: 'users.read' },
                ]);

                await toggleScope(drawer, 'users.read', false);
                expect(sortScopes(await groupPage.groupScopes(api, group.id))).toEqual([
                    { audience: env.consoleAudience, scope: 'identity-link.core' },
                ]);

                await drawer.getByRole('button', { name: 'Close' }).click();
                await expect(drawer).toBeHidden();
                await expect(tableRow(page, group.name).getByRole('cell').nth(1)).toHaveText(env.consoleAudience);

                // The drawer shows the saved scopes when it opens again.
                const reopened = await openScopes(page, group.name);
                await expect(scopeCheckbox(reopened, 'identity-link.core')).toBeChecked();
                await expect(scopeCheckbox(reopened, 'users.read')).not.toBeChecked();
            });

            test('offers the aliases and scopes of the audience', async ({ page, api }) => {
                const group = await groupPage.createGroup(api, uniqueName('e2e-group'));
                await openGroups(page, groupPage, group.name);

                const drawer = await openScopes(page, group.name);
                await chooseAudience(drawer, env.consoleAudience);
                const audienceScopes = drawer.locator('section').filter({
                    has: page.getByRole('heading', { level: 4, name: 'Audience scopes' }),
                });
                await expect(audienceScopes.getByRole('checkbox', { name: / Alias / })).toHaveCount(2);
                await expect(scopeCheckbox(audienceScopes, 'identity-link.core')).toBeVisible();
                await expect(scopeCheckbox(audienceScopes, 'identity-link.all')).toBeVisible();
                await expect(audienceScopes.getByRole('checkbox', { name: / Scope / })).toHaveCount(23);
                await expect(scopeCheckbox(audienceScopes, 'users.delete')).toHaveAccessibleName('users.delete Scope Delete users');
            });
        });
    });
}

function sortScopes(scopes: GroupScope[]): { audience: string; scope: string }[] {
    return scopes
        .map(({ audience, scope }) => ({ audience, scope }))
        .sort((a, b) => a.scope.localeCompare(b.scope));
}

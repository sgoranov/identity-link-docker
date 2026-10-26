import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';
import { chooseOptions } from './antd';
import { Api } from './api';
import { env } from './env';
import { submitLogin } from './oidc';

export { expect };

// The path of the admin console behind the proxy.
export const consolePath = '/admin-console';

// The browser state of tests that sign in themselves, with test.use({ storageState: noSession }). The other tests
// start signed in as the administrator.
export const noSession = { cookies: [], origins: [] };

type StorageState = Awaited<ReturnType<BrowserContext['storageState']>>;

export type Credentials = { username: string; password: string };

// Signs in to the console from its start page, the profile, through the login form of Identity Link.
export async function signInToConsole(page: Page, credentials: Credentials): Promise<void> {
    await page.goto(`${consolePath}/`);
    await page.waitForURL((url) => url.pathname.startsWith('/login/'));
    await submitLogin(page, credentials);
    await page.waitForURL((url) => url.pathname.startsWith(consolePath));
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
}

// Opens a page from the menu in the header: a top-level item, or an item of its submenu.
export async function openFromMenu(page: Page, item: string, subitem?: string): Promise<void> {
    await page.getByRole('banner').getByRole('menuitem', { name: item }).click();
    if (subitem) {
        await page.getByRole('menuitem', { name: subitem, exact: true }).click();
    }
}

// Types into the search box of a list page and waits for the search, which starts 300 ms after the last key. Until
// then the page still shows what it showed before.
export async function search(page: Page, placeholder: string, term: string): Promise<void> {
    const searched = page.waitForResponse((response) => {
        const body = response.request().postData() ?? '';
        return response.url().endsWith('/api/v1/query') && (term ? body.includes(`"%${term}%"`) : !body.includes(' LIKE '));
    });
    await page.getByPlaceholder(placeholder, { exact: true }).fill(term);
    await searched;
}

// Searches the users page in one of its fields.
export async function searchUsers(page: Page, field: 'Name' | 'Email' | 'Username', term: string): Promise<void> {
    await chooseOptions(page.getByRole('main').getByRole('combobox').first(), [field]);
    await search(page, 'Search users', term);
}

type Fixtures = {
    // The APIs of the services, to set up records and check what the console saved.
    api: Api;
    // Opens a page in a new browser context: signed in with these credentials, as the administrator, or without a
    // session. For tests that need a second user next to the page of the test.
    newSession: (session?: Credentials | 'administrator') => Promise<Page>;
};

type WorkerFixtures = {
    // The browser state of a signed-in administrator.
    administratorState: () => Promise<StorageState>;
};

export const test = base.extend<Fixtures, WorkerFixtures>({
    storageState: async ({ administratorState }, use) => {
        await use(await administratorState());
    },

    // Signs in once per worker and shares the session. The session ends with its access token, 15 minutes after
    // the sign-in, so it signs in again when the session is 10 minutes old. Tests with it must not sign out.
    administratorState: [
        async ({ browser }, use) => {
            let state: StorageState | undefined;
            let signedInAt = 0;
            await use(async () => {
                if (!state || Date.now() - signedInAt > 10 * 60 * 1000) {
                    const context = await browser.newContext({
                        baseURL: env.baseUrl,
                        ignoreHTTPSErrors: true,
                        storageState: noSession,
                    });
                    await signInToConsole(await context.newPage(), env.admin);
                    state = await context.storageState();
                    signedInAt = Date.now();
                    await context.close();
                }

                return state;
            });
        },
        { scope: 'worker' },
    ],

    api: async ({}, use) => {
        const api = await Api.create();
        await use(api);
        await api.dispose();
    },

    newSession: async ({ browser, administratorState }, use) => {
        const contexts: BrowserContext[] = [];
        await use(async (session) => {
            // The context gets the options of the test, such as baseURL, but for the storage state.
            const context = await browser.newContext({
                storageState: session === 'administrator' ? await administratorState() : noSession,
            });
            contexts.push(context);
            const page = await context.newPage();
            if (session && session !== 'administrator') {
                await signInToConsole(page, session);
            }

            return page;
        });
        for (const context of contexts) {
            await context.close();
        }
    },
});

import type { Page } from '@playwright/test';
import { expect, test } from './support/api';
import { env } from './support/env';
import { authorizationUrl, authorizeInBrowser, createPkce, fetchDiscovery, submitLogin } from './support/oidc';

// The services limit failed logins and password reset requests per client address, which they take from the
// X-Forwarded-For header the proxy sends. The proxy sets it to the address the request comes from and drops the one
// the client sent, so a client cannot escape the limits with a header of its own.
//
// Core locks a username after five failed logins from one address, for ten minutes, and allows 20 failed logins from
// one address in ten minutes. The tests all come from the runner's address and the test below fails five logins, so
// a deployment kept with --keep runs it three times in ten minutes; the fourth run locks out the tests after it.

// Submits the login form and waits for core to show it again, with the error.
async function submitRefusedLogin(page: Page, credentials: { username: string; password: string }): Promise<void> {
    const loginUrl = page.url();
    const shownAgain = page.waitForResponse(
        (response) => response.request().method() === 'GET' && response.url() === loginUrl,
    );
    await submitLogin(page, credentials);
    await shownAgain;
}

test('failed logins lock the username, also for a client that sends its own X-Forwarded-For', async ({ page, request, api }) => {
    const user = await api.createUser();
    const discovery = await fetchDiscovery(request);
    await page.goto(authorizationUrl(discovery, env.rpClient, {
        scope: 'openid',
        state: 'rate-limits',
        codeChallenge: createPkce().challenge,
    }));

    const error = page.getByRole('alert');
    for (let attempt = 1; attempt <= 5; attempt++) {
        await submitRefusedLogin(page, { username: user.username, password: 'not-the-password' });
        await expect(error).toHaveText('Invalid username or password.');
    }

    await submitRefusedLogin(page, user);
    await expect(error).toContainText('Too many login attempts.');

    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': '203.0.113.7' });
    await submitRefusedLogin(page, user);
    await expect(error).toContainText('Too many login attempts.');
    await page.setExtraHTTPHeaders({});

    // The lock is the username's: another user signs in from the same address.
    const otherUser = await api.createUser();
    const callback = await authorizeInBrowser(page, discovery, env.rpClient, otherUser, {
        scope: 'openid',
        state: 'rate-limits',
        codeChallenge: createPkce().challenge,
    });
    expect(callback.searchParams.get('code'), callback.toString()).toBeTruthy();
});

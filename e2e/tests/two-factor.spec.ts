import type { APIRequestContext, Page } from '@playwright/test';
import { notification, setSwitch } from './support/antd';
import { expect, requestClientToken, test, uniqueName, type User } from './support/api';
import { consolePath, signInToConsole } from './support/console';
import { env } from './support/env';
import {
    createPkce,
    decodeJwtPayload,
    exchangeCode,
    fetchDiscovery,
    startAuthorization,
    submitLogin,
    waitForCallback,
    type Discovery,
} from './support/oidc';
import { currentCode, enroll, enterCode, totp, verificationHeading, wrongCode } from './support/two-factor';

// Two-factor authentication at sign-in. The deployment turns it on (LOGIN_TWO_FA_ENABLED), and core sends a user who
// has it turned on to the 2FA service after the password. At the first sign-in the service has them add a secret to
// an authenticator app; from then on it asks for the app's code. An administrator can reset the secret through the
// API of the 2FA service, and the user sets up a new one at their next sign-in.

type Credentials = { username: string; password: string };

type SignIn = { discovery: Discovery; verifier: string };

// Starts a sign-in to an application, by default the one e2e/run.sh registers, up to the 2FA service.
async function startSignIn(
    page: Page,
    request: APIRequestContext,
    user: Credentials,
    client: { id: string; redirectUri: string } = env.rpClient,
): Promise<SignIn> {
    const discovery = await fetchDiscovery(request);
    const pkce = createPkce();
    await startAuthorization(page, discovery, client, user, {
        scope: 'openid',
        state: 'two-factor',
        codeChallenge: pkce.challenge,
    });

    return { discovery, verifier: pkce.verifier };
}

// Enters the code on the verification page and checks that the application gets the user's tokens.
async function finishSignIn(page: Page, request: APIRequestContext, signIn: SignIn, user: User, code: string): Promise<void> {
    const callback = waitForCallback(page, env.rpClient);
    await enterCode(page, code);
    const tokens = await exchangeCode(request, signIn.discovery, env.rpClient, await callback, signIn.verifier);
    expect(decodeJwtPayload(tokens.id_token!)).toMatchObject({ sub: user.id });
}

// A user with two-factor authentication who has signed in once, and so set it up. Returns the secret.
async function enrolledUser(page: Page, request: APIRequestContext, user: User & Credentials): Promise<string> {
    const signIn = await startSignIn(page, request, user);
    const secret = await enroll(page);
    await finishSignIn(page, request, signIn, user, await currentCode(secret));

    return secret;
}

test('at the first sign-in, a user sets up an authenticator app and enters its code', async ({ page, request, api }) => {
    const user = await api.createUser({ twoFaEnabled: true });

    const signIn = await startSignIn(page, request, user);
    await expect(page).toHaveURL(/\/2fa\/2fa\/enroll\//);
    const secret = await enroll(page);
    await finishSignIn(page, request, signIn, user, await currentCode(secret));
});

test('at later sign-ins, the user enters only the code', async ({ page, request, api }) => {
    const user = await api.createUser({ twoFaEnabled: true });
    const secret = await enrolledUser(page, request, user);

    const signIn = await startSignIn(page, request, user);
    await expect(verificationHeading(page)).toBeVisible();
    await expect(page).toHaveURL(/\/2fa\/2fa\/verify\//);
    await finishSignIn(page, request, signIn, user, await currentCode(secret));
});

test('a wrong code is refused, and the user can try again', async ({ page, request, api }) => {
    const user = await api.createUser({ twoFaEnabled: true });
    const secret = await enrolledUser(page, request, user);

    const signIn = await startSignIn(page, request, user);
    await enterCode(page, wrongCode(secret));
    await expect(page.getByRole('alert')).toHaveText('Invalid code. Please try again.');
    await expect(page).toHaveURL(/\/2fa\/2fa\/verify\//);

    await finishSignIn(page, request, signIn, user, await currentCode(secret));
});

test('after a reset of the secret, the user sets up a new one at the next sign-in', async ({ page, request, api }) => {
    const user = await api.createUser({ twoFaEnabled: true });
    const oldSecret = await enrolledUser(page, request, user);

    await api.resetTwoFaSecret(user.id);

    const signIn = await startSignIn(page, request, user);
    const newSecret = await enroll(page);
    expect(newSecret).not.toBe(oldSecret);

    await enterCode(page, totp(oldSecret));
    await expect(page.getByRole('alert')).toHaveText('Invalid code. Please try again.');
    await finishSignIn(page, request, signIn, user, await currentCode(newSecret));
});

test('resetting the secret needs the 2fa.reset scope', async ({ page, request, api }) => {
    const user = await api.createUser({ twoFaEnabled: true });
    const secret = await enrolledUser(page, request, user);

    // A client with every other scope of the 2FA service.
    const group = await api.createClientGroup(uniqueName('e2e-group'), ['2fa.read', '2fa.write']);
    const client = await api.createClient({ audience: env.consoleAudience, groups: [group.id] });
    const { password } = await api.issueSecret(client.id);
    const tokenResponse = await requestClientToken(request, { id: client.id, secret: password }, '2fa.read 2fa.write');
    expect(tokenResponse.status(), await tokenResponse.text()).toBe(200);
    const token = (await tokenResponse.json()).access_token;

    const reset = await request.put(`/2fa/api/v1/user/${user.id}/reset-secret`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    expect(reset.status()).toBe(403);

    // The secret still works.
    const signIn = await startSignIn(page, request, user);
    await finishSignIn(page, request, signIn, user, await currentCode(secret));
});

test('with consent, the user enters the code first and then allows the application', async ({ page, request, api }) => {
    const client = await api.createSignInClient({ consentRequired: true });
    const user = await api.createUser({ twoFaEnabled: true });

    const signIn = await startSignIn(page, request, user, client);
    const secret = await enroll(page);
    await enterCode(page, await currentCode(secret));
    await expect(page.getByRole('heading', { name: 'Access Request' })).toBeVisible();

    const callback = waitForCallback(page, client);
    await page.getByRole('button', { name: 'Allow' }).click();
    const tokens = await exchangeCode(request, signIn.discovery, client, await callback, signIn.verifier);
    expect(decodeJwtPayload(tokens.id_token!)).toMatchObject({ sub: user.id, aud: client.id });
});

test('a user who turns it on in the console sets it up at the next sign-in to the console', async ({ page, api }) => {
    const user = await api.createConsoleUser(['users.query', 'users.self.update']);
    await signInToConsole(page, user);

    const main = page.getByRole('main');
    await setSwitch(main, 'Two-factor authentication', true);
    await main.getByRole('button', { name: 'Save changes' }).click();
    await expect(notification(page, 'Profile updated')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(`${env.baseUrl}${consolePath}/logout-success`);

    await page.goto(`${consolePath}/`);
    await page.waitForURL((url) => url.pathname.startsWith('/login/'));
    await submitLogin(page, user);
    const secret = await enroll(page);
    await enterCode(page, await currentCode(secret));
    await page.waitForURL((url) => url.pathname.startsWith(consolePath));
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
});

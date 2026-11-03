import { expect, strongPassword, test, uniqueName } from './support/api';
import { env } from './support/env';
import { emailsTo, waitForEmail } from './support/mail';
import {
    authorizationUrl,
    createPkce,
    decodeJwtPayload,
    exchangeCode,
    fetchDiscovery,
    submitLogin,
    waitForCallback,
} from './support/oidc';

// Password reset. The login form links to db-users, which emails the user a link to a form for a new password, and
// then sends them back to the login form of the same sign-in. docker-compose.e2e.yml turns it on and catches the
// emails.
//
// db-users accepts five reset requests an hour from one address, and the tests all come from the runner's, so they
// send one each: two a run. A deployment kept with --keep runs them twice within an hour.

const checkEmailMessage = 'If your email exists in our system, you will receive a link to reset your password.';

test('a user resets a forgotten password and signs in with the new one', async ({ page, request, api }) => {
    const user = await api.createUser();
    const discovery = await fetchDiscovery(request);
    const pkce = createPkce();
    await page.goto(authorizationUrl(discovery, env.rpClient, {
        scope: 'openid',
        state: 'reset-password',
        codeChallenge: pkce.challenge,
    }));
    const loginUrl = page.url();

    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email address').fill(user.email);
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(checkEmailMessage)).toBeVisible();

    const email = await waitForEmail(user.email);
    expect(email.subject).toBe('Your password reset request');
    const link = email.text.match(/https:\/\/\S+\/reset-password\/\S+/)?.[0];
    expect(link, email.text).toBeDefined();
    expect(link!.startsWith(`${env.baseUrl}/users/reset-password/`), link).toBe(true);

    await test.step('the form refuses a weak password', async () => {
        await page.goto(link!);
        await page.getByLabel('New password', { exact: true }).fill('password1');
        await page.getByLabel('Confirm password', { exact: true }).fill('password1');
        await page.getByRole('button', { name: 'Submit' }).click();
        await expect(page.getByText('The password is too weak.')).toBeVisible();
        expect(await api.checkPassword(user.username, user.password)).toBe(true);
    });

    const password = strongPassword();
    await page.getByLabel('New password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText('Password successfully changed. You can now log in here.')).toBeVisible();
    expect(await api.checkPassword(user.username, user.password)).toBe(false);

    await test.step('the user signs in with the new password where they left off', async () => {
        await page.getByRole('link', { name: 'log in here' }).click();
        await expect(page).toHaveURL(loginUrl);
        const callback = waitForCallback(page, env.rpClient);
        await submitLogin(page, { username: user.username, password });
        const tokens = await exchangeCode(request, discovery, env.rpClient, await callback, pkce.verifier);
        expect(decodeJwtPayload(tokens.id_token!)).toMatchObject({ sub: user.id });
    });

    await test.step('the link works only once', async () => {
        await page.goto(link!);
        await expect(page.getByText('Invalid or expired reset token.')).toBeVisible();
        await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
    });
});

test('an unknown address gets the same answer, and no email', async ({ page, request }) => {
    const address = `${uniqueName('e2e-nobody')}@example.test`;
    const discovery = await fetchDiscovery(request);
    await page.goto(authorizationUrl(discovery, env.rpClient, {
        scope: 'openid',
        state: 'reset-password',
        codeChallenge: createPkce().challenge,
    }));
    const loginUrl = page.url();

    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    await page.getByLabel('Email address').fill(address);
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(checkEmailMessage)).toBeVisible();
    // db-users sends the email before it answers, so none comes later.
    expect(await emailsTo(address)).toEqual([]);

    await page.getByRole('link', { name: 'Back to login' }).click();
    await expect(page).toHaveURL(loginUrl);
});

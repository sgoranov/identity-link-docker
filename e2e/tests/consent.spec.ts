import { expect, test } from './support/api';
import { createPkce, decodeJwtPayload, exchangeCode, fetchDiscovery, startAuthorization, waitForCallback } from './support/oidc';

// An application whose client requires consent asks the user, after they sign in, to allow it the scopes it
// requested. Core shows the consent screen with the client's details from db-clients.

test('an application that requires consent asks for it, and Allow signs the user in', async ({ page, request, api }) => {
    const urls = {
        applicationUrl: 'https://app.example.test/',
        privacyPolicyUrl: 'https://app.example.test/privacy',
        termsOfServiceUrl: 'https://app.example.test/terms',
    };
    const client = await api.createSignInClient({ consentRequired: true, ...urls });
    const user = await api.createUser();
    const discovery = await fetchDiscovery(request);
    const pkce = createPkce();

    await startAuthorization(page, discovery, client, user, {
        scope: 'openid profile email',
        state: 'consent',
        codeChallenge: pkce.challenge,
    });

    await expect(page.getByRole('heading', { name: 'Access Request' })).toBeVisible();
    await expect(page.getByText(`${client.name} would like to access your account.`)).toBeVisible();
    await expect(page.getByRole('link', { name: client.name })).toHaveAttribute('href', urls.applicationUrl);
    await expect(page.locator('.list-group-item .fw-bold')).toHaveText([
        'Sign you in', 'Basic profile information', 'Email address',
    ]);
    await expect(page.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', urls.privacyPolicyUrl);
    await expect(page.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', urls.termsOfServiceUrl);

    const callback = waitForCallback(page, client);
    await page.getByRole('button', { name: 'Allow' }).click();
    const redirect = await callback;
    expect(redirect.searchParams.get('state')).toBe('consent');

    const tokens = await exchangeCode(request, discovery, client, redirect, pkce.verifier);
    expect(decodeJwtPayload(tokens.id_token!)).toMatchObject({ sub: user.id, aud: client.id });
});

test('Deny sends the user back to the application without a code', async ({ page, request, api }) => {
    const client = await api.createSignInClient({ consentRequired: true });
    const user = await api.createUser();
    const discovery = await fetchDiscovery(request);

    await startAuthorization(page, discovery, client, user, {
        scope: 'openid',
        state: 'denied',
        codeChallenge: createPkce().challenge,
    });
    await expect(page.getByRole('heading', { name: 'Access Request' })).toBeVisible();

    const callback = waitForCallback(page, client);
    await page.getByRole('button', { name: 'Deny' }).click();
    const redirect = await callback;
    expect(redirect.searchParams.get('error')).toBe('access_denied');
    expect(redirect.searchParams.get('state')).toBe('denied');
    expect(redirect.searchParams.get('code')).toBeNull();
});

test('an application that does not require consent signs the user in without asking', async ({ page, request, api }) => {
    const client = await api.createSignInClient({ consentRequired: false });
    const user = await api.createUser();
    const discovery = await fetchDiscovery(request);
    const pkce = createPkce();
    // Every request of the page, also each step of a redirect.
    const visited: string[] = [];
    page.on('request', (request) => visited.push(request.url()));

    const callback = waitForCallback(page, client);
    await startAuthorization(page, discovery, client, user, {
        scope: 'openid profile email',
        state: 'no-consent',
        codeChallenge: pkce.challenge,
    });
    const redirect = await callback;

    const tokens = await exchangeCode(request, discovery, client, redirect, pkce.verifier);
    expect(decodeJwtPayload(tokens.id_token!)).toMatchObject({ sub: user.id });
    expect(visited.filter((url) => url.includes('/consent-screen/'))).toEqual([]);
});

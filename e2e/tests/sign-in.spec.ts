import { expect, test } from '@playwright/test';
import { env } from './support/env';
import { authorizeInBrowser, basicAuth, createPkce, decodeJwtPayload, fetchDiscovery, requestToken } from './support/oidc';

// The sign-in flow of an application registered with bin/create-client.sh, as the README describes it:
// authorization code with PKCE, then the tokens and the user's claims from UserInfo.
test('an application signs a user in with the authorization code flow', async ({ page, request }) => {
    const client = env.rpClient;
    const discovery = await fetchDiscovery(request);
    const pkce = createPkce();
    const state = crypto.randomUUID();

    const callback = await authorizeInBrowser(page, discovery, client, env.admin, {
        scope: 'openid profile email',
        state,
        codeChallenge: pkce.challenge,
    });
    expect(callback.searchParams.get('error')).toBeNull();
    expect(callback.searchParams.get('state')).toBe(state);
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await requestToken(request, discovery, client, {
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: client.redirectUri,
        code_verifier: pkce.verifier,
    });
    expect(token.token_type).toBe('Bearer');
    expect(token.id_token).toBeTruthy();

    const idToken = decodeJwtPayload(token.id_token!);
    expect(idToken.iss).toBe(discovery.issuer);
    expect([idToken.aud].flat()).toContain(client.id);

    const userInfo = await request.get(discovery.userinfo_endpoint, {
        headers: { Authorization: `Bearer ${token.access_token}` },
    });
    expect(userInfo.status()).toBe(200);
    expect(await userInfo.json()).toEqual(
        expect.objectContaining({
            sub: idToken.sub,
            email: `${env.admin.username}@${new URL(env.baseUrl).hostname}`,
        }),
    );
});

test('the token endpoint rejects a code with the wrong PKCE verifier', async ({ page, request }) => {
    const client = env.rpClient;
    const discovery = await fetchDiscovery(request);

    const callback = await authorizeInBrowser(page, discovery, client, env.admin, {
        scope: 'openid',
        state: crypto.randomUUID(),
        codeChallenge: createPkce().challenge,
    });
    const code = callback.searchParams.get('code');
    expect(code).toBeTruthy();

    const response = await request.post(discovery.token_endpoint, {
        headers: { Authorization: basicAuth(client.id, client.secret) },
        form: {
            grant_type: 'authorization_code',
            code: code!,
            redirect_uri: client.redirectUri,
            code_verifier: createPkce().verifier,
        },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe('invalid_grant');
});

import { expect, test } from '@playwright/test';
import { env } from './support/env';
import { fetchDiscovery } from './support/oidc';

test('publishes the discovery document with endpoints on the public domain', async ({ request }) => {
    const discovery = await fetchDiscovery(request);

    // The endpoints are built from the X-Forwarded-* headers the proxy sets, so they show whether it forwards them.
    expect(discovery.authorization_endpoint).toBe(`${env.baseUrl}/oauth2/auth`);
    expect(discovery.token_endpoint).toBe(`${env.baseUrl}/oauth2/token`);
    expect(discovery.userinfo_endpoint).toBe(`${env.baseUrl}/user-info`);
    expect(discovery.jwks_uri).toBe(`${env.baseUrl}/jwks`);
    expect(discovery.introspection_endpoint).toBe(`${env.baseUrl}/oauth2/token/introspect`);
});

// OpenID Connect Discovery 1.0, section 4: libraries that find the provider from its issuer request the document at
// <issuer>/.well-known/openid-configuration, and check that its issuer is the one they asked for.
test('publishes the discovery document under the issuer', async ({ request }) => {
    const discovery = await fetchDiscovery(request);
    expect(new URL(discovery.issuer).pathname).not.toBe('/');

    const response = await request.get(`${discovery.issuer}/.well-known/openid-configuration`);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(discovery);
});

test('publishes the discovery document under no other path', async ({ request }) => {
    const response = await request.get('/not-the-issuer/.well-known/openid-configuration');
    expect(response.status()).toBe(404);
});

test('publishes a signing key in the JWKS', async ({ request }) => {
    const discovery = await fetchDiscovery(request);

    const response = await request.get(discovery.jwks_uri);
    expect(response.status()).toBe(200);

    const { keys } = await response.json();
    expect(keys).toEqual(expect.arrayContaining([expect.objectContaining({ kty: 'RSA', kid: expect.any(String) })]));
});

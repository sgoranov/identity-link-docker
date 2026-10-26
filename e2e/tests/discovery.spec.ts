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

test('publishes a signing key in the JWKS', async ({ request }) => {
    const discovery = await fetchDiscovery(request);

    const response = await request.get(discovery.jwks_uri);
    expect(response.status()).toBe(200);

    const { keys } = await response.json();
    expect(keys).toEqual(expect.arrayContaining([expect.objectContaining({ kty: 'RSA', kid: expect.any(String) })]));
});

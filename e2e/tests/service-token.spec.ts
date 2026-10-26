import { expect, test } from '@playwright/test';
import { env } from './support/env';
import { fetchDiscovery, requestToken } from './support/oidc';

// A client_credentials token issued by identity-link-core is accepted by the services behind the proxy,
// which check it against core's JWKS.
test('a client_credentials token from core is accepted by db-users and db-clients', async ({ request }) => {
    const discovery = await fetchDiscovery(request);
    const token = await requestToken(request, discovery, env.bffClient, {
        grant_type: 'client_credentials',
        // Without a scope parameter the token carries no scopes, and the services answer 403.
        scope: 'users.query clients.query',
    });
    expect(token.token_type).toBe('Bearer');

    const headers = { Authorization: `Bearer ${token.access_token}` };

    const users = await request.post('/users/api/v1/query', {
        headers,
        data: { type: 'User', alias: 't', query: 't.username = :username', parameters: { username: env.admin.username } },
    });
    expect(users.status(), await users.text()).toBe(200);
    expect((await users.json()).response.result).toEqual([expect.objectContaining({ username: env.admin.username })]);

    const clients = await request.post('/clients/api/v1/query', {
        headers,
        data: { type: 'Client', alias: 't', query: 't.id = :id', parameters: { id: env.rpClient.id } },
    });
    expect(clients.status(), await clients.text()).toBe(200);
    expect((await clients.json()).response.result).toEqual([expect.objectContaining({ id: env.rpClient.id })]);
});

test('db-users rejects a request without a token', async ({ request }) => {
    const response = await request.post('/users/api/v1/query', { data: { type: 'User', alias: 't' } });

    expect(response.status()).toBe(401);
});

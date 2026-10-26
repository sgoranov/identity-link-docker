import { createHash, randomBytes } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export type Discovery = {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    userinfo_endpoint: string;
    jwks_uri: string;
    introspection_endpoint: string;
};

export type TokenResponse = {
    token_type: string;
    expires_in: number;
    access_token: string;
    refresh_token?: string;
    id_token?: string;
    scope?: string;
};

export async function fetchDiscovery(request: APIRequestContext): Promise<Discovery> {
    const response = await request.get('/.well-known/openid-configuration');
    expect(response.status()).toBe(200);

    return response.json();
}

// Identity Link supports only client_secret_basic at the token endpoint.
export function basicAuth(clientId: string, clientSecret: string): string {
    return 'Basic ' + Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64');
}

export async function requestToken(
    request: APIRequestContext,
    discovery: Discovery,
    client: { id: string; secret: string },
    form: Record<string, string>,
): Promise<TokenResponse> {
    const response = await request.post(discovery.token_endpoint, {
        headers: { Authorization: basicAuth(client.id, client.secret) },
        form,
    });
    expect(response.status(), await response.text()).toBe(200);

    return response.json();
}

export function createPkce(): { verifier: string; challenge: string } {
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');

    return { verifier, challenge };
}

// Fills in and submits the Identity Link login form shown during an authorization request.
export async function submitLogin(page: Page, credentials: { username: string; password: string }): Promise<void> {
    await page.locator('[name="login[user_id]"]').fill(credentials.username);
    await page.locator('[name="login[password]"]').fill(credentials.password);
    await page.locator('[name="login[submit]"]').click();
}

// Runs an authorization request in the browser up to the redirect back to the client and returns that redirect.
// The client's application does not exist, so the browser's request to the redirect URI fails; it still carries
// the code and state. page.route() cannot answer it, because it is the end of a redirect chain.
export async function authorizeInBrowser(
    page: Page,
    discovery: Discovery,
    client: { id: string; redirectUri: string },
    credentials: { username: string; password: string },
    params: { scope: string; state: string; codeChallenge: string },
): Promise<URL> {
    const callback = page.waitForRequest((request) => request.url().startsWith(client.redirectUri));

    const authorizationUrl = new URL(discovery.authorization_endpoint);
    authorizationUrl.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.id,
        redirect_uri: client.redirectUri,
        scope: params.scope,
        state: params.state,
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
    }).toString();

    await page.goto(authorizationUrl.toString());
    await submitLogin(page, credentials);

    return new URL((await callback).url());
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
    const [, payload] = jwt.split('.');

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

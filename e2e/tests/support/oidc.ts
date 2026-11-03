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

export type AuthorizationParams = { scope: string; state: string; codeChallenge: string };

// The URL of an authorization request of the client, with PKCE.
export function authorizationUrl(
    discovery: Discovery,
    client: { id: string; redirectUri: string },
    params: AuthorizationParams,
): string {
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
        response_type: 'code',
        client_id: client.id,
        redirect_uri: client.redirectUri,
        scope: params.scope,
        state: params.state,
        code_challenge: params.codeChallenge,
        code_challenge_method: 'S256',
    }).toString();

    return url.toString();
}

// Opens an authorization request in the browser and signs in on the login form. The request then goes on to
// two-factor authentication or consent, if they apply, and ends with the redirect back to the client.
export async function startAuthorization(
    page: Page,
    discovery: Discovery,
    client: { id: string; redirectUri: string },
    credentials: { username: string; password: string },
    params: AuthorizationParams,
): Promise<void> {
    await page.goto(authorizationUrl(discovery, client, params));
    await submitLogin(page, credentials);
}

// Waits for the redirect back to the client that ends an authorization request and returns it. Call it before the
// step that ends the request. The client's application does not exist, so the browser's request to the redirect
// URI fails; it still carries the code and state. page.route() cannot answer it, because it is the end of a
// redirect chain.
export async function waitForCallback(page: Page, client: { redirectUri: string }): Promise<URL> {
    const request = await page.waitForRequest((request) => request.url().startsWith(client.redirectUri));

    return new URL(request.url());
}

// Runs an authorization request in the browser up to the redirect back to the client and returns that redirect.
export async function authorizeInBrowser(
    page: Page,
    discovery: Discovery,
    client: { id: string; redirectUri: string },
    credentials: { username: string; password: string },
    params: AuthorizationParams,
): Promise<URL> {
    const callback = waitForCallback(page, client);
    await startAuthorization(page, discovery, client, credentials, params);

    return callback;
}

// Exchanges the code of the redirect back to the client for the tokens.
export async function exchangeCode(
    request: APIRequestContext,
    discovery: Discovery,
    client: { id: string; secret: string; redirectUri: string },
    callback: URL,
    codeVerifier: string,
): Promise<TokenResponse> {
    const code = callback.searchParams.get('code');
    expect(code, callback.toString()).toBeTruthy();

    return requestToken(request, discovery, client, {
        grant_type: 'authorization_code',
        code: code!,
        redirect_uri: client.redirectUri,
        code_verifier: codeVerifier,
    });
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
    const [, payload] = jwt.split('.');

    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

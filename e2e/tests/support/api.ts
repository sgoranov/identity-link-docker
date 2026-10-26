import { randomBytes } from 'node:crypto';
import { expect, request, type APIRequestContext, type APIResponse } from '@playwright/test';
import { env } from './env';
import { basicAuth } from './oidc';

// The records of db-users and db-clients, as their APIs return them.

export type User = {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    groups: { data: string[]; hasMore: boolean };
    grantTypes: string[];
    isSystem: boolean;
    twoFaEnabled: boolean;
};

export type Group = {
    id: string;
    name: string;
    isSystem: boolean;
};

export type GroupScope = {
    id: string;
    audience: string;
    scope: string;
};

export type Client = {
    id: string;
    name: string;
    description: string;
    audience: string;
    redirectUri: string[];
    groups: { data: string[]; hasMore: boolean };
    grantTypes: string[];
    public: boolean;
    isSystem: boolean;
    consentRequired: boolean;
    applicationUrl: string | null;
    termsOfServiceUrl: string | null;
    privacyPolicyUrl: string | null;
    logoUrl: string | null;
};

export type Secret = {
    id: string;
    passwordHint: string;
    expirationDateTime: string;
    client: string;
    isSystem: boolean;
};

export type UserInput = Omit<User, 'id' | 'groups' | 'isSystem'> & { password: string; groups: string[] };

export type ClientInput = Omit<Client, 'id' | 'groups' | 'isSystem' | 'public'> & { groups: string[]; isPublic: boolean };

// A name no other test uses, also on a deployment kept from an earlier run. It is valid for every kind of record.
export function uniqueName(prefix: string): string {
    return `${prefix}-${randomBytes(4).toString('hex')}`;
}

// A password that passes the password strength check, which the deployment enables.
export function strongPassword(): string {
    return `${randomBytes(12).toString('base64url')}-Kq7`;
}

// Requests a token with the client credentials grant and returns the response, whatever its status.
export async function requestClientToken(
    context: APIRequestContext,
    client: { id: string; secret: string },
    scope: string,
): Promise<APIResponse> {
    return context.post('/oauth2/token', {
        headers: { Authorization: basicAuth(client.id, client.secret) },
        form: { grant_type: 'client_credentials', scope },
    });
}

// The APIs of db-users and db-clients through the proxy, with a token of the BFF client, whose group holds every
// Identity Link scope. The tests use it to set up the records they need and to check what the console saved.
export class Api {
    private constructor(
        private readonly context: APIRequestContext,
        private readonly token: string,
    ) {}

    static async create(): Promise<Api> {
        const context = await request.newContext({ baseURL: env.baseUrl, ignoreHTTPSErrors: true });
        const response = await requestClientToken(context, env.bffClient, 'identity-link.all');
        expect(response.status(), await response.text()).toBe(200);

        return new Api(context, (await response.json()).access_token);
    }

    async dispose(): Promise<void> {
        await this.context.dispose();
    }

    // Users

    async createUser(input: Partial<UserInput> = {}): Promise<User & { password: string }> {
        const username = input.username ?? uniqueName('e2e-user');
        const password = input.password ?? strongPassword();
        const data = {
            firstName: 'Test',
            lastName: 'User',
            email: `${username}@example.test`,
            grantTypes: ['password', 'authorization_code', 'refresh_token'],
            groups: [],
            twoFaEnabled: false,
            ...input,
            username,
            password,
        };
        await this.send('POST', '/users/api/v1/user', data);
        // The response leaves out the id.
        const user = await this.findUser(username);

        return { ...user!, password };
    }

    // A user who can sign in to the console with these scopes, given by a group of their own.
    async createConsoleUser(scopes: string[]): Promise<User & { password: string }> {
        const group = await this.createUserGroup(uniqueName('e2e-console'), scopes);

        return this.createUser({ groups: [group.id], grantTypes: ['authorization_code', 'refresh_token'] });
    }

    async findUser(username: string): Promise<User | undefined> {
        return (await this.query<User>('users', 'User', 't.username = :value', username))[0];
    }

    async getUser(id: string): Promise<User | undefined> {
        return (await this.query<User>('users', 'User', 't.id = :value', id))[0];
    }

    // Whether db-users accepts the password, as it does when the user signs in.
    async checkPassword(username: string, password: string): Promise<boolean> {
        const response = await this.request('POST', '/users/api/v1/auth', { username, password });
        expect([200, 400], await response.text()).toContain(response.status());

        return response.status() === 200;
    }

    async createUserGroup(name: string, scopes: string[] = [], audience = env.consoleAudience): Promise<Group> {
        const group = await this.send<{ response: { group: Group } }>('POST', '/users/api/v1/group', { name });
        for (const scope of scopes) {
            await this.send('POST', `/users/api/v1/group/${group.response.group.id}/scope`, { audience, scope });
        }

        return group.response.group;
    }

    async findUserGroup(name: string): Promise<Group | undefined> {
        return (await this.query<Group>('users', 'Group', 't.name = :value', name))[0];
    }

    async userGroupScopes(groupId: string): Promise<GroupScope[]> {
        const data = await this.send<{ response: { scopes: GroupScope[] } }>(
            'GET',
            `/users/api/v1/group/${groupId}/scope`,
        );

        return data.response.scopes;
    }

    // Clients

    async createClient(input: Partial<ClientInput> = {}): Promise<Client> {
        const name = input.name ?? uniqueName('e2e-client');
        const data = {
            description: `Client ${name}`,
            audience: `https://${name}.example.test`,
            redirectUri: [`https://${name}.example.test/callback`],
            groups: [],
            grantTypes: ['client_credentials'],
            isPublic: false,
            consentRequired: false,
            ...input,
            name,
        };
        const client = await this.send<{ response: { client: Client } }>('POST', '/clients/api/v1/client', data);

        return client.response.client;
    }

    async findClient(name: string): Promise<Client | undefined> {
        return (await this.query<Client>('clients', 'Client', 't.name = :value', name))[0];
    }

    async getClient(id: string): Promise<Client | undefined> {
        return (await this.query<Client>('clients', 'Client', 't.id = :value', id))[0];
    }

    async createClientGroup(name: string, scopes: string[] = [], audience = env.consoleAudience): Promise<Group> {
        const group = await this.send<{ response: { group: Group } }>('POST', '/clients/api/v1/group', { name });
        for (const scope of scopes) {
            await this.send('POST', `/clients/api/v1/group/${group.response.group.id}/scope`, { audience, scope });
        }

        return group.response.group;
    }

    async findClientGroup(name: string): Promise<Group | undefined> {
        return (await this.query<Group>('clients', 'Group', 't.name = :value', name))[0];
    }

    async clientGroupScopes(groupId: string): Promise<GroupScope[]> {
        const data = await this.send<{ response: { scopes: GroupScope[] } }>(
            'GET',
            `/clients/api/v1/group/${groupId}/scope`,
        );

        return data.response.scopes;
    }

    // Issues a secret the way the console does and returns it with its value.
    async issueSecret(
        clientId: string,
        expirationPeriod = '1y',
        passwordHint?: string,
    ): Promise<{ password: string; passwordHint: string; expirationDateTime: string }> {
        const data = await this.send<{ response: { secret: { password: string; passwordHint: string; expirationDateTime: string } } }>(
            'POST',
            '/clients/api/v1/secret/issue',
            { client: clientId, expirationPeriod, ...(passwordHint ? { passwordHint } : {}) },
        );

        return data.response.secret;
    }

    async clientSecrets(clientId: string): Promise<Secret[]> {
        return this.query<Secret>('clients', 'Secret', 'c.id = :value', clientId, { c: 't.client' });
    }

    private async query<T>(
        service: 'users' | 'clients',
        type: string,
        query: string,
        value: string,
        joins?: Record<string, string>,
    ): Promise<T[]> {
        const data = await this.send<{ response: { result: T[] } }>('POST', `/${service}/api/v1/query`, {
            type,
            alias: 't',
            query,
            parameters: { value },
            limit: 100,
            ...(joins ? { joins } : {}),
        });

        return data.response.result;
    }

    private async send<T = unknown>(method: string, path: string, data?: unknown): Promise<T> {
        const response = await this.request(method, path, data);
        expect(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`).toBe(true);

        return response.json();
    }

    private request(method: string, path: string, data?: unknown): Promise<APIResponse> {
        return this.context.fetch(path, {
            method,
            headers: { Authorization: `Bearer ${this.token}` },
            ...(data === undefined ? {} : { data }),
        });
    }
}

// Values e2e/run.sh writes into e2e/.stack/runner.env after it provisions the deployment.

function required(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set. Run the tests through e2e/run.sh.`);
    }

    return value;
}

export const env = {
    get baseUrl() {
        return required('E2E_BASE_URL');
    },

    // The administrator bin/provision-tenant.sh creates.
    get admin() {
        return {
            username: required('E2E_ADMIN_USERNAME'),
            password: required('E2E_ADMIN_PASSWORD'),
        };
    },

    // The client bin/provision-tenant.sh creates for the BFF.
    get bffClient() {
        return {
            id: required('E2E_BFF_CLIENT_ID'),
            secret: required('E2E_BFF_CLIENT_SECRET'),
        };
    },

    // A sign-in client bin/create-client.sh creates for an application that does not exist; the tests stand in for it.
    get rpClient() {
        return {
            id: required('E2E_RP_CLIENT_ID'),
            secret: required('E2E_RP_CLIENT_SECRET'),
            audience: required('E2E_RP_AUDIENCE'),
            redirectUri: required('E2E_RP_REDIRECT_URI'),
        };
    },

    // The audience of the BFF client. What a user may do in the admin console are the scopes of their groups for it.
    get consoleAudience() {
        return required('E2E_CONSOLE_AUDIENCE');
    },

    // e2e/run.sh creates a system user, a system client with a system secret, and a system group of each kind, all
    // with this name. The user can sign in to the console and read users and user groups.
    get system() {
        return {
            username: required('E2E_SYSTEM_NAME'),
            password: required('E2E_SYSTEM_PASSWORD'),
        };
    },
};

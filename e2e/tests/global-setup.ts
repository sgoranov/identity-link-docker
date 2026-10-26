import { request } from '@playwright/test';
import { env } from './support/env';

// The services report healthy before the proxy necessarily routes to them, so wait until the
// discovery document comes back through it.
export default async function globalSetup(): Promise<void> {
    const context = await request.newContext({ baseURL: env.baseUrl, ignoreHTTPSErrors: true });
    const deadline = Date.now() + 60_000;
    let lastError = '';

    try {
        while (Date.now() < deadline) {
            try {
                const response = await context.get('/.well-known/openid-configuration');
                if (response.ok()) {
                    return;
                }
                lastError = `HTTP ${response.status()}`;
            } catch (error) {
                lastError = String(error);
            }

            await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
    } finally {
        await context.dispose();
    }

    throw new Error(`${env.baseUrl} did not serve the discovery document within 60 seconds: ${lastError}`);
}

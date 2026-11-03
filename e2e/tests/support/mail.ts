import { expect, request } from '@playwright/test';
import { env } from './env';

// The emails db-users sends, caught by Mailpit (docker-compose.e2e.yml) and read through its API.

export type Email = { subject: string; text: string };

type MessageSummary = { ID: string };

async function mailApi<T>(path: string, params?: Record<string, string>): Promise<T> {
    const context = await request.newContext({ baseURL: env.mailUrl });
    try {
        const response = await context.get(path, { params });
        expect(response.status(), `GET ${path}: ${await response.text()}`).toBe(200);

        return await response.json();
    } finally {
        await context.dispose();
    }
}

// The emails sent to this address so far.
export async function emailsTo(address: string): Promise<MessageSummary[]> {
    const result = await mailApi<{ messages: MessageSummary[] }>('/api/v1/search', { query: `to:"${address}"` });

    return result.messages;
}

// Waits for the one email sent to this address and returns it. The tests send each email to an address of its own.
export async function waitForEmail(address: string): Promise<Email> {
    let messages: MessageSummary[] = [];
    await expect
        .poll(async () => (messages = await emailsTo(address)).length, { message: `an email to ${address}` })
        .toBe(1);
    const message = await mailApi<{ Subject: string; Text: string }>(`/api/v1/message/${messages[0].ID}`);

    return { subject: message.Subject, text: message.Text };
}

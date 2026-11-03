import { createHmac } from 'node:crypto';
import { expect, type Page } from '@playwright/test';

// The pages of the 2FA service and the codes of an authenticator app. The service uses TOTP (RFC 6238) with the
// settings authenticator apps default to: HMAC-SHA1, six digits and a new code every 30 seconds.

const period = 30_000;

function decodeBase32(value: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const character of value.toUpperCase().replace(/[=\s]/g, '')) {
        const index = alphabet.indexOf(character);
        if (index < 0) {
            throw new Error(`"${value}" is not Base32.`);
        }
        bits += index.toString(2).padStart(5, '0');
    }
    const bytes = bits.match(/.{8}/g) ?? [];

    return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

// The code of an authenticator app with this secret at this time.
export function totp(secret: string, time = Date.now()): string {
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(time / period)));
    const hmac = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;

    return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

// The code of the authenticator app now. The service accepts only the code of the current 30 seconds, so close to
// their end this waits for the next code: the current one could expire before the service checks it.
export async function currentCode(secret: string): Promise<string> {
    const left = period - (Date.now() % period);
    if (left < 5_000) {
        await new Promise((resolve) => setTimeout(resolve, left + 100));
    }

    return totp(secret);
}

// A code that is not the current one.
export function wrongCode(secret: string): string {
    const code = totp(secret);

    return code.slice(0, 5) + ((Number(code[5]) + 1) % 10);
}

// On the page the 2FA service shows at the first sign-in with two-factor authentication: checks it, reads the
// secret as a user does who enters it in their app by hand, and goes on to the verification. Returns the secret.
export async function enroll(page: Page): Promise<string> {
    await expect(page.getByRole('heading', { name: 'Enable Two-Factor Authentication (2FA)' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'QR Code for 2FA setup' })).toBeVisible();
    const secret = (await page.locator('p', { hasText: 'enter this code manually' }).locator('strong').textContent())!.trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    await page.getByRole('link', { name: 'Go to Verification' }).click();
    await expect(verificationHeading(page)).toBeVisible();

    return secret;
}

// The heading of the page that asks for the code.
export function verificationHeading(page: Page) {
    return page.getByRole('heading', { name: 'Two-factor verification' });
}

// Enters a code on the verification page of the 2FA service. The page has a field for each digit, whose script
// fills in the form field it submits, so it waits for the script first.
export async function enterCode(page: Page, code: string): Promise<void> {
    await expect(verificationHeading(page)).toBeVisible();
    await page.waitForLoadState();
    // The digit fields have no label.
    const digits = page.locator('.otp-field');
    await expect(digits).toHaveCount(code.length);
    for (const [index, digit] of [...code].entries()) {
        await digits.nth(index).fill(digit);
    }
    await page.getByRole('button', { name: 'Verify' }).click();
}

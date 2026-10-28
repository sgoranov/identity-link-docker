import { expect, test } from '@playwright/test';

// The proxy adds HSTS to every response over HTTPS, whichever service answers and errors included, so that browsers
// keep to HTTPS for the domain.
for (const path of ['/.well-known/openid-configuration', '/admin-console/', '/not-found']) {
    test(`tells browsers to use HTTPS only, in the response to ${path}`, async ({ request }) => {
        const response = await request.get(path, { maxRedirects: 0 });
        expect(response.headers()['strict-transport-security']).toBe('max-age=31536000');
    });
}

test('no longer sends the obsolete X-XSS-Protection header', async ({ request }) => {
    const response = await request.get('/.well-known/openid-configuration');
    expect(response.headers()['x-xss-protection']).toBeUndefined();
});

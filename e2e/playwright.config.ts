import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    globalSetup: './tests/global-setup.ts',
    // The tests share one deployment. Run in parallel, they slow the services down until tests time out, and save
    // little time, so they run one at a time.
    workers: 1,
    // Playwright replaces these directories on every run, so they sit below results, which is mounted from the host.
    outputDir: './results/test-results',
    reporter: [['list'], ['html', { open: 'never', outputFolder: './results/report' }]],
    use: {
        baseURL: process.env.E2E_BASE_URL,
        // The deployment uses a certificate from a CA generated for the run. The BFF verifies it; the tests do not.
        ignoreHTTPSErrors: true,
        trace: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});

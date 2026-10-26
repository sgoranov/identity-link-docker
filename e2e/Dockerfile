# Node with only the browser the tests use: Chromium's headless shell, which Playwright runs headless tests in.
# This is a fraction of the size of the Playwright image, which carries every browser.
FROM node:24.22.0-bookworm-slim

# Outside any home directory, so the browser is found whichever user runs the tests.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /e2e

COPY package.json package-lock.json ./
# Playwright installs the browser build that matches its version in package.json, with its system libraries.
RUN npm ci --no-audit --no-fund \
    && npx playwright install --with-deps --only-shell chromium \
    && rm -rf /var/lib/apt/lists/*

COPY playwright.config.ts ./
COPY tests ./tests

ENTRYPOINT ["/e2e/node_modules/.bin/playwright", "test"]

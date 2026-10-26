# End-to-end tests

The tests in this directory check a complete Identity Link deployment: the services together, the proxy
configuration, the Compose files and the scripts in `bin/`. Each service's own test suite replaces the other
services with mocks, so these tests cover what those suites cannot: the calls between the services, token
validation against core's JWKS, the proxy's routing and headers, and the provisioning scripts.

## Run the tests

Requirements: Docker with Compose 2.24 or later, Git, Bash and OpenSSL. Node is not needed; the tests run in a
container.

```bash
e2e/run.sh
```

The script:

1. copies the Compose files, `bin/` and the proxy and database configuration into `e2e/.stack`;
2. builds each service's image from its clone in `src/` (the `prod` target of its Dockerfile);
3. generates a CA and a certificate for `identity-link.test`, and the secrets with `bin/bootstrap-secrets.sh`;
4. starts the services, provisions the tenant with `bin/provision-tenant.sh` and registers a sign-in client
   with `bin/create-client.sh`;
5. creates a system user, client and groups, see [The admin console tests](#the-admin-console-tests);
6. runs the Playwright tests in a container on the deployment's network;
7. saves the service logs to `e2e/results/stack.log` and removes the deployment.

The tests run one at a time and take about five minutes. Runs share `e2e/.stack` and `e2e/results`, so while one
runs, another `e2e/run.sh` refuses to start.

The deployment uses `docker-compose.yml` and `docker-compose.prod.yml` with `docker-compose.e2e.yml` on top. It
has its own Compose project (`identity-link-e2e`), network and volumes, and publishes no ports, so it runs
alongside a development stack. Your `.env` and `config/` are not used.

`bin/bootstrap-secrets.sh` loads only `docker-compose.yml`, so it generates the secrets with the core image that
file names, which is pulled for that. All services run from the images built for the run.

## What is built

Every service is built from its clone in `src/`, which [docs/DEVELOPMENT.md](../docs/DEVELOPMENT.md) sets up:
`src/identity-link-core`, `src/identity-link-db-users`, `src/identity-link-db-clients`, `src/identity-link-2fa`,
`src/identity-link-bff` and `src/identity-link-console`. The script stops if one of them is not a Git clone.

The clones are built as they are on disk: the branch each one has checked out, uncommitted changes included. To
test another version of a service, check it out in its clone. Everything the clone's `.dockerignore` does not
exclude goes into the image, also files Git ignores, such as a `.env.local`.

`e2e/results/sources.txt` lists the branch and commit of each clone, and whether it had uncommitted changes.

## Build cache

Most of a build from scratch is compiling the PHP extensions in the `base` stage of each service's Dockerfile,
about two minutes. Docker's layer cache keeps that stage until its Dockerfile or base image changes, so later
builds only redo what changed in the clones, and a run with unchanged clones builds in seconds.

## Options

| Option                  | Description                                                                         |
|-------------------------|-------------------------------------------------------------------------------------|
| `--no-cache`            | Build without Docker's layer cache.                                                 |
| `--keep`                | Leave the deployment running after the tests, to rerun them or look into a failure. |
| `--ui`                  | Open Playwright's UI mode instead of running the tests, see [Watch the tests](#watch-the-tests). |
| `--ui-port <port>`      | Port of the UI mode on localhost. Default: 9323. Implies `--ui`.                    |
| `-- <options>`          | Pass the remaining options to Playwright, e.g. `-- tests/admin-console/users.spec.ts` or `-- --grep "authorization code"`. |

With `--keep`, run the tests again from `e2e/.stack` without rebuilding or redeploying:

```bash
cd e2e/.stack
docker compose run --rm --build identity-link-e2e-runner
docker compose logs identity-link-core   # the logs of a service
docker compose down --volumes            # remove the deployment
```

The next `e2e/run.sh` removes a kept deployment before it starts.

## Watch the tests

The browser of the tests runs in a container without a display, so it has no window. Playwright's UI mode shows
instead what the tests do:

```bash
e2e/run.sh --ui
```

The script deploys as usual and then, instead of running the tests, prints the address of the UI mode,
http://localhost:9323. Open it in your browser to choose a test, a file or a filter, run it and follow it action by
action, with the page as it was at each action, its network requests and its console output. The UI mode reads the
tests from `e2e/tests` as they are saved, so you can change a test and run it again. Ctrl+C in the terminal stops it
and removes the deployment, unless you pass `--keep` too.

The page in the middle shows the snapshot of the action selected in the list on its left, or on the timeline above
it. The first action of a test, usually opening a page, shows an empty page, as the console has not rendered yet;
the actions after it show the page.

The UI mode offers to install browsers, as the runner image has only Chromium's headless shell. Ignore it; the
tests run in the headless shell.

To see a test that already ran, open its trace in the HTML report: Playwright keeps the traces of failed tests, and
of every test with `-- --trace on`.

## Results

- `e2e/results/sources.txt`: the branch and commit of each clone, and whether it had uncommitted changes.
- `e2e/results/build.log`: the output of the image builds.
- `e2e/results/report`: the HTML report, with the trace of each failed test.
  Open it with `npx playwright show-report e2e/results/report`.
- `e2e/results/test-results`: the traces and other artifacts of failed tests.
- `e2e/results/stack.log`: the logs of all services.

## The admin console tests

`tests/admin-console` has a spec file for each page of the console, and two more:

| File                    | Covers                                                                                    |
|-------------------------|-------------------------------------------------------------------------------------------|
| `navigation.spec.ts`    | Signing in and out, the menu, the language, the menu on a small screen.                   |
| `profile.spec.ts`       | The profile: viewing it, changing the name, email, password and two-factor setting.      |
| `users.spec.ts`         | The users list: creating, editing, deleting, searching, sorting and paging.               |
| `user-groups.spec.ts`   | The user groups list, and the scopes of a group.                                          |
| `clients.spec.ts`       | The clients list: creating, editing, deleting, searching, sorting and paging.             |
| `client-groups.spec.ts` | The client groups list, and the scopes of a group.                                        |
| `client-secrets.spec.ts` | The secrets of a client: generating, copying and deleting them.                           |
| `permissions.spec.ts`   | Which pages and actions each scope gives, and that the services refuse the rest.          |
| `workflows.spec.ts`     | Users, groups and clients set up only in the console, then used to sign in and get tokens. |

The two group pages are built from the same components, so `group-pages.ts` holds the tests they share.

The tests check what the console saved through the services' APIs, and use it the way a deployment does: a user
created in the console signs in, a secret generated in the console authenticates its client.

The tests start signed in as the administrator. The `test` of `tests/support/console.ts` signs in once and shares
the session; its access token, and with it the session, expires 15 minutes after the sign-in, so it signs in again
after 10 minutes. Tests that sign in as another user, or sign out, use `test.use({ storageState: noSession })`.

The console shows system records read-only, but a deployment has none. `run.sh` creates a user, a client with a
secret, and a user group and a client group, all named `e2e-system`, with the services' commands, and marks them
as system records in the databases. The system user can sign in.

A test that is expected to fail because of a known bug calls `test.fail()` with a comment that names the bug. When
the bug is fixed, the test fails, as a reminder to remove the call.

## Write tests

Tests are Playwright tests in TypeScript under `tests/`. They reach the deployment at `https://identity-link.test`
(`baseURL`) and get the credentials of the provisioned users and clients from `tests/support/env.ts`.

| Module                   | Helpers                                                                                   |
|--------------------------|-------------------------------------------------------------------------------------------|
| `tests/support/oidc.ts`  | The discovery document, the token endpoint and the login form.                            |
| `tests/support/api.ts`   | The APIs of db-users and db-clients, with a token of the BFF client, to set up records and check them. |
| `tests/support/console.ts` | The `test` of the console tests, signed in as the administrator, with the `api` and `newSession` fixtures; signing in, the menu and searching. |
| `tests/support/antd.ts`  | Form fields by label, selects, switches, tables, notifications and confirmations of Ant Design. |

The tests share one deployment, so they should not depend on each other's data. Each test creates the records it
needs, with names from `uniqueName()`, and leaves them, also on a deployment kept with `--keep`. A test that
changes shared data, such as the administrator's password, should create its own user or client instead.

The tests run in Chromium's headless shell, the only browser in the runner image. The image installs the build
that matches the Playwright version in `package.json`, so updating Playwright needs only `package.json` and the
lockfile, refreshed with `npm install --package-lock-only` in this directory.

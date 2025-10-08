# Run Identity Link with Docker

This repository provides a simple way to run the entire Identity Link microservice 
architecture using Docker and Docker Compose. With just one command, you can 
spin up all necessary services in a consistent and reproducible environment.

## Getting Started

Before starting the services, make sure all required service repositories are 
cloned into this directory:

```bash
git clone https://github.com/sgoranov/identity-link.git identity-link-core
git clone https://github.com/sgoranov/identity-link-db-users.git identity-link-db-users
git clone https://github.com/sgoranov/identity-link-db-clients.git identity-link-db-clients
git clone https://github.com/sgoranov/identity-link-2fa.git identity-link-2fa
```

These repositories should exist as local folders inside identity-link-docker, 
matching the directory structure expected by Docker Compose.

If you already have these repositories checked out elsewhere, you can create 
relative symbolic links instead of cloning again:

```bash
ln -rs ../existing/identity-link identity-link-core
ln -rs ../existing/identity-link-db-users identity-link-db-users
ln -rs ../existing/identity-link-db-clients identity-link-db-clients
ln -rs ../existing/identity-link-2fa identity-link-2fa
```

Just make sure the symlinks resolve to valid folders on the host, because Docker Compose will mount 
whatever they point to into the containers.

## Setup TLS Certificates 

Before starting the Docker services, you need to generate and install the required TLS certificates using 
mkcert. This step ensures secure HTTPS communication for your local environment.

Run the following commands:

```bash
cd config/certificates
mkcert --install
mkcert "*.example.com" localhost 127.0.0.1 ::1
```

 - `mkcert --install` sets up a local Certificate Authority (CA) trusted by your system.
 - The second mkcert command generates certificates for the specified domains and IPs.
 - These certificates are used by the Docker services to enable HTTPS locally.

Make sure you have mkcert installed on your machine before running these commands.

## Update Your Hosts File

To properly test the system locally, you must add the following entries to your 
system's hosts file:

```text
127.0.0.1 protected.example.com
127.0.0.1 auth.example.com
```

### Why is this necessary?

- **auth.example.com** represents the **Identity Link** service.
- **protected.example.com** represents the **oidc-test-client**, which you can use to test the OpenID Connect authentication flow.

By mapping these domains to `127.0.0.1`, your local machine will resolve requests for these test domains to your Docker services, enabling HTTPS with the certificates you generated.


## Start/Stop the Services

```bash
./start.sh
```

This will:

 - Load environment variables from .env and .env.local (if present)
 - Launch all required containers in detached mode using Docker Compose


```bash
./stop.sh
```

This stops all running containers.

### Useful Tips

 - Use _docker compose logs -f_ to monitor service logs
 - Use _docker compose ps_ to list running containers

## Customizing Environment Configuration

By default, environment variables are defined in the .env file. To override any of them locally, 
create a _.env.local_ file:

```bash
touch .env.local
```

Then add only the variables you want to override:

```dotenv
DB_PASSWORD=mysecret
```

The .env.local file is automatically loaded when running start.sh or stop.sh.

.env.local is typically included in .gitignore to keep secrets out of version control.

## Environment Variables for Docker

Important: The Docker environment uses a dedicated environment file (e.g. .env, .env.local) that is 
separate from the application’s Symfony .env file.

The Docker .env is used only by Docker Compose and defines the 
setup parameters needed to build and run the containers.

**Note:** DB_USER and DB_PASSWORD must match between Docker’s environment and 
your Symfony application’s .env configuration, or the application will fail 
to connect to the database.

### List of Environment Variables

| Variable                  | Description                                         | Example Value                                 |
|---------------------------|-----------------------------------------------------|-----------------------------------------------|
| `DB_USER`                 | Database username (shared between app and services) | `ChangeMe`                                    |
| `DB_PASSWORD`             | Database password (shared between app and services) | `ChangeMe`                                    |
| `TEST_DATA_CLIENT_SECRET` | Test client secret                                  | `client`                                      |
| `TEST_DATA_REDIRECT_URI`  | Redirect URI for OAuth test client                  | `https://protected.example.com/auth/callback` |
| `TEST_DATA_USER_NAME`     | Username for the seeded test user                   | `user`                                        |
| `TEST_DATA_USER_PASS`     | Password hash for the test user (e.g., bcrypt)      | `pass`                                        |
| `TEST_DATA_GROUP_NAME`    | Name of the group assigned to the test user         | `group`                                       |

## Additional Docker Services

Your Docker setup includes several tools to assist with development and debugging.

### Adminer – Database UI

Adminer is a single-file UI for managing your PostgreSQL database.

 - Use case: Inspect tables, run SQL queries, debug data
 - Access: http://localhost/db

### MailHog – SMTP Test Server

MailHog catches emails sent from your application during development.

 - Use case: Test registration flows, password reset, etc.
 - SMTP port: localhost:9025
 - Web UI: http://localhost/mail

No real email is sent. All messages stay inside Docker for testing.

### Redis Commander – Redis Web UI

Redis Commander is a GUI for inspecting and modifying your Redis data.

 - Use case: Browse cache, sessions, Symfony rate limiters, etc.
 - Access: http://localhost/redis

### Swagger UI – API Explorer

Swagger UI lets you view and test API endpoints defined in the OpenAPI specification.

 - Use case: Interactively test API calls
 - Access: http://localhost/swagger


## Generate a JWT Token

You’ll need a valid JWT token to use protected endpoints in Swagger.

Generate one using:

```bash
docker exec -it core bash -c "cd /var/www; php bin/console identity-link:generate-jwt"
```

The output token can then be pasted into the Authorize dialog in Swagger UI.

## License

Identity Link is open source software licensed under the [MIT License](LICENSE), which permits reuse,
modification, and distribution with minimal restrictions.

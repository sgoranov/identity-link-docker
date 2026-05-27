# Run Identity Link with Docker

This repository provides a streamlined way to run the entire Identity Link microservice
architecture using Docker and Docker Compose. With the power of `make` and an integrated local 
split-horizon DNS server, you can spin up all necessary services in a consistent, secure, and reproducible 
environment with zero manual host configuration.

## Getting Started

Before starting the services, make sure all required service repositories are 
cloned into src/ directory:

```bash
cd src
git clone https://github.com/sgoranov/identity-link.git identity-link-core
git clone https://github.com/sgoranov/identity-link-db-users.git identity-link-db-users
git clone https://github.com/sgoranov/identity-link-db-clients.git identity-link-db-clients
git clone https://github.com/sgoranov/identity-link-2fa.git identity-link-2fa
git clone https://github.com/sgoranov/identity-link-bff.git identity-link-bff
git clone https://github.com/sgoranov/identity-link-console.git identity-link-console
```

These repositories should exist as local folders inside identity-link-docker, 
matching the directory structure expected by Docker Compose.

If you already have these repositories checked out elsewhere, you can create 
relative symbolic links instead of cloning again:

```bash
cd src
ln -s /path_to/identity-link identity-link-core
ln -s /path_to/identity-link-db-users identity-link-db-users
ln -s /path_to/identity-link-db-clients identity-link-db-clients
ln -s /path_to/identity-link-2fa identity-link-2fa
ln -s /path_to/identity-link-bff identity-link-bff
ln -s /path_to/identity-link-console identity-link-console
```

Make sure the symlinks resolve to valid folders on the host, because Docker Compose will mount 
whatever they point to into the containers.

## Start/Stop the Services

```bash
make dev-up
```

This will:

 - Load environment variables from .env and .env.local (if present)
 - Launch all required containers in detached mode using Docker Compose

```bash
make dev-down
```

This stops all running containers.

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

.env.local is included in .gitignore to keep secrets out of version control.

## Environment Variables for Docker

Important: The Docker environment uses a dedicated environment file (e.g., .env, .env.local) that is 
separate from the application’s Symfony .env file.

The Docker .env is used only by Docker Compose and defines the 
setup parameters needed to build and run the containers.

**Note:** DB_USER and DB_PASSWORD must match between Docker’s environment and 
your Symfony application’s .env configuration, or the application will fail 
to connect to the database.

## Additional Docker Services

Your Docker setup includes several tools to assist with development and debugging.

### Adminer – Database UI
Adminer is a lightweight UI for managing your PostgreSQL database.
- **Use case:** Inspect tables, run SQL queries, debug data.
- **Access:** [http://localhost/db/](http://localhost/db/)

### MailHog – SMTP Test Server
MailHog catches emails sent from your application during development.
- **Use case:** Test registration flows, password reset, etc.
- **SMTP port:** `localhost:9025`
- **Web UI:** [http://localhost/mail/](http://localhost/mail/)

No real email is sent. All messages stay inside Docker for testing.

## Generate a JWT Token

You’ll need a valid JWT token to use protected endpoints in Swagger or Postman. You can generate one instantly 
using the provided helper script, which automatically waits for the core service to become fully available
before issuing the token:

```bash
./bin/generate-auth-token.sh
```

The output token can then be copied and pasted directly into the Authorize dialog in Swagger UI.

## License

Identity Link is open source software licensed under the [MIT License](LICENSE), which permits reuse,
modification, and distribution with minimal restrictions.

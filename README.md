# Run Identity Link with Docker

This repository provides a simple way to run the entire Identity Link microservice 
architecture using Docker and Docker Compose. With just one command, you can 
spin up all necessary services in a consistent and reproducible environment.

## Getting Started

Before starting the services, make sure all required service repositories are 
cloned into this directory:

```bash
git clone https://github.com/sgoranov/identity-link.git core
git clone https://github.com/sgoranov/identity-link-db-users.git db-users
git clone https://github.com/sgoranov/identity-link-db-clients.git db-clients
git clone https://github.com/sgoranov/identity-link-2fa.git 2fa
```

These repositories should exist as local folders inside identity-link-docker, 
matching the directory structure expected by Docker Compose.

### Start the services

```bash
./start.sh
```

This will:

 - Load environment variables from .env and .env.local (if present)
 - Launch all required containers in detached mode using Docker Compose

### Stop the services

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
TEST_DATA_CLIENT_ID=my-client
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

| Variable                  | Description                                         | Example Value                           |
|---------------------------|-----------------------------------------------------|-----------------------------------------|
| `DB_USER`                 | Database username (shared between app and services) | `admin`                                 |
| `DB_PASSWORD`             | Database password (shared between app and services) | `admin`                                 |
| `TEST_DATA_GENERATION`    | Enable automatic test data generation               | `1`                                     |
| `TEST_DATA_CLIENT_ID`     | Test client ID used for sample data                 | `client`                                |
| `TEST_DATA_CLIENT_SECRET` | Test client secret                                  | `client`                                |
| `TEST_DATA_REDIRECT_URI`  | Redirect URI for OAuth test client                  | `https://example.com/oauth/login/check` |
| `TEST_DATA_USER_NAME`     | Username for the seeded test user                   | `user`                                  |
| `TEST_DATA_USER_PASS`     | Password hash for the test user (e.g., bcrypt)      | `4336b78adc9946baacb46a61630c2b45`      |
| `TEST_DATA_GROUP_NAME`    | Name of the group assigned to the test user         | `administrator`                         |

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

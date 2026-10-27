# Run Identity Link with Docker

This repository provides a streamlined way to run the complete **Identity Link** microservice architecture 
using **Docker** and **Docker Compose**.
The following guide explains how to configure, initialize, start, and manage an Identity Link deployment.

## Prerequisites

Before starting, make sure you have:

- Docker installed
- Docker Compose installed
- A valid domain name pointing to your server
- Ports `80` and `443` available for HTTPS certificate generation


## Configure environment variables

Docker Compose uses the `.env` file to load the configuration required by the applications.
Start by copying the example configuration:

```bash
cp .env.example.prod .env
```

Update the .env file according to your environment and deployment requirements.

Create a symbolic link to use the production Compose configuration as the local override:

```bash
ln -rs docker-compose.prod.yml docker-compose.override.yml
```

Docker Compose loads `docker-compose.override.yml` automatically, so the commands below do not need
explicit `-f` options.

## Generate HTTPS certificates

Identity Link runs by default over HTTPS, so you need to generate a TLS certificate and private key before starting the services.

You can generate certificates using Certbot.

### Generate a certificate

Replace your-domain.com and admin@your-domain.com with your actual domain and email address:

```bash
docker run --rm -it \
  -p 80:80 \
  -v "$PWD/config/letsencrypt:/etc/letsencrypt" \
  certbot/certbot certonly \
  --standalone \
  -d your-domain.com \
  --email admin@your-domain.com \
  --agree-tos \
  --no-eff-email
```

### Renew certificates

Certificates can be renewed using the same Certbot Docker image:

```bash
# Port 80 must be free, so stop the proxy first
docker compose stop identity-link-proxy
docker run --rm \
  -p 80:80 \
  -v "$PWD/config/letsencrypt:/etc/letsencrypt" \
  certbot/certbot renew
docker compose start identity-link-proxy
```

### Verify the certificates

Check the expiry date of the certificate on disk:

```bash
openssl x509 -enddate -noout -in config/letsencrypt/live/your-domain.com/fullchain.pem
```

Check the certificate actually served by the proxy:

```bash
echo | openssl s_client -connect your-domain.com:443 -servername your-domain.com 2>/dev/null | openssl x509 -noout -enddate
```

Both should show the same `notAfter=` date. If the served one is older, restart the proxy with `docker compose restart identity-link-proxy`.

### Configure certificate paths

After the certificates are generated, create symbolic links so Identity Link can access them:

```bash
ln -s "$PWD/config/letsencrypt/live/your-domain.com/privkey.pem" \
      config/certificates/server.key

ln -s "$PWD/config/letsencrypt/live/your-domain.com/fullchain.pem" \
      config/certificates/server.crt
```

## Generate application secrets

Before starting the services, generate all required secrets, passwords, and cryptographic keys.
Identity Link stores secrets as files under `config/secrets`. Each secret is stored in a separate file.

Generate the required JWT keys, encryption keys, and application secrets:

```bash
/bin/bash bin/bootstrap-secrets.sh
```

## Start Identity Link services

Start all services using Docker Compose:

```bash
docker compose up -d
```

Docker Compose will start all required Identity Link services in the background.

You can check the service status with:

```bash
docker compose ps
```

## Provision the initial tenant

Once all services are running, create the initial tenant, client, and administrative user for the Identity Link console:

```bash
/bin/bash bin/provision-tenant.sh your-domain.com
```

Replace your-domain.com with your configured domain.

The script creates the administrator `admin` with a random password and prints it at the end:

```txt
Administrator "admin" was created.

  Username:  admin
  Password:  <generated password>
```

**Important**: The password is shown only once and is not stored anywhere else. Save it in a password manager
before you continue.

## Access the Identity Link console

Open your browser and navigate to: https://your-domain.com/admin-console.
Sign in as `admin` with the password that `bin/provision-tenant.sh` printed.

If you lose the password, generate a new one:

```bash
docker compose exec identity-link-db-users php bin/console app:reset-user-password --username admin
```

## Stop Identity Link services

To stop and remove all running services:

```bash
docker compose down
```

## Integrate Applications with Identity Link

Once Identity Link is running, you can use the administration console to manage:

* Users
* Clients
* Authentication settings

The OpenID Connect discovery endpoint is available at: https://your-domain.com/.well-known/openid-configuration.
Use this endpoint to configure your applications and integrate them with Identity Link.

### Create a sign-in client

To register an application that signs users in with OpenID Connect, run:

```bash
/bin/bash bin/create-client.sh \
  --audience https://app.example.com \
  --redirect-uri https://app.example.com/callback
```

The script names the client after the audience, here `app-example-com`, and:

* declares the audience in `config/authorization/client-app-example-com.yaml`, unless it is declared already;
* creates the group `app-example-com` with the OpenID Connect scopes (`oidc.default`) for the audience;
* creates the client with that group, the `authorization_code` and `refresh_token` grant types and a secret,
  and prints the client ID and secret.

The client secret is shown only once, so store it securely. `--redirect-uri` can be repeated. The optional `--name`
sets the client and group name, and `--description` sets the client description. Users need no extra configuration,
because every user holds the OpenID Connect scopes.
The application must request the scopes it needs, for example `openid profile email offline_access`.

## Troubleshooting

### Check service logs

To inspect logs for all services:

```bash
docker compose logs -f
```

### Restart services

To restart the deployment:

```bash
docker compose restart
```

### Update Identity Link

`docker-compose.yml` pins the version of each Identity Link image, so `docker compose pull` alone does not update
Identity Link: it updates only the images without a fixed version, such as nginx and Redis. To update to the latest
release, get the new `docker-compose.yml` first, then pull the images and recreate the containers:

```bash
git pull
docker compose pull
docker compose up -d --force-recreate
```

The services do not need to be stopped first. `--force-recreate` recreates every container, also those whose image
has not changed: the proxy and Vector read their configuration from files in this checkout, and a running container
keeps the file it was started with, even after `git pull` replaces it.

## Further reading

For more information about configuring Identity Link for development and using Docker 
in a development environment, see: [DEVELOPMENT.md](docs/DEVELOPMENT.md)

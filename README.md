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
  -v "$PWD/letsencrypt:/etc/letsencrypt" \
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
docker run --rm \
  -p 80:80 \
  -v "$PWD/letsencrypt:/etc/letsencrypt" \
  certbot/certbot renew
```

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

## Access the Identity Link console

Open your browser and navigate to: https://your-domain.com/admin-console.
The default administrator credentials are:

```txt
username: admin
password: 7MkhqneerPNSsiws
```

**Important**: Change the administrator password immediately after the first login. Leaving the default 
password unchanged can allow unauthorized access to your Identity Link installation.

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

### Pull updates

To download the latest Identity Link images from the configured container registry:

```bash
docker compose pull
```

## Further reading

For more information about configuring Identity Link for development and using Docker 
in a development environment, see: [DEVELOPMENT.md](docs/DEVELOPMENT.md)

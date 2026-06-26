# Development setup

This document describes how to set up a local development environment for the Identity Link 
platform using Docker Compose. The development environment provides all required services, 
including the Identity Link server, supporting microservices, databases, and the Admin Console. 
It is intended for local development, testing, and debugging. Follow the steps below to prepare 
your machine, configure the environment, and start the complete development stack.

## Prerequisites

Make sure you have the following tools installed:

* Docker and Docker Compose
* Git
* mkcert (for generating local TLS certificates)

## Clone the repositories

Clone the required repositories into the `src/` directory:

```bash
git clone https://github.com/sgoranov/identity-link.git src/identity-link-core
git clone https://github.com/sgoranov/identity-link-db-users.git src/identity-link-db-users
git clone https://github.com/sgoranov/identity-link-db-clients.git src/identity-link-db-clients
git clone https://github.com/sgoranov/identity-link-2fa.git src/identity-link-2fa
git clone https://github.com/sgoranov/identity-link-bff.git src/identity-link-bff
git clone https://github.com/sgoranov/identity-link-console.git src/identity-link-console
```

## Configure the environment

Copy the development environment file:

```bash
cp .env.example.dev .env
```

## Configure your hosts file

Add the domain configured in your .env file to your `/etc/hosts` file. The default domain is `example.com`.
If you want to use the bundled OIDC test client, also add the test subdomain:

```txt
127.0.0.1 example.com
127.0.0.1 test.example.com
```

## Generate TLS certificates

Generate local development certificates using mkcert and the provided helper script:

```bash
/bin/bash bin/ssl-setup.sh example.com
```

## Start the development environment

Start all services:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

## Default development credentials

The development environment creates the following user:

```txt
username: user
password: pass
```

## Accessing the applications

After the environment has started, the following applications are available:


| Application      | Url                               |
|------------------|-----------------------------------|
| Identity Link    | https://example.com               |
| Admin console    | https://example.com/admin-console |
| Db-Clients       | https://example.com/clients       |
| Db-Users         | https://example.com/users         |
| OIDC Test Client | https://test.example.com          |


The OIDC Test Client is based on `beryju/oidc-test-client` and can be used to test the 
OpenID Connect flows provided by the Identity Link server.
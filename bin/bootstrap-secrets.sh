#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

docker compose \
    -f "$PROJECT_ROOT/docker-compose.yml" \
    run --rm \
    --no-deps \
    --entrypoint "" \
    -v "$PROJECT_ROOT/config/keys:/app/config/keys" \
    -v "$PROJECT_ROOT/config/secrets:/app/config/secrets" \
    identity-link-core \
    sh -c '
        php bin/console identity-link:generate-random-secret \
            --path /app/config/secrets/database_user \
            --path /app/config/secrets/database_password \
            --path /app/config/secrets/core_app_secret \
            --path /app/config/secrets/db_users_app_secret \
            --path /app/config/secrets/db_clients_app_secret \
            --path /app/config/secrets/2fa_app_secret \
            --path /app/config/secrets/bff_app_secret

        php bin/console identity-link:generate-encryption-key \
            --key-path /app/config/keys/core_encryption_key

        php bin/console identity-link:generate-jwt-keys \
            --private-key-path /app/config/keys/core_jwt_private_key \
            --public-key-path /app/config/keys/core_jwt_public_key
    '

touch $PROJECT_ROOT/config/secrets/bff_client_id
chmod 0600 $PROJECT_ROOT/config/secrets/bff_client_id
touch $PROJECT_ROOT/config/secrets/bff_client_secret
chmod 0600 $PROJECT_ROOT/config/secrets/bff_client_secret

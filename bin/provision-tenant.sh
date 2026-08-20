#!/usr/bin/env bash

set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
    echo "Usage: $0 <DOMAIN_NAME>" >&2
    echo "Example: $0 example.com" >&2
    exit 1
fi

DOMAIN_NAME="$1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
SECRETS_DIR="$PROJECT_ROOT/config/secrets"

cd "$PROJECT_ROOT"

OUTPUT_ID_PATH="$SECRETS_DIR/bff_client_id"
OUTPUT_SECRET_PATH="$SECRETS_DIR/bff_client_secret"
CLIENT_AUDIENCE="https://${DOMAIN_NAME}/identity-link"
GROUP_NAME="administrator"
CLIENT_NAME="bff-client"
CLIENT_DESCRIPTION="BFF production client"
REDIRECT_URIS="https://${DOMAIN_NAME}/bff/login_check"

echo "Creating the client ($CLIENT_NAME) for domain $DOMAIN_NAME..."
TMP_OUTPUT=$(mktemp)
trap 'rm -f "$TMP_OUTPUT"' EXIT

docker compose exec -T identity-link-db-clients \
  php bin/console app:configure-group-scopes \
  --group "$GROUP_NAME" \
  --audience "$CLIENT_AUDIENCE" \
  --scope oidc.default \
  --scope identity-link.all

docker compose exec -T identity-link-db-clients \
  php bin/console app:create-client \
  --name "$CLIENT_NAME" \
  --description "$CLIENT_DESCRIPTION" \
  --audience "$CLIENT_AUDIENCE" \
  --group "$GROUP_NAME" \
  --redirect-uri "$REDIRECT_URIS" \
  --grant-type client_credentials \
  --grant-type password \
  --grant-type authorization_code \
  --grant-type refresh_token \
  > "$TMP_OUTPUT"

cat "$TMP_OUTPUT"

EXTRACTED_ID=$(sed -n 's/^[[:space:]]*Client ID[[:space:].]*//p' "$TMP_OUTPUT" | tr -d '[:space:]')
EXTRACTED_SECRET=$(sed -n 's/^[[:space:]]*Client secret[[:space:].]*//p' "$TMP_OUTPUT" | tr -d '[:space:]')

if [ -z "$EXTRACTED_ID" ] || [ -z "$EXTRACTED_SECRET" ]; then
    echo "ERROR: Failed to extract CLIENT_ID or CLIENT_SECRET from the command output." >&2
    echo "Raw output was:" >&2
    cat "$TMP_OUTPUT" >&2
    exit 1
fi

printf '%s' "$EXTRACTED_ID" > "$OUTPUT_ID_PATH"
chmod 600 "$OUTPUT_ID_PATH"

printf '%s' "$EXTRACTED_SECRET" > "$OUTPUT_SECRET_PATH"
chmod 600 "$OUTPUT_SECRET_PATH"

echo "Client ID saved to: $OUTPUT_ID_PATH"
echo "Client Secret saved to: $OUTPUT_SECRET_PATH"

USER_NAME=admin
USER_PASSWORD=7MkhqneerPNSsiws
USER_EMAIL=admin@${DOMAIN_NAME}
USER_FIRST_NAME=Admin
USER_LAST_NAME=User

docker compose exec -T identity-link-db-users \
  php bin/console app:configure-group-scopes \
    --group "$GROUP_NAME" \
    --audience "$CLIENT_AUDIENCE" \
    --scope oidc.default \
    --scope identity-link.all

docker compose exec -T identity-link-db-users \
  php bin/console app:create-user \
    --username "$USER_NAME" \
    --email "$USER_EMAIL" \
    --first-name "$USER_FIRST_NAME" \
    --last-name "$USER_LAST_NAME" \
    --password "$USER_PASSWORD" \
    --group "$GROUP_NAME" \
    --grant-type password \
    --grant-type authorization_code \
    --grant-type refresh_token

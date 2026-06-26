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
KEYS_DIR="$PROJECT_ROOT/config/keys"

OUTPUT_ID_PATH="$SECRETS_DIR/bff_client_id"
OUTPUT_SECRET_PATH="$SECRETS_DIR/bff_client_secret"
JWT_PRIVATE_KEY_PATH="$KEYS_DIR/core_jwt_private_key"
CLIENT_API_URL="https://${DOMAIN_NAME}/clients/api/v1"
GROUP_NAME="administrator"
CLIENT_NAME="bff-client"
SECRET_EXPIRATION_PERIOD="1y"
REDIRECT_URIS="https://${DOMAIN_NAME}/bff/login_check"

echo "Generating authentication token..."
AUTH_TOKEN="$("$SCRIPT_DIR/generate-auth-token" --private-key="$JWT_PRIVATE_KEY_PATH")"

echo "Creating the client ($CLIENT_NAME) for domain $DOMAIN_NAME..."
TMP_OUTPUT=$(mktemp)
trap 'rm -f "$TMP_OUTPUT"' EXIT

"$SCRIPT_DIR/create-client" \
  --api-url "$CLIENT_API_URL" \
  --insecure \
  --group "$GROUP_NAME" \
  --client "$CLIENT_NAME" \
  --exp-period "$SECRET_EXPIRATION_PERIOD" \
  --redirect-uris "$REDIRECT_URIS" \
  --auth-token "$AUTH_TOKEN" > "$TMP_OUTPUT"

EXTRACTED_ID=$(sed -n 's/^CLIENT_ID=//p' "$TMP_OUTPUT" | tr -d '[:space:]')
EXTRACTED_SECRET=$(sed -n 's/^CLIENT_SECRET=//p' "$TMP_OUTPUT" | tr -d '[:space:]')

if [ -z "$EXTRACTED_ID" ] || [ -z "$EXTRACTED_SECRET" ]; then
    echo "ERROR: Failed to extract CLIENT_ID or CLIENT_SECRET from the command output." >&2
    echo "Raw output was:" >&2
    cat "$TMP_OUTPUT" >&2
    exit 1
fi

echo -n "$EXTRACTED_ID" > "$OUTPUT_ID_PATH"
chmod 600 "$OUTPUT_ID_PATH"

echo -n "$EXTRACTED_SECRET" > "$OUTPUT_SECRET_PATH"
chmod 600 "$OUTPUT_SECRET_PATH"

echo "Client ID saved to: $OUTPUT_ID_PATH"
echo "Client Secret saved to: $OUTPUT_SECRET_PATH"

USER_API_URL="https://${DOMAIN_NAME}/users/api/v1"
USER_NAME=admin
USER_PASSWORD=7MkhqneerPNSsiws
USER_EMAIL=admin@${DOMAIN_NAME}
"$SCRIPT_DIR/create-user" \
  --api-url "$USER_API_URL" \
  --auth-token "$AUTH_TOKEN" \
  --insecure \
  --group "$GROUP_NAME" \
  --username "$USER_NAME" \
  --password "$USER_PASSWORD" \
  --email "$USER_EMAIL"

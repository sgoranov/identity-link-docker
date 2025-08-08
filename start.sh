#!/bin/bash

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

if ! docker network inspect my-network >/dev/null 2>&1; then
  echo "Network my-network does not exist, creating..."
  docker network create my-network
fi

docker compose up -d

# Run generate-data script and capture JSON output
echo "Generating client data..."
generate_output=$(./bin/generate-data.sh)
CLIENT_ID=$(echo "$generate_output" | jq -r '.client_id')
CLIENT_SECRET=$(echo "$generate_output" | jq -r '.client_secret')
USERNAME=$(echo "$generate_output" | jq -r '.username')
USER_PASS=$(echo "$generate_output" | jq -r '.user_password')

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo "Failed to extract CLIENT_ID or CLIENT_SECRET from generate-data output" >&2
  exit 1
fi

echo
echo "Generated credentials"
echo "Client ID: $CLIENT_ID"
echo "Client Secret: $CLIENT_SECRET"
echo "Username: $USERNAME"
echo "Password: $USER_PASS"

echo
echo "Starting oidc-test-client container with generated client credentials..."

docker run -d --name oidc-test-client \
  --network my-network \
  -p 9010:9009 \
  -e OIDC_CLIENT_ID="$CLIENT_ID" \
  -e OIDC_CLIENT_SECRET="$CLIENT_SECRET" \
  -e OIDC_PROVIDER="https://auth.example.com" \
  -e OIDC_ROOT_URL="https://protected.example.com" \
  -e OIDC_TLS_VERIFY="false" \
  -e OIDC_DO_INTROSPECTION="false" \
  --add-host host.docker.internal:host-gateway \
  --add-host auth.example.com:host-gateway \
  ghcr.io/beryju/oidc-test-client

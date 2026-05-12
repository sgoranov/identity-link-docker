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
echo "Starting identity-link-bff container with generated client credentials..."

if docker ps -a --format '{{.Names}}' | grep -q '^identity-link-bff$'; then
  docker stop identity-link-bff >/dev/null
  docker rm identity-link-bff >/dev/null
fi

# Build image only if it does not exist yet to keep startup fast.
IMAGE_NAME="identity-link-bff:dev"
if ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  docker build --target dev -t "$IMAGE_NAME" ./identity-link-bff
fi

docker run -d --name identity-link-bff \
  --privileged \
  --network identity-link-network \
  -v ./identity-link-bff:/app \
  -p 9004:9004 \
  -e OIDC_CLIENT_ID="$CLIENT_ID" \
  -e OIDC_CLIENT_SECRET="$CLIENT_SECRET" \
  --add-host host.docker.internal:${HOST_GW:-host-gateway} \
  --add-host auth.example.com:${HOST_GW:-host-gateway} \
  $IMAGE_NAME

echo
echo "Starting oidc-test-client container with generated client credentials..."

if docker ps -a --format '{{.Names}}' | grep -q '^oidc-test-client$'; then
  docker stop oidc-test-client >/dev/null
  docker rm oidc-test-client >/dev/null
fi

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

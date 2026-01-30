#!/bin/bash

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

echo "Stopping oidc-test-client container if running..."
if docker ps -a --format '{{.Names}}' | grep -q '^oidc-test-client$'; then
  docker stop oidc-test-client
  docker rm oidc-test-client
  echo "Container oidc-test-client stopped and removed."
else
  echo "Container oidc-test-client not running."
fi

echo "Stopping identity-link-bff container if running..."
if docker ps -a --format '{{.Names}}' | grep -q '^identity-link-bff$'; then
  docker stop identity-link-bff
  docker rm identity-link-bff
  echo "Container identity-link-bff stopped and removed."
else
  echo "Container identity-link-bff not running."
fi

echo "Stopping docker compose services..."
docker compose down --remove-orphans

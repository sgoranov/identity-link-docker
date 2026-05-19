#!/usr/bin/env bash

set -e

RETRY_INTERVAL=3
MAX_RETRIES=30
RETRIES=0

URL=https://auth.example.com/.well-known/openid-configuration
CONTAINER_NAME="identity-link-core"

echo "Waiting for $URL to respond..." >&2

while true; do
  response=$(curl -s -o /dev/null -w "%{http_code}" "$URL" || echo "000")

  if [[ "$response" =~ ^[0-9]{3}$ ]]; then   # Check if response is a 3-digit number
    if [ "$response" -eq 200 ]; then
      echo "Service is up. Generating token..." >&2
      AUTH_TOKEN=$(docker exec "$CONTAINER_NAME" bash -c "cd /app && php bin/console identity-link:generate-jwt")
      echo "$AUTH_TOKEN"
      exit 0
    fi
  else
    echo "Invalid HTTP response code: '$response'" >&2
  fi

  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    echo "Timeout waiting for $URL after $((RETRY_INTERVAL * MAX_RETRIES)) seconds." >&2
    exit 1
  fi

  echo "Service not ready (HTTP $response), retrying in $RETRY_INTERVAL seconds..." >&2
  sleep "$RETRY_INTERVAL"
done

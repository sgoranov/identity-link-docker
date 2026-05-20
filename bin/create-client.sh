#!/usr/bin/env bash

set -euo pipefail

CLIENT_API_URL=https://example.com/clients/api/v1
CLIENT_SECRET=$(uuidgen)

# Use existing value if set and non-empty, otherwise assign defaults
: "${TEST_DATA_GROUP_NAME:=administrator}"
: "${TEST_DATA_CLIENT_NAME:=test-client-$(uuidgen)}"
: "${TEST_DATA_REDIRECT_URIS:=https://oidc-test.example.com/auth/callback,https://example.com/bff/login_check}"
: "${RETRY_INTERVAL:=3}"
: "${MAX_RETRIES:=10}"

if [ -z "${AUTH_TOKEN:-}" ]; then
  echo "Generating access token..." >&2
  AUTH_TOKEN=$(./generate-auth-token.sh | tail -n 1)
fi

# Wait for client API
RETRIES=0
echo "Waiting for $CLIENT_API_URL/ping to respond..." >&2
while true; do
  if response=$(curl -sS -o /dev/null -w "%{http_code}" "$CLIENT_API_URL/ping"); then
    :
  else
    response="000"
  fi

  if [[ "$response" =~ ^[0-9]{3}$ ]]; then
    if [ "$response" -eq 200 ]; then
      echo "Client API is up." >&2
      break
    fi
  else
    echo "Invalid HTTP response code: '$response'" >&2
  fi

  RETRIES=$((RETRIES + 1))
  if [ "$RETRIES" -ge "$MAX_RETRIES" ]; then
    echo "Timeout waiting for client API after $((RETRY_INTERVAL * MAX_RETRIES)) seconds." >&2
    exit 1
  fi

  echo "Client API not ready (HTTP $response), retrying in $RETRY_INTERVAL seconds..." >&2
  sleep "$RETRY_INTERVAL"
done

# Check if group exists
echo "Checking for existing group '$TEST_DATA_GROUP_NAME'..." >&2

query_response=$(curl -s --location "$CLIENT_API_URL/query" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer $AUTH_TOKEN" \
  --data "{
    \"type\": \"Group\",
    \"query\": \"t.name = :name\",
    \"parameters\": { \"name\": \"$TEST_DATA_GROUP_NAME\" },
    \"alias\": \"t\",
    \"limit\": 1
  }")

GROUP_ID=$(echo "$query_response" | jq -r '.response.result[0].id')

if [ "$GROUP_ID" != "null" ]; then
  echo "Group already exists with ID: $GROUP_ID" >&2
else
  echo "Group not found. Creating group '$TEST_DATA_GROUP_NAME'..." >&2

  group_create_response=$(curl -s -w "%{http_code}" --location "$CLIENT_API_URL/group" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $AUTH_TOKEN" \
    --data "{\"name\": \"$TEST_DATA_GROUP_NAME\"}")

  http_status="${group_create_response: -3}"
  if [ "$http_status" -ne 201 ]; then
    echo "Failed to create group. HTTP Status: $http_status" >&2
    exit 1
  fi

  json_body="${group_create_response::-3}"
  GROUP_ID=$(echo "$json_body" | jq -r '.response.group.id')
  echo "Created new group with ID: $GROUP_ID" >&2
fi

# Build JSON array for redirect URIs from comma-separated env var
IFS=',' read -r -a redirect_uris <<< "$TEST_DATA_REDIRECT_URIS"
redirect_uris_json="["
for uri in "${redirect_uris[@]}"; do
  uri_trimmed="${uri#"${uri%%[![:space:]]*}"}"
  uri_trimmed="${uri_trimmed%"${uri_trimmed##*[![:space:]]}"}"
  if [ -n "$uri_trimmed" ]; then
    if [ "$redirect_uris_json" != "[" ]; then
      redirect_uris_json+=", "
    fi
    redirect_uris_json+="\"$uri_trimmed\""
  fi
done
redirect_uris_json+="]"

# Create client
echo "Creating client..." >&2
response=$(curl -s -w "%{http_code}" --location "$CLIENT_API_URL/client" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $AUTH_TOKEN" \
    --data "{
        \"name\": \"$TEST_DATA_CLIENT_NAME\",
        \"description\": \"description\",
        \"redirectUri\": $redirect_uris_json,
        \"grantTypes\": [\"client_credentials\", \"authorization_code\", \"password\", \"refresh_token\"],
        \"groups\": [\"$GROUP_ID\"],
        \"isPublic\": false
    }")

http_status="${response: -3}"
json_body="${response::-3}"

if [ "$http_status" -ne 201 ]; then
    echo "Failed to create client. HTTP Status: $http_status" >&2
    echo "$json_body" >&2
    exit 1
fi

CLIENT_ID=$(echo "$json_body" | jq -r '.response.client.id')
echo "Client created: $CLIENT_ID" >&2

# Create secret
echo "Creating client secret..." >&2
EXPIRATION_DATE=$(date -d "+1 month" +"%Y-%m-%dT%H:%M:%S")

response=$(curl -s -w "%{http_code}" --location "$CLIENT_API_URL/secret" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $AUTH_TOKEN" \
    --data "{
        \"password\": \"$CLIENT_SECRET\",
        \"passwordHint\": \"pass hint\",
        \"expirationDateTime\": \"$EXPIRATION_DATE\",
        \"client\": \"$CLIENT_ID\"
    }")

http_status="${response: -3}"
json_body="${response::-3}"

if [ "$http_status" -ne 201 ]; then
    echo "Failed to create client secret. HTTP Status: $http_status" >&2
    echo "$json_body" >&2
    exit 1
fi

echo "Client and secret created successfully!" >&2
echo "Client ID:" >&2
echo $CLIENT_ID
echo "Client secret:" >&2
echo $CLIENT_SECRET

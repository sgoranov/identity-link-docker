#!/usr/bin/env bash

set -euo pipefail

USER_API_URL=https://example.com/users/api/v1

# Use existing values if set, otherwise assign defaults
: "${TEST_DATA_GROUP_NAME:=administrator}"
: "${TEST_DATA_USER_NAME:=user-$(uuidgen)}"
: "${TEST_DATA_USER_PASS:=pass}"
: "${RETRY_INTERVAL:=3}"
: "${MAX_RETRIES:=10}"

if [ -z "${AUTH_TOKEN:-}" ]; then
  echo "Generating access token..." >&2
  AUTH_TOKEN=$(./generate-auth-token.sh | tail -n 1)
fi

echo "Waiting for $USER_API_URL/ping to respond..."
attempts=0
while true; do
  if response=$(curl -sS -o /dev/null -w "%{http_code}" "$USER_API_URL/ping"); then
    :
  else
    response="000"
  fi

  if [[ "$response" =~ ^[0-9]{3}$ ]]; then
    if [ "$response" -eq 200 ]; then
      echo "User API is up."
      break
    fi
  else
    echo "Invalid HTTP response code: '$response'" >&2
  fi

  attempts=$((attempts + 1))
  if [ "$attempts" -ge "$MAX_RETRIES" ]; then
    echo "User API did not become ready after $MAX_RETRIES attempts. Exiting." >&2
    exit 1
  fi

  echo "Waiting for User API... Retry $attempts/$MAX_RETRIES in $RETRY_INTERVAL seconds..." >&2
  sleep "$RETRY_INTERVAL"
done

# Check if group exists
echo "Checking for existing group: $TEST_DATA_GROUP_NAME"
query_response=$(curl -s --location "$USER_API_URL/query" \
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
  echo "Group already exists: $GROUP_ID" >&2
else
  echo "Creating group: $TEST_DATA_GROUP_NAME" >&2
  group_response=$(curl -s -w "%{http_code}" --location "$USER_API_URL/group" \
    --header "Content-Type: application/json" \
    --header "Authorization: Bearer $AUTH_TOKEN" \
    --data "{\"name\": \"$TEST_DATA_GROUP_NAME\"}")

  http_status="${group_response: -3}"
  if [ "$http_status" -ne 201 ]; then
    echo "Failed to create users group. HTTP Status: $http_status" >&2
    exit 1
  fi

  json_body="${group_response::-3}"
  GROUP_ID=$(echo "$json_body" | jq -r '.response.group.id')
  echo "Created new group: $GROUP_ID" >&2
fi

# Create the user
echo "Creating user: $TEST_DATA_USER_NAME" >&2
user_response=$(curl -s -w "%{http_code}" --location "$USER_API_URL/user" \
  --header "Content-Type: application/json" \
  --header "Authorization: Bearer $AUTH_TOKEN" \
  --data "{
    \"username\": \"$TEST_DATA_USER_NAME\",
    \"password\": \"$TEST_DATA_USER_PASS\",
    \"firstName\": \"Firstname\",
    \"lastName\": \"Lastname\",
    \"email\": \"test-$(uuidgen)@example.com\",
    \"grantTypes\": [\"password\", \"authorization_code\", \"refresh_token\"],
    \"groups\": [\"$GROUP_ID\"]
  }")

http_status="${user_response: -3}"
if [ "$http_status" -ne 201 ]; then
  echo "Failed to create user. HTTP Status: $http_status $user_response" >&2
  exit 1
fi

echo "User created successfully." >&2
echo "Username:" >&2
echo "$TEST_DATA_USER_NAME"
echo "Password:" >&2
echo "$TEST_DATA_USER_PASS"

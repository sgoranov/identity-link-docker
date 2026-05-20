#!/usr/bin/env bash
set -euo pipefail

# Defaults (you can override by exporting before running)
: "${TEST_DATA_GROUP_NAME:=administrator}"
: "${TEST_DATA_CLIENT_NAME:=test-client-$(uuidgen)}"
: "${TEST_DATA_CLIENT_SECRET:=$(uuidgen)}"
: "${TEST_DATA_REDIRECT_URI:=https://oidc-test.example.com/auth/callback}"
: "${TEST_DATA_USER_NAME:=user-$(uuidgen)}"
: "${TEST_DATA_USER_PASS:=pass}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Generate auth token only if not set
if [ -z "${AUTH_TOKEN:-}" ]; then
  echo "Generating access token..." >&2
  AUTH_TOKEN=$($SCRIPT_DIR/generate-auth-token.sh | tail -n 1)
  if [ -z "$AUTH_TOKEN" ]; then
    echo "Failed to obtain access token." >&2
    exit 1
  fi
fi

export AUTH_TOKEN
export TEST_DATA_GROUP_NAME
export TEST_DATA_CLIENT_NAME
export TEST_DATA_CLIENT_SECRET
export TEST_DATA_REDIRECT_URI
export TEST_DATA_USER_NAME
export TEST_DATA_USER_PASS

# Create client (with group and secret)
echo "Running client creation script..." >&2
readarray -t client_output < <($SCRIPT_DIR/create-client.sh)
CLIENT_ID="${client_output[-2]}"
CLIENT_SECRET="${client_output[-1]}"

# Create user
echo "Running user creation script..." >&2
readarray -t user_output < <($SCRIPT_DIR/create-user.sh)
USER_NAME="${user_output[-2]}"
USER_PASS="${user_output[-1]}"

echo >&2
echo "All done:" >&2
jq -n --arg clientId "$CLIENT_ID" \
      --arg clientSecret "$CLIENT_SECRET" \
      --arg username "$USER_NAME" \
      --arg userPass "$USER_PASS" \
      '{
        "client_id": $clientId,
        "client_secret": $clientSecret,
        "username": $username,
        "user_password": $userPass
      }'

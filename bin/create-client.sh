#!/usr/bin/env bash

set -euo pipefail

usage() {
    cat <<EOF
Usage: $0 --audience <URL> --redirect-uri <URL> [--redirect-uri <URL>...] [--name <NAME>] [--description <TEXT>]

Creates a client that can sign users in with OpenID Connect:
  - declares the audience in the authorization configuration if it is not declared yet;
  - creates a group named after the client with the OpenID Connect scopes (oidc.default) for the audience;
  - creates the client with that group, the authorization_code and refresh_token grant types and a secret.

Options:
  --audience       Required. HTTP or HTTPS URL identifying the application, e.g. https://app.example.com.
  --redirect-uri   Required. Redirect URI of the application; may be repeated.
  --name           Unique client name, also used as the group name (letters, digits, "_" and "-").
                   Defaults to the audience without the scheme, e.g. app-example-com for https://app.example.com.
  --description    Client description. Defaults to "OpenID Connect client <NAME>".

Example:
  $0 --audience https://app.example.com --redirect-uri https://app.example.com/callback
EOF
}

CLIENT_NAME=""
CLIENT_AUDIENCE=""
CLIENT_DESCRIPTION=""
REDIRECT_URIS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --name|--audience|--redirect-uri|--description)
            if [ $# -lt 2 ] || [ -z "$2" ]; then
                echo "ERROR: $1 requires a value." >&2
                exit 1
            fi
            case "$1" in
                --name) CLIENT_NAME="$2" ;;
                --audience) CLIENT_AUDIENCE="$2" ;;
                --redirect-uri) REDIRECT_URIS+=("$2") ;;
                --description) CLIENT_DESCRIPTION="$2" ;;
            esac
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "ERROR: Unknown option: $1" >&2
            usage >&2
            exit 1
            ;;
    esac
done

if [ -z "$CLIENT_AUDIENCE" ] || [ ${#REDIRECT_URIS[@]} -eq 0 ]; then
    usage >&2
    exit 1
fi

# The audience is written into a YAML file below, so reject anything that is not a plain URL before it gets there.
if [[ ! "$CLIENT_AUDIENCE" =~ ^https?://[^[:space:]]+$ ]]; then
    echo "ERROR: --audience must be an HTTP or HTTPS URL." >&2
    exit 1
fi

# identity-link-core resolves %name% in the authorization configuration as a parameter, as it does for %jwt_url%.
if [[ "$CLIENT_AUDIENCE" == *%* ]]; then
    echo "ERROR: --audience must not contain \"%\"." >&2
    exit 1
fi

# Without --name, the audience names the client: https://app.example.com:8443/app/ becomes app-example-com-8443-app.
if [ -z "$CLIENT_NAME" ]; then
    CLIENT_NAME=$(printf '%s' "${CLIENT_AUDIENCE#*://}" | tr -cs 'A-Za-z0-9_-' '-' | sed 's/^-*//; s/-*$//')
    CLIENT_NAME="${CLIENT_NAME:0:100}"

    if [ -z "$CLIENT_NAME" ]; then
        echo "ERROR: No client name can be derived from $CLIENT_AUDIENCE; pass --name." >&2
        exit 1
    fi
fi

# The name is also used for the group and the audience file name, so it is limited to characters that are valid in all three.
if [[ ! "$CLIENT_NAME" =~ ^[A-Za-z0-9_-]{1,100}$ ]]; then
    echo "ERROR: --name may contain only letters, digits, \"_\" and \"-\" (at most 100 characters)." >&2
    exit 1
fi

CLIENT_DESCRIPTION="${CLIENT_DESCRIPTION:-OpenID Connect client $CLIENT_NAME}"
GROUP_NAME="$CLIENT_NAME"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

for SERVICE in identity-link-core identity-link-db-clients; do
    if [ -z "$(docker compose ps -q "$SERVICE")" ]; then
        echo "ERROR: $SERVICE is not running. Start the services with: docker compose up -d" >&2
        exit 1
    fi
done

# Prints the configuration error and returns non-zero when the authorization configuration is invalid.
list_audiences() {
    docker compose exec -T identity-link-core php bin/console identity-link:validate-authorization
}

is_audience_declared() {
    grep -Fxq -- " - $CLIENT_AUDIENCE" <<< "$1"
}

core_mount_source() {
    docker inspect \
        --format "{{range .Mounts}}{{if eq .Destination \"$1\"}}{{.Source}}{{end}}{{end}}" \
        "$(docker compose ps -q identity-link-core)"
}

# Host directory that identity-link-core reads as config/authorization: mounted directly in production,
# or through the source checkout mounted at /app in development.
authorization_dir() {
    local directory
    directory=$(core_mount_source /app/config/authorization)
    if [ -z "$directory" ]; then
        directory=$(core_mount_source /app)
        [ -n "$directory" ] && directory="$directory/config/authorization"
    fi

    printf '%s' "$directory"
}

echo "Checking the authorization configuration for audience $CLIENT_AUDIENCE..."
if ! AUDIENCES=$(list_audiences); then
    echo "$AUDIENCES" >&2
    echo "ERROR: The authorization configuration is invalid; fix it before creating clients." >&2
    exit 1
fi

if is_audience_declared "$AUDIENCES"; then
    echo "Audience $CLIENT_AUDIENCE is already declared."
else
    AUTHORIZATION_DIR=$(authorization_dir)
    if [ -z "$AUTHORIZATION_DIR" ] || [ ! -d "$AUTHORIZATION_DIR" ]; then
        echo "ERROR: config/authorization is not mounted into identity-link-core, so the audience cannot be declared." >&2
        exit 1
    fi

    AUDIENCE_FILE="$AUTHORIZATION_DIR/client-$CLIENT_NAME.yaml"
    if [ -e "$AUDIENCE_FILE" ]; then
        echo "ERROR: $AUDIENCE_FILE already exists but does not declare $CLIENT_AUDIENCE." >&2
        exit 1
    fi

    # Escape single quotes for the single-quoted YAML key.
    cat > "$AUDIENCE_FILE" <<EOF
# Created by bin/create-client.sh for the "$CLIENT_NAME" client. A login-only audience needs no scopes of its own:
# the OpenID Connect default scopes come from the built-in config/authorization.yaml.
resources:
  '${CLIENT_AUDIENCE//\'/\'\'}': {}
EOF

    # identity-link-core reads the configuration on every request, so an invalid file would break it immediately.
    if ! AUDIENCES=$(list_audiences) || ! is_audience_declared "$AUDIENCES"; then
        echo "$AUDIENCES" >&2
        rm -f "$AUDIENCE_FILE"
        echo "ERROR: Declaring audience $CLIENT_AUDIENCE failed; $AUDIENCE_FILE was removed." >&2
        exit 1
    fi

    echo "Audience $CLIENT_AUDIENCE declared in $AUDIENCE_FILE"
fi

echo "Configuring the group ($GROUP_NAME)..."
docker compose exec -T identity-link-db-clients \
  php bin/console app:configure-group-scopes \
  --group "$GROUP_NAME" \
  --audience "$CLIENT_AUDIENCE" \
  --scope oidc.default

REDIRECT_URI_OPTIONS=()
for REDIRECT_URI in "${REDIRECT_URIS[@]}"; do
    REDIRECT_URI_OPTIONS+=(--redirect-uri "$REDIRECT_URI")
done

echo "Creating the client ($CLIENT_NAME)..."
TMP_OUTPUT=$(mktemp)
trap 'rm -f "$TMP_OUTPUT"' EXIT

if ! docker compose exec -T identity-link-db-clients \
  php bin/console app:create-client \
  --name "$CLIENT_NAME" \
  --description "$CLIENT_DESCRIPTION" \
  --audience "$CLIENT_AUDIENCE" \
  --group "$GROUP_NAME" \
  "${REDIRECT_URI_OPTIONS[@]}" \
  --grant-type authorization_code \
  --grant-type refresh_token \
  > "$TMP_OUTPUT"; then
    cat "$TMP_OUTPUT" >&2
    echo "ERROR: Creating the client failed. The audience and the group $GROUP_NAME are set up already," >&2
    echo "so the script can be run again once the error above is fixed." >&2
    exit 1
fi

EXTRACTED_ID=$(sed -n 's/^[[:space:]]*Client ID[[:space:].]*//p' "$TMP_OUTPUT" | tr -d '[:space:]')
EXTRACTED_SECRET=$(sed -n 's/^[[:space:]]*Client secret[[:space:].]*//p' "$TMP_OUTPUT" | tr -d '[:space:]')

if [ -z "$EXTRACTED_ID" ] || [ -z "$EXTRACTED_SECRET" ]; then
    echo "ERROR: Failed to extract CLIENT_ID or CLIENT_SECRET from the command output." >&2
    echo "Raw output was:" >&2
    cat "$TMP_OUTPUT" >&2
    exit 1
fi

cat <<EOF

Client "$CLIENT_NAME" was created.

  Client ID:      $EXTRACTED_ID
  Client secret:  $EXTRACTED_SECRET
  Audience:       $CLIENT_AUDIENCE
  Group:          $GROUP_NAME (scope oidc.default)
  Grant types:    authorization_code refresh_token
  Redirect URIs:  ${REDIRECT_URIS[*]}

The application must request the scopes it needs, e.g. "openid profile email offline_access".
Store the client secret securely; it will not be shown again.
EOF

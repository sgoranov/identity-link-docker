#!/usr/bin/env bash

set -euo pipefail

SERVICES=(core db-users db-clients 2fa bff console)

usage() {
    cat <<EOF
Usage: $0 [--no-cache] [--keep] [--ui] [--ui-port <port>] [-- <Playwright options>]

Builds the Identity Link images from the clones in src/ (docs/DEVELOPMENT.md), as they are on disk, uncommitted
changes included, and deploys them into e2e/.stack, a throwaway copy of this checkout, the way the README
describes it (bin/bootstrap-secrets.sh, docker compose up, bin/provision-tenant.sh, bin/create-client.sh). Then
runs the end-to-end tests against it and removes it again.

Options:
  --no-cache              Build without Docker's layer cache.
  --keep                  Leave the deployment running after the tests. The next run removes it.
  --ui                    Open Playwright's UI mode instead of running the tests: choose tests in your browser,
                          run them and watch them step by step. It runs the tests in e2e/tests as they are saved.
                          Stop it with Ctrl+C.
  --ui-port <port>        Port of the UI mode on localhost. Default: 9323. Implies --ui.

Options after -- go to Playwright, e.g. -- --grep "authorization code".

The results go to e2e/results: the branch and commit of each clone, the build log, the HTML report, the traces
of failed tests and the service logs.

Examples:
  $0                                          # every test
  $0 -- tests/admin-console/users.spec.ts     # the tests of one file
  $0 --ui                                     # watch the tests at http://localhost:9323
EOF
}

NO_CACHE=false
KEEP=false
UI=false
UI_PORT=9323
PLAYWRIGHT_ARGS=()

while [ $# -gt 0 ]; do
    case "$1" in
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        --keep)
            KEEP=true
            shift
            ;;
        --ui)
            UI=true
            shift
            ;;
        --ui-port)
            if [ $# -lt 2 ] || [[ ! "$2" =~ ^[0-9]+$ ]]; then
                echo "ERROR: --ui-port requires a port number." >&2
                exit 1
            fi
            UI=true
            UI_PORT="$2"
            shift 2
            ;;
        --)
            shift
            PLAYWRIGHT_ARGS=("$@")
            break
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

E2E_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$E2E_DIR")"
STACK_DIR="$E2E_DIR/.stack"
RESULTS_DIR="$E2E_DIR/results"
LOCK_FILE="$E2E_DIR/.run.lock"

for SERVICE in "${SERVICES[@]}"; do
    # .git of the clone itself: git rev-parse would also accept a directory of this repository.
    if [ ! -e "$PROJECT_ROOT/src/identity-link-$SERVICE/.git" ]; then
        echo "ERROR: $SERVICE is built from src/identity-link-$SERVICE, which is not a Git clone." \
            "Clone it as docs/DEVELOPMENT.md describes." >&2
        exit 1
    fi
done

DOMAIN_NAME=identity-link.test
RP_AUDIENCE="https://rp.$DOMAIN_NAME"
RP_REDIRECT_URI="$RP_AUDIENCE/callback"
# The administrator bin/provision-tenant.sh creates. It generates the password and prints it.
ADMIN_USERNAME=admin
# The audience bin/provision-tenant.sh gives the BFF client. The console's rights are scopes for it.
CONSOLE_AUDIENCE="https://$DOMAIN_NAME/identity-link"
# The name of the system user, client and groups, see "Creating the system records".
SYSTEM_NAME=e2e-system

# Files the deployment needs from this checkout. Everything else under config/ is generated for the run.
STACK_FILES=(
    bin
    docker-compose.yml
    docker-compose.prod.yml
    config/nginx.prod.conf.template
    config/postgres
)

remove_stack() {
    if [ -f "$STACK_DIR/.env" ]; then
        echo "Removing the deployment in $STACK_DIR..."
        (cd "$STACK_DIR" && docker compose down --volumes --remove-orphans)
    fi
    rm -rf "$STACK_DIR"
}

STEP="Preparing the deployment"

# Starts a step; finish() names the step that failed.
step() {
    STEP="$1"
    echo "$1..."
}

finish() {
    local exit_code=$?

    if [ -f "$STACK_DIR/.env" ]; then
        (cd "$STACK_DIR" && docker compose logs --no-color --timestamps > "$RESULTS_DIR/stack.log" 2>&1) || true
    fi

    if [ "$KEEP" = true ]; then
        cat <<EOF

The deployment keeps running. In $STACK_DIR:
  docker compose run --rm --build identity-link-e2e-runner   # run the tests again
  docker compose down --volumes                               # remove it
EOF
    else
        remove_stack
    fi

    # Printed last, so it is not lost above the output of removing the deployment.
    echo
    if [ "$STEP" = "Running the tests" ]; then
        echo "Test report: $RESULTS_DIR/report"
        echo "  Open it with: npx playwright show-report $RESULTS_DIR/report"
    elif [ "$STEP" = "Opening the UI mode" ]; then
        # Ctrl+C is how the UI mode ends.
        if [ "$exit_code" -eq 130 ]; then
            exit_code=0
        fi
    elif [ "$exit_code" -eq 130 ]; then
        echo "ERROR: $STEP was interrupted, so the tests did not run." >&2
    else
        echo "ERROR: $STEP failed, so the tests did not run." >&2
    fi
    if [ -f "$RESULTS_DIR/stack.log" ]; then
        echo "Service logs: $RESULTS_DIR/stack.log"
    fi

    rm -f "$LOCK_FILE"
    exit "$exit_code"
}

# Runs share e2e/.stack, e2e/results and the Compose project, so a second run would remove the deployment of the
# first. The lock is a symbolic link to the process ID of the run: creating it either succeeds or fails, also when
# two runs start at once, and the ID is in it from the moment it exists.
lock_holder_running() {
    # Not only kill -0, which also accepts another process that got the ID of a killed run.
    [ -n "$1" ] && ps -p "$1" -o args= 2> /dev/null | grep -q 'run\.sh'
}
if ! ln -s "$$" "$LOCK_FILE" 2> /dev/null; then
    LOCK_PID=$(readlink "$LOCK_FILE" 2> /dev/null || true)
    if lock_holder_running "$LOCK_PID"; then
        echo "ERROR: Another e2e/run.sh is running (process $LOCK_PID). Wait for it, or stop it with Ctrl+C." >&2
        exit 1
    fi
    # Left by a run that was killed.
    rm -rf "$LOCK_FILE"
    if ! ln -s "$$" "$LOCK_FILE" 2> /dev/null; then
        echo "ERROR: Another e2e/run.sh has just started." >&2
        exit 1
    fi
fi
# Until finish() takes over below.
trap 'rm -f "$LOCK_FILE"' EXIT

remove_stack

mkdir -p "$STACK_DIR"
for FILE in "${STACK_FILES[@]}"; do
    mkdir -p "$STACK_DIR/$(dirname "$FILE")"
    cp -R "$PROJECT_ROOT/$FILE" "$STACK_DIR/$FILE"
done
cp "$E2E_DIR/docker-compose.e2e.yml" "$STACK_DIR/"
mkdir -p "$STACK_DIR"/config/{authorization,certificates,keys,secrets}

# Created here so Docker does not create it as root when it mounts it into the runner.
rm -rf "$RESULTS_DIR"
mkdir -p "$RESULTS_DIR"

cat > "$STACK_DIR/.env" <<EOF
COMPOSE_PROJECT_NAME=identity-link-e2e
COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml:docker-compose.e2e.yml
DOMAIN_NAME=$DOMAIN_NAME
E2E_USER=$(id -u):$(id -g)
EOF

trap finish EXIT
cd "$STACK_DIR"

# The images are built from the clones as they are on disk, so this records what they had checked out.
printf '%-11s %-24s %-13s %s\n' SERVICE BRANCH COMMIT CHANGES > "$RESULTS_DIR/sources.txt"
for SERVICE in "${SERVICES[@]}"; do
    CLONE="$PROJECT_ROOT/src/identity-link-$SERVICE"
    BRANCH=$(git -C "$CLONE" symbolic-ref -q --short HEAD || echo '(no branch)')
    COMMIT=$(git -C "$CLONE" rev-parse --short=12 HEAD)
    CHANGES=
    if [ -n "$(git -C "$CLONE" status --porcelain)" ]; then
        CHANGES='uncommitted changes'
    fi
    printf '%-11s %-24s %-13s %s\n' "$SERVICE" "$BRANCH" "$COMMIT" "$CHANGES" >> "$RESULTS_DIR/sources.txt"
done
cat "$RESULTS_DIR/sources.txt"

step "Building the images"
BUILD_OPTIONS=(--pull)
if [ "$NO_CACHE" = true ]; then
    BUILD_OPTIONS+=(--no-cache)
fi
if ! docker compose --progress plain build "${BUILD_OPTIONS[@]}" > "$RESULTS_DIR/build.log" 2>&1; then
    tail -n 40 "$RESULTS_DIR/build.log" >&2
    echo "The build log is in $RESULTS_DIR/build.log" >&2
    exit 1
fi

step "Generating a CA and a certificate for $DOMAIN_NAME"
CERT_DIR="$STACK_DIR/config/certificates"
openssl req -x509 -newkey rsa:2048 -nodes -days 7 \
    -subj "/CN=Identity Link e2e CA" \
    -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -keyout "$CERT_DIR/rootCA.key" -out "$CERT_DIR/rootCA.crt" 2> /dev/null
openssl req -newkey rsa:2048 -nodes \
    -subj "/CN=$DOMAIN_NAME" \
    -keyout "$CERT_DIR/server.key" -out "$CERT_DIR/server.csr" 2> /dev/null
openssl x509 -req -days 7 \
    -in "$CERT_DIR/server.csr" -CA "$CERT_DIR/rootCA.crt" -CAkey "$CERT_DIR/rootCA.key" -CAcreateserial \
    -extfile <(printf 'subjectAltName=DNS:%s\nextendedKeyUsage=serverAuth\n' "$DOMAIN_NAME") \
    -out "$CERT_DIR/server.crt" 2> /dev/null

# bin/bootstrap-secrets.sh loads only docker-compose.yml, so it generates the secrets with the published core
# image that file names, not with the one built above. It also uses that file's network, identity-link-network, which
# the deployment does not: if no development stack has created it, it is removed again.
step "Generating the application secrets"
bin/bootstrap-secrets.sh
if [ "$(docker network inspect --format '{{index .Labels "com.docker.compose.project"}}' identity-link-network 2> /dev/null)" \
    = identity-link-e2e ]; then
    docker network rm identity-link-network > /dev/null
fi

step "Starting the services"
if ! docker compose up --detach --wait --wait-timeout 300 --quiet-pull; then
    # Show why: the end of the log of each service that stopped or is unhealthy. If none did, the wait timed
    # out, so show the services that are still starting instead.
    FAILED_SERVICES=$(docker compose ps --all --format '{{.Service}} {{.State}} {{.Health}}' \
        | awk '$2 != "running" || $3 == "unhealthy" { print $1 }')
    if [ -z "$FAILED_SERVICES" ]; then
        FAILED_SERVICES=$(docker compose ps --format '{{.Service}} {{.Health}}' | awk '$2 != "" && $2 != "healthy" { print $1 }')
    fi
    for SERVICE in $FAILED_SERVICES; do
        echo >&2
        echo "$SERVICE did not start. The end of its log:" >&2
        docker compose logs --no-color --no-log-prefix --tail 20 "$SERVICE" >&2
    done
    exit 1
fi

step "Provisioning the tenant"
if ! PROVISION_OUTPUT=$(bin/provision-tenant.sh "$DOMAIN_NAME"); then
    echo "$PROVISION_OUTPUT" >&2
    exit 1
fi
echo "$PROVISION_OUTPUT"
ADMIN_PASSWORD=$(sed -n 's/^[[:space:]]*Password:[[:space:]]*//p' <<< "$PROVISION_OUTPUT")
if [ -z "$ADMIN_PASSWORD" ]; then
    echo "ERROR: bin/provision-tenant.sh did not print the administrator's password." >&2
    exit 1
fi

step "Creating a sign-in client"
CLIENT_OUTPUT=$(bin/create-client.sh --name e2e-rp --audience "$RP_AUDIENCE" --redirect-uri "$RP_REDIRECT_URI")
echo "$CLIENT_OUTPUT"
RP_CLIENT_ID=$(sed -n 's/^[[:space:]]*Client ID:[[:space:]]*//p' <<< "$CLIENT_OUTPUT")
RP_CLIENT_SECRET=$(sed -n 's/^[[:space:]]*Client secret:[[:space:]]*//p' <<< "$CLIENT_OUTPUT")

# Runs the SQL on stdin in a database of identity-link-database-server.
run_sql() {
    docker compose exec -T identity-link-database-server \
        sh -c 'psql --quiet -v ON_ERROR_STOP=1 -U "$(cat /run/secrets/db_user)" -d "$1"' sh "$1" > /dev/null
}

# The console shows system records read-only, and the services refuse to change them. A deployment has none, so
# create a user, a client and a group of each kind with the services' commands, and mark them in the databases.
# The system user can sign in to the console, with the rights of its group.
step "Creating the system records"
SYSTEM_PASSWORD=$(openssl rand -base64 18)
docker compose exec -T identity-link-db-users php bin/console app:configure-group-scopes \
    --group "$SYSTEM_NAME" --audience "$CONSOLE_AUDIENCE" \
    --scope users.read --scope users.query --scope users.groups.read > /dev/null
docker compose exec -T identity-link-db-users php bin/console app:create-user \
    --username "$SYSTEM_NAME" --email "$SYSTEM_NAME@$DOMAIN_NAME" --first-name System --last-name User \
    --password "$SYSTEM_PASSWORD" --group "$SYSTEM_NAME" \
    --grant-type authorization_code --grant-type refresh_token > /dev/null
docker compose exec -T identity-link-db-clients php bin/console app:configure-group-scopes \
    --group "$SYSTEM_NAME" --audience "$CONSOLE_AUDIENCE" --scope users.read > /dev/null
docker compose exec -T identity-link-db-clients php bin/console app:create-client \
    --name "$SYSTEM_NAME" --description "System client" --audience "$CONSOLE_AUDIENCE" --group "$SYSTEM_NAME" \
    --redirect-uri "https://$SYSTEM_NAME.$DOMAIN_NAME/callback" --grant-type client_credentials > /dev/null
run_sql identity-link-db-users <<EOF
UPDATE "user" SET is_system = true WHERE username = '$SYSTEM_NAME';
UPDATE "group" SET is_system = true WHERE name = '$SYSTEM_NAME';
EOF
run_sql identity-link-db-clients <<EOF
UPDATE client SET is_system = true WHERE name = '$SYSTEM_NAME';
UPDATE "group" SET is_system = true WHERE name = '$SYSTEM_NAME';
UPDATE secret SET is_system = true WHERE client_id = (SELECT id FROM client WHERE name = '$SYSTEM_NAME');
EOF

(
    umask 077
    cat > runner.env <<EOF
E2E_ADMIN_USERNAME=$ADMIN_USERNAME
E2E_ADMIN_PASSWORD=$ADMIN_PASSWORD
E2E_BFF_CLIENT_ID=$(< config/secrets/bff_client_id)
E2E_BFF_CLIENT_SECRET=$(< config/secrets/bff_client_secret)
E2E_RP_CLIENT_ID=$RP_CLIENT_ID
E2E_RP_CLIENT_SECRET=$RP_CLIENT_SECRET
E2E_RP_AUDIENCE=$RP_AUDIENCE
E2E_RP_REDIRECT_URI=$RP_REDIRECT_URI
E2E_CONSOLE_AUDIENCE=$CONSOLE_AUDIENCE
E2E_SYSTEM_NAME=$SYSTEM_NAME
E2E_SYSTEM_PASSWORD=$SYSTEM_PASSWORD
EOF
)

# The expansion guard keeps an empty array from failing under set -u in bash 3 (macOS).
if [ "$UI" = true ]; then
    step "Opening the UI mode"
    echo "Open http://localhost:$UI_PORT in your browser. Stop the UI mode with Ctrl+C."
    # The tests come from e2e rather than the image, so the UI mode sees every change to them.
    docker compose run --rm --build --publish "127.0.0.1:$UI_PORT:$UI_PORT" --volume "$E2E_DIR/tests:/e2e/tests:ro" \
        identity-link-e2e-runner --ui-host 0.0.0.0 --ui-port "$UI_PORT" ${PLAYWRIGHT_ARGS[@]+"${PLAYWRIGHT_ARGS[@]}"}
else
    step "Running the tests"
    docker compose run --rm --build identity-link-e2e-runner ${PLAYWRIGHT_ARGS[@]+"${PLAYWRIGHT_ARGS[@]}"}
fi

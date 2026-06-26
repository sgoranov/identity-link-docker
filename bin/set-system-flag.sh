#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONTAINER="identity-link-database-server"

DB_USER=$(<$PROJECT_ROOT/config/secrets/database_user)
DB_PASSWORD=$(<$PROJECT_ROOT/config/secrets/database_password)

export PGPASSWORD="$DB_PASSWORD"

echo "Updating identity-link-db-clients..."

docker exec -e PGPASSWORD="$PGPASSWORD" -i "$CONTAINER" \
    psql -U "$DB_USER" -d identity-link-db-clients <<'EOF'
BEGIN;
UPDATE client SET is_system = TRUE;
UPDATE "group" SET is_system = TRUE;
UPDATE secret SET is_system = TRUE;
COMMIT;
EOF

echo "Updating identity-link-db-users..."

docker exec -e PGPASSWORD="$PGPASSWORD" -i "$CONTAINER" \
    psql -U "$DB_USER" -d identity-link-db-users <<'EOF'
BEGIN;
UPDATE "group" SET is_system = TRUE;
UPDATE "user" SET is_system = TRUE;
COMMIT;
EOF

echo "Done."

#!/usr/bin/env bash

set -euo pipefail

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <username>"
    exit 1
fi

USERNAME="$1"
CONTAINER="identity-link-db-users"

docker exec -it "$CONTAINER" \
    php bin/console app:reset-user-password \
    --username "$USERNAME"
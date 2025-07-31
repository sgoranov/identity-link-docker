#!/bin/bash

set -a
[ -f .env ] && source .env
[ -f .env.local ] && source .env.local
set +a

docker compose down --remove-orphans
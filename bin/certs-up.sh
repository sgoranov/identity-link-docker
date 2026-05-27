#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:-example.com}"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$BASE_DIR/config/certificates"
CRT_FILE="local-dev.crt"
KEY_FILE="local-dev.key"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "Error: mkcert is not installed." >&2
  echo "Install mkcert first: https://github.com/FiloSottile/mkcert" >&2
  exit 1
fi

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

SHOULD_GENERATE=true
if [ -f "$CRT_FILE" ] && [ -f "$KEY_FILE" ]; then
  if command -v openssl >/dev/null 2>&1; then
    if openssl x509 -in "$CRT_FILE" -text -noout | grep -qi "DNS:$DOMAIN"; then
      SHOULD_GENERATE=false
    fi
  fi
fi

if [ "$SHOULD_GENERATE" = true ]; then
  echo "Certificates missing, invalid or domain changed. Generating new ones for: $DOMAIN"

  if ! mkcert -check >/dev/null 2>&1; then
    echo "Installing local CA (may require sudo password)..."
    mkcert -install
  fi

  mkcert \
    -cert-file "$CRT_FILE" \
    -key-file "$KEY_FILE" \
    "$DOMAIN" "*.$DOMAIN" "*.id.$DOMAIN" localhost 127.0.0.1 ::1

  echo "Certificates generated successfully."
else
  echo "Valid certificates for $DOMAIN already exist. Skipping generation."
fi
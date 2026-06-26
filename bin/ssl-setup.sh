#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:-example.com}"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CERT_DIR="$BASE_DIR/config/certificates"
CRT_FILE="local-dev.crt"
KEY_FILE="local-dev.key"
CA_FILE="rootCA.crt"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "Error: mkcert is not installed." >&2
  echo "Install mkcert first: https://github.com/FiloSottile/mkcert" >&2
  exit 1
fi

mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

SHOULD_GENERATE=true
if [ -f "$CRT_FILE" ] && [ -f "$KEY_FILE" ] && [ -f "$CA_FILE" ]; then
  if command -v openssl >/dev/null 2>&1; then
    if openssl x509 -in "$CRT_FILE" -text -noout | grep -qi "DNS:$DOMAIN"; then
      SHOULD_GENERATE=false
    fi
  fi
fi

if [ "$SHOULD_GENERATE" = true ]; then
  echo "Certificates or root CA missing, invalid, or domain changed. Generating new ones for: $DOMAIN"

  if ! mkcert -check >/dev/null 2>&1; then
    echo "Installing local CA (may require sudo password)..."
    mkcert -install
  fi

  mkcert \
    -cert-file "$CRT_FILE" \
    -key-file "$KEY_FILE" \
    "$DOMAIN" "*.$DOMAIN" "*.id.$DOMAIN" localhost 127.0.0.1 ::1

  MKCERT_CA_ROOT="$(mkcert -CAROOT)"
  if [ -f "$MKCERT_CA_ROOT/rootCA.pem" ]; then
    cp "$MKCERT_CA_ROOT/rootCA.pem" "$CA_FILE"
    echo "Root CA certificate copied successfully to $CERT_DIR/$CA_FILE."
  else
    echo "Warning: Could not find rootCA.pem in $MKCERT_CA_ROOT" >&2
  fi

  echo "Certificates setup complete."
else
  echo "Valid certificates and root CA for $DOMAIN already exist. Skipping generation."
fi
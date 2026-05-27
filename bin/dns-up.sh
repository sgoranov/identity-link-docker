#!/usr/bin/env bash

set -euo pipefail

DOMAIN="${1:-example.com}"
INTERFACE="${2:-}"
LOCAL_DNS="${LOCAL_DNS:-127.0.0.1}"

if [ -z "$INTERFACE" ]; then
  INTERFACE="$(ip route | awk '/default/ {print $5; exit}')"
fi

if [ -z "$INTERFACE" ]; then
  echo "Error: Could not detect active network interface." >&2
  exit 1
fi

echo "Configuring DNS for interface: $INTERFACE"
echo "Domain routed to local DNS: ~${DOMAIN}"
echo "Local DNS target: ${LOCAL_DNS}"

if systemctl is-active --quiet systemd-resolved && command -v resolvectl >/dev/null 2>&1; then
  sudo resolvectl dns "$INTERFACE" "$LOCAL_DNS"
  sudo resolvectl domain "$INTERFACE" "~${DOMAIN}"
  echo "Applied via systemd-resolved."
elif command -v nmcli >/dev/null 2>&1; then
  CONNECTION="$(nmcli -t -f NAME,DEVICE connection show --active | awk -F: -v dev="$INTERFACE" '$2 == dev {print $1; exit}')"
  if [ -z "$CONNECTION" ]; then
    echo "Error: Could not find active NetworkManager connection for interface '$INTERFACE'." >&2
    exit 1
  fi

  echo "$CONNECTION:$INTERFACE" > .dns_current_connection

  sudo nmcli connection modify "$CONNECTION" ipv4.ignore-auto-dns yes
  sudo nmcli connection modify "$CONNECTION" ipv4.dns "$LOCAL_DNS"
  sudo nmcli connection modify "$CONNECTION" ipv4.dns-search "~${DOMAIN}"
  sudo nmcli connection up "$CONNECTION"
  echo "Applied via NetworkManager connection: $CONNECTION"
else
  echo "Error: neither systemd-resolved nor NetworkManager tooling is available." >&2
  exit 1
fi

echo -e "\nVerify with:"
if command -v resolvectl >/dev/null 2>&1; then
  echo "  resolvectl query app1.id.${DOMAIN}"
else
  echo "  dig app1.id.${DOMAIN} +short"
fi
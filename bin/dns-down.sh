#!/usr/bin/env bash

set -euo pipefail

INTERFACE="${1:-}"

if [ -z "$INTERFACE" ]; then
  INTERFACE="$(ip route | awk '/default/ {print $5; exit}')"
fi

echo "Reverting DNS settings..."

if systemctl is-active --quiet systemd-resolved && command -v resolvectl >/dev/null 2>&1; then
  if [ -n "$INTERFACE" ]; then
    sudo resolvectl revert "$INTERFACE"
    echo "DNS settings reverted via systemd-resolved for $INTERFACE."
  else
    echo "Error: Could not detect interface to revert systemd-resolved." >&2
    exit 1
  fi
elif command -v nmcli >/dev/null 2>&1; then
  if [ -f .dns_current_connection ]; then
    SAVED_DATA=$(cat .dns_current_connection)
    CONNECTION="${SAVED_DATA%%:*}"
    rm .dns_current_connection
  else
    if [ -z "$INTERFACE" ]; then
      echo "Error: Could not detect active interface for NetworkManager." >&2
      exit 1
    fi
    CONNECTION="$(nmcli -t -f NAME,DEVICE connection show --active | awk -F: -v dev="$INTERFACE" '$2 == dev {print $1; exit}')"
  fi

  if [ -z "$CONNECTION" ]; then
    echo "Warning: No active connection found to revert."
    exit 0
  fi

  sudo nmcli connection modify "$CONNECTION" ipv4.ignore-auto-dns no
  sudo nmcli connection modify "$CONNECTION" ipv4.dns ""
  sudo nmcli connection modify "$CONNECTION" ipv4.dns-search ""
  sudo nmcli connection up "$CONNECTION"
  echo "DNS settings reverted via NetworkManager for connection: $CONNECTION"
else
  echo "Error: neither systemd-resolved nor NetworkManager tooling is available." >&2
  exit 1
fi

echo "Done. System DNS is back to default."
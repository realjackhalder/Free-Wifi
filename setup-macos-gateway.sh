#!/usr/bin/env bash
set -euo pipefail

cat <<'CONF' > portal.conf
# pf anchors for captive portal
rdr pass on en0 inet proto tcp from any to any port 80 -> 127.0.0.1 port 3000

# table used by firewall.js
# clients with internet access are inserted into this table:
# sudo pfctl -t allowed_wifi -T add <ip>
table <allowed_wifi> persist
pass out quick inet from <allowed_wifi> to any keep state
block out quick inet from any to any
CONF

echo "Generated portal.conf in $(pwd)"
echo "Apply with:"
echo "  sudo pfctl -f ./portal.conf"
echo "  sudo pfctl -e"
echo ""
echo "To disable: sudo pfctl -d"

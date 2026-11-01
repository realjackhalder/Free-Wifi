#!/usr/bin/env bash
# ==============================================================================
# setup-vpn.sh — Complete WireGuard VPN Server Setup for Free-Wifi Gateway
# Supports: Ubuntu, Debian, Raspberry Pi OS, CentOS, Rocky Linux
# ==============================================================================
set -euo pipefail

echo "=========================================================="
echo "   Free Wi-Fi + WireGuard VPN Gateway Server Installer    "
echo "=========================================================="

# Check root
if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run as root: sudo bash setup-vpn.sh"
  exit 1
fi

WAN_IFACE=$(ip route get 8.8.8.8 2>/dev/null | awk -- '{print $5}' | head -n1 || echo "eth0")
SERVER_PORT=51820
VPN_SUBNET="10.8.0.1/24"

echo "[1/5] Detected Primary Network Interface: $WAN_IFACE"

# Install WireGuard
echo "[2/5] Installing WireGuard & Tools..."
if command -v apt-get &>/dev/null; then
  apt-get update -y
  apt-get install -y wireguard iptables qrencode curl
elif command -v dnf &>/dev/null; then
  dnf install -y epel-release || true
  dnf install -y wireguard-tools iptables qrencode curl
fi

# Enable IP forwarding
echo "[3/5] Enabling IPv4 Packet Forwarding..."
sysctl -w net.ipv4.ip_forward=1
sed -i 's/#net.ipv4.ip_forward=1/net.ipv4.ip_forward=1/' /etc/sysctl.conf 2>/dev/null || true
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-wireguard-forward.conf

# Setup iptables NAT Masquerade
echo "[4/5] Setting up NAT / Masquerade on $WAN_IFACE..."
iptables -t nat -C POSTROUTING -s 10.8.0.0/24 -o "$WAN_IFACE" -j MASQUERADE 2>/dev/null || \
iptables -t nat -A POSTROUTING -s 10.8.0.0/24 -o "$WAN_IFACE" -j MASQUERADE

iptables -C FORWARD -i wg0 -j ACCEPT 2>/dev/null || iptables -A FORWARD -i wg0 -j ACCEPT
iptables -C FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || \
iptables -A FORWARD -o wg0 -m state --state RELATED,ESTABLISHED -j ACCEPT

# Save iptables rules
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save
fi

echo "[5/5] WireGuard Environment Ready!"
echo ""
echo "Next Steps:"
echo "1. Run the Captive Portal node app: npm start"
echo "2. Open Admin Panel: http://<SERVER_IP>:3000/admin"
echo "3. Go to 'WireGuard VPN' tab to manage peers, export wg0.conf, or scan QR codes"
echo "4. Start WireGuard interface anytime with: sudo wg-quick up wg0"
echo "=========================================================="

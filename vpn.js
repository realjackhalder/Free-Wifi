// ============================================================================
// vpn.js — WireGuard VPN Server & Client Profile Automation
// Pure Node.js Curve25519 (X25519) key generation + Config & QR builder
// ============================================================================

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const QRCode = require('qrcode');

const DRY_RUN = process.env.DRY_RUN !== 'false';

/**
 * Generate a WireGuard-compatible Curve25519 32-byte Base64 key pair
 */
function generateKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });

  // In PKCS#8 DER for X25519, the 32 raw private bytes start at offset 16
  const privRaw = privDer.subarray(16, 48);
  // In SPKI DER for X25519, the 32 raw public bytes start at offset 12
  const pubRaw = pubDer.subarray(12, 44);

  return {
    privateKey: privRaw.toString('base64'),
    publicKey: pubRaw.toString('base64')
  };
}

/**
 * Derive public key from an existing base64 private key
 */
function getPublicKeyFromPrivate(privateKeyBase64) {
  try {
    const privRaw = Buffer.from(privateKeyBase64, 'base64');
    // Wrap in standard PKCS#8 DER header for X25519
    const pkcs8Header = Buffer.from([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20
    ]);
    const der = Buffer.concat([pkcs8Header, privRaw]);
    const privKeyObj = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const pubKeyObj = crypto.createPublicKey(privKeyObj);
    const pubDer = pubKeyObj.export({ type: 'spki', format: 'der' });
    return pubDer.subarray(12, 44).toString('base64');
  } catch (err) {
    return null;
  }
}

/**
 * Detect public IP or best local IP for WireGuard endpoint
 */
function detectEndpoint() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

/**
 * Ensure VPN server keys & settings exist in db
 */
function ensureVpnSettings(db) {
  if (!db.vpn) {
    const keys = generateKeyPair();
    db.vpn = {
      enabled: true,
      port: 51820,
      serverSubnet: '10.8.0.1/24',
      serverIp: '10.8.0.1',
      endpoint: `${detectEndpoint()}:51820`,
      serverPrivateKey: keys.privateKey,
      serverPublicKey: keys.publicKey,
      dns: '1.1.1.1, 8.8.8.8',
      peers: {} // keyed by phone or client id
    };
  }
  if (!db.vpn.peers) db.vpn.peers = {};
  return db.vpn;
}

/**
 * Allocate next available client IP in 10.8.0.2 - 10.8.0.254
 */
function getNextAvailableClientIp(db) {
  const vpn = ensureVpnSettings(db);
  const usedIps = new Set(Object.values(vpn.peers).map(p => p.clientIp));
  usedIps.add('10.8.0.1');

  for (let i = 2; i <= 254; i++) {
    const candidate = `10.8.0.${i}`;
    if (!usedIps.has(candidate)) return candidate;
  }
  throw new Error('VPN IP pool exhausted (max 253 peers)');
}

/**
 * Create or retrieve a WireGuard peer for a phone/account
 */
function getOrCreateVpnPeer(db, phone, clientLabel = '') {
  const vpn = ensureVpnSettings(db);
  if (vpn.peers[phone]) {
    return vpn.peers[phone];
  }

  const keys = generateKeyPair();
  const clientIp = getNextAvailableClientIp(db);

  const peer = {
    phone,
    label: clientLabel || `User-${phone}`,
    clientIp,
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    createdAt: Date.now(),
    enabled: true
  };

  vpn.peers[phone] = peer;
  return peer;
}

/**
 * Generate client .conf file string
 */
function generateClientConfig(db, phone) {
  const vpn = ensureVpnSettings(db);
  const peer = vpn.peers[phone] || getOrCreateVpnPeer(db, phone);

  return `[Interface]
# Free-Wifi VIP WireGuard VPN Client
# User: ${peer.phone} (${peer.label || 'Subscriber'})
PrivateKey = ${peer.privateKey}
Address = ${peer.clientIp}/32
DNS = ${vpn.dns || '1.1.1.1, 8.8.8.8'}

[Peer]
# Free Wi-Fi Gateway Server
PublicKey = ${vpn.serverPublicKey}
Endpoint = ${vpn.endpoint}
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = 25
`;
}

/**
 * Generate client QR code as SVG string
 */
async function generateClientQrSvg(db, phone) {
  const conf = generateClientConfig(db, phone);
  return await QRCode.toString(conf, {
    type: 'svg',
    margin: 2,
    color: {
      dark: '#1e3a8a',
      light: '#ffffff'
    }
  });
}

/**
 * Generate client QR code as Data URL (base64 PNG)
 */
async function generateClientQrDataUrl(db, phone) {
  const conf = generateClientConfig(db, phone);
  return await QRCode.toDataURL(conf, {
    margin: 2,
    width: 320,
    color: {
      dark: '#1e3a8a',
      light: '#ffffff'
    }
  });
}

/**
 * Generate server wg0.conf
 */
function generateServerWgConfig(db) {
  const vpn = ensureVpnSettings(db);
  let conf = `# ==============================================================================
# /etc/wireguard/wg0.conf
# Free Wi-Fi & WireGuard VPN Gateway Server Configuration
# Generated automatically by Free-Wifi Captive Portal
# ==============================================================================

[Interface]
Address = ${vpn.serverSubnet}
ListenPort = ${vpn.port || 51820}
PrivateKey = ${vpn.serverPrivateKey}

# NAT Routing & IP Masquerading on start/stop
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -A FORWARD -o %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -D FORWARD -o %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

`;

  for (const phone of Object.keys(vpn.peers)) {
    const peer = vpn.peers[phone];
    if (peer.enabled !== false) {
      conf += `
# Client: ${peer.phone} (${peer.label || 'Peer'})
[Peer]
PublicKey = ${peer.publicKey}
AllowedIPs = ${peer.clientIp}/32
`;
    }
  }

  return conf;
}

/**
 * Apply WireGuard config to system if wireguard is available
 */
async function syncWireGuard(db) {
  const vpn = ensureVpnSettings(db);
  if (DRY_RUN) {
    console.log(`[VPN DRY_RUN] Would sync WireGuard peers (${Object.keys(vpn.peers).length} active) to port ${vpn.port}`);
    return { ok: true, dryRun: true };
  }

  const wgConfPath = process.platform === 'win32'
    ? path.join(__dirname, 'wg0.conf')
    : '/etc/wireguard/wg0.conf';

  try {
    fs.writeFileSync(wgConfPath, generateServerWgConfig(db), 'utf-8');
    return new Promise((resolve) => {
      execFile('wg', ['syncconf', 'wg0', '<(wg-quick strip wg0)'], (err, stdout, stderr) => {
        if (err) {
          console.log('[VPN] Note: wg command not active or requires root:', err.message);
          return resolve({ ok: false, error: err.message });
        }
        resolve({ ok: true, stdout });
      });
    });
  } catch (err) {
    console.error('[VPN] Failed writing wg0.conf:', err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  DRY_RUN,
  generateKeyPair,
  getPublicKeyFromPrivate,
  ensureVpnSettings,
  getOrCreateVpnPeer,
  generateClientConfig,
  generateClientQrSvg,
  generateClientQrDataUrl,
  generateServerWgConfig,
  syncWireGuard
};

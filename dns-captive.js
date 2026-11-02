// dns-captive.js — Lightweight captive portal DNS responder
// Resolves unauthenticated client queries to Portal IP (Walled Garden)
// Proxies authenticated client queries to upstream DNS (8.8.8.8)

const dgram = require('dgram');
const os = require('os');

const PORTAL_IP = process.argv[2] || getLocalIp();
const DNS_PORT = 53;

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '192.168.1.1';
}

function extractDomainFromQuery(query) {
  try {
    let offset = 12;
    const parts = [];
    while (offset < query.length) {
      const len = query[offset++];
      if (len === 0) break;
      if (offset + len > query.length) break;
      parts.push(query.toString('utf8', offset, offset + len));
      offset += len;
    }
    return parts.join('.').toLowerCase();
  } catch (e) {
    return '';
  }
}

function isCnaProbeDomain(domain) {
  if (!domain) return false;
  const d = domain.toLowerCase();
  return (
    d.includes('captive.apple.com') ||
    d.includes('connectivitycheck') ||
    d.includes('clients3.google.com') ||
    d.includes('msftconnecttest') ||
    d.includes('msftncsi') ||
    d.includes('detectportal.firefox') ||
    d.includes('networkcheck.kde')
  );
}

function isWalledGardenDomain(domain) {
  if (!domain) return false;
  if (isCnaProbeDomain(domain)) return false;
  const d = domain.toLowerCase();
  return (
    d.endsWith('free-wifi-portal.web.app') ||
    d.endsWith('.web.app') ||
    d.endsWith('.firebaseapp.com') ||
    d.endsWith('.googleapis.com') ||
    d.endsWith('.google.com') ||
    d.endsWith('.gstatic.com') ||
    d.endsWith('.googleusercontent.com') ||
    d.endsWith('telegram.org') ||
    d.endsWith('.telegram.org') ||
    d.endsWith('jsdelivr.net') ||
    d.endsWith('.jsdelivr.net') ||
    d.endsWith('cloudflare.com') ||
    d.endsWith('.cloudflare.com') ||
    d.endsWith('ipify.org') ||
    d.endsWith('.ipify.org')
  );
}

function buildDnsResponse(query, ip) {
  const id = query.slice(0, 2);
  const header = Buffer.alloc(12);
  id.copy(header, 0);
  header.writeUInt16BE(0x8180, 2); // standard response, no error
  header.writeUInt16BE(1, 4);      // questions: 1
  header.writeUInt16BE(1, 6);      // answers: 1
  header.writeUInt16BE(0, 8);      // authority: 0
  header.writeUInt16BE(0, 10);     // additional: 0

  const questionStart = 12;
  let questionEnd = questionStart;
  while (questionEnd < query.length && query[questionEnd] !== 0) {
    questionEnd += query[questionEnd] + 1;
  }
  questionEnd += 1; // null terminator
  questionEnd += 4; // QTYPE (2) + QCLASS (2)

  const question = query.slice(questionStart, questionEnd);

  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xC00C, 0); // Pointer to name in question
  answer.writeUInt16BE(1, 2);      // Type: A
  answer.writeUInt16BE(1, 4);      // Class: IN
  answer.writeUInt32BE(60, 6);     // TTL: 60s
  answer.writeUInt16BE(4, 10);     // RDLENGTH: 4 bytes

  const parts = String(ip || '127.0.0.1').split('.').map(Number);
  answer[12] = parts[0] || 127;
  answer[13] = parts[1] || 0;
  answer[14] = parts[2] || 0;
  answer[15] = parts[3] || 1;

  return Buffer.concat([header, question, answer]);
}

function startCaptiveDns(portalIp, isAuthenticatedFn = null) {
  try {
    const server = dgram.createSocket('udp4');
    const targetIp = portalIp || getLocalIp();

    server.on('message', async (msg, rinfo) => {
      try {
        if (msg.length < 12) return;
        const clientIp = rinfo.address;
        const domain = extractDomainFromQuery(msg);
        const isAuth = typeof isAuthenticatedFn === 'function' ? await isAuthenticatedFn(clientIp) : false;
        const isWalled = isWalledGardenDomain(domain);

        if (!isAuth && !isWalled) {
          // Unauthenticated & outside walled garden: Resolve to Portal IP to force captive login & block internet
          const response = buildDnsResponse(msg, targetIp);
          server.send(response, rinfo.port, rinfo.address);
        } else {
          // Authenticated (after success from website) OR Walled Garden domain (portal, Firebase, Google auth, Telegram):
          // Forward to upstream DNS (8.8.8.8) to give access!
          const upstream = dgram.createSocket('udp4');
          upstream.send(msg, 53, '8.8.8.8', (err) => {
            if (err) upstream.close();
          });
          upstream.on('message', (upstreamMsg) => {
            server.send(upstreamMsg, rinfo.port, rinfo.address);
            upstream.close();
          });
          upstream.on('error', () => {
            try { upstream.close(); } catch (e) {}
          });
        }
      } catch (err) {
        // Silently ignore corrupted packets
      }
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        console.warn(`[DNS] Port 53 unavailable (${err.code}). Captive DNS responder bypassed.`);
      } else {
        console.warn(`[DNS] Server error:`, err.message);
      }
    });

    server.bind(DNS_PORT, '0.0.0.0', () => {
      console.log(`📡 Captive DNS Responder active on UDP Port 53 -> Unauthenticated queries redirect to ${targetIp}`);
    });

    return server;
  } catch (err) {
    console.warn('[DNS] Initialization skipped:', err.message);
    return null;
  }
}

if (require.main === module) {
  const standalone = startCaptiveDns(PORTAL_IP);
}

module.exports = {
  buildDnsResponse,
  startCaptiveDns,
  getLocalIp
};

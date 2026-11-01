// dns-captive.js — Lightweight captive portal DNS responder
// Responds to all DNS queries with the portal server IP
// Usage: sudo node dns-captive.js [PORTAL_IP]

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

function buildDnsResponse(query, ip) {
  // Parse the query
  const id = query.slice(0, 2);
  
  // Build response header
  const header = Buffer.alloc(12);
  id.copy(header, 0); // Transaction ID
  header.writeUInt16BE(0x8180, 2); // Flags: standard response, no error
  header.writeUInt16BE(1, 4);      // Questions: 1
  header.writeUInt16BE(1, 6);      // Answers: 1
  header.writeUInt16BE(0, 8);      // Authority: 0
  header.writeUInt16BE(0, 10);     // Additional: 0
  
  // Copy question section from query
  const questionStart = 12;
  let questionEnd = questionStart;
  // Skip past the QNAME
  while (questionEnd < query.length && query[questionEnd] !== 0) {
    questionEnd += query[questionEnd] + 1;
  }
  questionEnd += 1; // null terminator
  questionEnd += 4; // QTYPE (2) + QCLASS (2)
  
  const question = query.slice(questionStart, questionEnd);
  
  // Build answer: pointer to name in question + A record
  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xC00C, 0); // Pointer to name in question
  answer.writeUInt16BE(1, 2);      // Type: A
  answer.writeUInt16BE(1, 4);      // Class: IN
  answer.writeUInt32BE(60, 6);     // TTL: 60 seconds
  answer.writeUInt16BE(4, 10);     // RDLENGTH: 4 bytes
  
  // Write IP address
  const parts = ip.split('.').map(Number);
  answer[12] = parts[0];
  answer[13] = parts[1];
  answer[14] = parts[2];
  answer[15] = parts[3];
  
  return Buffer.concat([header, question, answer]);
}

const server = dgram.createSocket('udp4');

server.on('message', (msg, rinfo) => {
  try {
    if (msg.length < 12) return;
    const response = buildDnsResponse(msg, PORTAL_IP);
    server.send(response, rinfo.port, rinfo.address);
  } catch (err) {
    console.error('[DNS] Error processing query:', err.message);
  }
});

server.on('listening', () => {
  const addr = server.address();
  console.log(`[DNS] Captive portal DNS responder listening on ${addr.address}:${addr.port}`);
  console.log(`[DNS] All queries will resolve to: ${PORTAL_IP}`);
});

server.on('error', (err) => {
  if (err.code === 'EACCES') {
    console.error('[DNS] Permission denied. Run with sudo: sudo node dns-captive.js');
  } else {
    console.error('[DNS] Server error:', err.message);
  }
  process.exit(1);
});

server.bind(DNS_PORT, '0.0.0.0');

// firewall.js — Network Gateway & Firewall Automation
const { execFile } = require('child_process');
const net = require('net');

const DRY_RUN = process.env.DRY_RUN !== 'false'; // default true for safe testing

function run(args) {
  return new Promise((resolve, reject) => {
    if (DRY_RUN) {
      console.log(`[FIREWALL DRY_RUN] sudo ${args.join(' ')}`);
      return resolve({ stdout: '', stderr: '' });
    }
    execFile('sudo', args, (error, stdout, stderr) => {
      if (error) {
        console.error(`[FIREWALL ERROR] ${args.join(' ')}: ${error.message}`);
        return resolve({ stdout: '', stderr: error.message });
      }
      resolve({ stdout, stderr });
    });
  });
}

function validateIp(ip) {
  return typeof ip === 'string' && net.isIP(ip) !== 0;
}

// Get MAC address from ARP table
function getMacForIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return Promise.resolve('localhost');
  if (!validateIp(ip)) return Promise.resolve(ip);
  return new Promise((resolve) => {
    // Try arp -a on Windows, arp -n on Linux/macOS
    const isWin = process.platform === 'win32';
    const args = isWin ? ['-a', ip] : ['-n', ip];
    execFile('arp', args, (error, stdout) => {
      if (error || !stdout) return resolve(ip);
      // Match MAC patterns: aa:bb:cc:dd:ee:ff or aa-bb-cc-dd-ee-ff
      const match = stdout.match(/([0-9a-fA-F]{1,2}[:-]){5}[0-9a-fA-F]{1,2}/);
      if (match) {
        resolve(match[0].toLowerCase().replace(/-/g, ':'));
      } else {
        resolve(ip);
      }
    });
  });
}

async function allowIp(ip) {
  if (!validateIp(ip)) return;
  console.log(`[FIREWALL] Allowing IP: ${ip}`);
  await run(['pfctl', '-t', 'allowed_wifi', '-T', 'add', ip]);
}

async function revokeIp(ip) {
  if (!validateIp(ip)) return;
  console.log(`[FIREWALL] Revoking IP: ${ip}`);
  await run(['pfctl', '-t', 'allowed_wifi', '-T', 'delete', ip]);
}

module.exports = { DRY_RUN, allowIp, revokeIp, getMacForIp, validateIp };

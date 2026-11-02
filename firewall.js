// firewall.js — Network Gateway & Firewall Automation
const { execFile } = require('child_process');
const net = require('net');

const DRY_RUN = process.env.DRY_RUN !== 'false'; // default true for safe testing

function runCmd(cmd, args) {
  return new Promise((resolve) => {
    if (DRY_RUN) {
      console.log(`[FIREWALL DRY_RUN] ${cmd} ${args.join(' ')}`);
      return resolve({ stdout: '', stderr: '' });
    }
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) {
        console.error(`[FIREWALL ERROR] ${cmd} ${args.join(' ')}: ${error.message}`);
        return resolve({ stdout: '', stderr: error.message });
      }
      resolve({ stdout, stderr });
    });
  });
}

function runSudo(args) {
  if (process.platform === 'win32') {
    return runCmd(args[0], args.slice(1));
  }
  const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  if (isRoot) {
    return runCmd(args[0], args.slice(1));
  }
  return runCmd('sudo', args);
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
  console.log(`[FIREWALL] Allowing internet access for IP: ${ip}`);
  if (process.platform === 'win32') {
    await runSudo(['netsh', 'advfirewall', 'firewall', 'add', 'rule', `name=WIFI_ALLOWED_${ip}`, 'dir=in', 'action=allow', `remoteip=${ip}`]);
  } else if (process.platform === 'darwin') {
    await runSudo(['pfctl', '-t', 'allowed_wifi', '-T', 'add', ip]);
  } else {
    // Linux iptables
    await runSudo(['iptables', '-I', 'WIFI_ALLOWED', '1', '-s', ip, '-j', 'ACCEPT']);
  }
}

async function revokeIp(ip) {
  if (!validateIp(ip)) return;
  console.log(`[FIREWALL] Revoking internet access for IP: ${ip}`);
  if (process.platform === 'win32') {
    await runSudo(['netsh', 'advfirewall', 'firewall', 'delete', 'rule', `name=WIFI_ALLOWED_${ip}`]);
  } else if (process.platform === 'darwin') {
    await runSudo(['pfctl', '-t', 'allowed_wifi', '-T', 'delete', ip]);
  } else {
    // Linux iptables
    await runSudo(['iptables', '-D', 'WIFI_ALLOWED', '-s', ip, '-j', 'ACCEPT']);
  }
}

module.exports = { DRY_RUN, allowIp, revokeIp, getMacForIp, validateIp };

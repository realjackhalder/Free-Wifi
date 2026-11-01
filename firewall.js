const { execFile } = require('child_process');
const net = require('net');

const DRY_RUN = process.env.DRY_RUN !== 'false';

function run(args) {
  return new Promise((resolve, reject) => {
    if (DRY_RUN) {
      console.log(`[DRY_RUN] sudo ${args.join(' ')}`);
      return resolve({ stdout: '', stderr: '' });
    }
    execFile('sudo', args, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });
}

function validateIp(ip) {
  return net.isIP(ip) !== 0;
}

async function allowIp(ip) {
  if (!validateIp(ip)) return;
  await run(['pfctl', '-t', 'allowed_wifi', '-T', 'add', ip]);
}

async function revokeIp(ip) {
  if (!validateIp(ip)) return;
  await run(['pfctl', '-t', 'allowed_wifi', '-T', 'delete', ip]);
}

module.exports = {
  DRY_RUN,
  allowIp,
  revokeIp,
};

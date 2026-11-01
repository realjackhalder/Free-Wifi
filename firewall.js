const { exec } = require('child_process');

const DRY_RUN = process.env.DRY_RUN !== 'false';

function run(command) {
  return new Promise((resolve, reject) => {
    if (DRY_RUN) {
      console.log(`[DRY_RUN] ${command}`);
      return resolve({ stdout: '', stderr: '' });
    }
    exec(command, (error, stdout, stderr) => {
      if (error) return reject(error);
      resolve({ stdout, stderr });
    });
  });
}

async function allowIp(ip) {
  if (!ip) return;
  await run(`sudo pfctl -t allowed_wifi -T add ${ip}`);
}

async function revokeIp(ip) {
  if (!ip) return;
  await run(`sudo pfctl -t allowed_wifi -T delete ${ip}`);
}

module.exports = {
  DRY_RUN,
  allowIp,
  revokeIp,
};

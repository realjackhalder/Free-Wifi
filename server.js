const express = require('express');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const multer = require('multer');
const Jimp = require('jimp');
const jsQR = require('jsqr');
const { allowIp, revokeIp, DRY_RUN } = require('./firewall');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

const ROOT = __dirname;
const DB_FILE = path.join(ROOT, 'db.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');

for (const dir of [PUBLIC_DIR, UPLOAD_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        sessions: {},
        usedSlips: [],
        settings: { monthlyPrice: 150, trialMinutes: 60, adminPin: '1234' },
      },
      null,
      2,
    ),
  );
}

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 },
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

function readDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (!parsed.sessions) parsed.sessions = {};
    if (!Array.isArray(parsed.usedSlips)) parsed.usedSlips = [];
    if (!parsed.settings) parsed.settings = { monthlyPrice: 150, trialMinutes: 60, adminPin: '1234' };
    if (typeof parsed.settings.monthlyPrice !== 'number') parsed.settings.monthlyPrice = 150;
    if (typeof parsed.settings.trialMinutes !== 'number') parsed.settings.trialMinutes = 60;
    if (!parsed.settings.adminPin) parsed.settings.adminPin = '1234';
    return parsed;
  } catch (error) {
    return {
      sessions: {},
      usedSlips: [],
      settings: { monthlyPrice: 150, trialMinutes: 60, adminPin: '1234' },
    };
  }
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function now() {
  return Date.now();
}

function normalizeIp(raw) {
  if (!raw) return '';
  const ip = raw.includes(',') ? raw.split(',')[0].trim() : raw.trim();
  return ip.replace('::ffff:', '');
}

function getClientIp(req) {
  return normalizeIp(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '');
}

function getMacForIp(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1') return Promise.resolve(ip || 'localhost');
  return new Promise((resolve) => {
    exec(`arp -n ${ip}`, (error, stdout) => {
      if (error || !stdout) return resolve(ip);
      const match = stdout.match(/(([0-9a-f]{1,2}:){5}[0-9a-f]{1,2})/i);
      resolve(match ? match[1].toLowerCase() : ip);
    });
  });
}

async function getClientId(req) {
  const ip = getClientIp(req);
  const mac = await getMacForIp(ip);
  return { ip, mac: mac || ip, key: mac || ip };
}

function sessionState(session) {
  const active = !!session?.expiresAt && session.expiresAt > now();
  const remainingMs = active ? session.expiresAt - now() : 0;
  return { active, remainingMs };
}

function formatDate(timestamp) {
  if (!timestamp) return '-';
  return new Date(timestamp).toLocaleString();
}

function isAdmin(req, db) {
  const pin = String(req.query.pin || req.body.pin || '');
  return pin && pin === String(db.settings.adminPin || '1234');
}

function getQrPath() {
  const jpg = path.join(PUBLIC_DIR, 'qr.jpg');
  const png = path.join(PUBLIC_DIR, 'qr.png');
  if (fs.existsSync(jpg)) return jpg;
  if (fs.existsSync(png)) return png;
  return null;
}

function renderPortal({ client, session, settings }) {
  const state = sessionState(session);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Free Wi-Fi Portal</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 text-slate-900 min-h-screen">
  <main class="max-w-md mx-auto p-4 space-y-4">
    <h1 class="text-2xl font-bold">Wi-Fi Captive Portal</h1>
    <div class="bg-white rounded-xl p-4 shadow space-y-1">
      <p class="text-sm text-slate-500">Client</p>
      <p class="text-xs break-all">MAC/ID: ${client.mac}</p>
      <p class="text-xs break-all">IP: ${client.ip || '-'}</p>
      <span class="inline-flex px-3 py-1 rounded-full text-sm font-medium ${state.active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}">
        ${state.active ? 'Internet Active' : 'No Access'}
      </span>
      <p id="countdown" class="text-sm ${state.active ? '' : 'hidden'}">Remaining: --:--:--</p>
    </div>

    <section class="bg-white rounded-xl p-4 shadow space-y-3">
      <h2 class="font-semibold">1-Hour Free Wi-Fi Trial</h2>
      <p class="text-sm text-slate-600">Get ${settings.trialMinutes} minutes free access once every 24 hours.</p>
      <button id="trialBtn" class="w-full bg-blue-600 text-white rounded-lg py-2">Start Free Trial</button>
    </section>

    <section class="bg-white rounded-xl p-4 shadow space-y-3">
      <h2 class="font-semibold">30-Day Monthly Package (${settings.monthlyPrice} THB)</h2>
      <img src="/my-qr" alt="PromptPay QR" class="w-full rounded-lg border" />
      <form id="slipForm" class="space-y-2">
        <input type="file" name="slip" accept="image/*" required class="w-full text-sm" />
        <button class="w-full bg-emerald-600 text-white rounded-lg py-2" type="submit">Upload Slip for Verification</button>
      </form>
    </section>

    <p id="message" class="text-sm"></p>
  </main>

  <script>
    const messageEl = document.getElementById('message');
    const countdownEl = document.getElementById('countdown');
    let remaining = ${Math.max(0, state.remainingMs)};

    if (remaining > 0) {
      countdownEl.classList.remove('hidden');
      setInterval(() => {
        remaining = Math.max(0, remaining - 1000);
        const h = String(Math.floor(remaining / 3600000)).padStart(2, '0');
        const m = String(Math.floor((remaining % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0');
        countdownEl.textContent = 'Remaining: ' + h + ':' + m + ':' + s;
      }, 1000);
    }

    document.getElementById('trialBtn').addEventListener('click', async () => {
      const res = await fetch('/api/trial', { method: 'POST' });
      const data = await res.json();
      messageEl.textContent = data.message;
      messageEl.className = 'text-sm ' + (res.ok ? 'text-green-700' : 'text-red-700');
      if (res.ok) setTimeout(() => location.reload(), 600);
    });

    document.getElementById('slipForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const res = await fetch('/api/verify-slip', { method: 'POST', body: form });
      const data = await res.json();
      messageEl.textContent = data.message;
      messageEl.className = 'text-sm ' + (res.ok ? 'text-green-700' : 'text-red-700');
      if (res.ok) setTimeout(() => location.reload(), 600);
    });
  </script>
</body>
</html>`;
}

function renderAdmin({ db, pin }) {
  const rows = Object.entries(db.sessions)
    .map(([key, session]) => {
      const state = sessionState(session);
      const slipLink = session.slipFile
        ? `<a class="text-blue-600 underline" href="/uploads/${encodeURIComponent(session.slipFile)}" target="_blank">View slip</a>`
        : '-';
      return `<tr class="border-t align-top">
        <td class="p-2 text-xs break-all">${session.mac || key}</td>
        <td class="p-2 text-xs break-all">${session.ip || '-'}</td>
        <td class="p-2 text-xs">${session.plan || '-'}</td>
        <td class="p-2 text-xs">${formatDate(session.expiresAt)}${state.active ? '' : ' (expired)'}</td>
        <td class="p-2 text-xs">${slipLink}</td>
        <td class="p-2 text-xs space-x-1 whitespace-nowrap">
          <form method="post" action="/admin/session/${encodeURIComponent(key)}/approve?pin=${encodeURIComponent(pin)}" class="inline">
            <button class="px-2 py-1 bg-green-600 text-white rounded">Approve +30d</button>
          </form>
          <form method="post" action="/admin/session/${encodeURIComponent(key)}/revoke?pin=${encodeURIComponent(pin)}" class="inline">
            <button class="px-2 py-1 bg-red-600 text-white rounded">Revoke</button>
          </form>
        </td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Admin - Free Wi-Fi</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-100 text-slate-900 min-h-screen">
  <main class="max-w-5xl mx-auto p-4 space-y-4">
    <h1 class="text-2xl font-bold">Admin Dashboard</h1>

    <section class="bg-white rounded-xl p-4 shadow space-y-2">
      <h2 class="font-semibold">PromptPay QR Photo</h2>
      <form method="post" action="/admin/upload-qr?pin=${encodeURIComponent(pin)}" enctype="multipart/form-data" class="space-y-2">
        <input type="file" name="qr" accept="image/*" required class="text-sm" />
        <button class="bg-blue-600 text-white rounded px-3 py-2">Upload / Replace QR</button>
      </form>
    </section>

    <section class="bg-white rounded-xl p-4 shadow space-y-2">
      <h2 class="font-semibold">Settings</h2>
      <form method="post" action="/admin/settings?pin=${encodeURIComponent(pin)}" class="grid sm:grid-cols-3 gap-2 items-end">
        <label class="text-sm">Monthly Price (THB)
          <input type="number" name="monthlyPrice" min="1" value="${db.settings.monthlyPrice}" class="w-full border rounded p-2" />
        </label>
        <label class="text-sm">Free Trial Minutes
          <input type="number" name="trialMinutes" min="1" value="${db.settings.trialMinutes}" class="w-full border rounded p-2" />
        </label>
        <label class="text-sm">Admin PIN
          <input type="text" name="adminPin" value="${db.settings.adminPin || '1234'}" class="w-full border rounded p-2" />
        </label>
        <button class="bg-emerald-600 text-white rounded px-3 py-2">Save Settings</button>
      </form>
    </section>

    <section class="bg-white rounded-xl p-4 shadow overflow-x-auto">
      <h2 class="font-semibold mb-2">User Sessions</h2>
      <table class="w-full text-left text-sm min-w-[900px]">
        <thead>
          <tr class="border-b">
            <th class="p-2">MAC/ID</th>
            <th class="p-2">IP</th>
            <th class="p-2">Plan</th>
            <th class="p-2">Expiry Time</th>
            <th class="p-2">Slip</th>
            <th class="p-2">Actions</th>
          </tr>
        </thead>
        <tbody>${rows || '<tr><td colspan="6" class="p-3 text-slate-500">No sessions yet</td></tr>'}</tbody>
      </table>
    </section>

    <p class="text-xs text-slate-500">Firewall mode: ${DRY_RUN ? 'DRY_RUN=true (safe)' : 'LIVE'}</p>
  </main>
</body>
</html>`;
}

app.get('/my-qr', (req, res) => {
  const qrPath = getQrPath();
  if (qrPath) return res.sendFile(qrPath);
  res.type('image/svg+xml').send(
    `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="450"><rect width="100%" height="100%" fill="#e2e8f0"/><text x="50%" y="50%" font-family="sans-serif" font-size="36" fill="#334155" dominant-baseline="middle" text-anchor="middle">Upload PromptPay QR in /admin</text></svg>`,
  );
});

app.get('/', async (req, res) => {
  const db = readDb();
  const client = await getClientId(req);
  const session = db.sessions[client.key] || { ip: client.ip, mac: client.mac };
  db.sessions[client.key] = { ...session, ip: client.ip, mac: client.mac };
  writeDb(db);
  res.send(renderPortal({ client, session: db.sessions[client.key], settings: db.settings }));
});

app.post('/api/trial', async (req, res) => {
  const db = readDb();
  const client = await getClientId(req);
  const session = db.sessions[client.key] || { ip: client.ip, mac: client.mac };
  const current = now();

  if (session.lastTrialAt && current - session.lastTrialAt < 24 * 60 * 60 * 1000) {
    const nextAt = new Date(session.lastTrialAt + 24 * 60 * 60 * 1000).toLocaleString();
    return res.status(429).json({ message: `Trial cooldown active. Try again after ${nextAt}` });
  }

  session.ip = client.ip;
  session.mac = client.mac;
  session.plan = '1-Hour Trial';
  session.lastTrialAt = current;
  session.expiresAt = current + Number(db.settings.trialMinutes || 60) * 60 * 1000;
  db.sessions[client.key] = session;
  writeDb(db);
  await allowIp(client.ip);

  res.json({ message: 'Free trial activated for 1 hour.' });
});

app.post('/api/verify-slip', upload.single('slip'), async (req, res) => {
  const db = readDb();
  const client = await getClientId(req);
  if (!req.file) return res.status(400).json({ message: 'Please upload a slip image.' });

  try {
    const image = await Jimp.read(req.file.path);
    const { data, width, height } = image.bitmap;
    const qr = jsQR(new Uint8ClampedArray(data), width, height);
    const payload = qr && typeof qr.data === 'string' ? qr.data.trim() : '';

    if (!payload || payload.length < 25) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'No valid bank QR payload found in slip.' });
    }

    if (db.usedSlips.includes(payload)) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ message: 'This slip has already been used.' });
    }

    db.usedSlips.push(payload);
    const session = db.sessions[client.key] || { ip: client.ip, mac: client.mac };
    session.ip = client.ip;
    session.mac = client.mac;
    session.plan = '30-Day Monthly';
    session.expiresAt = now() + 30 * 24 * 60 * 60 * 1000;
    session.slipFile = req.file.filename;
    session.slipPayload = payload;
    db.sessions[client.key] = session;
    writeDb(db);
    await allowIp(client.ip);

    res.json({ message: 'Slip verified. 30-day access granted.' });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(400).json({ message: 'Could not process this image. Please upload a clearer slip screenshot.' });
  }
});

app.get('/admin', (req, res) => {
  const db = readDb();
  const pin = String(req.query.pin || '');
  if (!pin || pin !== String(db.settings.adminPin || '1234')) {
    return res.send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><script src="https://cdn.tailwindcss.com"></script></head><body class="bg-slate-100 min-h-screen flex items-center justify-center p-4"><form class="bg-white p-4 rounded-xl shadow w-full max-w-sm space-y-2" method="get" action="/admin"><h1 class="text-xl font-bold">Admin Login</h1><input name="pin" type="password" placeholder="PIN" class="w-full border rounded p-2" required><button class="w-full bg-blue-600 text-white rounded p-2">Enter</button><p class="text-xs text-slate-500">Default PIN: 1234</p></form></body></html>`);
  }
  res.send(renderAdmin({ db, pin }));
});

const adminUpload = multer({ dest: UPLOAD_DIR });

app.post('/admin/upload-qr', adminUpload.single('qr'), (req, res) => {
  const db = readDb();
  if (!isAdmin(req, db)) return res.status(403).send('Forbidden');
  if (!req.file) return res.status(400).send('No file uploaded');

  const target = path.join(PUBLIC_DIR, 'qr.jpg');
  fs.copyFileSync(req.file.path, target);
  fs.unlinkSync(req.file.path);
  res.redirect(`/admin?pin=${encodeURIComponent(req.query.pin || req.body.pin)}`);
});

app.post('/admin/settings', (req, res) => {
  const db = readDb();
  if (!isAdmin(req, db)) return res.status(403).send('Forbidden');

  const monthlyPrice = Number(req.body.monthlyPrice);
  const trialMinutes = Number(req.body.trialMinutes);
  const adminPin = String(req.body.adminPin || db.settings.adminPin || '1234').trim();

  if (Number.isFinite(monthlyPrice) && monthlyPrice > 0) db.settings.monthlyPrice = monthlyPrice;
  if (Number.isFinite(trialMinutes) && trialMinutes > 0) db.settings.trialMinutes = trialMinutes;
  if (adminPin) db.settings.adminPin = adminPin;
  writeDb(db);

  res.redirect(`/admin?pin=${encodeURIComponent(db.settings.adminPin)}`);
});

app.post('/admin/session/:sessionId/approve', async (req, res) => {
  const db = readDb();
  if (!isAdmin(req, db)) return res.status(403).send('Forbidden');

  const sessionId = decodeURIComponent(req.params.sessionId);
  const session = db.sessions[sessionId];
  if (session) {
    session.plan = '30-Day Monthly';
    session.expiresAt = now() + 30 * 24 * 60 * 60 * 1000;
    db.sessions[sessionId] = session;
    writeDb(db);
    await allowIp(session.ip);
  }
  res.redirect(`/admin?pin=${encodeURIComponent(req.query.pin || req.body.pin || db.settings.adminPin)}`);
});

app.post('/admin/session/:sessionId/revoke', async (req, res) => {
  const db = readDb();
  if (!isAdmin(req, db)) return res.status(403).send('Forbidden');

  const sessionId = decodeURIComponent(req.params.sessionId);
  const session = db.sessions[sessionId];
  if (session) {
    session.expiresAt = 0;
    session.plan = `${session.plan || 'Unknown'} (Revoked)`;
    db.sessions[sessionId] = session;
    writeDb(db);
    await revokeIp(session.ip);
  }
  res.redirect(`/admin?pin=${encodeURIComponent(req.query.pin || req.body.pin || db.settings.adminPin)}`);
});

setInterval(async () => {
  const db = readDb();
  let changed = false;
  for (const key of Object.keys(db.sessions)) {
    const session = db.sessions[key];
    if (session?.expiresAt && session.expiresAt > 0 && session.expiresAt < now()) {
      session.expiresAt = 0;
      db.sessions[key] = session;
      changed = true;
      await revokeIp(session.ip);
    }
  }
  if (changed) writeDb(db);
}, 30000);

app.listen(PORT, HOST, () => {
  console.log(`Free Wi-Fi portal running at http://${HOST}:${PORT}`);
});

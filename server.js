// ============================================================================
// Super Wi-Fi Captive Portal — Complete Server
// ============================================================================

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const multer = require('multer');
const Jimp = require('jimp');
const jsQR = require('jsqr');
const { allowIp, revokeIp, getMacForIp, DRY_RUN } = require('./firewall');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';
const DB_FILE = path.join(__dirname, 'db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure directories exist
[PUBLIC_DIR, UPLOAD_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 10 * 1024 * 1024 } });
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(PUBLIC_DIR));
app.use('/uploads', express.static(UPLOAD_DIR));

// ============================================================================
// Database helpers
// ============================================================================

const DEFAULT_DB = {
  accounts: {},
  usedSlips: [],
  settings: { monthlyPrice: 99, trialMinutes: 60, adminPin: '1234' }
};

function loadDb() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      const data = JSON.parse(raw);
      return {
        accounts: data.accounts || {},
        usedSlips: data.usedSlips || [],
        settings: { ...DEFAULT_DB.settings, ...(data.settings || {}) }
      };
    }
  } catch (e) {
    console.error('[DB] Failed to load db.json, using defaults:', e.message);
  }
  return JSON.parse(JSON.stringify(DEFAULT_DB));
}

function saveDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// ============================================================================
// Utility functions
// ============================================================================

function getClientIp(req) {
  const raw = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
  const ip = raw.includes(',') ? raw.split(',')[0].trim() : raw.trim();
  return ip.replace('::ffff:', '');
}

let _serverIp = null;
function getServerIp() {
  if (_serverIp) return _serverIp;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        _serverIp = iface.address;
        return _serverIp;
      }
    }
  }
  _serverIp = '127.0.0.1';
  return _serverIp;
}

function isValidPhone(p) { return /^[0-9]{10}$/.test(p); }
function isValidPin(p) { return /^[0-9]{4}$/.test(p); }

function getAccountByIp(ip) {
  const db = loadDb();
  for (const phone of Object.keys(db.accounts)) {
    const acc = db.accounts[phone];
    if (acc.activeIp === ip && acc.expiresAt && Date.now() < acc.expiresAt && !acc.blocked) {
      return { ...acc, phone };
    }
  }
  return null;
}

function isAuthenticated(ip) {
  return !!getAccountByIp(ip);
}

// ============================================================================
// CNA Detection Routes (Section 1 — CRITICAL)
// ============================================================================

function cnaHandler(req, res) {
  const ip = getClientIp(req);
  if (isAuthenticated(ip)) {
    return res.status(200).send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  }
  return res.redirect(302, `http://${getServerIp()}:${PORT}/portal`);
}

function cnaHandler204(req, res) {
  const ip = getClientIp(req);
  if (isAuthenticated(ip)) {
    return res.status(204).end();
  }
  return res.redirect(302, `http://${getServerIp()}:${PORT}/portal`);
}

function cnaHandlerWindows(req, res) {
  const ip = getClientIp(req);
  if (isAuthenticated(ip)) {
    return res.status(200).send('Microsoft Connect Test');
  }
  return res.redirect(302, `http://${getServerIp()}:${PORT}/portal`);
}

// Apple CNA
app.get('/hotspot-detect.html', cnaHandler);
app.get('/library/test/success.html', cnaHandler);

// Android/Google CNA
app.get('/generate_204', cnaHandler204);
app.get('/gen_204', cnaHandler204);

// Windows NCSI
app.get('/connecttest.txt', cnaHandlerWindows);
app.get('/ncsi.txt', cnaHandlerWindows);

// ============================================================================
// Portal Route
// ============================================================================

app.get('/portal', (req, res) => {
  const ip = getClientIp(req);
  const account = getAccountByIp(ip);
  const db = loadDb();
  res.status(200).send(renderPortal(account, db.settings));
});

// ============================================================================
// API Routes
// ============================================================================

// --- POST /api/free-trial ---
app.post('/api/free-trial', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!isValidPhone(phone)) return res.json({ ok: false, msg: 'Invalid phone number — must be 10 digits / หมายเลขโทรศัพท์ไม่ถูกต้อง' });
    if (!isValidPin(pin)) return res.json({ ok: false, msg: 'Invalid PIN — must be 4 digits / PIN ไม่ถูกต้อง' });

    const db = loadDb();
    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    // Check if this phone already used trial in last 24h
    const existing = db.accounts[phone];
    if (existing && existing.lastTrialAt && (now - existing.lastTrialAt) < twentyFourHours) {
      const remain = Math.ceil((existing.lastTrialAt + twentyFourHours - now) / 60000);
      return res.json({ ok: false, msg: `Free trial already used. Try again in ${remain} min / ทดลองใช้ฟรีแล้ว ลองอีกครั้งใน ${remain} นาที` });
    }

    // Check if current IP/MAC already used trial via another account in last 24h
    for (const p of Object.keys(db.accounts)) {
      const a = db.accounts[p];
      if (p !== phone && a.lastTrialAt && (now - a.lastTrialAt) < twentyFourHours) {
        if ((a.activeIp === ip) || (mac && a.activeMac === mac)) {
          return res.json({ ok: false, msg: 'This device already used a free trial today / อุปกรณ์นี้ใช้ทดลองฟรีแล้ววันนี้' });
        }
      }
    }

    const trialMs = (db.settings.trialMinutes || 60) * 60 * 1000;

    db.accounts[phone] = {
      ...(existing || {}),
      phone,
      pin,
      plan: 'free-1h',
      expiresAt: now + trialMs,
      lastTrialAt: now,
      activeIp: ip,
      activeMac: mac || null,
      blocked: false
    };
    saveDb(db);
    await allowIp(ip);

    return res.json({ ok: true, msg: 'Free trial activated! / เปิดใช้ทดลองฟรีแล้ว!', expiresAt: db.accounts[phone].expiresAt });
  } catch (e) {
    console.error('[free-trial]', e);
    return res.json({ ok: false, msg: 'Server error / เกิดข้อผิดพลาด' });
  }
});

// --- POST /api/buy-package ---
app.post('/api/buy-package', upload.single('slip'), async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!isValidPhone(phone)) return res.json({ ok: false, msg: 'Invalid phone number / หมายเลขโทรศัพท์ไม่ถูกต้อง' });
    if (!isValidPin(pin)) return res.json({ ok: false, msg: 'Invalid PIN / PIN ไม่ถูกต้อง' });
    if (!req.file) return res.json({ ok: false, msg: 'Please upload a payment slip / กรุณาอัปโหลดสลิปการชำระเงิน' });

    // Decode QR from slip
    let qrPayload = null;
    try {
      const image = await Jimp.read(req.file.path);
      const { data, width, height } = image.bitmap;
      const qr = jsQR(new Uint8ClampedArray(data), width, height);
      if (qr && qr.data) qrPayload = qr.data;
    } catch (imgErr) {
      console.error('[buy-package] Image processing error:', imgErr.message);
    }

    if (!qrPayload || qrPayload.length < 25) {
      return res.json({ ok: false, msg: 'No valid QR code found on slip — please upload a clear payment slip / ไม่พบ QR Code ที่ถูกต้องในสลิป กรุณาอัปโหลดสลิปที่ชัดเจน' });
    }

    const db = loadDb();

    if (db.usedSlips.includes(qrPayload)) {
      return res.json({ ok: false, msg: 'This payment slip has already been used / สลิปนี้ถูกใช้แล้ว' });
    }

    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const existing = db.accounts[phone];

    // Save slip file with better name
    const slipExt = path.extname(req.file.originalname) || '.jpg';
    const slipName = `slip_${phone}_${now}${slipExt}`;
    const slipDest = path.join(UPLOAD_DIR, slipName);
    fs.renameSync(req.file.path, slipDest);

    db.accounts[phone] = {
      ...(existing || {}),
      phone,
      pin,
      plan: 'vip-30d',
      expiresAt: now + thirtyDaysMs,
      activeIp: ip,
      activeMac: mac || null,
      slipFile: slipName,
      slipPayload: qrPayload,
      blocked: false
    };
    db.usedSlips.push(qrPayload);
    saveDb(db);
    await allowIp(ip);

    return res.json({ ok: true, msg: '30-Day VIP activated! / เปิดใช้แพ็กเกจ VIP 30 วันแล้ว!', expiresAt: db.accounts[phone].expiresAt });
  } catch (e) {
    console.error('[buy-package]', e);
    return res.json({ ok: false, msg: 'Server error / เกิดข้อผิดพลาด' });
  }
});

// --- POST /api/login ---
app.post('/api/login', async (req, res) => {
  try {
    const { phone, pin } = req.body;
    if (!isValidPhone(phone)) return res.json({ ok: false, msg: 'Invalid phone number / หมายเลขโทรศัพท์ไม่ถูกต้อง' });
    if (!isValidPin(pin)) return res.json({ ok: false, msg: 'Invalid PIN / PIN ไม่ถูกต้อง' });

    const db = loadDb();
    const acc = db.accounts[phone];
    if (!acc) return res.json({ ok: false, msg: 'Account not found / ไม่พบบัญชี' });
    if (acc.pin !== pin) return res.json({ ok: false, msg: 'Wrong PIN / PIN ไม่ถูกต้อง' });
    if (acc.blocked) return res.json({ ok: false, msg: 'Account is blocked / บัญชีถูกระงับ' });
    if (!acc.expiresAt || Date.now() >= acc.expiresAt) return res.json({ ok: false, msg: 'Account expired / บัญชีหมดอายุแล้ว' });

    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);

    // Revoke old IP if different
    if (acc.activeIp && acc.activeIp !== ip) {
      try { await revokeIp(acc.activeIp); } catch (e) { console.error('[login] revoke old IP:', e.message); }
    }

    acc.activeIp = ip;
    acc.activeMac = mac || null;
    saveDb(db);
    await allowIp(ip);

    const remainMs = acc.expiresAt - Date.now();
    return res.json({ ok: true, msg: 'Login successful! / เข้าสู่ระบบสำเร็จ!', expiresAt: acc.expiresAt, remainMs });
  } catch (e) {
    console.error('[login]', e);
    return res.json({ ok: false, msg: 'Server error / เกิดข้อผิดพลาด' });
  }
});

// --- POST /api/logout ---
app.post('/api/logout', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.json({ ok: false, msg: 'Phone required / กรุณาระบุหมายเลขโทรศัพท์' });

    const db = loadDb();
    const acc = db.accounts[phone];
    if (!acc) return res.json({ ok: false, msg: 'Account not found / ไม่พบบัญชี' });

    if (acc.activeIp) {
      try { await revokeIp(acc.activeIp); } catch (e) { console.error('[logout] revoke:', e.message); }
    }
    acc.activeIp = null;
    acc.activeMac = null;
    saveDb(db);

    return res.json({ ok: true, msg: 'Logged out / ออกจากระบบแล้ว' });
  } catch (e) {
    console.error('[logout]', e);
    return res.json({ ok: false, msg: 'Server error / เกิดข้อผิดพลาด' });
  }
});

// --- GET /api/session-status ---
app.get('/api/session-status', (req, res) => {
  const ip = getClientIp(req);
  const acc = getAccountByIp(ip);
  if (!acc) return res.json({ active: false });
  return res.json({
    active: true,
    phone: acc.phone,
    plan: acc.plan,
    expiresAt: acc.expiresAt,
    remainMs: acc.expiresAt - Date.now()
  });
});

// --- GET /my-qr ---
app.get('/my-qr', (req, res) => {
  const jpgPath = path.join(PUBLIC_DIR, 'qr.jpg');
  const pngPath = path.join(PUBLIC_DIR, 'qr.png');
  if (fs.existsSync(jpgPath)) return res.sendFile(jpgPath);
  if (fs.existsSync(pngPath)) return res.sendFile(pngPath);
  // Return placeholder SVG
  res.set('Content-Type', 'image/svg+xml');
  return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250">
    <rect width="250" height="250" fill="#f3f4f6" rx="16"/>
    <text x="125" y="115" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#9ca3af">QR Code</text>
    <text x="125" y="140" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#9ca3af">Not uploaded yet</text>
  </svg>`);
});

// ============================================================================
// Admin Routes
// ============================================================================

app.get('/admin', (req, res) => {
  const db = loadDb();
  const pin = req.query.pin;
  if (pin !== db.settings.adminPin) {
    return res.send(renderAdminLogin());
  }
  return res.send(renderAdmin(db));
});

app.post('/admin/upload-qr', upload.single('qr'), (req, res) => {
  const db = loadDb();
  if (req.query.pin !== db.settings.adminPin) return res.status(403).json({ ok: false, msg: 'Unauthorized' });
  if (!req.file) return res.redirect(`/admin?pin=${req.query.pin}&err=No+file`);
  const dest = path.join(PUBLIC_DIR, 'qr.jpg');
  fs.renameSync(req.file.path, dest);
  return res.redirect(`/admin?pin=${req.query.pin}&msg=QR+uploaded`);
});

app.post('/admin/settings', (req, res) => {
  const db = loadDb();
  if (req.query.pin !== db.settings.adminPin) return res.status(403).json({ ok: false, msg: 'Unauthorized' });
  const { monthlyPrice, trialMinutes, adminPin } = req.body;
  if (monthlyPrice) db.settings.monthlyPrice = parseInt(monthlyPrice, 10) || db.settings.monthlyPrice;
  if (trialMinutes) db.settings.trialMinutes = parseInt(trialMinutes, 10) || db.settings.trialMinutes;
  if (adminPin && /^[0-9]{4,}$/.test(adminPin)) db.settings.adminPin = adminPin;
  saveDb(db);
  return res.redirect(`/admin?pin=${db.settings.adminPin}&msg=Settings+saved`);
});

app.post('/admin/account/:phone/extend', (req, res) => {
  const db = loadDb();
  if (req.query.pin !== db.settings.adminPin) return res.status(403).json({ ok: false, msg: 'Unauthorized' });
  const acc = db.accounts[req.params.phone];
  if (!acc) return res.redirect(`/admin?pin=${req.query.pin}&err=Not+found`);
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const base = (acc.expiresAt && acc.expiresAt > Date.now()) ? acc.expiresAt : Date.now();
  acc.expiresAt = base + thirtyDays;
  acc.plan = 'vip-30d';
  saveDb(db);
  return res.redirect(`/admin?pin=${req.query.pin}&msg=Extended+30+days`);
});

app.post('/admin/account/:phone/reset-trial', (req, res) => {
  const db = loadDb();
  if (req.query.pin !== db.settings.adminPin) return res.status(403).json({ ok: false, msg: 'Unauthorized' });
  const acc = db.accounts[req.params.phone];
  if (!acc) return res.redirect(`/admin?pin=${req.query.pin}&err=Not+found`);
  acc.lastTrialAt = null;
  saveDb(db);
  return res.redirect(`/admin?pin=${req.query.pin}&msg=Trial+reset`);
});

app.post('/admin/account/:phone/block', async (req, res) => {
  const db = loadDb();
  if (req.query.pin !== db.settings.adminPin) return res.status(403).json({ ok: false, msg: 'Unauthorized' });
  const acc = db.accounts[req.params.phone];
  if (!acc) return res.redirect(`/admin?pin=${req.query.pin}&err=Not+found`);
  acc.blocked = !acc.blocked;
  if (acc.blocked && acc.activeIp) {
    try { await revokeIp(acc.activeIp); } catch (e) { /* ignore */ }
    acc.activeIp = null;
    acc.activeMac = null;
  }
  saveDb(db);
  return res.redirect(`/admin?pin=${req.query.pin}&msg=${acc.blocked ? 'Blocked' : 'Unblocked'}`);
});

app.post('/admin/account/:phone/delete', async (req, res) => {
  const db = loadDb();
  if (req.query.pin !== db.settings.adminPin) return res.status(403).json({ ok: false, msg: 'Unauthorized' });
  const acc = db.accounts[req.params.phone];
  if (acc && acc.activeIp) {
    try { await revokeIp(acc.activeIp); } catch (e) { /* ignore */ }
  }
  delete db.accounts[req.params.phone];
  saveDb(db);
  return res.redirect(`/admin?pin=${req.query.pin}&msg=Deleted`);
});

// ============================================================================
// Catch-all — redirect unauthenticated clients to /portal
// ============================================================================

app.use((req, res, next) => {
  const ip = getClientIp(req);
  if (isAuthenticated(ip)) {
    return next();
  }
  return res.redirect(302, `http://${getServerIp()}:${PORT}/portal`);
});

// ============================================================================
// Background job — auto-revoke expired sessions every 30 seconds
// ============================================================================

setInterval(async () => {
  const db = loadDb();
  const now = Date.now();
  let changed = false;
  for (const phone of Object.keys(db.accounts)) {
    const acc = db.accounts[phone];
    if (acc.activeIp && acc.expiresAt && now >= acc.expiresAt) {
      console.log(`[auto-revoke] Revoking expired session for ${phone} (IP: ${acc.activeIp})`);
      try { await revokeIp(acc.activeIp); } catch (e) { console.error('[auto-revoke]', e.message); }
      acc.activeIp = null;
      acc.activeMac = null;
      changed = true;
    }
  }
  if (changed) saveDb(db);
}, 30000);

// ============================================================================
// Start server
// ============================================================================

app.listen(PORT, HOST, () => {
  console.log(`\n  ╔═══════════════════════════════════════════════════╗`);
  console.log(`  ║   Super Wi-Fi Captive Portal                     ║`);
  console.log(`  ║   Running on http://${getServerIp()}:${PORT}            ║`);
  console.log(`  ║   Admin: http://${getServerIp()}:${PORT}/admin         ║`);
  console.log(`  ║   DRY_RUN: ${DRY_RUN ? 'ON (firewall disabled)' : 'OFF (firewall active)'}${DRY_RUN ? '         ' : '        '}║`);
  console.log(`  ╚═══════════════════════════════════════════════════╝\n`);
});

// ============================================================================
// HTML Renderers
// ============================================================================

function renderPortal(account, settings) {
  const connected = !!account;
  const phone = account ? account.phone : '';
  const plan = account ? account.plan : '';
  const expiresAt = account ? account.expiresAt : 0;
  const price = settings.monthlyPrice || 99;
  const trialMin = settings.trialMinutes || 60;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Super Wi-Fi — Free High-Speed Internet</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: #f0f4ff; min-height: 100vh; }
  .gradient-header { background: linear-gradient(135deg, #1e3a8a 0%, #4338ca 50%, #6366f1 100%); }
  .card { background: #fff; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
  .tab-btn { transition: all 0.25s ease; position: relative; }
  .tab-btn.active { color: #4338ca; border-bottom: 3px solid #4338ca; background: rgba(67,56,202,0.06); }
  .tab-btn:not(.active) { color: #6b7280; border-bottom: 3px solid transparent; }
  .tab-content { display: none; animation: fadeIn 0.3s ease; }
  .tab-content.active { display: block; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes pulse-green { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); } 70% { box-shadow: 0 0 0 12px rgba(34,197,94,0); } }
  .pulse-green { animation: pulse-green 2s infinite; }
  .btn-primary { background: linear-gradient(135deg, #4338ca, #6366f1); color: #fff; border: none; border-radius: 12px; padding: 14px 24px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; transition: transform 0.15s, box-shadow 0.15s; }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(67,56,202,0.35); }
  .btn-primary:active { transform: scale(0.98); }
  .btn-danger { background: linear-gradient(135deg, #dc2626, #ef4444); color: #fff; border: none; border-radius: 12px; padding: 12px 24px; font-size: 15px; font-weight: 600; cursor: pointer; width: 100%; }
  .input-field { width: 100%; border: 2px solid #e5e7eb; border-radius: 12px; padding: 12px 16px; font-size: 16px; transition: border-color 0.2s, box-shadow 0.2s; outline: none; background: #fafbff; }
  .input-field:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
  .toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 14px 28px; border-radius: 12px; font-weight: 600; z-index: 9999; box-shadow: 0 8px 30px rgba(0,0,0,0.15); animation: slideDown 0.4s ease; max-width: 90vw; text-align: center; }
  .toast.success { background: #22c55e; color: #fff; }
  .toast.error { background: #ef4444; color: #fff; }
  @keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  .countdown-box { background: linear-gradient(135deg, #1e3a8a, #312e81); border-radius: 12px; padding: 16px; display: flex; justify-content: center; gap: 12px; }
  .countdown-unit { text-align: center; min-width: 56px; }
  .countdown-num { font-size: 28px; font-weight: 800; color: #fff; line-height: 1; }
  .countdown-label { font-size: 10px; color: #a5b4fc; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
  .badge { display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; }
  .file-upload { border: 2px dashed #c7d2fe; border-radius: 12px; padding: 24px; text-align: center; cursor: pointer; transition: border-color 0.2s, background 0.2s; }
  .file-upload:hover { border-color: #6366f1; background: #eef2ff; }
  .file-upload.has-file { border-color: #22c55e; background: #f0fdf4; }
</style>
</head>
<body>

<!-- Header -->
<div class="gradient-header pt-8 pb-10 px-6 text-center relative overflow-hidden">
  <div style="position:absolute;top:-40px;right:-40px;width:200px;height:200px;background:rgba(255,255,255,0.05);border-radius:50%;"></div>
  <div style="position:absolute;bottom:-60px;left:-30px;width:160px;height:160px;background:rgba(255,255,255,0.04);border-radius:50%;"></div>
  <div class="relative z-10">
    <div class="flex items-center justify-center mb-3">
      <svg class="w-10 h-10 text-white mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"/>
      </svg>
      <h1 class="text-3xl font-extrabold text-white tracking-tight">Super Wi-Fi</h1>
    </div>
    <p class="text-indigo-200 text-sm font-medium">Free High-Speed Internet / อินเทอร์เน็ตความเร็วสูงฟรี</p>
  </div>
</div>

<div class="max-w-md mx-auto px-4" style="margin-top: -28px; position: relative; z-index: 10;">

${connected ? `
<!-- ===================== CONNECTED STATE ===================== -->
<div class="card p-6 mb-4">
  <div class="flex items-center justify-center mb-5">
    <div class="pulse-green w-3 h-3 rounded-full bg-green-500 mr-3"></div>
    <span class="badge" style="background: #dcfce7; color: #166534;">
      <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
      Connected / เชื่อมต่อแล้ว
    </span>
  </div>

  <div class="text-center mb-5">
    <p class="text-gray-500 text-xs uppercase tracking-wider mb-1">Account / บัญชี</p>
    <p class="text-2xl font-bold text-gray-800 tracking-wide">${phone.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}</p>
  </div>

  <div class="flex justify-center mb-5">
    <span class="badge ${plan === 'vip-30d' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">
      ${plan === 'vip-30d' ? '⭐ 30-Day VIP / แพ็กเกจ VIP 30 วัน' : '⏱ Free 1-Hour / ทดลองฟรี 1 ชม.'}
    </span>
  </div>

  <p class="text-center text-gray-500 text-xs uppercase tracking-wider mb-2">Time Remaining / เวลาที่เหลือ</p>
  <div class="countdown-box mb-5" id="countdown">
    <div class="countdown-unit"><div class="countdown-num" id="cd-days">--</div><div class="countdown-label">Days</div></div>
    <div class="countdown-unit"><div class="countdown-num" id="cd-hours">--</div><div class="countdown-label">Hours</div></div>
    <div class="countdown-unit"><div class="countdown-num" id="cd-mins">--</div><div class="countdown-label">Mins</div></div>
    <div class="countdown-unit"><div class="countdown-num" id="cd-secs">--</div><div class="countdown-label">Secs</div></div>
  </div>

  <button class="btn-danger" onclick="doLogout('${phone}')">
    <svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
    Disconnect / ตัดการเชื่อมต่อ
  </button>
</div>

<script>
(function() {
  const expiresAt = ${expiresAt};
  function update() {
    const now = Date.now();
    let diff = Math.max(0, expiresAt - now);
    if (diff <= 0) { location.reload(); return; }
    const d = Math.floor(diff / 86400000); diff %= 86400000;
    const h = Math.floor(diff / 3600000); diff %= 3600000;
    const m = Math.floor(diff / 60000); diff %= 60000;
    const s = Math.floor(diff / 1000);
    document.getElementById('cd-days').textContent = String(d).padStart(2,'0');
    document.getElementById('cd-hours').textContent = String(h).padStart(2,'0');
    document.getElementById('cd-mins').textContent = String(m).padStart(2,'0');
    document.getElementById('cd-secs').textContent = String(s).padStart(2,'0');
  }
  update();
  setInterval(update, 1000);
})();
</script>
` : `
<!-- ===================== TABS (NOT CONNECTED) ===================== -->
<div class="card overflow-hidden mb-4">
  <!-- Tab Navigation -->
  <div class="flex border-b border-gray-100">
    <button class="tab-btn active flex-1 py-3 px-2 text-xs font-semibold text-center" onclick="switchTab(0)" id="tab-btn-0">
      <svg class="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      Free 1-Hour<br><span class="font-normal text-gray-400" style="font-size:10px">ฟรี 1 ชม.</span>
    </button>
    <button class="tab-btn flex-1 py-3 px-2 text-xs font-semibold text-center" onclick="switchTab(1)" id="tab-btn-1">
      <svg class="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"/></svg>
      30-Day VIP<br><span class="font-normal text-gray-400" style="font-size:10px">VIP 30 วัน</span>
    </button>
    <button class="tab-btn flex-1 py-3 px-2 text-xs font-semibold text-center" onclick="switchTab(2)" id="tab-btn-2">
      <svg class="w-5 h-5 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
      Login<br><span class="font-normal text-gray-400" style="font-size:10px">เข้าสู่ระบบ</span>
    </button>
  </div>

  <!-- Tab 0: Free Trial -->
  <div class="tab-content active p-6" id="tab-0">
    <div class="text-center mb-5">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-indigo-100 mb-3">
        <svg class="w-7 h-7 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <h2 class="text-lg font-bold text-gray-800">Free ${trialMin}-Minute Wi-Fi</h2>
      <p class="text-sm text-gray-500">ลงทะเบียนรับเน็ตฟรี ${trialMin} นาที</p>
    </div>

    <form onsubmit="return handleFreeTrial(event)">
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-1">Phone Number / หมายเลขโทรศัพท์</label>
        <input type="tel" id="ft-phone" class="input-field" placeholder="0812345678" pattern="[0-9]{10}" maxlength="10" required>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-1">Create PIN / สร้าง PIN</label>
        <input type="password" id="ft-pin" class="input-field" placeholder="••••" pattern="[0-9]{4}" maxlength="4" inputmode="numeric" required>
      </div>
      <div class="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-5 text-xs text-blue-700">
        <svg class="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
        1 free session per 24 hours / ทดลองฟรี 1 ครั้งต่อ 24 ชั่วโมง
      </div>
      <button type="submit" class="btn-primary" id="ft-btn">
        Get Free Wi-Fi / รับเน็ตฟรี
      </button>
    </form>
  </div>

  <!-- Tab 1: Buy Package -->
  <div class="tab-content p-6" id="tab-1">
    <div class="text-center mb-5">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-yellow-100 mb-3">
        <svg class="w-7 h-7 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"/></svg>
      </div>
      <h2 class="text-lg font-bold text-gray-800">30-Day VIP Package</h2>
      <p class="text-sm text-gray-500">สมัครแพ็กเกจ VIP 30 วัน</p>
    </div>

    <form onsubmit="return handleBuyPackage(event)" enctype="multipart/form-data">
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-1">Phone Number / หมายเลขโทรศัพท์</label>
        <input type="tel" id="bp-phone" class="input-field" placeholder="0812345678" pattern="[0-9]{10}" maxlength="10" required>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-1">Create PIN / สร้าง PIN</label>
        <input type="password" id="bp-pin" class="input-field" placeholder="••••" pattern="[0-9]{4}" maxlength="4" inputmode="numeric" required>
      </div>

      <!-- QR + Price -->
      <div class="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-xl p-4 mb-4 text-center">
        <p class="text-sm font-semibold text-gray-700 mb-2">Scan to Pay via PromptPay / สแกนจ่ายผ่านพร้อมเพย์</p>
        <img src="/my-qr" alt="PromptPay QR" class="mx-auto rounded-lg shadow-md mb-3" style="max-width:200px;max-height:200px;">
        <div class="inline-flex items-center gap-2 bg-white rounded-full px-4 py-2 shadow-sm">
          <span class="text-2xl font-extrabold text-indigo-700">฿${price}</span>
          <span class="text-xs text-gray-500">/ 30 days</span>
        </div>
      </div>

      <div class="mb-5">
        <label class="block text-sm font-semibold text-gray-700 mb-2">Upload Payment Slip / อัปโหลดสลิปการชำระเงิน</label>
        <div class="file-upload" id="file-upload-area" onclick="document.getElementById('bp-slip').click()">
          <svg class="w-8 h-8 mx-auto text-indigo-300 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/></svg>
          <p class="text-sm text-gray-500" id="file-upload-text">Tap to select image / แตะเพื่อเลือกรูป</p>
          <input type="file" id="bp-slip" accept="image/*" class="hidden" onchange="onSlipSelected(this)" required>
        </div>
      </div>

      <button type="submit" class="btn-primary" id="bp-btn">
        ⭐ Verify & Activate / ตรวจสอบและเปิดใช้งาน
      </button>
    </form>
  </div>

  <!-- Tab 2: Login -->
  <div class="tab-content p-6" id="tab-2">
    <div class="text-center mb-5">
      <div class="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-100 mb-3">
        <svg class="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
      </div>
      <h2 class="text-lg font-bold text-gray-800">Member Login</h2>
      <p class="text-sm text-gray-500">เข้าสู่ระบบสำหรับสมาชิก</p>
    </div>

    <form onsubmit="return handleLogin(event)">
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-1">Phone Number / หมายเลขโทรศัพท์</label>
        <input type="tel" id="lg-phone" class="input-field" placeholder="0812345678" pattern="[0-9]{10}" maxlength="10" required>
      </div>
      <div class="mb-4">
        <label class="block text-sm font-semibold text-gray-700 mb-1">PIN</label>
        <input type="password" id="lg-pin" class="input-field" placeholder="••••" pattern="[0-9]{4}" maxlength="4" inputmode="numeric" required>
      </div>
      <div class="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-5 text-xs text-gray-500">
        <svg class="w-4 h-4 inline mr-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
        For existing VIP or active free trial subscribers / สำหรับสมาชิก VIP หรือผู้ใช้ทดลองฟรีที่ยังไม่หมดอายุ
      </div>
      <button type="submit" class="btn-primary" id="lg-btn">
        Login / เข้าสู่ระบบ
      </button>
    </form>
  </div>
</div>
`}

<!-- Footer -->
<div class="text-center py-6 text-xs text-gray-400">
  <p>Powered by Super Wi-Fi &copy; ${new Date().getFullYear()}</p>
</div>

</div><!-- /.max-w-md -->

<script>
// Toast
function showToast(msg, type) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.4s'; setTimeout(() => t.remove(), 400); }, 4000);
}

// Tab switching
function switchTab(idx) {
  document.querySelectorAll('.tab-btn').forEach((b,i) => b.classList.toggle('active', i === idx));
  document.querySelectorAll('.tab-content').forEach((c,i) => c.classList.toggle('active', i === idx));
}

// File upload visual
function onSlipSelected(input) {
  const area = document.getElementById('file-upload-area');
  const text = document.getElementById('file-upload-text');
  if (input.files.length) {
    area.classList.add('has-file');
    text.textContent = input.files[0].name;
  } else {
    area.classList.remove('has-file');
    text.textContent = 'Tap to select image / แตะเพื่อเลือกรูป';
  }
}

// API helpers
async function apiPost(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return res.json();
}

async function handleFreeTrial(e) {
  e.preventDefault();
  const btn = document.getElementById('ft-btn');
  btn.disabled = true; btn.textContent = 'Processing...';
  try {
    const data = await apiPost('/api/free-trial', {
      phone: document.getElementById('ft-phone').value.trim(),
      pin: document.getElementById('ft-pin').value.trim()
    });
    if (data.ok) { showToast(data.msg, 'success'); setTimeout(() => location.reload(), 1500); }
    else { showToast(data.msg, 'error'); btn.disabled = false; btn.textContent = 'Get Free Wi-Fi / รับเน็ตฟรี'; }
  } catch (err) { showToast('Network error / ข้อผิดพลาดเครือข่าย', 'error'); btn.disabled = false; btn.textContent = 'Get Free Wi-Fi / รับเน็ตฟรี'; }
  return false;
}

async function handleBuyPackage(e) {
  e.preventDefault();
  const btn = document.getElementById('bp-btn');
  btn.disabled = true; btn.textContent = 'Verifying...';
  try {
    const fd = new FormData();
    fd.append('phone', document.getElementById('bp-phone').value.trim());
    fd.append('pin', document.getElementById('bp-pin').value.trim());
    fd.append('slip', document.getElementById('bp-slip').files[0]);
    const res = await fetch('/api/buy-package', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) { showToast(data.msg, 'success'); setTimeout(() => location.reload(), 1500); }
    else { showToast(data.msg, 'error'); btn.disabled = false; btn.textContent = '⭐ Verify & Activate / ตรวจสอบและเปิดใช้งาน'; }
  } catch (err) { showToast('Network error / ข้อผิดพลาดเครือข่าย', 'error'); btn.disabled = false; btn.textContent = '⭐ Verify & Activate / ตรวจสอบและเปิดใช้งาน'; }
  return false;
}

async function handleLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('lg-btn');
  btn.disabled = true; btn.textContent = 'Logging in...';
  try {
    const data = await apiPost('/api/login', {
      phone: document.getElementById('lg-phone').value.trim(),
      pin: document.getElementById('lg-pin').value.trim()
    });
    if (data.ok) { showToast(data.msg, 'success'); setTimeout(() => location.reload(), 1500); }
    else { showToast(data.msg, 'error'); btn.disabled = false; btn.textContent = 'Login / เข้าสู่ระบบ'; }
  } catch (err) { showToast('Network error / ข้อผิดพลาดเครือข่าย', 'error'); btn.disabled = false; btn.textContent = 'Login / เข้าสู่ระบบ'; }
  return false;
}

async function doLogout(phone) {
  if (!confirm('Disconnect from Wi-Fi? / ตัดการเชื่อมต่อ?')) return;
  try {
    const data = await apiPost('/api/logout', { phone });
    showToast(data.msg, data.ok ? 'success' : 'error');
    if (data.ok) setTimeout(() => location.reload(), 1200);
  } catch (err) { showToast('Network error', 'error'); }
}
</script>
</body>
</html>`;
}

// ============================================================================
// Admin HTML
// ============================================================================

function renderAdminLogin() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Login — Super Wi-Fi</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>body{background:#0f172a;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui;}</style>
</head>
<body>
<div style="background:#1e293b;border-radius:20px;padding:40px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.4);">
  <div class="text-center mb-6">
    <div class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-600 mb-4">
      <svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
    </div>
    <h1 class="text-2xl font-bold text-white">Admin Panel</h1>
    <p class="text-gray-400 text-sm">Enter admin PIN to continue</p>
  </div>
  <form method="GET" action="/admin">
    <input type="password" name="pin" placeholder="Admin PIN" pattern="[0-9]+" inputmode="numeric"
      style="width:100%;padding:14px 18px;border-radius:12px;border:2px solid #334155;background:#0f172a;color:#fff;font-size:18px;text-align:center;letter-spacing:8px;outline:none;margin-bottom:16px;"
      onfocus="this.style.borderColor='#6366f1'" onblur="this.style.borderColor='#334155'" required>
    <button type="submit" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,#4338ca,#6366f1);color:#fff;font-weight:700;font-size:16px;border:none;cursor:pointer;">
      Enter / เข้าสู่ระบบ
    </button>
  </form>
</div>
</body>
</html>`;
}

function renderAdmin(db) {
  const s = db.settings;
  const accounts = db.accounts;
  const phones = Object.keys(accounts).sort();
  const pin = s.adminPin;
  const now = Date.now();

  const rows = phones.map(p => {
    const a = accounts[p];
    const isActive = a.expiresAt && now < a.expiresAt && !a.blocked;
    const isExpired = a.expiresAt && now >= a.expiresAt;
    const statusBadge = a.blocked
      ? '<span style="background:#fecaca;color:#991b1b;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;">Blocked</span>'
      : isActive
        ? '<span style="background:#dcfce7;color:#166534;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;">Active</span>'
        : isExpired
          ? '<span style="background:#fef3c7;color:#92400e;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;">Expired</span>'
          : '<span style="background:#f3f4f6;color:#6b7280;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:600;">—</span>';
    const planBadge = a.plan === 'vip-30d'
      ? '<span style="background:#fef9c3;color:#854d0e;padding:2px 8px;border-radius:99px;font-size:11px;">VIP</span>'
      : a.plan === 'free-1h'
        ? '<span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:99px;font-size:11px;">Free</span>'
        : '—';
    const expiry = a.expiresAt ? new Date(a.expiresAt).toLocaleString() : '—';
    const slipLink = a.slipFile ? `<a href="/uploads/${a.slipFile}" target="_blank" style="color:#6366f1;text-decoration:underline;font-size:12px;">View</a>` : '—';

    return `<tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:10px;font-weight:600;color:#e2e8f0;font-size:13px;">${p}</td>
      <td style="padding:10px;color:#94a3b8;font-size:11px;font-family:monospace;">${a.activeMac || '—'}</td>
      <td style="padding:10px;color:#94a3b8;font-size:11px;font-family:monospace;">${a.activeIp || '—'}</td>
      <td style="padding:10px;">${planBadge}</td>
      <td style="padding:10px;color:#94a3b8;font-size:11px;">${expiry}</td>
      <td style="padding:10px;">${statusBadge}</td>
      <td style="padding:10px;">${slipLink}</td>
      <td style="padding:10px;white-space:nowrap;">
        <form method="POST" action="/admin/account/${p}/extend?pin=${pin}" style="display:inline;"><button type="submit" style="background:#4338ca;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;margin:1px;">+30 Days</button></form>
        <form method="POST" action="/admin/account/${p}/reset-trial?pin=${pin}" style="display:inline;"><button type="submit" style="background:#0891b2;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;margin:1px;">Reset Trial</button></form>
        <form method="POST" action="/admin/account/${p}/block?pin=${pin}" style="display:inline;"><button type="submit" style="background:#d97706;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;margin:1px;">${a.blocked ? 'Unblock' : 'Block'}</button></form>
        <form method="POST" action="/admin/account/${p}/delete?pin=${pin}" style="display:inline;" onsubmit="return confirm('Delete ${p}?')"><button type="submit" style="background:#dc2626;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;margin:1px;">Delete</button></form>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Admin Dashboard — Super Wi-Fi</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>
  body { background: #0f172a; color: #e2e8f0; font-family: system-ui; margin: 0; padding: 20px; }
  .admin-card { background: #1e293b; border-radius: 16px; padding: 24px; margin-bottom: 20px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); }
  .admin-input { width: 100%; padding: 10px 14px; border-radius: 8px; border: 2px solid #334155; background: #0f172a; color: #fff; font-size: 14px; outline: none; }
  .admin-input:focus { border-color: #6366f1; }
  .admin-btn { padding: 10px 20px; border-radius: 8px; background: linear-gradient(135deg,#4338ca,#6366f1); color: #fff; font-weight: 600; font-size: 14px; border: none; cursor: pointer; }
  .admin-btn:hover { opacity: 0.9; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; border-bottom: 2px solid #334155; }
</style>
</head>
<body>

<div style="max-width: 1200px; margin: 0 auto;">

  <!-- Header -->
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;">
    <div>
      <h1 style="font-size:24px;font-weight:800;color:#fff;margin:0;">⚙️ Super Wi-Fi Admin</h1>
      <p style="color:#64748b;font-size:13px;margin:4px 0 0;">Dashboard & Account Management</p>
    </div>
    <a href="/portal" style="color:#6366f1;font-size:13px;text-decoration:none;">← Back to Portal</a>
  </div>

  <!-- Stats -->
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px;">
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#6366f1;">${phones.length}</div>
      <div style="font-size:12px;color:#64748b;">Total Accounts</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#22c55e;">${phones.filter(p => accounts[p].expiresAt && now < accounts[p].expiresAt && !accounts[p].blocked).length}</div>
      <div style="font-size:12px;color:#64748b;">Active Sessions</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#eab308;">${phones.filter(p => accounts[p].plan === 'vip-30d').length}</div>
      <div style="font-size:12px;color:#64748b;">VIP Members</div>
    </div>
    <div class="admin-card" style="padding:16px;text-align:center;">
      <div style="font-size:28px;font-weight:800;color:#ef4444;">${phones.filter(p => accounts[p].blocked).length}</div>
      <div style="font-size:12px;color:#64748b;">Blocked</div>
    </div>
  </div>

  <!-- QR Upload + Settings side by side -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
    <div class="admin-card">
      <h2 style="font-size:16px;font-weight:700;margin:0 0 16px;">📱 PromptPay QR Code</h2>
      <div style="text-align:center;margin-bottom:16px;">
        <img src="/my-qr" alt="QR" style="max-width:160px;border-radius:12px;background:#fff;padding:8px;">
      </div>
      <form method="POST" action="/admin/upload-qr?pin=${pin}" enctype="multipart/form-data">
        <input type="file" name="qr" accept="image/*" class="admin-input" style="margin-bottom:12px;" required>
        <button type="submit" class="admin-btn" style="width:100%;">Upload New QR</button>
      </form>
    </div>

    <div class="admin-card">
      <h2 style="font-size:16px;font-weight:700;margin:0 0 16px;">⚙️ Settings</h2>
      <form method="POST" action="/admin/settings?pin=${pin}">
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Monthly Price (฿)</label>
          <input type="number" name="monthlyPrice" value="${s.monthlyPrice}" class="admin-input">
        </div>
        <div style="margin-bottom:12px;">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Trial Duration (minutes)</label>
          <input type="number" name="trialMinutes" value="${s.trialMinutes}" class="admin-input">
        </div>
        <div style="margin-bottom:16px;">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px;">Admin PIN</label>
          <input type="text" name="adminPin" value="${s.adminPin}" class="admin-input" pattern="[0-9]{4,}">
        </div>
        <button type="submit" class="admin-btn" style="width:100%;">Save Settings</button>
      </form>
    </div>
  </div>

  <!-- Accounts Table -->
  <div class="admin-card" style="overflow-x:auto;">
    <h2 style="font-size:16px;font-weight:700;margin:0 0 16px;">👥 Accounts (${phones.length})</h2>
    ${phones.length === 0 ? '<p style="color:#64748b;text-align:center;padding:20px;">No accounts yet</p>' : `
    <table>
      <thead>
        <tr>
          <th>Phone</th><th>MAC</th><th>IP</th><th>Plan</th><th>Expires</th><th>Status</th><th>Slip</th><th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`}
  </div>

</div>
</body>
</html>`;
}

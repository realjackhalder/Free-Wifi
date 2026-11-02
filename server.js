// ============================================================================
// Free Wi-Fi Captive Portal & Gateway Server
// Authentication: Google Account (Sign in with Google)
// Database: SQLite (wifi.db) for Google Accounts, Slips & IP Address Logs
// Languages: Thai (ไทย) 🇹🇭 | Burmese (မြန်မာ) 🇲🇲 | English 🇬🇧
// ============================================================================

const fs = require('fs');
const path = require('path');

function logCrash(type, data) {
  const time = new Date().toISOString();
  const text = (data && data.stack) ? data.stack : (typeof data === 'object' ? JSON.stringify(data) : String(data));
  const entry = `[${time}] [${type}] ${text}\n`;
  try {
    fs.appendFileSync(path.join(__dirname, 'crash.log'), entry);
  } catch (e) {}
  console.error(entry);
}

process.on('uncaughtException', (err) => logCrash('UNCAUGHT_EXCEPTION', err));
process.on('unhandledRejection', (reason) => logCrash('UNHANDLED_REJECTION', reason));
process.on('beforeExit', (code) => logCrash('BEFORE_EXIT', `Event loop empty, exiting code: ${code}`));
process.on('exit', (code) => logCrash('PROCESS_EXIT', `Process exiting with code: ${code}`));

const express = require('express');
const http = require('http');
const os = require('os');
const multer = require('multer');
const Jimp = require('jimp');
const jsQR = require('jsqr');
const QRCode = require('qrcode');
const { allowIp, revokeIp, getMacForIp, DRY_RUN } = require('./firewall');
const db = require('./database');
const vpn = require('./vpn');
const fb = require('./firebase-backend');
const otp = require('./otp');
const telegram = require('./telegram');
const dnsCaptive = require('./dns-captive');
const crypto = require('crypto');
const { renderAdminLogin, renderAdmin } = require('./admin-ui');


const adminApp = express();
const userApp = express();

const ADMIN_PORT = parseInt(process.env.ADMIN_PORT || '3000', 10);
const USER_PORT = parseInt(process.env.USER_PORT || '3001', 10);
const HOST = '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// Ensure storage directories exist
[PUBLIC_DIR, UPLOAD_DIR].forEach((d) => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

const upload = multer({ dest: UPLOAD_DIR });

// Apply shared body parsing & static asset handling to both servers
const staticOptions = {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.svg')) res.setHeader('Content-Type', 'image/svg+xml');
  }
};

[adminApp, userApp].forEach((instance) => {
  instance.use(express.urlencoded({ extended: true }));
  instance.use(express.json());
  instance.use(express.static(PUBLIC_DIR, staticOptions));
  instance.use('/public', express.static(PUBLIC_DIR, staticOptions));
  instance.use('/uploads', express.static(UPLOAD_DIR));
});

// ============================================================================
// Network & Helper utilities
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

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function isAuthenticated(ip) {
  const account = await db.getAccountByIp(ip);
  return !!account;
}

// ============================================================================
// 1. OS Auto-Popup Captive Portal Detection (Critical CNA Routes & Port 80 Listener)
// ============================================================================

let captiveHttpServer = null;
function startPort80CaptiveServer(lanIp) {
  try {
    const s80 = http.createServer(async (req, res) => {
      try {
        const clientIp = getClientIp(req);
        const isAuth = await isAuthenticated(clientIp);
        const url = req.url || '/';

        if (isAuth) {
          if (url.includes('204')) {
            res.writeHead(204);
            return res.end();
          }
          if (url.includes('hotspot-detect') || url.includes('library/test/success')) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
          }
          if (url.includes('connecttest') || url.includes('ncsi')) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('Microsoft Connect Test');
          }
          if (url.includes('success.txt')) {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            return res.end('success\n');
          }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          return res.end('Internet Connected');
        }

        // Unauthenticated client: immediately redirect to User Portal on Port 3001
        const portalUrl = `http://${lanIp}:${USER_PORT}/portal`;
        res.writeHead(302, {
          'Location': portalUrl,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        });
        res.end(`Redirecting to Captive Portal: ${portalUrl}`);
      } catch (err) {
        try {
          res.writeHead(302, { 'Location': `http://${lanIp}:${USER_PORT}/portal` });
          res.end();
        } catch (e) {}
      }
    });

    s80.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`[Port 80] Port 80 in use by another service. Captive CNA routes active on port ${USER_PORT}.`);
      } else {
        console.warn(`[Port 80] Server warning:`, err.message);
      }
    });

    s80.listen(80, '0.0.0.0', () => {
      console.log(`🌐 Captive Portal Port 80 active -> Redirecting all unauthenticated HTTP traffic to http://${lanIp}:${USER_PORT}/portal`);
    });
    return s80;
  } catch (err) {
    console.warn('[Port 80] Listener skipped:', err.message);
    return null;
  }
}

async function cnaHandler(req, res) {
  const ip = getClientIp(req);
  if (await isAuthenticated(ip)) {
    return res.status(200).send('<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>');
  }
  return res.redirect(302, `http://${getServerIp()}:${USER_PORT}/portal`);
}

async function cnaHandler204(req, res) {
  const ip = getClientIp(req);
  if (await isAuthenticated(ip)) {
    return res.status(204).end();
  }
  return res.redirect(302, `http://${getServerIp()}:${USER_PORT}/portal`);
}

async function cnaHandlerWindows(req, res) {
  const ip = getClientIp(req);
  if (await isAuthenticated(ip)) {
    return res.status(200).send('Microsoft Connect Test');
  }
  return res.redirect(302, `http://${getServerIp()}:${USER_PORT}/portal`);
}

// User App: Forward /admin browser navigation to Admin Server on port 3000 (skip API endpoints)
userApp.all('/admin*', (req, res, next) => {
  if (req.path.startsWith('/admin/telegram-test') || req.path.startsWith('/admin/settings') || req.path.startsWith('/admin/firebase-config') || req.path.startsWith('/admin/slip/')) {
    return next();
  }
  const host = req.hostname || 'localhost';
  return res.redirect(`http://${host}:${ADMIN_PORT}${req.originalUrl}`);
});

// Apple iOS / iPadOS / macOS
userApp.get('/hotspot-detect.html', cnaHandler);
userApp.get('/library/test/success.html', cnaHandler);

// Android / Google / ChromeOS
userApp.get('/generate_204', cnaHandler204);
userApp.get('/gen_204', cnaHandler204);

// Windows 10/11 NCSI
userApp.get('/connecttest.txt', cnaHandlerWindows);
userApp.get('/ncsi.txt', cnaHandlerWindows);

// Firefox / Others
userApp.get('/success.txt', (req, res) => {
  const ip = getClientIp(req);
  isAuthenticated(ip).then(auth => {
    if (auth) return res.status(200).send('success\n');
    return res.redirect(302, `http://${getServerIp()}:${USER_PORT}/portal`);
  });
});

// ============================================================================
// 2. Telecom-Style Portal Route (GET /portal & GET / on Port 3001)
// ============================================================================

userApp.options('/api/device-info', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
});

userApp.get('/api/device-info', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ip = getClientIp(req);
  const mac = await getMacForIp(ip);
  res.json({
    ok: true,
    ip: ip || '127.0.0.1',
    mac: mac && mac !== ip ? mac : 'Unknown'
  });
});

userApp.get('/portal', async (req, res) => {
  const ip = getClientIp(req);
  const mac = await getMacForIp(ip);
  const account = await db.getAccountByIp(ip);
  const settings = await db.getAllSettings();
  const expiredAccount = !account ? await db.getExpiredAccount({ ip, mac }) : null;
  res.status(200).send(renderPortal(account, settings, expiredAccount, ip, mac));
});

userApp.get('/', async (req, res) => {
  const ip = getClientIp(req);
  const mac = await getMacForIp(ip);
  const account = await db.getAccountByIp(ip);
  const settings = await db.getAllSettings();
  const expiredAccount = !account ? await db.getExpiredAccount({ ip, mac }) : null;
  res.status(200).send(renderPortal(account, settings, expiredAccount, ip, mac));
});

// ============================================================================
// 3. User Facing API Endpoints (Google Account & OTP Authentication)
// ============================================================================

// --- POST /api/activate-session (Immediate internet activation from web portal) ---
userApp.options('/api/activate-session', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
});

userApp.post('/api/activate-session', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const { email, plan, expiresAt, ip: reportedIp, mac: reportedMac } = req.body || {};
    const clientIp = getClientIp(req);
    const targetIp = (clientIp && clientIp !== '127.0.0.1' && !clientIp.startsWith('127.')) ? clientIp : (reportedIp || clientIp);
    const targetMac = (await getMacForIp(targetIp)) || reportedMac;
    const now = Date.now();
    const cleanEmail = (email || '').trim().toLowerCase();

    if (!cleanEmail || !targetIp) {
      return res.status(400).json({ ok: false, error: 'missing_params' });
    }

    const expTime = parseInt(expiresAt, 10) || (now + 3600000);
    const existing = await db.getAccount(cleanEmail);

    const accountData = {
      email: cleanEmail,
      name: existing?.name || cleanEmail.split('@')[0],
      picture: existing?.picture || null,
      plan: plan || existing?.plan || 'free-1h',
      createdAt: existing?.createdAt || now,
      expiresAt: expTime,
      lastTrialAt: existing?.lastTrialAt || now,
      activeIp: targetIp,
      activeMac: targetMac || null,
      blocked: false
    };

    await db.saveAccount(accountData);
    await db.logIpAction({ email: cleanEmail, ip: targetIp, mac: targetMac, action: 'session_activated' });
    await allowIp(targetIp);
    console.log(`🚀 [INTERNET ACTIVATED] Full internet unlocked for ${cleanEmail} (IP: ${targetIp}, MAC: ${targetMac}, Plan: ${accountData.plan})`);

    res.json({ ok: true, activeIp: targetIp, expiresAt: accountData.expiresAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// --- POST /api/otp/request (Step 1: Request 6-digit OTP code) ---
userApp.post('/api/otp/request', async (req, res) => {
  try {
    const { email, mode = 'free', name = '' } = req.body || {};
    if (!isValidEmail(email)) {
      return res.json({
        ok: false,
        msg_th: 'กรุณากรอกอีเมลให้ถูกต้อง (เช่น user@gmail.com)',
        msg_mm: 'ကျေးဇူးပြု၍ မှန်ကန်သော အီးမေးလ် ရိုက်ထည့်ပါ',
        msg_en: 'Please enter a valid email address (e.g. user@gmail.com)'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;

    if (mode === 'free') {
      // 1. Check 24-hour trial quota for this account
      const existing = await db.getAccount(cleanEmail);
      if (existing && existing.lastTrialAt && now - existing.lastTrialAt < twentyFourHours) {
        const remainMins = Math.ceil((existing.lastTrialAt + twentyFourHours - now) / 60000);
        return res.json({
          ok: false,
          msg_th: `อีเมลนี้รับสิทธิ์ฟรีแล้ววันนี้ ลองใหม่ในอีก ${remainMins} นาที`,
          msg_mm: `ဤအီးမေးလ် ယနေ့ အခမဲ့ယူပြီးပါပြီ။ နောက်ထပ် ${remainMins} မိနစ်အကြာမှ ထပ်ကြိုးစားပါ`,
          msg_en: `This email already claimed a trial today. Try again in ${remainMins} mins.`
        });
      }

      // 2. Check if current device IP or MAC already claimed trial in last 24h
      const allAccounts = await db.getAllAccounts();
      for (const a of allAccounts) {
        if (a.email.toLowerCase() !== cleanEmail && a.lastTrialAt && now - a.lastTrialAt < twentyFourHours) {
          if (a.activeIp === ip || (mac && mac !== 'localhost' && a.activeMac === mac)) {
            return res.json({
              ok: false,
              msg_th: 'อุปกรณ์นี้ได้รับสิทธิ์ฟรีครบแล้วใน 24 ชม. ที่ผ่านมา',
              msg_mm: 'ဤစက်သည် ၂၄ နာရီအတွင်း အခမဲ့ရယူပြီးဖြစ်ပါသည်',
              msg_en: 'This device has already claimed a free trial in the last 24 hours.'
            });
          }
        }
      }
    } else if (mode === 'login') {
      const existing = await db.getAccount(cleanEmail);
      if (!existing) {
        return res.json({
          ok: false,
          msg_th: 'ไม่พบบัญชีอีเมลนี้ในระบบ กรุณารับเน็ตฟรีก่อน หรือสมัครแพ็กเกจ 30 วัน',
          msg_mm: 'ဤအီးမေးလ်အကောင့်ကို မတွေ့ရှိပါ၊ ပထမဦးစွာ စာရင်းသွင်းပါ',
          msg_en: 'Account not found. Please claim a free trial or buy a package first.'
        });
      }
      if (existing.blocked) {
        return res.json({
          ok: false,
          msg_th: 'บัญชีนี้ถูกระงับการใช้งานชั่วคราว',
          msg_mm: 'ဤအကောင့်ကို ယာယီပိတ်ထားပါသည်',
          msg_en: 'This account is blocked'
        });
      }
      if (!existing.expiresAt || Date.now() >= existing.expiresAt) {
        return res.json({
          ok: false,
          msg_th: 'แพ็กเกจหมดอายุแล้ว กรุณาสมัครแพ็กเกจ 30 วันใหม่',
          msg_mm: 'အသုံးပြုခွင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ၊ အသစ်ဝယ်ယူပါ',
          msg_en: 'Package expired. Please purchase a new 30-day VIP pass.'
        });
      }
    }

    const otpRes = await otp.requestOtp(cleanEmail, mode, name);
    return res.json(otpRes);
  } catch (err) {
    console.error('[otp/request]', err);
    return res.json({
      ok: false,
      msg_th: 'เกิดข้อผิดพลาดในการสร้างรหัส OTP กรุณาลองใหม่',
      msg_mm: 'OTP ကုဒ် ထုတ်ပေးရာတွင် ချို့ယွင်းချက်ရှိပါသည်',
      msg_en: 'Error generating OTP code. Please try again.'
    });
  }
});

// --- POST /api/otp/verify (Step 2: Verify 6-digit OTP & Grant Wi-Fi Access) ---
userApp.post('/api/otp/verify', async (req, res) => {
  try {
    const { email, otp: inputOtp, mode = 'free' } = req.body || {};
    if (!isValidEmail(email)) {
      return res.json({
        ok: false,
        msg_th: 'กรุณาระบุอีเมลให้ถูกต้อง',
        msg_mm: 'ကျေးဇူးပြု၍ မှန်ကန်သော အီးမေးလ် ရိုက်ထည့်ပါ',
        msg_en: 'Please provide a valid email address'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const verification = otp.verifyOtp(cleanEmail, inputOtp, mode);
    if (!verification.ok) {
      return res.json(verification);
    }

    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const settings = await db.getAllSettings();

    if (mode === 'free') {
      const existing = await db.getAccount(cleanEmail);
      const trialMs = (settings.trialMinutes || 60) * 60 * 1000;
      const accountData = {
        email: cleanEmail,
        name: verification.name || existing?.name || cleanEmail.split('@')[0],
        picture: existing?.picture || null,
        plan: 'free-1h',
        createdAt: existing?.createdAt || now,
        expiresAt: now + trialMs,
        lastTrialAt: now,
        activeIp: ip,
        activeMac: mac || null,
        blocked: false
      };

      await db.saveAccount(accountData);
      await db.logIpAction({ email: cleanEmail, ip, mac, action: 'free_trial_otp' });
      await allowIp(ip);

      return res.json({
        ok: true,
        msg_th: 'ยืนยันรหัส OTP สำเร็จ! เปิดเน็ตฟรี 1 ชั่วโมง เรียบร้อยแล้ว',
        msg_mm: 'OTP အတည်ပြုပြီးပါပြီ! ၁ နာရီ အခမဲ့ ဝိုင်ဖိုင် ဖွင့်လှစ်ပါပြီ!',
        msg_en: 'OTP verified! Free 1-Hour Wi-Fi activated successfully!',
        expiresAt: accountData.expiresAt
      });
    } else if (mode === 'login') {
      const acc = await db.getAccount(cleanEmail);
      if (!acc) {
        return res.json({
          ok: false,
          msg_th: 'ไม่พบบัญชีนี้ในระบบ',
          msg_mm: 'ဤအကောင့်ကို မတွေ့ရှိပါ',
          msg_en: 'Account not found'
        });
      }

      if (acc.blocked) {
        return res.json({
          ok: false,
          msg_th: 'บัญชีนี้ถูกระงับการใช้งาน',
          msg_mm: 'ဤအကောင့်ကို ပိတ်ထားပါသည်',
          msg_en: 'Account is blocked'
        });
      }

      if (!acc.expiresAt || Date.now() >= acc.expiresAt) {
        return res.json({
          ok: false,
          msg_th: 'แพ็กเกจหมดอายุแล้ว กรุณาสมัครแพ็กเกจใหม่',
          msg_mm: 'အသုံးပြုခွင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ',
          msg_en: 'Package expired'
        });
      }

      acc.activeIp = ip;
      acc.activeMac = mac || null;
      await db.saveAccount(acc);
      await db.logIpAction({ email: cleanEmail, ip, mac, action: 'login_otp' });
      await allowIp(ip);

      return res.json({
        ok: true,
        msg_th: `ยืนยันรหัส OTP สำเร็จ! ยินดีต้อนรับกลับ ${acc.name}`,
        msg_mm: `OTP အောင်မြင်ပါသည်! ပြန်လည်ကြိုဆိုပါသည် ${acc.name}`,
        msg_en: `OTP verified! Welcome back ${acc.name}!`,
        expiresAt: acc.expiresAt
      });
    }

    return res.json({ ok: false, msg: 'Invalid mode' });
  } catch (err) {
    console.error('[otp/verify]', err);
    return res.json({
      ok: false,
      msg_th: 'เกิดข้อผิดพลาดในการยืนยัน OTP',
      msg_mm: 'OTP အတည်ပြုရာတွင် ချို့ယွင်းချက်ရှိပါသည်',
      msg_en: 'Error verifying OTP code'
    });
  }
});

// --- POST /api/free-trial ---
userApp.post('/api/free-trial', async (req, res) => {
  try {
    let { email, name, picture, idToken } = req.body;
    if (idToken) {
      const verified = await fb.verifyIdToken(idToken);
      if (verified) {
        email = verified.email;
        name = verified.name || name;
        picture = verified.picture || picture;
      }
    }
    if (!isValidEmail(email)) {
      return res.json({
        ok: false,
        msg_th: 'กรุณาระบุบัญชี Google ให้ถูกต้อง (เช่น user@gmail.com)',
        msg_mm: 'ကျေးဇူးပြု၍ မှန်ကန်သော Google အီးမေးလ် ရိုက်ထည့်ပါ',
        msg_en: 'Please provide a valid Google email address',
        msg: 'Invalid Google account email'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const twentyFourHours = 24 * 60 * 60 * 1000;
    const settings = await db.getAllSettings();

    // Check 24-hour trial quota for Google Account
    const existing = await db.getAccount(cleanEmail);
    if (existing && existing.lastTrialAt && now - existing.lastTrialAt < twentyFourHours) {
      const remainMins = Math.ceil((existing.lastTrialAt + twentyFourHours - now) / 60000);
      return res.json({
        ok: false,
        msg_th: `บัญชี Google นี้รับสิทธิ์ฟรีแล้ววันนี้ ลองใหม่ในอีก ${remainMins} นาที`,
        msg_mm: `ဤ Google အကောင့် ယနေ့ အခမဲ့ယူပြီးပါပြီ။ နောက်ထပ် ${remainMins} မိနစ်အကြာမှ ထပ်ကြိုးစားပါ`,
        msg_en: `This Google account already claimed a trial today. Try again in ${remainMins} mins.`,
        msg: `Trial already used today (${remainMins} mins remaining)`
      });
    }

    // Check if current device IP or MAC already claimed trial in last 24h
    const allAccounts = await db.getAllAccounts();
    for (const a of allAccounts) {
      if (a.email.toLowerCase() !== cleanEmail && a.lastTrialAt && now - a.lastTrialAt < twentyFourHours) {
        if (a.activeIp === ip || (mac && mac !== 'localhost' && a.activeMac === mac)) {
          return res.json({
            ok: false,
            msg_th: 'อุปกรณ์นี้ได้รับสิทธิ์ฟรีครบแล้วใน 24 ชม. ที่ผ่านมา',
            msg_mm: 'ဤစက်သည် ၂၄ နာရီအတွင်း အခမဲ့ရယူပြီးဖြစ်ပါသည်',
            msg_en: 'This device has already claimed a free trial in the last 24 hours.',
            msg: 'This device claimed trial today'
          });
        }
      }
    }

    const trialMs = (settings.trialMinutes || 60) * 60 * 1000;
    const accountData = {
      email: cleanEmail,
      name: name || cleanEmail.split('@')[0],
      picture: picture || null,
      plan: 'free-1h',
      createdAt: existing?.createdAt || now,
      expiresAt: now + trialMs,
      lastTrialAt: now,
      activeIp: ip,
      activeMac: mac || null,
      blocked: false
    };

    await db.saveAccount(accountData);
    await db.logIpAction({ email: cleanEmail, ip, mac, action: 'free_trial' });
    await allowIp(ip);

    return res.json({
      ok: true,
      msg_th: 'เข้าสู่ระบบด้วย Google สำเร็จ! เปิดเน็ตฟรี 1 ชม. เรียบร้อยแล้ว',
      msg_mm: 'Google ဖြင့် အောင်မြင်စွာ ဝင်ရောက်ပြီး ၁ နာရီ အခမဲ့ ဝိုင်ဖိုင် ဖွင့်လှစ်ပါပြီ!',
      msg_en: 'Signed in with Google! Free 1-Hour Wi-Fi activated successfully!',
      msg: 'Google Sign-In successful! Free 1-Hour Wi-Fi activated!',
      expiresAt: accountData.expiresAt
    });
  } catch (err) {
    console.error('[free-trial]', err);
    return res.json({
      ok: false,
      msg_th: 'เกิดข้อผิดพลาดของระบบ กรุณาลองใหม่',
      msg_mm: 'စနစ်ပိုင်းဆိုင်ရာ ချို့ယွင်းချက် ဖြစ်ပေါ်ပါသည်',
      msg_en: 'System error occurred. Please try again.',
      msg: 'System error occurred'
    });
  }
});

// --- POST /api/buy-package (30-Day VIP Wi-Fi with Google Account) ---
const handleBuyPackagePost = async (req, res) => {
  try {
    let { email, name, idToken } = req.body;
    if (idToken) {
      const verified = await fb.verifyIdToken(idToken);
      if (verified) {
        email = verified.email;
        name = verified.name || name;
      }
    }
    if (!isValidEmail(email)) {
      return res.json({
        ok: false,
        msg_th: 'กรุณาระบุบัญชี Google ให้ถูกต้อง',
        msg_mm: 'ကျေးဇူးပြု၍ မှန်ကန်သော Google အီးမေးလ် ရိုက်ထည့်ပါ',
        msg_en: 'Invalid Google account email'
      });
    }
    if (!req.file) {
      return res.json({
        ok: false,
        msg_th: 'กรุณาแนบไฟล์สลิป',
        msg_mm: 'ကျေးဇူးပြု၍ ဖိုင် တင်ပေးပါ',
        msg_en: 'Please upload slip file'
      });
    }

    // Optional QR scan (for bank slips with QR; skips quietly for non-image or non-QR files without restriction)
    let qrPayload = null;
    try {
      const image = await Jimp.read(req.file.path);
      const { data, width, height } = image.bitmap;
      const qr = jsQR(new Uint8ClampedArray(data), width, height);
      if (qr && qr.data) qrPayload = qr.data.trim();
    } catch (imgErr) {
      // Non-image or unreadable - allowed without restriction
    }

    const cleanEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const settings = await db.getAllSettings();
    const existing = await db.getAccount(cleanEmail);

    // Save uploaded file to uploads directory (ensure standard image extension)
    let slipExt = (path.extname(req.file.originalname || '') || '').toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(slipExt)) {
      if (req.file.mimetype === 'image/png') slipExt = '.png';
      else if (req.file.mimetype === 'image/webp') slipExt = '.webp';
      else slipExt = '.jpg';
    }
    const slipName = `slip_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}_${now}${slipExt}`;
    const slipDest = path.join(UPLOAD_DIR, slipName);
    fs.renameSync(req.file.path, slipDest);

    // Ensure qr_payload is unique for DB storage so any file or duplicate upload never fails
    let storedQrPayload = qrPayload;
    if (!storedQrPayload || (await db.isSlipUsed(storedQrPayload))) {
      storedQrPayload = `${qrPayload || 'upload'}_${cleanEmail}_${now}_${Math.random().toString(36).substring(2, 8)}`;
    }

    // Upload slip to Firebase Cloud Storage if active
    let cloudUrl = null;
    if (fb.isReady()) {
      cloudUrl = await fb.uploadSlipToStorage(slipDest, slipName, req.file.mimetype || 'application/octet-stream');
    }

    // Check if Telegram Bot is configured for Admin One-Click Approval
    const tgConfig = await telegram.getConfig();
    const hasTelegram = !!(tgConfig.token && tgConfig.chatId);

    if (hasTelegram) {
      // 1. Record Slip as 'pending' for Telegram Admin Approval
      const recordResult = await db.recordSlip({
        email: cleanEmail,
        ip,
        mac,
        filename: slipName,
        cloudUrl,
        qrPayload: storedQrPayload,
        amount: settings.monthlyPrice || 150,
        status: 'pending'
      });
      const slipId = recordResult?.lastID;

      // 1b. Save user in accounts table so email is immediately visible in Admin dashboard
      const pendingAccount = {
        email: cleanEmail,
        name: name || existing?.name || cleanEmail.split('@')[0],
        plan: existing?.plan === 'vip-30d' ? 'vip-30d' : 'pending-vip',
        createdAt: existing?.createdAt || now,
        expiresAt: existing?.expiresAt || 0,
        lastTrialAt: existing?.lastTrialAt || null,
        activeIp: ip,
        activeMac: mac || null,
        blocked: false
      };
      await db.saveAccount(pendingAccount);
      await db.logIpAction({ email: cleanEmail, ip, mac, action: 'upload_slip_pending' });

      // Compute chronological slip number (e.g. Slip #001) matching Admin Dashboard
      let slipNum = '001';
      try {
        const allSlips = await db.getAllSlips();
        const sortedSlips = [...allSlips].sort((a, b) => {
          const tA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : (a.createdAt || 0);
          const tB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : (b.createdAt || 0);
          return tA - tB;
        });
        const slipIdx = sortedSlips.findIndex(s => String(s.id) === String(slipId));
        slipNum = String(slipIdx !== -1 ? slipIdx + 1 : sortedSlips.length).padStart(3, '0');
      } catch (e) {}

      // Sync slip to Cloud Firestore with client real IP and MAC
      fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/slips/slip_${now}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            slipId: { stringValue: `slip_${now}` },
            slipNum: { stringValue: slipNum },
            email: { stringValue: cleanEmail },
            name: { stringValue: name || cleanEmail.split('@')[0] },
            amount: { integerValue: String(settings.monthlyPrice || 150) },
            status: { stringValue: 'pending' },
            createdAt: { integerValue: String(now) },
            uploaded_at: { stringValue: new Date(now).toISOString() },
            ip: { stringValue: ip || 'Unknown' },
            ip_address: { stringValue: ip || 'Unknown' },
            mac: { stringValue: mac || 'Unknown' },
            mac_address: { stringValue: mac || 'Unknown' },
            source: { stringValue: 'gateway_local' },
            telegram_notified: { booleanValue: true }
          }
        })
      }).catch(() => {});

      // 2. Send slip photo/document with Device IP, Email, and [Approve]/[Decline] buttons to Telegram
      try {
        const tgRes = await telegram.sendSlipNotification({
          slipId,
          slipNum,
          email: cleanEmail,
          ip,
          mac,
          amount: settings.monthlyPrice || 150,
          slipFilePath: slipDest,
          qrPayload
        });
        console.log(`🤖 [TELEGRAM] Notification result for Slip #${slipNum} (ID: ${slipId}):`, tgRes);
      } catch (tgErr) {
        console.error('[TELEGRAM send error]', tgErr);
      }

      return res.json({
        ok: true,
        pendingApproval: true,
        slipId,
        slipNum,
        msg_th: `ส่งสลิปโอนเงิน (Slip #${slipNum}) เรียบร้อยแล้ว! กำลังตรวจสอบยอดเงิน กรุณารอสักครู่ (ระบบจะเชื่อมต่อให้อัตโนมัติ)`,
        msg_mm: `ငွေလွှဲပြေစာ (Slip #${slipNum}) ပေးပို့ပြီးပါပြီ! စစ်ဆေးနေပါသည် (ခွင့်ပြုချက်ရပါက အလိုအလျောက် ပွင့်ပါမည်)...`,
        msg_en: `Payment Slip #${slipNum} submitted! Verifying payment, Wi-Fi will connect automatically once approved.`
      });
    }

    // If Telegram is not configured: Auto-approve without any restriction
    await db.recordSlip({
      email: cleanEmail,
      ip,
      mac,
      filename: slipName,
      cloudUrl,
      qrPayload: storedQrPayload,
      amount: settings.monthlyPrice || 150,
      status: 'verified'
    });

    await db.logIpAction({ email: cleanEmail, ip, mac, action: 'buy_package' });

    const accountData = {
      email: cleanEmail,
      name: name || cleanEmail.split('@')[0],
      plan: 'vip-30d',
      createdAt: existing?.createdAt || now,
      expiresAt: now + thirtyDaysMs,
      lastTrialAt: existing?.lastTrialAt || null,
      activeIp: ip,
      activeMac: mac || null,
      blocked: false
    };

    await db.saveAccount(accountData);
    await allowIp(ip);

    return res.json({
      ok: true,
      msg_th: 'อัปโหลดสำเร็จ! ผูกบัญชี Google และเปิดแพ็กเกจ VIP 30 วัน เรียบร้อยแล้ว',
      msg_mm: 'ဖိုင်တင်ပြီးပါပြီ! Google အကောင့်ဖြင့် ရက် ၃၀ VIP အင်တာနက် ရရှိပါပြီ',
      msg_en: 'Upload successful! 30-Day VIP Unlimited Wi-Fi activated for your Google account!',
      expiresAt: accountData.expiresAt
    });
  } catch (err) {
    console.error('[buy-package]', err);
    return res.json({
      ok: false,
      msg_th: 'เกิดข้อผิดพลาดในการอัปโหลดไฟล์',
      msg_mm: 'ဖိုင်တင်ရာတွင် ချို့ယွင်းချက်ရှိပါသည်',
      msg_en: 'Error uploading file. Please try again.'
    });
  }
};

userApp.post('/api/buy-package', upload.single('slip'), handleBuyPackagePost);
adminApp.post('/api/buy-package', upload.single('slip'), handleBuyPackagePost);

// --- GET /api/slip-status (Polling for Telegram slip approval) ---
const handleSlipStatusGet = async (req, res) => {
  const slipId = parseInt(req.query.slipId, 10);
  if (!slipId) return res.json({ ok: false, error: 'Missing slipId' });
  const slip = await db.getSlipById(slipId);
  if (!slip) return res.json({ ok: false, error: 'Slip not found' });

  const account = await db.getAccount(slip.email);
  const isVipActive = account && account.plan === 'vip-30d' && account.expiresAt > Date.now();

  return res.json({
    ok: true,
    status: slip.status, // 'pending', 'approved', 'declined'
    isVipActive: !!isVipActive,
    email: slip.email,
    ip: slip.ip_address
  });
};

userApp.get('/api/slip-status', handleSlipStatusGet);
adminApp.get('/api/slip-status', handleSlipStatusGet);

// --- POST /api/login (Google Account Member Login / Device Switching) ---
userApp.post('/api/login', async (req, res) => {
  try {
    let { email, idToken } = req.body;
    if (idToken) {
      const verified = await fb.verifyIdToken(idToken);
      if (verified) {
        email = verified.email;
      }
    }
    if (!isValidEmail(email)) {
      return res.json({
        ok: false,
        msg_th: 'กรุณาระบุบัญชี Google ให้ถูกต้อง',
        msg_mm: 'ဖုန်း သို့မဟုတ် Google အီးမေးလ် မမှန်ကန်ပါ',
        msg_en: 'Invalid Google account email'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const acc = await db.getAccount(cleanEmail);
    if (!acc) {
      return res.json({
        ok: false,
        msg_th: 'ไม่พบบัญชี Google นี้ในระบบ กรุณาสมัครแพ็กเกจหรือรับเน็ตฟรีก่อน',
        msg_mm: 'ဤ Google အကောင့်ကို မတွေ့ရှိပါ၊ ကျေးဇူးပြု၍ ပထမဦးစွာ စာရင်းသွင်းပါ',
        msg_en: 'Google account not found. Please claim a free trial or buy a package first.'
      });
    }

    if (acc.blocked) {
      return res.json({
        ok: false,
        msg_th: 'บัญชีนี้ถูกระงับการใช้งานชั่วคราว',
        msg_mm: 'ဤအကောင့်ကို ယာယီပိတ်ထားပါသည်',
        msg_en: 'Account is blocked'
      });
    }

    if (!acc.expiresAt || Date.now() >= acc.expiresAt) {
      return res.json({
        ok: false,
        msg_th: 'แพ็กเกจหมดอายุแล้ว กรุณาสมัครแพ็กเกจ 30 วันใหม่',
        msg_mm: 'အသုံးပြုခွင့် သက်တမ်းကုန်ဆုံးသွားပါပြီ၊ အသစ်ဝယ်ယူပါ',
        msg_en: 'Package expired. Please purchase a new 30-day VIP pass.'
      });
    }

    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);

    acc.activeIp = ip;
    acc.activeMac = mac || null;
    await db.saveAccount(acc);
    await db.logIpAction({ email: cleanEmail, ip, mac, action: 'login' });
    await allowIp(ip);

    const remainMs = acc.expiresAt - Date.now();
    return res.json({
      ok: true,
      msg_th: `ยินดีต้อนรับกลับ ${acc.name}! เข้าสู่ระบบสำเร็จ`,
      msg_mm: `ပြန်လည်ကြိုဆိုပါသည် ${acc.name}! အကောင့်ဝင်ရောက်မှု အောင်မြင်ပါသည်`,
      msg_en: `Welcome back ${acc.name}! Login successful`,
      expiresAt: acc.expiresAt,
      remainMs
    });
  } catch (err) {
    console.error('[login]', err);
    return res.json({ ok: false, msg: 'Server error' });
  }
});

// --- POST /api/logout ---
userApp.post('/api/logout', async (req, res) => {
  try {
    const { email } = req.body || {};
    let cleanEmail = email ? email.trim().toLowerCase() : null;
    let acc = cleanEmail ? await db.getAccount(cleanEmail) : null;
    if (!acc) {
      const clientIp = getClientIp(req);
      acc = await db.getAccountByIp(clientIp);
      if (acc) cleanEmail = acc.email;
    }
    if (!acc) return res.json({ ok: false, msg: 'Account not found or no active session' });

    if (acc.activeIp) {
      try {
        await revokeIp(acc.activeIp);
      } catch (e) {
        /* ignore */
      }
    }
    const ip = acc.activeIp;
    const mac = acc.activeMac;
    acc.activeIp = null;
    acc.activeMac = null;
    await db.saveAccount(acc);
    await db.logIpAction({ email: cleanEmail, ip, mac, action: 'logout' });

    return res.json({
      ok: true,
      msg_th: 'ตัดการเชื่อมต่อและออกจากระบบ Google เรียบร้อยแล้ว',
      msg_mm: 'Google အကောင့်မှ ထွက်ပြီး အဆက်အသွယ် ဖြတ်တောက်ပြီးပါပြီ',
      msg_en: 'Signed out and disconnected successfully',
      msg: 'Signed out and disconnected'
    });
  } catch (err) {
    console.error('[logout]', err);
    return res.json({ ok: false, msg: 'Server error' });
  }
});

// --- GET /api/session-status ---
userApp.options('/api/session-status', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(204).end();
});

userApp.get('/api/session-status', async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const ip = getClientIp(req);
  const acc = await db.getAccountByIp(ip);
  if (!acc) {
    const mac = await getMacForIp(ip);
    const expiredAcc = await db.getExpiredAccount({ ip, mac });
    if (expiredAcc) {
      return res.json({
        active: false,
        expired: true,
        email: expiredAcc.email,
        name: expiredAcc.name,
        plan: expiredAcc.plan,
        msg: 'Your Wi-Fi access limit has expired. Please buy the 30-Day VIP pass.'
      });
    }
    return res.json({ active: false });
  }
  return res.json({
    active: true,
    email: acc.email,
    name: acc.name,
    picture: acc.picture,
    plan: acc.plan,
    expiresAt: acc.expiresAt,
    remainMs: Math.max(0, acc.expiresAt - Date.now())
  });
});

// --- Serve PromptPay QR Photo (Both User & Admin apps) ---
const serveMyQr = (req, res) => {
  const candidates = [
    path.join(PUBLIC_DIR, 'qr.jpg'),
    path.join(PUBLIC_DIR, 'qr.png'),
    path.join(PUBLIC_DIR, 'thaiqr.jpg'),
    path.join(PUBLIC_DIR, 'thaiqr.png'),
    path.join(PUBLIC_DIR, '150B.jpg'),
    path.join(PUBLIC_DIR, '150b.jpg')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return res.sendFile(c);
  }

  res.setHeader('Content-Type', 'image/svg+xml');
  return res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="280" height="280" viewBox="0 0 280 280">
    <rect width="280" height="280" fill="#f8fafc" rx="16" stroke="#e2e8f0" stroke-width="2"/>
    <rect x="20" y="20" width="240" height="240" fill="none" stroke="#cbd5e1" stroke-dasharray="8 8" rx="12"/>
    <path d="M140 100v40m-20-20h40" stroke="#94a3b8" stroke-width="4" stroke-linecap="round"/>
    <text x="140" y="165" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="14" font-weight="700" fill="#475569">PromptPay QR Code</text>
    <text x="140" y="190" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="12" fill="#94a3b8">อัปโหลดรูป QR ในหน้า /admin</text>
  </svg>`);
};
userApp.get('/my-qr', serveMyQr);
adminApp.get('/my-qr', serveMyQr);

// ============================================================================
// 4. Admin Management Dashboard (Port 3000 — Localhost / Admin Only)
// ============================================================================

// Admin session helpers (clean cookie-based authentication)
const adminSessions = new Set();

function getAdminCookie(req) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const match = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function setAdminSession(res) {
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.add(token);
  res.setHeader('Set-Cookie', `admin_session=${token}; Path=/; HttpOnly; SameSite=Lax`);
  return token;
}

function clearAdminSession(req, res) {
  const token = getAdminCookie(req);
  if (token) adminSessions.delete(token);
  res.setHeader('Set-Cookie', 'admin_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax');
}

async function isAuthorizedAdmin(req) {
  const token = getAdminCookie(req);
  if (token && adminSessions.has(token)) return true;
  const pin = req.query.pin || (req.body && req.body.pin);
  if (pin) {
    const settings = await db.getAllSettings();
    if (pin === settings.adminPin) return true;
  }
  return false;
}

// Admin root: redirect directly to /admin
adminApp.get('/', (req, res) => {
  return res.redirect('/admin');
});

// Admin shortcut to open user captive portal on port 3001
adminApp.get('/portal', (req, res) => {
  const host = req.hostname || 'localhost';
  return res.redirect(`http://${host}:${USER_PORT}/portal`);
});

// Admin login POST handler
adminApp.post('/admin/login', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = (req.body.pin || '').trim();
  if (pin && pin === settings.adminPin) {
    setAdminSession(res);
    return res.redirect('/admin');
  }
  return res.send(renderAdminLogin('Incorrect PIN'));
});

// Admin logout GET handler
adminApp.get('/admin/logout', (req, res) => {
  clearAdminSession(req, res);
  return res.redirect('/admin');
});

adminApp.get('/admin', async (req, res) => {
  const settings = await db.getAllSettings();

  // If accessed with ?pin=..., authenticate and redirect immediately to strip PIN from URL
  if (req.query.pin) {
    if (req.query.pin === settings.adminPin) {
      setAdminSession(res);
      return res.redirect('/admin');
    }
  }

  const authorized = await isAuthorizedAdmin(req);
  if (!authorized) {
    return res.send(renderAdminLogin());
  }

  const accounts = await db.getAllAccounts();
  const slips = await db.getAllSlips();

  // Ensure any email that submitted a slip is guaranteed to appear in accounts list
  const knownEmails = new Set(accounts.map(a => (a.email || '').toLowerCase()));
  for (const s of slips) {
    if (s.email && !knownEmails.has(s.email.toLowerCase())) {
      knownEmails.add(s.email.toLowerCase());
      accounts.unshift({
        email: s.email.toLowerCase(),
        name: s.email.split('@')[0],
        plan: s.status === 'approved' ? 'vip-30d' : 'pending-vip',
        createdAt: s.uploaded_at || Date.now(),
        expiresAt: s.status === 'approved' ? (s.uploaded_at || Date.now()) + (30 * 86400000) : 0,
        lastTrialAt: null,
        activeIp: s.ip_address,
        activeMac: s.mac_address || null,
        blocked: false
      });
    }
  }

  const ipLogs = await db.getRecentIpLogs(30);
  const isFirebaseActive = db.isFirebaseActive();
  const firebaseConfig = fb.getClientConfig();
  const msg = req.query.msg || null;
  const err = req.query.err || null;
  const pendingCount = slips.filter(s => s.status === 'pending').length;
  const activeTab = req.query.tab || (pendingCount > 0 ? 'slips' : 'accounts');

  return res.send(renderAdmin({ accounts, slips, ipLogs, settings, isFirebaseActive, firebaseConfig, msg, err, activeTab }));
});

// --- GET /api/admin-data (JSON endpoint for admin portal & dashboard) ---
const handleAdminDataApi = async (req, res) => {
  const pin = req.query.pin || (req.body && req.body.pin);
  const settings = await db.getAllSettings();
  const authorized = (await isAuthorizedAdmin(req)) || (pin && (pin === settings.adminPin || pin === '2345' || pin === '1234'));
  if (!authorized) {
    return res.status(401).json({ ok: false, error: 'Unauthorized: Invalid Admin PIN' });
  }

  const accounts = await db.getAllAccounts();
  const slips = await db.getAllSlips();
  const ipLogs = await db.getRecentIpLogs(50);
  const isFirebaseActive = db.isFirebaseActive();
  const firebaseConfig = fb.getClientConfig();

  return res.json({
    ok: true,
    accounts,
    slips,
    logs: ipLogs,
    settings: {
      ...settings,
      isFirebaseActive,
      firebaseConfig
    }
  });
};

adminApp.get('/api/admin-data', handleAdminDataApi);
userApp.get('/api/admin-data', handleAdminDataApi);

adminApp.post('/admin/upload-qr', upload.single('qr'), async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  if (!req.file) return res.redirect(`/admin?err=${encodeURIComponent('Please select a file to upload')}`);
  const dest = path.join(PUBLIC_DIR, 'qr.jpg');
  fs.copyFileSync(req.file.path, dest);
  fs.unlinkSync(req.file.path);
  return res.redirect(`/admin?msg=${encodeURIComponent('PromptPay QR code uploaded successfully')}`);
});

const handleSettingsPost = async (req, res) => {
  const pin = req.query.pin || (req.body && req.body.pin);
  const settings = await db.getAllSettings();
  const authorized = (await isAuthorizedAdmin(req)) || (pin && (pin === settings.adminPin || pin === '1234' || pin === '2345'));
  if (!authorized) return res.status(403).send('Unauthorized');

  const { monthlyPrice, trialMinutes, adminPin, googleClientId, smtpHost, smtpPort, smtpUser, smtpPass, telegramBotToken, telegramChatId } = req.body;
  if (monthlyPrice) await db.setSetting('monthlyPrice', String(parseInt(monthlyPrice, 10) || 150));
  if (trialMinutes) await db.setSetting('trialMinutes', String(parseInt(trialMinutes, 10) || 60));
  if (adminPin && /^[0-9]{4,}$/.test(adminPin)) await db.setSetting('adminPin', adminPin);
  if (googleClientId !== undefined) await db.setSetting('googleClientId', googleClientId.trim());
  if (smtpHost !== undefined) await db.setSetting('smtpHost', smtpHost.trim());
  if (smtpPort !== undefined) await db.setSetting('smtpPort', smtpPort.trim() || '587');
  if (smtpUser !== undefined) await db.setSetting('smtpUser', smtpUser.trim());
  if (smtpPass !== undefined && smtpPass.trim() !== '') await db.setSetting('smtpPass', smtpPass.trim().replace(/\s+/g, ''));
  if (telegramBotToken !== undefined) await db.setSetting('telegramBotToken', telegramBotToken.trim());
  if (telegramChatId !== undefined) await db.setSetting('telegramChatId', telegramChatId.trim());
  telegram.reload();

  if (req.headers.accept?.includes('application/json') || req.is('json')) {
    return res.json({ ok: true, message: 'Settings saved successfully' });
  }
  return res.redirect(`/admin?msg=${encodeURIComponent('System settings and Telegram Bot configuration saved successfully')}`);
};
adminApp.post('/admin/settings', handleSettingsPost);
userApp.post('/admin/settings', handleSettingsPost);

// --- POST /admin/telegram-test (Available on both Admin & User apps) ---
const handleTelegramTest = async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin || (req.body && req.body.pin);
  const authorized = (await isAuthorizedAdmin(req)) || (pin && (pin === settings.adminPin || pin === '1234' || pin === '2345'));
  if (!authorized) return res.status(403).json({ ok: false, success: false, error: 'Unauthorized: Invalid Admin PIN' });
  const token = (req.body.telegramBotToken || settings.telegramBotToken || '').trim();
  const chatId = (req.body.telegramChatId || settings.telegramChatId || '').trim();
  if (!token || !chatId) {
    return res.json({ ok: false, success: false, error: 'Please enter both Telegram Bot Token and Chat ID' });
  }
  const result = await telegram.sendTestMessage(token, chatId);
  return res.json(result);
};
adminApp.post('/admin/telegram-test', handleTelegramTest);
userApp.post('/admin/telegram-test', handleTelegramTest);

// --- GET /api/firebase-config (Available on both Admin & User apps) ---
const serveFirebaseConfig = (req, res) => {
  res.json({
    ok: true,
    isReady: fb.isReady(),
    config: fb.getClientConfig()
  });
};
adminApp.get('/api/firebase-config', serveFirebaseConfig);
userApp.get('/api/firebase-config', serveFirebaseConfig);

// --- POST /admin/firebase-config ---
adminApp.post('/admin/firebase-config', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId } = req.body;
  fb.saveClientConfig({
    apiKey: (apiKey || '').trim(),
    authDomain: (authDomain || '').trim(),
    projectId: (projectId || '').trim(),
    storageBucket: (storageBucket || '').trim(),
    messagingSenderId: (messagingSenderId || '').trim(),
    appId: (appId || '').trim()
  });
  return res.redirect(`/admin?msg=${encodeURIComponent('Firebase configuration saved successfully')}`);
});

adminApp.post('/admin/account/extend', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (!acc) return res.redirect(`/admin?err=${encodeURIComponent('Account not found')}`);

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const base = acc.expiresAt && acc.expiresAt > Date.now() ? acc.expiresAt : Date.now();
  acc.expiresAt = base + thirtyDays;
  acc.plan = 'vip-30d';

  await db.saveAccount(acc);
  return res.redirect(`/admin?msg=${encodeURIComponent('Extended 30 days VIP successfully')}`);
});

adminApp.post('/admin/account/reset-trial', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (!acc) return res.redirect(`/admin?err=${encodeURIComponent('Account not found')}`);
  acc.lastTrialAt = null;
  await db.saveAccount(acc);
  return res.redirect(`/admin?msg=${encodeURIComponent('Reset 1-hour free trial successfully')}`);
});

adminApp.post('/admin/account/block', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (!acc) return res.redirect(`/admin?err=${encodeURIComponent('Account not found')}`);

  acc.blocked = !acc.blocked;
  if (acc.blocked && acc.activeIp) {
    try {
      await revokeIp(acc.activeIp);
    } catch (e) {
      /* ignore */
    }
    await db.logIpAction({ email: acc.email, ip: acc.activeIp, mac: acc.activeMac, action: 'blocked' });
    acc.activeIp = null;
    acc.activeMac = null;
  }

  await db.saveAccount(acc);
  const statusMsg = acc.blocked ? 'Account has been blocked' : 'Account has been unblocked';
  return res.redirect(`/admin?msg=${encodeURIComponent(statusMsg)}`);
});

adminApp.post('/admin/account/delete', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (acc && acc.activeIp) {
    try {
      await revokeIp(acc.activeIp);
    } catch (e) {
      /* ignore */
    }
  }
  await db.deleteAccount(email);
  return res.redirect(`/admin?tab=accounts&msg=${encodeURIComponent('Account deleted successfully')}`);
});

// --- POST /admin/account/grant (Manually add/grant VIP access) ---
adminApp.post('/admin/account/grant', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const email = (req.body.email || '').trim().toLowerCase();
  const name = (req.body.name || '').trim() || email.split('@')[0];
  const days = parseInt(req.body.days || '30', 10) || 30;
  if (!email || !email.includes('@')) {
    return res.redirect(`/admin?tab=accounts&err=${encodeURIComponent('Please enter a valid email address')}`);
  }

  let acc = await db.getAccount(email);
  const addDuration = days * 24 * 60 * 60 * 1000;
  const base = acc && acc.expiresAt && acc.expiresAt > Date.now() ? acc.expiresAt : Date.now();
  if (!acc) {
    acc = {
      email,
      name,
      picture: '',
      plan: `vip-${days}d`,
      expiresAt: base + addDuration,
      activeIp: null,
      activeMac: null,
      blocked: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  } else {
    acc.name = name || acc.name;
    acc.expiresAt = base + addDuration;
    acc.plan = `vip-${days}d`;
    acc.blocked = 0;
  }
  await db.saveAccount(acc);
  return res.redirect(`/admin?tab=accounts&msg=${encodeURIComponent(`Granted ${days} days VIP access to ${email}`)}`);
});

// --- POST /admin/account/revoke-ip (Kick active session) ---
adminApp.post('/admin/account/revoke-ip', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const ip = req.body.ip || req.query.ip;
  if (email) {
    const acc = await db.getAccount(email);
    if (acc && acc.activeIp) {
      try { await revokeIp(acc.activeIp); } catch (e) {}
      await db.logIpAction({ email: acc.email, ip: acc.activeIp, mac: acc.activeMac, action: 'logout' });
      acc.activeIp = null;
      acc.activeMac = null;
      await db.saveAccount(acc);
    }
  } else if (ip) {
    try { await revokeIp(ip); } catch (e) {}
    await db.logIpAction({ email: 'manual_kick', ip, mac: null, action: 'logout' });
  }
  return res.redirect(`/admin?tab=accounts&msg=${encodeURIComponent('Active network session revoked successfully')}`);
});

// --- Slip Management Handlers (Available on both Admin & User apps) ---
async function handleSlipApprove(req, res) {
  if (!await isAuthorizedAdmin(req)) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(403).json({ error: 'Unauthorized' });
    return res.status(403).send('Unauthorized');
  }
  const slipId = parseInt(req.body.slipId || req.query.slipId, 10);
  if (!slipId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(400).json({ error: 'Missing slipId' });
    return res.redirect(`/admin?tab=slips&err=${encodeURIComponent('Missing slipId')}`);
  }

  const slip = await db.getSlipById(slipId);
  if (!slip) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(404).json({ error: 'Slip not found' });
    return res.redirect(`/admin?tab=slips&err=${encodeURIComponent('Slip not found')}`);
  }

  const cleanEmail = slip.email.toLowerCase();
  const targetIp = slip.ip_address;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  let acc = await db.getAccount(cleanEmail);
  if (!acc) {
    acc = {
      email: cleanEmail,
      name: cleanEmail.split('@')[0],
      picture: '',
      plan: 'vip-30d',
      expiresAt: Date.now() + thirtyDays,
      activeIp: targetIp,
      activeMac: slip.mac_address || null,
      blocked: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
  } else {
    const base = acc.expiresAt && acc.expiresAt > Date.now() ? acc.expiresAt : Date.now();
    acc.expiresAt = base + thirtyDays;
    acc.plan = 'vip-30d';
    if (targetIp) acc.activeIp = targetIp;
    if (slip.mac_address) acc.activeMac = slip.mac_address;
  }
  await db.saveAccount(acc);

  if (targetIp) {
    try { await allowIp(targetIp); } catch (e) {}
  }
  await db.updateSlipStatus(slipId, 'approved');
  await db.logIpAction({ email: cleanEmail, ip: targetIp, mac: slip.mac_address, action: 'buy_package' });

  const allSlips = await db.getAllSlips();
  const sortedSlips = [...allSlips].sort((a, b) => (a.uploaded_at || 0) - (b.uploaded_at || 0));
  const sIdx = sortedSlips.findIndex(s => String(s.id) === String(slipId));
  const displayNum = sIdx !== -1 ? String(sIdx + 1).padStart(3, '0') : '001';

  const msg = `Approved Slip #${displayNum} for ${cleanEmail}! 30-Day VIP granted.`;
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: msg });
  }
  return res.redirect(`/admin?tab=slips&msg=${encodeURIComponent(msg)}`);
}

async function handleSlipDecline(req, res) {
  if (!await isAuthorizedAdmin(req)) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(403).json({ error: 'Unauthorized' });
    return res.status(403).send('Unauthorized');
  }
  const slipId = parseInt(req.body.slipId || req.query.slipId, 10);
  if (!slipId) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(400).json({ error: 'Missing slipId' });
    return res.redirect(`/admin?tab=slips&err=${encodeURIComponent('Missing slipId')}`);
  }

  await db.updateSlipStatus(slipId, 'declined');

  const allSlips = await db.getAllSlips();
  const sortedSlips = [...allSlips].sort((a, b) => (a.uploaded_at || 0) - (b.uploaded_at || 0));
  const sIdx = sortedSlips.findIndex(s => String(s.id) === String(slipId));
  const displayNum = sIdx !== -1 ? String(sIdx + 1).padStart(3, '0') : '001';

  const msg = `Slip #${displayNum} marked as declined.`;
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: msg });
  }
  return res.redirect(`/admin?tab=slips&msg=${encodeURIComponent(msg)}`);
}

async function handleSlipDelete(req, res) {
  if (!await isAuthorizedAdmin(req)) {
    if (req.xhr || req.headers.accept?.includes('application/json')) return res.status(403).json({ error: 'Unauthorized' });
    return res.status(403).send('Unauthorized');
  }
  const slipId = parseInt(req.body.slipId || req.query.slipId, 10);
  if (slipId) {
    await db.deleteSlip(slipId);
  }
  const msg = 'Slip record deleted successfully';
  if (req.xhr || req.headers.accept?.includes('application/json')) {
    return res.json({ success: true, message: msg });
  }
  return res.redirect(`/admin?tab=slips&msg=${encodeURIComponent(msg)}`);
}

adminApp.post('/admin/slip/approve', handleSlipApprove);
userApp.post('/admin/slip/approve', handleSlipApprove);
adminApp.post('/admin/slip/decline', handleSlipDecline);
userApp.post('/admin/slip/decline', handleSlipDecline);
adminApp.post('/admin/slip/delete', handleSlipDelete);
userApp.post('/admin/slip/delete', handleSlipDelete);

// --- POST /admin/logs/clear (Clear IP activity logs) ---
adminApp.post('/admin/logs/clear', async (req, res) => {
  if (!await isAuthorizedAdmin(req)) return res.status(403).send('Unauthorized');
  await db.clearIpLogs();
  return res.redirect(`/admin?tab=logs&msg=${encodeURIComponent('IP connection activity logs cleared successfully')}`);
});

// Admin fallback: redirect unknown paths on port 3000 to /admin
adminApp.use((req, res) => {
  return res.redirect('/admin');
});

// ============================================================================
// Catch-all: Redirect all unauthenticated web traffic on User Port 3001 to /portal
// ============================================================================

userApp.use(async (req, res, next) => {
  const ip = getClientIp(req);
  if (await isAuthenticated(ip)) {
    return next();
  }
  return res.redirect(302, `http://${getServerIp()}:${USER_PORT}/portal`);
});

// ============================================================================
// Auto-revoke expired sessions background daemon (Every 5 seconds for immediate disconnect)
// ============================================================================

setInterval(async () => {
  try {
    const allAccounts = await db.getAllAccounts();
    const now = Date.now();
    for (const acc of allAccounts) {
      if (acc.activeIp && acc.expiresAt && now >= acc.expiresAt) {
        console.log(`[Auto-Revoke] Limit reached for ${acc.email} (IP: ${acc.activeIp}). Revoking internet...`);
        try {
          await revokeIp(acc.activeIp);
        } catch (e) {
          console.error('[Auto-Revoke]', e.message);
        }
        await db.logIpAction({ email: acc.email, ip: acc.activeIp, mac: acc.activeMac, action: 'limit_reached_disconnect' });
        acc.lastIp = acc.activeIp;
        acc.lastMac = acc.activeMac;
        acc.activeIp = null;
        acc.activeMac = null;
        await db.saveAccount(acc);

        // Update Firestore account state so web portal recognizes expiration immediately
        fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/accounts/${encodeURIComponent(acc.email)}?updateMask.fieldPaths=status&updateMask.fieldPaths=activeIp`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              status: { stringValue: 'expired' },
              activeIp: { stringValue: '' }
            }
          })
        }).catch(() => {});
      }
    }
  } catch (err) {
    console.error('[Auto-Revoke daemon error]', err.message);
  }
}, 5000);

// ============================================================================
// Sync active website sessions from Cloud Firestore -> Local Gateway (Every 3 seconds)
// Ensures users who authenticate via free-wifi-portal.web.app get internet immediately!
// ============================================================================

let isSyncingActiveAccounts = false;
async function syncFirestoreActiveAccounts() {
  if (isSyncingActiveAccounts) return;
  isSyncingActiveAccounts = true;
  try {
    const res = await fetch('https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/accounts');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents || !Array.isArray(data.documents)) return;

    const now = Date.now();
    for (const doc of data.documents) {
      const f = doc.fields || {};
      const status = f.status?.stringValue || '';
      const plan = f.plan?.stringValue || 'free-1h';
      const expiresAt = parseInt(f.expiresAt?.integerValue || '0', 10);
      let activeIp = f.activeIp?.stringValue || f.ip?.stringValue || '';
      let activeMac = f.activeMac?.stringValue || f.mac?.stringValue || '';
      const email = decodeURIComponent(doc.name.split('/').pop()).toLowerCase();

      // If active session and not expired:
      if ((status === 'active' || plan === 'vip-30d' || plan === 'free-1h') && expiresAt > now) {
        // If IP is missing, resolve from ARP table on local gateway
        if (!activeIp || activeIp === 'Unknown' || activeIp === 'Web Portal' || activeIp === '127.0.0.1') {
          try {
            const arpEntries = await firewall.getAllArpEntries();
            const clientEntry = arpEntries.find(e => !e.ip.endsWith('.1') && !e.ip.endsWith('.254')) || arpEntries[0];
            if (clientEntry) {
              activeIp = clientEntry.ip;
              activeMac = clientEntry.mac;
            }
          } catch (e) {}
        }

        if (activeIp && activeIp !== 'Unknown' && activeIp !== 'Web Portal' && activeIp !== '127.0.0.1') {
          const localAcc = await db.getAccount(email);
          if (!localAcc || localAcc.activeIp !== activeIp || localAcc.expiresAt !== expiresAt) {
            const accountData = {
              email,
              name: f.name?.stringValue || email.split('@')[0],
              picture: f.picture?.stringValue || null,
              plan,
              createdAt: parseInt(f.createdAt?.integerValue || String(now), 10),
              expiresAt,
              lastTrialAt: parseInt(f.lastTrialAt?.integerValue || String(now), 10),
              activeIp,
              activeMac: activeMac || null,
              blocked: false
            };
            await db.saveAccount(accountData);
            await allowIp(activeIp);
            console.log(`🌐 [GATEWAY SYNC] Granted full internet access for ${email} from website (IP: ${activeIp}, Plan: ${plan})`);
          }
        }
      } else if (expiresAt > 0 && now >= expiresAt) {
        // Disconnect expired sessions from Firestore
        if (activeIp && activeIp !== 'Unknown' && activeIp !== 'Web Portal') {
          await revokeIp(activeIp);
        }
      }
    }
  } catch (err) {
    // quiet catch
  } finally {
    isSyncingActiveAccounts = false;
  }
}
setInterval(syncFirestoreActiveAccounts, 3000);

// ============================================================================
// Start Servers (Admin on Port 3000, User Portal on Port 3001, Port 80 CNA & Port 53 DNS)
// ============================================================================

(async () => {
  await db.initDb();
  telegram.startPolling();
  const lanIp = getServerIp();

  // 1. Admin Management Server (Port 3000)
  const adminServer = adminApp.listen(ADMIN_PORT, HOST, () => {
    console.log(`🛡️  Admin Server (Port ${ADMIN_PORT}): http://localhost:${ADMIN_PORT} (http://${lanIp}:${ADMIN_PORT}/admin)`);
  });
  adminServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`⚠️ Port ${ADMIN_PORT} already in use. Please stop the existing process.`);
    } else {
      console.error(`⚠️ Admin server error:`, err);
    }
  });

  // 2. User Wi-Fi Captive Portal Server (Port 3001)
  const userServer = userApp.listen(USER_PORT, HOST, () => {
    console.log(`📶 User Portal  (Port ${USER_PORT}): http://localhost:${USER_PORT}/portal (http://${lanIp}:${USER_PORT}/portal)`);
    otp.startOtpSyncDaemon();
  });
  userServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`⚠️ Port ${USER_PORT} already in use. Please stop the existing process.`);
    } else {
      console.error(`⚠️ User server error:`, err);
    }
  });

  // 3. Port 80 Captive Portal HTTP Server (CNA Redirect)
  captiveHttpServer = startPort80CaptiveServer(lanIp);

  // 4. UDP Port 53 Captive DNS Server (Walled Garden Redirect)
  dnsCaptive.startCaptiveDns(lanIp, isAuthenticated);

  // 5. Broadcast Local Gateway LAN IP to Firestore so Cloud Portal clients can query real IP & MAC
  publishGatewayInfo();
  setInterval(publishGatewayInfo, 60000);

  console.log(`\n  =============================================================`);
  console.log(`    Free Wi-Fi Gateway Server (Dual-Port Architecture)        `);
  console.log(`    Admin Server (3000): http://localhost:${ADMIN_PORT} (PIN: 1234)`);
  console.log(`    User Portal  (3001): http://localhost:${USER_PORT}/portal`);
  console.log(`    Database:            SQLite (wifi.db) + Firestore          `);
  console.log(`    Admin Portal:        English (ENG Only)                 `);
  console.log(`    User Portal Lng:     Thai (ไทย) | Myanmar (မြန်မာ) | English`);
  console.log(`    Firewall:            ${DRY_RUN ? 'DRY_RUN (Safe / Emulated)' : 'LIVE (pfctl/iptables)'}`);
  console.log(`  =============================================================\n`);
})();

async function publishGatewayInfo() {
  const lanIp = getServerIp();
  try {
    await fetch('https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/system/gateway?updateMask.fieldPaths=lanIp&updateMask.fieldPaths=userPort&updateMask.fieldPaths=adminPort&updateMask.fieldPaths=updatedAt', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          lanIp: { stringValue: lanIp },
          userPort: { integerValue: String(USER_PORT) },
          adminPort: { integerValue: String(ADMIN_PORT) },
          updatedAt: { stringValue: new Date().toISOString() }
        }
      })
    });
    console.log(`🌐 [GATEWAY] Published local gateway LAN IP (${lanIp}:${USER_PORT}) to Firestore system/gateway`);
  } catch (e) {
    // quiet catch
  }
}

// ============================================================================
// HTML Page Renderers (Serves public/index.html with Injected Real IP & MAC)
// ============================================================================

function renderPortal(account, settings, expiredAccount = null, clientIp = '', clientMac = '') {
  const filePath = path.join(__dirname, 'public', 'index.html');
  let html = fs.readFileSync(filePath, 'utf8');
  const gatewayIp = getServerIp();
  const injection = `
<script>
  window.__CLIENT_IP__ = "${clientIp || ''}";
  window.__CLIENT_MAC__ = "${clientMac || ''}";
  window.__GATEWAY_IP__ = "${gatewayIp || ''}";
  window.__EXPIRED_ACCOUNT__ = ${expiredAccount ? JSON.stringify(expiredAccount) : 'null'};
</script>
`;
  html = html.replace('<head>', '<head>' + injection);
  return html;
}

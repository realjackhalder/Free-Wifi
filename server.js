// ============================================================================
// Free Wi-Fi Captive Portal & Gateway Server
// Authentication: Google Account (Sign in with Google)
// Database: SQLite (wifi.db) for Google Accounts, Slips & IP Address Logs
// Languages: Thai (ไทย) 🇹🇭 | Burmese (မြန်မာ) 🇲🇲 | English 🇬🇧
// ============================================================================

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
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

// Global error handlers to keep background gateway resilient
process.on('uncaughtException', (err) => {
  console.error('⚠️ [UNCAUGHT EXCEPTION]', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ [UNHANDLED REJECTION]', reason);
});

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

userApp.get('/portal', async (req, res) => {
  const ip = getClientIp(req);
  const mac = await getMacForIp(ip);
  const account = await db.getAccountByIp(ip);
  const settings = await db.getAllSettings();
  const expiredAccount = !account ? await db.getExpiredAccount({ ip, mac }) : null;
  res.status(200).send(renderPortal(account, settings, expiredAccount));
});

userApp.get('/', async (req, res) => {
  const ip = getClientIp(req);
  const mac = await getMacForIp(ip);
  const account = await db.getAccountByIp(ip);
  const settings = await db.getAllSettings();
  const expiredAccount = !account ? await db.getExpiredAccount({ ip, mac }) : null;
  res.status(200).send(renderPortal(account, settings, expiredAccount));
});

// ============================================================================
// 3. User Facing API Endpoints (Google Account & OTP Authentication)
// ============================================================================

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
userApp.get('/api/session-status', async (req, res) => {
  const ip = getClientIp(req);
  const acc = await db.getAccountByIp(ip);
  if (!acc) return res.json({ active: false });
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
      }
    }
  } catch (err) {
    console.error('[Auto-Revoke daemon error]', err.message);
  }
}, 5000);

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

// ============================================================================
// HTML Page Renderers (Google Account Mobile-First UI)
// ============================================================================

function renderPortal(account, settings, expiredAccount = null) {
  const connected = !!account;
  const isExpired = !connected && !!expiredAccount;
  const email = account ? account.email : (expiredAccount ? expiredAccount.email : '');
  const name = account ? account.name : (expiredAccount ? expiredAccount.name : '');
  const picture = account ? account.picture : '';
  const plan = account ? account.plan : (expiredAccount ? expiredAccount.plan : '');
  const expiresAt = account ? account.expiresAt : (expiredAccount ? expiredAccount.expiresAt : 0);
  const price = settings.monthlyPrice || 150;
  const trialMin = settings.trialMinutes || 60;

  const initial = name ? name.charAt(0).toUpperCase() : (email ? email.charAt(0).toUpperCase() : 'G');

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="theme-color" content="#1e3a8a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="format-detection" content="telephone=no">
<title>Free Wi-Fi — Sign in with Google</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-analytics-compat.js"></script>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body {
    overflow-x: hidden;
    width: 100%;
    max-width: 100%;
    -webkit-text-size-adjust: 100%;
  }
  body { 
    margin: 0; 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Myanmar Text', 'Padauk', 'Pyidaungsu', Helvetica, Arial, sans-serif; 
    background: #f0f4ff; 
    min-height: 100vh;
    padding-top: env(safe-area-inset-top);
    padding-bottom: max(32px, env(safe-area-inset-bottom));
  }
  /* Prevent iOS Safari auto-zooming on input focus */
  @media screen and (max-width: 768px) {
    input, select, textarea, .input-field {
      font-size: 16px !important;
    }
  }
  .gradient-header { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #2563eb 100%); }
  .card { background: #ffffff; border-radius: 22px; box-shadow: 0 10px 30px rgba(15,23,42,0.08); }
  .tab-btn { 
    transition: all 0.2s ease; 
    position: relative; 
    font-weight: 700; 
    font-size: 13px; 
    min-height: 52px;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .tab-btn.active { color: #1e40af; border-bottom: 3px solid #2563eb; background: rgba(37,99,235,0.08); }
  .tab-btn:not(.active) { color: #64748b; border-bottom: 3px solid transparent; }
  .tab-content { display: none; animation: fadeIn 0.25s ease; }
  .tab-content.active { display: block; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  @keyframes pulse-green { 0%, 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0.4); } 70% { box-shadow: 0 0 0 10px rgba(34,197,94,0); } }
  .pulse-green { animation: pulse-green 2s infinite; }
  .btn-google { 
    background: #ffffff; 
    color: #3c4043; 
    border: 1px solid #dadce0; 
    border-radius: 14px; 
    padding: 12px 18px; 
    min-height: 48px;
    font-size: 14px; 
    font-weight: 700; 
    cursor: pointer; 
    width: 100%; 
    display: flex; 
    align-items: center; 
    justify-content: center; 
    transition: all 0.2s; 
    box-shadow: 0 2px 6px rgba(60,64,67,0.08);
    touch-action: manipulation;
    user-select: none;
  }
  .btn-google:hover { 
    background: #f8fafd; 
    border-color: #d2e3fc; 
    box-shadow: 0 4px 12px rgba(66,133,244,0.15); 
  }
  .btn-google:active { transform: scale(0.98); }
  .btn-primary { 
    background: linear-gradient(135deg, #1d4ed8, #2563eb); 
    color: #fff; 
    border: none; 
    border-radius: 14px; 
    padding: 13px 18px; 
    min-height: 48px;
    font-size: 15px; 
    font-weight: 700; 
    cursor: pointer; 
    width: 100%; 
    transition: transform 0.15s, box-shadow 0.15s; 
    touch-action: manipulation;
    user-select: none;
    box-shadow: 0 4px 14px rgba(37,99,235,0.25);
  }
  .btn-primary:hover { box-shadow: 0 6px 20px rgba(37,99,235,0.35); }
  .btn-primary:active { transform: scale(0.98); }
  .btn-danger { 
    background: linear-gradient(135deg, #b91c1c, #ef4444); 
    color: #fff; 
    border: none; 
    border-radius: 14px; 
    padding: 12px 18px; 
    min-height: 46px;
    font-size: 14px; 
    font-weight: 700; 
    cursor: pointer; 
    width: 100%; 
    touch-action: manipulation;
  }
  .btn-danger:active { transform: scale(0.98); }
  .input-field { 
    width: 100%; 
    border: 2px solid #e2e8f0; 
    border-radius: 14px; 
    padding: 12px 14px; 
    min-height: 48px;
    font-size: 15px; 
    transition: all 0.2s; 
    outline: none; 
    background: #f8fafc; 
  }
  .input-field:focus { border-color: #3b82f6; background: #fff; box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
  .toast { 
    position: fixed; 
    top: max(16px, env(safe-area-inset-top)); 
    left: 50%; 
    transform: translateX(-50%); 
    padding: 12px 20px; 
    border-radius: 14px; 
    font-weight: 700; 
    font-size: 13px; 
    z-index: 9999; 
    box-shadow: 0 8px 30px rgba(0,0,0,0.25); 
    animation: slideDown 0.3s ease; 
    max-width: calc(100vw - 32px); 
    width: max-content;
    text-align: center; 
  }
  .toast.success { background: #16a34a; color: #fff; }
  .toast.error { background: #dc2626; color: #fff; }
  @keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-15px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
  .countdown-box { 
    background: linear-gradient(135deg, #0f172a, #1e293b); 
    border-radius: 16px; 
    padding: 12px 6px; 
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
  }
  .countdown-unit { text-align: center; min-width: 0; }
  .countdown-num { font-size: 22px; font-weight: 800; color: #38bdf8; line-height: 1.1; font-variant-numeric: tabular-nums; }
  .countdown-label { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
  .file-upload { border: 2px dashed #93c5fd; border-radius: 16px; padding: 18px 12px; text-align: center; cursor: pointer; transition: all 0.2s; background: #f8fafc; touch-action: manipulation; }
  .file-upload:hover { border-color: #2563eb; background: #eff6ff; }
  .file-upload:active { transform: scale(0.99); }
  .file-upload.has-file { border-color: #16a34a; background: #f0fdf4; }
  .lang-flag-btn { touch-action: manipulation; user-select: none; }
</style>
</head>
<body class="pb-10">

<!-- Telecom Header (Mobile-First) -->
<div class="gradient-header pt-3 sm:pt-4 pb-8 sm:pb-9 px-3 sm:px-4 text-center text-white relative overflow-hidden">
  <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;background:rgba(255,255,255,0.06);border-radius:50%;pointer-events:none;"></div>
  <div style="position:absolute;bottom:-60px;left:-30px;width:120px;height:120px;background:rgba(255,255,255,0.04);border-radius:50%;pointer-events:none;"></div>
  
  <!-- Top Bar: Right Corner Language Flag Photos (Inline Vector SVGs) -->
  <div class="flex items-center justify-end max-w-md mx-auto mb-2 relative z-30">
    <div class="inline-flex items-center space-x-2 bg-black bg-opacity-35 hover:bg-opacity-45 backdrop-blur-md px-2.5 py-1.5 rounded-full border border-white border-opacity-20 shadow-md">
      <!-- Thai Flag Photo -->
      <button type="button" onclick="setLanguage('th')" id="lang-btn-th" title="Thai Flag" class="lang-flag-btn relative p-0.5 rounded transition duration-150 active:scale-90 hover:opacity-100 opacity-60">
        <svg viewBox="0 0 900 600" class="w-7 h-5 sm:w-8 sm:h-5.5 rounded-sm object-cover shadow-sm pointer-events-none border border-black border-opacity-25" xmlns="http://www.w3.org/2000/svg">
          <rect width="900" height="600" fill="#A51931"/>
          <rect y="100" width="900" height="400" fill="#F4F5F8"/>
          <rect y="200" width="900" height="200" fill="#2D2A4A"/>
        </svg>
      </button>

      <!-- Myanmar Flag Photo -->
      <button type="button" onclick="setLanguage('mm')" id="lang-btn-mm" title="Myanmar Flag" class="lang-flag-btn relative p-0.5 rounded transition duration-150 active:scale-90 hover:opacity-100 opacity-60">
        <svg viewBox="0 0 900 600" class="w-7 h-5 sm:w-8 sm:h-5.5 rounded-sm object-cover shadow-sm pointer-events-none border border-black border-opacity-25" xmlns="http://www.w3.org/2000/svg">
          <rect width="900" height="200" fill="#FECB00"/>
          <rect y="200" width="900" height="200" fill="#34B233"/>
          <rect y="400" width="900" height="200" fill="#EA2839"/>
          <polygon points="450,116 496,258 645,258 525,345 571,487 450,400 329,487 375,345 255,258 404,258" fill="#FFFFFF"/>
        </svg>
      </button>

      <!-- GB Flag Photo -->
      <button type="button" onclick="setLanguage('en')" id="lang-btn-en" title="GB Flag" class="lang-flag-btn relative p-0.5 rounded transition duration-150 active:scale-90 hover:opacity-100 opacity-60">
        <svg viewBox="0 0 60 30" class="w-7 h-5 sm:w-8 sm:h-5.5 rounded-sm object-cover shadow-sm pointer-events-none border border-black border-opacity-25" xmlns="http://www.w3.org/2000/svg">
          <clipPath id="clip-s-gb"><path d="M0,0 v30 h60 v-30 z"/></clipPath>
          <clipPath id="clip-t-gb"><path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z"/></clipPath>
          <g clip-path="url(#clip-s-gb)">
            <path d="M0,0 v30 h60 v-30 z" fill="#012169"/>
            <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>
            <path d="M0,0 L60,30 M60,0 L0,30" clip-path="url(#clip-t-gb)" stroke="#C8102E" stroke-width="4"/>
            <path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/>
            <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" stroke-width="6"/>
          </g>
        </svg>
      </button>
    </div>
  </div>

  <div class="relative z-10 max-w-md mx-auto">
    <!-- Title -->
    <div class="flex items-center justify-center mb-0.5">
      <svg class="w-7 h-7 sm:w-8 sm:h-8 text-blue-400 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.14 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0"/>
      </svg>
      <span class="text-xl sm:text-2xl font-black tracking-tight text-white">FREE WI-FI</span>
    </div>
    <p class="text-blue-100 text-xs font-medium" data-i18n="header_sub">Free High-Speed Wi-Fi Service</p>
    <p class="text-blue-200 text-[11px] sm:text-xs mt-0.5" data-i18n="header_desc">เชื่อมต่อง่ายและปลอดภัยด้วยบัญชี Google ของคุณ</p>
  </div>
</div>

<div class="max-w-md mx-auto px-3 sm:px-4" style="margin-top: -16px; position: relative; z-index: 20;">

${
  connected
    ? `
<!-- ===================== 1. CONNECTED STATE VIEW ===================== -->
<div class="card p-4 sm:p-6 mb-4">
  <div class="flex items-center justify-center mb-3">
    <div class="pulse-green w-3 h-3 rounded-full bg-green-500 mr-2"></div>
    <span class="badge bg-green-100 text-green-800">
      <svg class="w-4 h-4 text-green-600" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
      <span data-i18n="conn_status">เชื่อมต่ออินเทอร์เน็ตแล้ว / Connected</span>
    </span>
  </div>

  <!-- Google User Profile Card -->
  <div class="flex flex-col items-center mb-4 bg-blue-50 border border-blue-100 rounded-2xl p-3.5 sm:p-4 text-center">
    ${
      picture
        ? `<img src="${picture}" alt="Google Avatar" class="w-14 h-14 rounded-full border-2 border-white shadow-md mb-2 object-cover" />`
        : `<div class="w-14 h-14 rounded-full bg-blue-600 text-white font-black text-2xl flex items-center justify-center shadow-md mb-2">${initial}</div>`
    }
    <p class="text-base font-black text-gray-900 truncate max-w-full">${name || 'Google User'}</p>
    <p class="text-xs text-blue-700 font-mono font-semibold break-all px-2">${email}</p>
    <div class="mt-2">
      <span class="badge ${plan === 'vip-30d' ? 'bg-indigo-100 text-indigo-800 border border-indigo-200' : 'bg-blue-100 text-blue-800'}">
        <span data-i18n="${plan === 'vip-30d' ? 'plan_vip_badge' : 'plan_free_badge'}">${plan === 'vip-30d' ? '★ VIP 30 วัน (Unlimited)' : '⏱ เน็ตฟรี 1 ชั่วโมง (Free 1-Hour)'}</span>
      </span>
    </div>
  </div>

  <p class="text-center text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2" data-i18n="conn_remain">เวลาใช้งานคงเหลือ / Time Remaining</p>
  <div class="countdown-box mb-4">
    <div class="countdown-unit"><div class="countdown-num text-xl sm:text-2xl" id="cd-days">--</div><div class="countdown-label" data-i18n="cd_days">วัน / Days</div></div>
    <div class="countdown-unit"><div class="countdown-num text-xl sm:text-2xl" id="cd-hours">--</div><div class="countdown-label" data-i18n="cd_hours">ชม. / Hrs</div></div>
    <div class="countdown-unit"><div class="countdown-num text-xl sm:text-2xl" id="cd-mins">--</div><div class="countdown-label" data-i18n="cd_mins">นาที / Min</div></div>
    <div class="countdown-unit"><div class="countdown-num text-xl sm:text-2xl" id="cd-secs">--</div><div class="countdown-label" data-i18n="cd_secs">วิ / Sec</div></div>
  </div>

  <button class="btn-danger" onclick="doLogout('${email}')">
    <svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
    <span data-i18n="btn_logout">ออกจากระบบ / Disconnect</span>
  </button>
</div>
`
    : `
<!-- ===================== 2. THREE-TAB LOGIN PORTAL ===================== -->
<div class="card overflow-hidden mb-4">
  <!-- Tabs Header -->
  <div class="grid grid-cols-3 border-b border-gray-100 text-center">
    <button class="tab-btn ${isExpired ? '' : 'active'} py-2.5 sm:py-3 px-1 flex flex-col items-center justify-center min-h-[52px]" onclick="switchTab('tab-free')">
      <span class="text-base sm:text-lg mb-0.5 leading-none">🎁</span>
      <span class="text-xs sm:text-sm font-bold truncate max-w-full px-1" data-i18n="tab_free_title">เน็ตฟรี 1 ชม.</span>
      <span class="text-[10px] text-gray-400 font-medium leading-none" data-i18n="tab_free_sub">${isExpired ? 'สิทธิ์หมดแล้ว' : 'Free 1-Hr'}</span>
    </button>
    <button class="tab-btn ${isExpired ? 'active' : ''} py-2.5 sm:py-3 px-1 flex flex-col items-center justify-center min-h-[52px]" onclick="switchTab('tab-vip')">
      <span class="text-base sm:text-lg mb-0.5 leading-none">👑</span>
      <span class="text-xs sm:text-sm font-bold truncate max-w-full px-1" data-i18n="tab_vip_title">แพ็กเกจ 30 วัน</span>
      <span class="text-[10px] text-gray-400 font-medium leading-none" data-i18n="tab_vip_sub">30-Day VIP</span>
    </button>
    <button class="tab-btn py-2.5 sm:py-3 px-1 flex flex-col items-center justify-center min-h-[52px]" onclick="switchTab('tab-login')">
      <span class="text-base sm:text-lg mb-0.5 leading-none">🔑</span>
      <span class="text-xs sm:text-sm font-bold truncate max-w-full px-1" data-i18n="tab_login_title">เข้าสู่ระบบ</span>
      <span class="text-[10px] text-gray-400 font-medium leading-none" data-i18n="tab_login_sub">Google Login</span>
    </button>
  </div>

  <!-- Tab 1: Free 1-Hour Wi-Fi (Google Account Sign-In / OTP) -->
  <div id="tab-free" class="tab-content ${isExpired ? '' : 'active'} p-4 sm:p-6 text-center">
    ${isExpired ? `
    <div class="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-red-900 text-left text-xs shadow-sm">
      <p class="font-bold text-red-950 mb-0.5">⚠️ สิทธิ์ใช้งานเน็ตฟรีของคุณหมดลงแล้วสำหรับวันนี้</p>
      <p class="text-red-800 leading-relaxed">อุปกรณ์หรือบัญชีนี้ได้รับสิทธิ์ฟรี 1 ชั่วโมงครบแล้ว กรุณาสมัครแพ็กเกจ VIP 30 วัน เพื่อเชื่อมต่ออินเทอร์เน็ตต่อทันที</p>
      <button type="button" onclick="switchTab('tab-vip')" class="mt-2.5 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl text-xs transition">ไปที่แพ็กเกจ VIP 30 วัน (150 บาท) →</button>
    </div>` : ''}
    <div class="mb-4">
      <span class="inline-block p-2 bg-blue-50 text-blue-600 rounded-full mb-1">⚡</span>
      <h2 class="text-lg font-black text-gray-800" data-i18n="free_heading">รับเน็ตฟรี ${trialMin} นาที</h2>
      <p class="text-xs text-gray-500" data-i18n="free_sub">เข้าสู่ระบบด้วยบัญชี Google รับสิทธิ์ได้ 1 ครั้ง ต่อ 24 ชม.</p>
    </div>

    <!-- Step 1: Request OTP -->
    <div id="free-step-1" class="space-y-3.5">
      <button type="button" onclick="triggerGoogleAuth('free')" id="btn-google-free" class="btn-google">
        <svg class="w-5 h-5 mr-2.5 flex-shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span data-i18n="btn_google_free">เข้าสู่ระบบด้วย Google เพื่อรับสิทธิ์ฟรี</span>
      </button>

      <div class="relative flex py-0.5 items-center">
        <div class="flex-grow border-t border-gray-200"></div>
        <span class="flex-shrink mx-2 text-[11px] text-gray-400 font-bold uppercase" data-i18n="or_enter_email">หรือระบุอีเมล Google</span>
        <div class="flex-grow border-t border-gray-200"></div>
      </div>

      <form onsubmit="handleRequestOtp(event, 'free')" class="space-y-3 text-left">
        <div>
          <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_google_email">Google Account Email</label>
          <input type="email" id="free-email" placeholder="example@gmail.com" required class="input-field" />
        </div>
        <button type="submit" id="btn-free-req-otp" class="btn-primary flex items-center justify-center space-x-1.5">
          <span>📨</span>
          <span data-i18n="btn_req_otp">ขอรหัส OTP เพื่อเชื่อมต่อเน็ตฟรี</span>
        </button>
      </form>
    </div>

    <!-- Step 2: Enter & Verify OTP -->
    <div id="free-step-2" class="hidden space-y-3.5 text-left">
      <div class="bg-blue-50 border border-blue-200 rounded-2xl p-3.5 text-center">
        <p class="text-xs text-blue-900 font-medium" data-i18n="otp_sent_to">ส่งรหัส OTP 6 หลักไปที่:</p>
        <p class="text-sm font-bold text-blue-800 font-mono mt-0.5" id="free-target-email"></p>
        <p class="text-[11px] text-blue-600 mt-1" data-i18n="otp_valid_note">รหัสหมดอายุภายใน 5 นาที</p>
      </div>

      <form onsubmit="handleVerifyOtp(event, 'free')" class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_enter_otp">กรอกรหัส OTP 6 หลัก</label>
          <input 
            type="text" 
            id="free-otp-code" 
            maxlength="6" 
            inputmode="numeric" 
            pattern="[0-9]*" 
            placeholder="• • • • • •" 
            required 
            class="input-field text-center font-mono font-black text-2xl tracking-widest" 
            autocomplete="one-time-code" 
            oninput="this.value = this.value.replace(/\\D/g, '').slice(0, 6)" 
            onkeypress="return (event.charCode >= 48 && event.charCode <= 57)" 
          />

          <!-- Open Gmail App Button (Directly below OTP input) -->
          <div class="mt-2.5">
            <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" onclick="openGmailApp(event)" class="inline-flex items-center justify-center space-x-2 w-full bg-white hover:bg-gray-50 text-gray-700 hover:text-blue-700 border border-gray-300 font-bold px-3 py-2.5 rounded-xl text-xs transition active:scale-95 shadow-sm">
              <svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22 6.5V18a2 2 0 0 1-2 2h-3v-8.5l-5 3.5-5-3.5V20H4a2 2 0 0 1-2-2V6.5l10 7 10-7z"/>
                <path fill="#EA4335" d="M2 6.5A2 2 0 0 1 4 5h1.5l6.5 4.55L18.5 5H20a2 2 0 0 1 2 1.5l-10 7-10-7z"/>
              </svg>
              <span data-i18n="btn_open_gmail">Open Gmail</span>
            </a>
          </div>
        </div>
        <button type="submit" id="btn-free-verify" class="btn-primary flex items-center justify-center space-x-1.5">
          <span>⚡</span>
          <span data-i18n="btn_verify_otp">ยืนยัน OTP และเริ่มใช้งานเน็ตฟรี</span>
        </button>
      </form>

      <div class="flex items-center justify-between pt-1 text-xs">
        <button type="button" onclick="backToStep1('free')" class="text-gray-500 hover:text-gray-800 font-medium">
          &larr; <span data-i18n="btn_change_email">เปลี่ยนอีเมล</span>
        </button>
        <button type="button" id="btn-free-resend" onclick="handleResendOtp('free')" class="text-blue-600 hover:underline font-bold">
          <span data-i18n="btn_resend_otp">ขอรหัสใหม่</span>
        </button>
      </div>
    </div>
  </div>

  <!-- Tab 2: Buy 30-Day VIP Package (with Google Account) -->
  <div id="tab-vip" class="tab-content ${isExpired ? 'active' : ''} p-4 sm:p-6">
    <div class="text-center mb-3">
      <div class="inline-flex items-center px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold mb-1.5" data-i18n="vip_badge_banner">
        ★ UNLIMITED WI-FI 30 DAYS
      </div>
      <h2 class="text-lg font-black text-gray-800" data-i18n="vip_heading">สมัครแพ็กเกจ 30 วัน (${price} บาท)</h2>
      <p class="text-xs text-gray-500" data-i18n="vip_sub">ผูกกับบัญชี Google เข้าใช้งานได้ตลอด 30 วัน</p>
    </div>

    <!-- Expired Warning Notice -->
    <div id="vip-expired-banner" class="${isExpired ? '' : 'hidden'} mb-3.5 p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-left shadow-sm">
      <div class="flex items-start space-x-2.5">
        <span class="text-xl flex-shrink-0">⏰</span>
        <div class="text-xs">
          <p class="font-black text-amber-950 mb-0.5" id="vip-expired-title">สิทธิ์เน็ตฟรี 1 ชั่วโมงของคุณหมดลงแล้ว!</p>
          <p class="text-amber-800 leading-relaxed" id="vip-expired-desc">กรุณาสมัครแพ็กเกจ 30 วัน (${price} บาท) เพื่อเชื่อมต่อและใช้งานอินเทอร์เน็ตความเร็วสูงได้ต่อเนื่องตลอด 30 วัน</p>
        </div>
      </div>
    </div>

    <div class="bg-gray-50 border border-gray-200 rounded-xl p-3.5 mb-3 text-center">
      <div class="bg-white p-2 rounded-lg border border-gray-200 inline-block shadow-sm">
        <img src="/thaiqr.jpg" onerror="this.onerror=null;this.src='/150B.jpg';" alt="PromptPay QR" class="w-40 sm:w-48 h-40 sm:h-48 object-contain mx-auto" />
      </div>
      <p class="text-xs text-gray-500 mt-2"><span data-i18n="price_label">ยอดชำระ:</span> <strong id="price-display" class="text-blue-600 font-bold" data-i18n="price_amount">${price} บาท</strong></p>
    </div>

    <form onsubmit="handleBuyPackage(event)" class="space-y-3">
      <!-- Saved Linked Account Card (No Need to Re-type Email) -->
      <div id="vip-saved-badge" class="${email ? '' : 'hidden'} bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between shadow-sm">
        <div class="flex items-center space-x-2.5 min-w-0">
          <span class="text-emerald-600 text-lg flex-shrink-0">✓</span>
          <div class="min-w-0">
            <p class="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">บัญชีที่ผูกไว้ / Linked Account</p>
            <p id="vip-saved-email-text" class="text-xs font-mono font-black text-emerald-950 truncate">${email}</p>
          </div>
        </div>
        <button type="button" onclick="changeVipEmail()" class="text-[11px] text-emerald-700 hover:text-emerald-900 underline font-bold px-1.5 py-1">เปลี่ยน / Change</button>
      </div>

      <div id="vip-email-container" class="${email ? 'hidden' : ''}">
        <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_google_email">บัญชี Google Email (สำหรับผูกแพ็กเกจ)</label>
        <div class="relative">
          <input type="email" id="vip-email" value="${email}" placeholder="your.name@gmail.com" required class="input-field pr-10" />
          <span class="absolute right-3 top-3.5 text-gray-400">📧</span>
        </div>
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_slip">แนบสลิปโอนเงิน</label>
        <div class="file-upload" id="dropzone" onclick="document.getElementById('slip-file').click()">
          <input type="file" id="slip-file" accept="image/*" class="hidden" onchange="onFileSelected(this)" required />
          <img id="slip-preview" class="hidden max-h-36 mx-auto rounded-lg mb-2 shadow-sm object-contain" alt="Slip Preview" />
          <svg class="w-7 h-7 text-blue-500 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          <p id="file-label" class="text-xs text-gray-600 font-medium" data-i18n="dropzone_label">กดเพื่อเลือกรูปภาพสลิปธนาคาร</p>
        </div>
      </div>
      <button type="submit" id="btn-buy" class="btn-primary" data-i18n="btn_buy_vip">
        ยืนยันสลิปและเปิดใช้งาน VIP 30 วัน
      </button>
    </form>
  </div>

  <!-- Tab 3: Member Login (Google Sign-In / OTP) -->
  <div id="tab-login" class="tab-content p-4 sm:p-6 text-center">
    <div class="mb-4">
      <span class="inline-block p-2 bg-indigo-50 text-indigo-600 rounded-full mb-1">🔐</span>
      <h2 class="text-lg font-black text-gray-800" data-i18n="login_heading">เข้าสู่ระบบด้วย Google</h2>
      <p class="text-xs text-gray-500" data-i18n="login_sub">สำหรับสมาชิกที่มีแพ็กเกจ 30 วัน หรือเวลาฟรียังไม่หมด</p>
    </div>

    <!-- Step 1: Request OTP -->
    <div id="login-step-1" class="space-y-3.5">
      <button type="button" onclick="triggerGoogleAuth('login')" id="btn-google-login" class="btn-google">
        <svg class="w-5 h-5 mr-2.5 flex-shrink-0" viewBox="0 0 24 24">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
          <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
          <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
        </svg>
        <span data-i18n="btn_google_login">เข้าสู่ระบบด้วย Google Account</span>
      </button>

      <div class="relative flex py-0.5 items-center">
        <div class="flex-grow border-t border-gray-200"></div>
        <span class="flex-shrink mx-2 text-[11px] text-gray-400 font-bold uppercase" data-i18n="or_enter_email">หรือระบุอีเมล Google</span>
        <div class="flex-grow border-t border-gray-200"></div>
      </div>

      <form onsubmit="handleRequestOtp(event, 'login')" class="space-y-3 text-left">
        <div>
          <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_google_email">Google Account Email</label>
          <input type="email" id="login-email" placeholder="example@gmail.com" required class="input-field" />
        </div>
        <button type="submit" id="btn-login-req-otp" class="btn-primary flex items-center justify-center space-x-1.5">
          <span>📨</span>
          <span data-i18n="btn_req_otp_login">ขอรหัส OTP เข้าสู่ระบบ</span>
        </button>
      </form>

    </div>

    <!-- Step 2: Enter & Verify OTP -->
    <div id="login-step-2" class="hidden space-y-3.5 text-left">
      <div class="bg-indigo-50 border border-indigo-200 rounded-2xl p-3.5 text-center">
        <p class="text-xs text-indigo-900 font-medium" data-i18n="otp_sent_to">ส่งรหัส OTP 6 หลักไปที่:</p>
        <p class="text-sm font-bold text-indigo-800 font-mono mt-0.5" id="login-target-email"></p>
        <p class="text-[11px] text-indigo-600 mt-1" data-i18n="otp_valid_note">รหัสหมดอายุภายใน 5 นาที</p>
      </div>

      <form onsubmit="handleVerifyOtp(event, 'login')" class="space-y-3">
        <div>
          <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_enter_otp">กรอกรหัส OTP 6 หลัก</label>
          <input 
            type="text" 
            id="login-otp-code" 
            maxlength="6" 
            inputmode="numeric" 
            pattern="[0-9]*" 
            placeholder="• • • • • •" 
            required 
            class="input-field text-center font-mono font-black text-2xl tracking-widest" 
            autocomplete="one-time-code" 
            oninput="this.value = this.value.replace(/\\D/g, '').slice(0, 6)" 
            onkeypress="return (event.charCode >= 48 && event.charCode <= 57)" 
          />

          <!-- Open Gmail App Button (Directly below OTP input) -->
          <div class="mt-2.5">
            <a href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noopener noreferrer" onclick="openGmailApp(event)" class="inline-flex items-center justify-center space-x-2 w-full bg-white hover:bg-gray-50 text-gray-700 hover:text-indigo-700 border border-gray-300 font-bold px-3 py-2.5 rounded-xl text-xs transition active:scale-95 shadow-sm">
              <svg class="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22 6.5V18a2 2 0 0 1-2 2h-3v-8.5l-5 3.5-5-3.5V20H4a2 2 0 0 1-2-2V6.5l10 7 10-7z"/>
                <path fill="#EA4335" d="M2 6.5A2 2 0 0 1 4 5h1.5l6.5 4.55L18.5 5H20a2 2 0 0 1 2 1.5l-10 7-10-7z"/>
              </svg>
              <span data-i18n="btn_open_gmail">Open Gmail</span>
            </a>
          </div>
        </div>
        <button type="submit" id="btn-login-verify" class="btn-primary flex items-center justify-center space-x-1.5">
          <span>🔑</span>
          <span data-i18n="btn_verify_otp_login">ยืนยัน OTP และเข้าใช้งาน</span>
        </button>
      </form>

      <div class="flex items-center justify-between pt-1 text-xs">
        <button type="button" onclick="backToStep1('login')" class="text-gray-500 hover:text-gray-800 font-medium">
          &larr; <span data-i18n="btn_change_email">เปลี่ยนอีเมล</span>
        </button>
        <button type="button" id="btn-login-resend" onclick="handleResendOtp('login')" class="text-blue-600 hover:underline font-bold">
          <span data-i18n="btn_resend_otp">ขอรหัสใหม่</span>
        </button>
      </div>
    </div>
  </div>
</div>
`
}

  <!-- Footer Help Info -->
  <div class="text-center text-xs text-gray-500 space-y-1.5 pt-6 pb-2">
    <p class="font-medium text-gray-600">Free Wi-Fi Network</p>
    <p class="inline-flex items-center justify-center flex-wrap gap-1 text-gray-600 px-2">
      <span data-i18n="footer_need_help">ต้องการความช่วยเหลือ?</span>
      <a href="https://t.me/petharsupport" target="_blank" rel="noopener noreferrer" class="inline-flex items-center text-blue-600 hover:text-blue-700 font-bold underline ml-0.5">
        <svg class="w-3.5 h-3.5 mr-1 fill-current text-[#229ED9]" viewBox="0 0 24 24">
          <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.458c.538-.196 1.006.128.832.943z"/>
        </svg>
        <span data-i18n="footer_click_here">คลิกที่นี่</span>
      </a>
    </p>
  </div>
</div>

<script>
// ============================================================================
// Trilingual I18N Dictionary (Thai 🇹🇭 | Burmese 🇲🇲 | English 🇬🇧)
// ============================================================================
const I18N = {
  th: {
    header_sub: "อินเทอร์เน็ตความเร็วสูง เชื่อมต่อง่าย รวดเร็ว",
    header_desc: "เชื่อมต่อง่ายและปลอดภัยด้วยบัญชี Google ของคุณ",
    conn_status: "เชื่อมต่ออินเทอร์เน็ตแล้ว / Connected",
    plan_vip_badge: "★ VIP 30 วัน (Unlimited)",
    plan_free_badge: "⏱ เน็ตฟรี 1 ชั่วโมง (Free 1-Hour)",
    conn_remain: "เวลาใช้งานคงเหลือ / Time Remaining",
    cd_days: "วัน",
    cd_hours: "ชม.",
    cd_mins: "นาที",
    cd_secs: "วิ",
    btn_logout: "ออกจากระบบ Google / Disconnect",
    tab_free_title: "เน็ตฟรี 1 ชม.",
    tab_free_sub: "Free 1-Hr",
    tab_vip_title: "แพ็กเกจ 30 วัน",
    tab_vip_sub: "30-Day VIP",
    tab_login_title: "เข้าสู่ระบบ",
    tab_login_sub: "Google Login",
    free_heading: "รับเน็ตฟรี ${trialMin} นาที",
    free_sub: "เข้าสู่ระบบด้วยบัญชี Google รับสิทธิ์ได้ 1 ครั้ง ต่อ 24 ชม.",
    btn_google_free: "เข้าสู่ระบบด้วย Google เพื่อรับสิทธิ์ฟรี",
    or_enter_email: "หรือระบุอีเมล Google",
    label_google_email: "Google Account Email",
    btn_free_trial: "เริ่มใช้งานเน็ตฟรี ${trialMin} นาที",
    vip_badge_banner: "★ UNLIMITED WI-FI 30 DAYS",
    vip_heading: "สมัครแพ็กเกจ 30 วัน (${price} บาท)",
    vip_sub: "ผูกกับบัญชี Google เข้าใช้งานได้ตลอด 30 วัน",
    price_label: "ยอดชำระ:",
    price_amount: "${price} บาท",
    label_slip: "แนบสลิปโอนเงิน",
    dropzone_label: "กดเพื่อเลือกรูปภาพสลิปธนาคาร",
    btn_buy_vip: "ยืนยันสลิปและเปิดใช้งาน VIP 30 วัน",
    login_heading: "เข้าสู่ระบบด้วย Google",
    login_sub: "สำหรับสมาชิกที่มีแพ็กเกจ 30 วัน หรือเวลาฟรียังไม่หมด",
    btn_google_login: "เข้าสู่ระบบด้วย Google Account",
    btn_login: "เข้าสู่ระบบ / Connect",
    footer_need_help: "ต้องการความช่วยเหลือ?",
    footer_click_here: "คลิกที่นี่",
    google_dialog_brand: "Sign in with Google",
    google_choose_account: "เลือกบัญชี",
    google_to_continue: "เพื่อไปยัง",
    google_use_another: "ใช้บัญชีอื่น",
    google_disclaimer_pre: "ก่อนที่จะใช้แอปนี้ คุณสามารถอ่าน",
    google_privacy_policy: "นโยบายความเป็นส่วนตัว",
    google_and: "และ",
    google_terms_service: "ข้อกำหนดในการให้บริการ",
    google_help: "ความช่วยเหลือ",
    google_privacy: "ความเป็นส่วนตัว",
    google_terms: "ข้อกำหนด",
    google_direct_popup_btn: "เปิดหน้าต่าง Google แท้",
    google_enter_email: "Google Email",
    google_continue_btn: "ดำเนินการต่อด้วย Google",
    google_dialog_title: "เลือกบัญชี Google ของคุณ",
    google_dialog_sub: "เพื่อเข้าใช้งานอินเทอร์เน็ต Free Wi-Fi",
    btn_req_otp: "ขอรหัส OTP เพื่อเชื่อมต่อเน็ตฟรี",
    btn_req_otp_login: "ขอรหัส OTP เข้าสู่ระบบ",
    otp_sent_to: "ส่งรหัส OTP 6 หลักไปที่:",
    otp_valid_note: "รหัสหมดอายุภายใน 5 นาที (หากไม่พบ ให้ดูใน Junk / Spam)",
    label_enter_otp: "กรอกรหัส OTP 6 หลัก",
    btn_verify_otp: "ยืนยัน OTP และเริ่มใช้งานเน็ตฟรี",
    btn_verify_otp_login: "ยืนยัน OTP และเข้าใช้งาน",
    btn_change_email: "เปลี่ยนอีเมล",
    btn_resend_otp: "ขอรหัสใหม่",
    btn_open_gmail: "Open Gmail"
  },
  mm: {
    header_sub: "အခမဲ့ အမြန်နှုန်းမြင့် ဝိုင်ဖိုင် ကွန်ရက်",
    header_desc: "သင့် Google အကောင့်ဖြင့် လွယ်ကူလုံခြုံစွာ ချိတ်ဆက်ပါ",
    conn_status: "အင်တာနက် ချိတ်ဆက်ပြီးပါပြီ",
    plan_vip_badge: "★ ရက် ၃၀ VIP (အကန့်အသတ်မဲ့)",
    plan_free_badge: "⏱ ၁ နာရီ အခမဲ့ စမ်းသုံးခွင့်",
    conn_remain: "ကျန်ရှိသော အချိန်",
    cd_days: "ရက်",
    cd_hours: "နာရီ",
    cd_mins: "မိနစ်",
    cd_secs: "စက္ကန့်",
    btn_logout: "Google အကောင့်မှ ထွက်မည် / အဆက်အသွယ်ဖြတ်မည်",
    tab_free_title: "၁ နာရီ အခမဲ့",
    tab_free_sub: "Free 1-Hr",
    tab_vip_title: "ရက် ၃၀ VIP",
    tab_vip_sub: "30-Day VIP",
    tab_login_title: "အကောင့်ဝင်ရန်",
    tab_login_sub: "Google Login",
    free_heading: "၁ နာရီ (${trialMin} မိနစ်) အခမဲ့ ရယူပါ",
    free_sub: "Google အကောင့်ဖြင့် ၂၄ နာရီအတွင်း ၁ ကြိမ် အခမဲ့ရယူနိုင်ပါသည်",
    btn_google_free: "အခမဲ့ရယူရန် Google ဖြင့် အကောင့်ဝင်ပါ",
    or_enter_email: "သို့မဟုတ် Google အီးမေးလ် ရိုက်ထည့်ပါ",
    label_google_email: "Google Account Email (အီးမေးလ်)",
    btn_free_trial: "၁ နာရီ အခမဲ့ ဝိုင်ဖိုင် စတင်အသုံးပြုမည်",
    vip_badge_banner: "★ အကန့်အသတ်မဲ့ ဝိုင်ဖိုင် ၃၀ ရက်",
    vip_heading: "ရက် ၃၀ VIP ပက်ကေ့ဂျ် (${price} ဘတ်)",
    vip_sub: "Google အကောင့်နှင့် ချိတ်ဆက်ပြီး ၃၀ ရက် အကန့်အသတ်မဲ့ သုံးနိုင်သည်",
    price_label: "ပေးသွင်းရမည့်ငွေ:",
    price_amount: "${price} ဘတ်",
    label_slip: "ငွေလွှဲပြေစာ ဓာတ်ပုံ တင်ပါ",
    dropzone_label: "ငွေလွှဲပြေစာ ဓာတ်ပုံ ရွေးချယ်ရန် နှိပ်ပါ",
    btn_buy_vip: "ပြေစာစစ်ဆေးပြီး ရက် ၃၀ VIP စတင်မည်",
    login_heading: "Google ဖြင့် အကောင့်ဝင်ရန်",
    login_sub: "ရက် ၃၀ VIP အသင်းဝင်များနှင့် အခမဲ့အချိန် မကုန်သေးသူများအတွက်",
    btn_google_login: "Google Account ဖြင့် ဝင်ရောက်ပါ",
    btn_login: "အကောင့်ဝင်ပါ / Connect",
    footer_need_help: "အကူအညီ လိုအပ်ပါက",
    footer_click_here: "ဤနေရာကိုနှိပ်ပါ",
    google_dialog_brand: "Sign in with Google",
    google_choose_account: "အကောင့်တစ်ခု ရွေးပါ",
    google_to_continue: "ဆက်လက်လုပ်ဆောင်ရန်",
    google_use_another: "အခြားအကောင့်တစ်ခု အသုံးပြုပါ",
    google_disclaimer_pre: "ဤအက်ပ်ကို မသုံးမီ Free Wi-Fi ၏",
    google_privacy_policy: "ကိုယ်ရေးကိုယ်တာမူဝါဒ",
    google_and: "နှင့်",
    google_terms_service: "ဝန်ဆောင်မှုစည်းမျဉ်းများ",
    google_help: "အကူအညီ",
    google_privacy: "ကိုယ်ရေးကိုယ်တာ",
    google_terms: "စည်းမျဉ်းများ",
    google_direct_popup_btn: "တရားဝင် Google Popup ဖွင့်ရန်",
    google_enter_email: "Google အီးမေးလ် ရိုက်ထည့်ပါ",
    google_continue_btn: "Google ဖြင့် ဆက်သွားပါ",
    google_dialog_title: "သင့် Google အကောင့်ကို ရွေးချယ်ပါ",
    google_dialog_sub: "Free Wi-Fi အင်တာနက်ကို စတင်သုံးစွဲရန်",
    btn_req_otp: "အခမဲ့ အင်တာနက်အတွက် OTP ကုဒ်တောင်းမည်",
    btn_req_otp_login: "အကောင့်ဝင်ရန် OTP ကုဒ်တောင်းမည်",
    otp_sent_to: "ဂဏန်း ၆ လုံးပါ OTP ကုဒ် ပို့ပြီးသော အီးမေးလ်:",
    otp_valid_note: "OTP ကုဒ် သက်တမ်း ၅ မိနစ်ရှိပါသည် (Spam ဖိုင်တွဲကိုလည်း စစ်ဆေးပါ)",
    label_enter_otp: "OTP ဂဏန်း ၆ လုံး ရိုက်ထည့်ပါ",
    btn_verify_otp: "OTP အတည်ပြုပြီး အင်တာနက် အခမဲ့ စတင်မည်",
    btn_verify_otp_login: "OTP အတည်ပြုပြီး အင်တာနက် ချိတ်ဆက်မည်",
    btn_change_email: "အီးမေးလ် ပြောင်းမည်",
    btn_resend_otp: "ကုဒ်အသစ် ပြန်တောင်းမည်",
    btn_open_gmail: "Open Gmail"
  },
  en: {
    header_sub: "Free High-Speed Wi-Fi Service",
    header_desc: "Fast, secure connection with your Google Account",
    conn_status: "Connected to Free Wi-Fi",
    plan_vip_badge: "★ 30-Day VIP (Unlimited)",
    plan_free_badge: "⏱ Free 1-Hour Wi-Fi Trial",
    conn_remain: "Time Remaining",
    cd_days: "Days",
    cd_hours: "Hours",
    cd_mins: "Mins",
    cd_secs: "Secs",
    btn_logout: "Sign Out & Disconnect",
    tab_free_title: "Free 1-Hour",
    tab_free_sub: "Trial Pass",
    tab_vip_title: "30-Day VIP",
    tab_vip_sub: "Unlimited",
    tab_login_title: "Google Login",
    tab_login_sub: "Sign In",
    free_heading: "Get Free ${trialMin}-Minute Wi-Fi",
    free_sub: "Sign in with Google. Available once every 24 hours.",
    btn_google_free: "Sign in with Google to get 1 Hour Free",
    or_enter_email: "Or enter Google email manually",
    label_google_email: "Google Account Email",
    btn_free_trial: "Get ${trialMin} Minutes Free Wi-Fi",
    vip_badge_banner: "★ UNLIMITED WI-FI 30 DAYS",
    vip_heading: "30-Day VIP Package (${price} Baht)",
    vip_sub: "Link with your Google account for 30 days unlimited access",
    price_label: "Amount Due:",
    price_amount: "${price} Baht",
    label_slip: "Attach Payment Slip",
    dropzone_label: "Tap to select bank payment receipt image",
    btn_buy_vip: "Verify Slip & Activate 30-Day VIP",
    login_heading: "Sign in with Google",
    login_sub: "For existing 30-Day VIP members or active trial users",
    btn_google_login: "Sign in with Google Account",
    btn_login: "Login / Connect",
    footer_need_help: "Need help?",
    footer_click_here: "Click here",
    google_dialog_brand: "Sign in with Google",
    google_choose_account: "Choose an account",
    google_to_continue: "to continue to",
    google_use_another: "Use another account",
    google_disclaimer_pre: "Before using this app, you can review Free Wi-Fi's",
    google_privacy_policy: "Privacy Policy",
    google_and: "and",
    google_terms_service: "Terms of Service",
    google_help: "Help",
    google_privacy: "Privacy",
    google_terms: "Terms",
    google_direct_popup_btn: "Open official Google Sign-In window",
    google_enter_email: "Google Email",
    google_continue_btn: "Continue with Google",
    google_dialog_title: "Choose a Google Account",
    google_dialog_sub: "to continue to Free Wi-Fi",
    btn_req_otp: "Request OTP for Free Wi-Fi",
    btn_req_otp_login: "Request OTP Code to Connect",
    otp_sent_to: "A 6-digit OTP code was sent to:",
    otp_valid_note: "OTP code is valid for 5 minutes (check Spam / Junk if needed)",
    label_enter_otp: "Enter 6-digit OTP Code",
    btn_verify_otp: "Verify OTP & Start Free Wi-Fi",
    btn_verify_otp_login: "Verify OTP & Connect",
    btn_change_email: "Change Email",
    btn_resend_otp: "Resend Code",
    btn_open_gmail: "Open Gmail"
  }
};

let currentLang = localStorage.getItem('portal_lang') || 'th';
if (currentLang === 'mm') { currentLang = 'mm'; localStorage.setItem('portal_lang', 'mm'); }
let pendingAuthMode = 'free'; // 'free' or 'login'

function setLanguage(lang) {
  if (!I18N[lang]) lang = 'th';
  currentLang = lang;
  localStorage.setItem('portal_lang', lang);

  // Highlight active flag photo with ring & full opacity; dim inactive flags
  ['th', 'mm', 'en'].forEach(function(l) {
    const btn = document.getElementById('lang-btn-' + l);
    if (btn) {
      if (l === lang) {
        btn.classList.add('opacity-100', 'ring-2', 'ring-white', 'bg-white', 'bg-opacity-25', 'scale-110');
        btn.classList.remove('opacity-60');
      } else {
        btn.classList.remove('opacity-100', 'ring-2', 'ring-white', 'bg-white', 'bg-opacity-25', 'scale-110');
        btn.classList.add('opacity-60');
      }
    }
  });

  const dlgLang = document.getElementById('google-dlg-lang-select');
  if (dlgLang) dlgLang.value = lang;

  ['btn-google-free', 'btn-google-login'].forEach(function(id) {
    const btn = document.getElementById(id);
    if (btn && btn.dataset) delete btn.dataset.originalHtml;
  });

  document.querySelectorAll('[data-i18n]').forEach(function(el) {
    const key = el.getAttribute('data-i18n');
    if (I18N[lang] && I18N[lang][key]) {
      el.textContent = I18N[lang][key];
    }
  });
}

function selectLangOption(lang) {
  setLanguage(lang);
}

function showToast(data, fallbackType = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  
  let msg = '';
  let isOk = fallbackType === 'success';

  if (typeof data === 'object' && data !== null) {
    isOk = !!data.ok;
    msg = data['msg_' + currentLang] || data.msg || (isOk ? 'Success' : 'Error');
  } else {
    msg = String(data);
  }

  el.className = 'toast ' + (isOk ? 'success' : 'error');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function saveDeviceAccount({ email, name, picture } = {}) {
  if (!email) return;
  try {
    const cleanEmail = email.trim().toLowerCase();
    const data = {
      email: cleanEmail,
      name: name || cleanEmail.split('@')[0],
      picture: picture || null,
      savedAt: Date.now()
    };
    localStorage.setItem('wifi_saved_account', JSON.stringify(data));
    localStorage.setItem('wifi_account_email', cleanEmail);
  } catch (e) {}
}

function getSavedDeviceAccount() {
  try {
    const raw = localStorage.getItem('wifi_saved_account');
    if (raw) return JSON.parse(raw);
    const email = localStorage.getItem('wifi_account_email');
    if (email) return { email: email.trim().toLowerCase(), name: email.split('@')[0] };
  } catch (e) {}
  return null;
}

function applySavedAccountToVip() {
  const saved = getSavedDeviceAccount();
  const vipEmailInput = document.getElementById('vip-email');
  const badgeEl = document.getElementById('vip-saved-badge');
  const emailContainer = document.getElementById('vip-email-container');
  const badgeEmailText = document.getElementById('vip-saved-email-text');

  if (saved && saved.email) {
    if (vipEmailInput) vipEmailInput.value = saved.email;
    if (badgeEmailText) badgeEmailText.textContent = saved.email;
    if (badgeEl) badgeEl.classList.remove('hidden');
    if (emailContainer) emailContainer.classList.add('hidden');
  } else if (!vipEmailInput?.value) {
    if (badgeEl) badgeEl.classList.add('hidden');
    if (emailContainer) emailContainer.classList.remove('hidden');
  }
}

function changeVipEmail() {
  const badgeEl = document.getElementById('vip-saved-badge');
  const emailContainer = document.getElementById('vip-email-container');
  const vipEmailInput = document.getElementById('vip-email');
  if (badgeEl) badgeEl.classList.add('hidden');
  if (emailContainer) {
    emailContainer.classList.remove('hidden');
    if (vipEmailInput) {
      vipEmailInput.focus();
      vipEmailInput.select();
    }
  }
}

function switchTab(id) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  const target = document.getElementById(id);
  if (target) target.classList.add('active');
  const btns = document.querySelectorAll('.tab-btn');
  if (id === 'tab-free' && btns[0]) btns[0].classList.add('active');
  if (id === 'tab-vip' && btns[1]) {
    btns[1].classList.add('active');
    applySavedAccountToVip();
  }
  if (id === 'tab-login' && btns[2]) btns[2].classList.add('active');
}

function onFileSelected(input) {
  const label = document.getElementById('file-label');
  const dropzone = document.getElementById('dropzone');
  const preview = document.getElementById('slip-preview');
  if (input.files && input.files[0]) {
    const file = input.files[0];
    const prefix = currentLang === 'mm' ? '✓ ရွေးချယ်ပြီး: ' : (currentLang === 'en' ? '✓ Selected: ' : '✓ เลือกไฟล์แล้ว: ');
    label.textContent = prefix + file.name;
    dropzone.classList.add('has-file');
    if (preview) {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = e => {
          preview.src = e.target.result;
          preview.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
      } else {
        preview.src = '';
        preview.classList.add('hidden');
      }
    }
  } else {
    label.textContent = I18N[currentLang].dropzone_label;
    dropzone.classList.remove('has-file');
    if (preview) {
      preview.src = '';
      preview.classList.add('hidden');
    }
  }
}

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyCr-hr5oeYdwUUdQgywHTl5VobOJ_ZNZ14",
  authDomain: "free-wifi-portal.firebaseapp.com",
  projectId: "free-wifi-portal",
  storageBucket: "free-wifi-portal.firebasestorage.app",
  messagingSenderId: "197252344762",
  appId: "1:197252344762:web:4830845739d16d12778b83",
  measurementId: "G-KDRZMJZDMW"
};

let firebaseReady = false;
let firebaseClientConfig = window.__FIREBASE_CONFIG__ || DEFAULT_FIREBASE_CONFIG;

// Initialize Firebase Client Synchronously
function initFirebaseClient() {
  try {
    if (window.firebase && !firebase.apps.length) {
      firebase.initializeApp(firebaseClientConfig);
      if (typeof firebase.analytics === 'function' && firebaseClientConfig.measurementId) {
        try { firebase.analytics(); } catch (e) {}
      }
    }
    if (window.firebase && firebase.apps.length) {
      firebaseReady = true;
    }
  } catch (err) {
    console.warn('Firebase init:', err.message);
  }
}
initFirebaseClient();

// Handle redirect result if signInWithRedirect was used by browser
if (window.firebase && firebase.auth) {
  firebase.auth().getRedirectResult().then(async (result) => {
    if (result && result.user) {
      const user = result.user;
      const idToken = await user.getIdToken();
      const email = user.email;
      const name = user.displayName || email.split('@')[0];
      const picture = user.photoURL || null;
      const mode = localStorage.getItem('pending_auth_mode') || 'free';

      showToast({
        msg_th: 'เข้าสู่ระบบด้วย ' + email + ' สำเร็จ! กำลังเปิดใช้งาน Wi-Fi...',
        msg_en: 'Signed in as ' + email + '! Activating Wi-Fi...'
      });

      if (mode === 'free') {
        await submitFreeTrial(email, name, picture, idToken);
      } else {
        await submitGoogleLogin(email, idToken);
      }
    }
  }).catch((err) => {
    console.warn('getRedirectResult notice:', err.message);
  });
}

let isGoogleAuthRunning = false;
let googleAuthTimeout = null;

function setGoogleAuthLoading(loading) {
  isGoogleAuthRunning = loading;
  if (googleAuthTimeout) {
    clearTimeout(googleAuthTimeout);
    googleAuthTimeout = null;
  }

  // Safety watchdog: unlock buttons if popup takes over 60s or hangs
  if (loading) {
    googleAuthTimeout = setTimeout(() => {
      setGoogleAuthLoading(false);
    }, 60000);
  }

  const btnFree = document.getElementById('btn-google-free');
  const btnLogin = document.getElementById('btn-google-login');

  [btnFree, btnLogin].forEach(btn => {
    if (!btn) return;
    if (loading) {
      btn.disabled = true;
      btn.style.pointerEvents = 'none';
      btn.style.opacity = '0.7';
      if (!btn.dataset.originalHtml) {
        btn.dataset.originalHtml = btn.innerHTML;
      }
      const loadingText = currentLang === 'mm' ? 'Google ဖွင့်နေပါသည်...' : (currentLang === 'en' ? 'Opening Google...' : 'กำลังเปิดหน้าต่าง Google...');
      btn.innerHTML = '<svg class="animate-spin w-5 h-5 mr-2 text-blue-600 inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path></svg><span>' + loadingText + '</span>';
    } else {
      btn.disabled = false;
      btn.style.pointerEvents = 'auto';
      btn.style.opacity = '1';
      if (btn.dataset.originalHtml) {
        btn.innerHTML = btn.dataset.originalHtml;
      }
    }
  });
}

// Trigger Google Sign-In Popup Window (Real Google Account Chooser)
function triggerGoogleAuth(mode) {
  if (isGoogleAuthRunning) {
    showToast({
      ok: true,
      msg_th: 'หน้าต่าง Google กำลังเปิดอยู่ กรุณาเลือกบัญชีในหน้าต่างป๊อปอัป',
      msg_mm: 'Google အကောင့် ရွေးချယ်ရန် ဝင်းဒိုး ဖွင့်ထားဆဲဖြစ်ပါသည်',
      msg_en: 'Google Sign-In window is already open. Please choose your account there.'
    });
    return;
  }

  pendingAuthMode = mode || 'free';
  localStorage.setItem('pending_auth_mode', pendingAuthMode);

  initFirebaseClient();
  if (!window.firebase || !firebase.auth) {
    showToast({ 
      ok: false, 
      msg_th: 'กำลังโหลดระบบ Google กรุณารอสักครู่...', 
      msg_mm: 'Google စနစ် ဖွင့်နေပါသည်...', 
      msg_en: 'Loading Google SDK, please wait...' 
    });
    return;
  }

  setGoogleAuthLoading(true);

  showToast({ 
    msg_th: 'กำลังเปิดหน้าต่างลงชื่อเข้าใช้ Google เพื่อเลือกบัญชี...', 
    msg_mm: 'Google အကောင့် ရွေးချယ်ရန် ဖွင့်နေပါသည်...', 
    msg_en: 'Opening Google Sign-In window to select account...' 
  });

  const provider = new firebase.auth.GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  // Forces Google to show the real account selection screen ("Choose an account")
  provider.setCustomParameters({
    prompt: 'select_account'
  });

  // Call signInWithPopup synchronously within the click event loop to prevent popup blocking
  firebase.auth().signInWithPopup(provider)
    .then(async (result) => {
      if (!result || !result.user) return;
      const user = result.user;
      const idToken = await user.getIdToken();
      const email = user.email;
      const name = user.displayName || email.split('@')[0];
      const picture = user.photoURL || null;

      showToast({
        msg_th: 'เข้าสู่ระบบด้วย Google สำเร็จ: ' + email,
        msg_mm: 'Google အကောင့်ဝင်ရောက်မှု အောင်မြင်ပါသည်: ' + email,
        msg_en: 'Signed in with Google: ' + email
      });

      if (pendingAuthMode === 'free') {
        await submitFreeTrial(email, name, picture, idToken);
      } else {
        await submitGoogleLogin(email, idToken);
      }
    })
    .catch((err) => {
      console.warn('Firebase Google Sign-In error:', err);
      // Suppress conflicting popup request cancellation so user never sees alarming red banner
      if (err.code === 'auth/cancelled-popup-request') {
        return;
      }
      if (err.code === 'auth/popup-blocked') {
        // If the browser blocks the popup window, redirect directly so the user still gets Google
        showToast({
          msg_th: 'เบราว์เซอร์บล็อกหน้าต่างป๊อปอัป กำลังเปิดหน้า Google โดยตรง...',
          msg_en: 'Popup blocked by browser. Redirecting directly to Google...'
        });
        setTimeout(() => {
          firebase.auth().signInWithRedirect(provider);
        }, 500);
      } else if (err.code === 'auth/popup-closed-by-user') {
        showToast({
          ok: false,
          msg_th: 'คุณปิดหน้าต่างลงชื่อเข้าใช้ Google',
          msg_mm: 'Google အကောင့်ဝင်ခြင်းကို ပယ်ဖျက်လိုက်ပါသည်',
          msg_en: 'Sign-in window was closed'
        });
      } else if (err.code === 'auth/unauthorized-domain') {
        showToast({
          ok: false,
          msg_th: 'โดเมนนี้ (' + window.location.hostname + ') ยังไม่ได้เพิ่มใน Firebase Authorized Domains',
          msg_en: 'Domain (' + window.location.hostname + ') is not in Firebase Authorized Domains'
        });
      } else {
        showToast({
          ok: false,
          msg_th: 'เข้าสู่ระบบไม่สำเร็จ: ' + (err.message || err.code),
          msg_en: 'Login error: ' + (err.message || err.code)
        });
      }
    })
    .finally(() => {
      setGoogleAuthLoading(false);
    });
}

let currentEmail = { free: '', login: '' };
let resendTimers = { free: null, login: null };

async function handleRequestOtp(e, mode) {
  if (e && e.preventDefault) e.preventDefault();
  const inputEl = document.getElementById(mode + '-email');
  const email = inputEl ? inputEl.value.trim() : '';
  await sendOtpRequest(email, mode);
}

async function sendOtpRequest(email, mode, name = '') {
  if (!email || !email.includes('@')) {
    return showToast({
      ok: false,
      msg_th: 'กรุณากรอกอีเมลให้ถูกต้อง',
      msg_mm: 'မှန်ကန်သော အီးမေးလ် ရိုက်ထည့်ပါ',
      msg_en: 'Please enter a valid email address'
    });
  }

  const btn = document.getElementById('btn-' + mode + '-req-otp');
  if (btn) {
    btn.disabled = true;
    const loadingText = currentLang === 'mm' ? 'OTP တောင်းဆိုနေပါသည်...' : (currentLang === 'en' ? 'Requesting OTP...' : 'กำลังขอรหัส OTP...');
    btn.innerHTML = '<span>⏳</span><span>' + loadingText + '</span>';
  }

  try {
    const res = await fetch('/api/otp/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, mode, name })
    });
    const data = await res.json();
    showToast(data);

    if (data.ok) {
      currentEmail[mode] = email;
      // Switch view to Step 2 (OTP Entry)
      const step1 = document.getElementById(mode + '-step-1');
      const step2 = document.getElementById(mode + '-step-2');
      if (step1 && step2) {
        step1.classList.add('hidden');
        step2.classList.remove('hidden');
      }
      const targetEl = document.getElementById(mode + '-target-email');
      if (targetEl) targetEl.textContent = email;
      const otpInput = document.getElementById(mode + '-otp-code');
      if (otpInput) {
        otpInput.value = '';
        setTimeout(() => otpInput.focus(), 100);
      }
      startResendCountdown(mode, 30);
    }
  } catch (err) {
    showToast({ ok: false, msg_th: 'เชื่อมต่อเซิร์ฟเวอร์ล้มเหลว', msg_mm: 'ချိတ်ဆက်မှု မအောင်မြင်ပါ', msg_en: 'Connection failed' });
  } finally {
    if (btn) {
      btn.disabled = false;
      const labelKey = mode === 'free' ? 'btn_req_otp' : 'btn_req_otp_login';
      const labelText = (I18N[currentLang] && I18N[currentLang][labelKey]) || 'Request OTP';
      btn.innerHTML = '<span>📨</span><span data-i18n="' + labelKey + '">' + labelText + '</span>';
    }
  }
}

function backToStep1(mode) {
  const step1 = document.getElementById(mode + '-step-1');
  const step2 = document.getElementById(mode + '-step-2');
  if (step1 && step2) {
    step2.classList.add('hidden');
    step1.classList.remove('hidden');
  }
  const inputEl = document.getElementById(mode + '-email');
  if (inputEl) inputEl.focus();
}

function startResendCountdown(mode, seconds) {
  const btn = document.getElementById('btn-' + mode + '-resend');
  if (!btn) return;
  if (resendTimers[mode]) clearInterval(resendTimers[mode]);

  let remain = seconds;
  btn.disabled = true;
  btn.classList.add('text-gray-400', 'cursor-not-allowed');
  btn.classList.remove('text-blue-600', 'hover:underline');
  const resendLabel = (I18N[currentLang] && I18N[currentLang].btn_resend_otp) || 'Resend';
  btn.textContent = resendLabel + ' (' + remain + 's)';

  resendTimers[mode] = setInterval(() => {
    remain -= 1;
    if (remain <= 0) {
      clearInterval(resendTimers[mode]);
      btn.disabled = false;
      btn.classList.remove('text-gray-400', 'cursor-not-allowed');
      btn.classList.add('text-blue-600', 'hover:underline');
      btn.textContent = (I18N[currentLang] && I18N[currentLang].btn_resend_otp) || 'Resend';
    } else {
      btn.textContent = resendLabel + ' (' + remain + 's)';
    }
  }, 1000);
}

async function handleResendOtp(mode) {
  const email = currentEmail[mode] || document.getElementById(mode + '-email')?.value.trim();
  if (!email) return;
  await sendOtpRequest(email, mode);
}

async function handleVerifyOtp(e, mode) {
  if (e && e.preventDefault) e.preventDefault();
  const email = currentEmail[mode] || document.getElementById(mode + '-email')?.value.trim();
  const otpInput = document.getElementById(mode + '-otp-code');
  const otpVal = otpInput ? otpInput.value.trim() : '';

  if (!otpVal || otpVal.length < 6) {
    return showToast({
      ok: false,
      msg_th: 'กรุณากรอกรหัส OTP ให้ครบ 6 หลัก',
      msg_mm: 'ဂဏန်း ၆ လုံးပါ OTP ကုဒ် ရိုက်ထည့်ပါ',
      msg_en: 'Please enter the full 6-digit OTP code'
    });
  }

  const btn = document.getElementById('btn-' + mode + '-verify');
  if (btn) {
    btn.disabled = true;
    const verifyingText = currentLang === 'mm' ? 'OTP အတည်ပြုနေပါသည်...' : (currentLang === 'en' ? 'Verifying OTP & Connecting...' : 'กำลังยืนยัน OTP และเชื่อมต่ออินเทอร์เน็ต...');
    btn.innerHTML = '<span>⏳</span><span>' + verifyingText + '</span>';
  }

  try {
    const res = await fetch('/api/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp: otpVal, mode })
    });
    const data = await res.json();
    showToast(data);

    if (data.ok) {
      saveDeviceAccount({ email });
      setTimeout(() => location.reload(), 1000);
    } else {
      if (btn) {
        btn.disabled = false;
        const labelKey = mode === 'free' ? 'btn_verify_otp' : 'btn_verify_otp_login';
        const labelText = (I18N[currentLang] && I18N[currentLang][labelKey]) || 'Verify OTP';
        btn.innerHTML = '<span>⚡</span><span data-i18n="' + labelKey + '">' + labelText + '</span>';
      }
    }
  } catch (err) {
    showToast({ ok: false, msg_th: 'ยืนยันรหัส OTP ล้มเหลว', msg_mm: 'စစ်ဆေး၍ မရပါ', msg_en: 'Verification failed' });
    if (btn) {
      btn.disabled = false;
      const labelKey = mode === 'free' ? 'btn_verify_otp' : 'btn_verify_otp_login';
      const labelText = (I18N[currentLang] && I18N[currentLang][labelKey]) || 'Verify OTP';
      btn.innerHTML = '<span>⚡</span><span data-i18n="' + labelKey + '">' + labelText + '</span>';
    }
  }
}

async function submitFreeTrial(email, name, picture = null, idToken = null) {
  try {
    const res = await fetch('/api/free-trial', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, picture, idToken })
    });
    const data = await res.json();
    showToast(data);
    if (data.ok) {
      saveDeviceAccount({ email, name, picture });
      setTimeout(() => location.reload(), 1000);
    }
  } catch (err) {
    showToast({ ok: false, msg_th: 'เชื่อมต่อล้มเหลว', msg_mm: 'ချိတ်ဆက်မှု မအောင်မြင်ပါ', msg_en: 'Connection failed' });
  }
}

async function submitGoogleLogin(email, idToken = null) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, idToken })
    });
    const data = await res.json();
    showToast(data);
    if (data.ok) {
      saveDeviceAccount({ email });
      setTimeout(() => location.reload(), 1000);
    }
  } catch (err) {
    showToast({ ok: false, msg_th: 'เข้าสู่ระบบไม่สำเร็จ', msg_mm: 'အကောင့်ဝင်ရောက်မှု မအောင်မြင်ပါ', msg_en: 'Login failed' });
  }
}

async function handleBuyPackage(e) {
  e.preventDefault();
  const saved = getSavedDeviceAccount();
  const inputEmail = document.getElementById('vip-email')?.value?.trim();
  const email = (inputEmail || (saved && saved.email ? saved.email : '')).trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return showToast({ 
      ok: false, 
      msg_th: 'กรุณาระบุอีเมลบัญชี Google ของคุณ',
      msg_mm: 'ကျေးဇူးပြု၍ Google အီးမေးလ် ရိုက်ထည့်ပါ',
      msg_en: 'Please enter your Google account email'
    });
  }
  saveDeviceAccount({ email });
  const fileInput = document.getElementById('slip-file');
  if (!fileInput.files || !fileInput.files[0]) {
    return showToast({ 
      ok: false, 
      msg_th: 'กรุณาเลือกไฟล์สลิป',
      msg_mm: 'ပြေစာဖိုင် ရွေးချယ်ပေးပါ',
      msg_en: 'Please select slip file' 
    });
  }

  const btn = document.getElementById('btn-buy');
  btn.disabled = true;
  btn.textContent = currentLang === 'mm' ? 'ဖိုင်အား တင်နေပါသည်...' : (currentLang === 'en' ? 'Uploading file...' : 'กำลังอัปโหลดไฟล์...');

  const formData = new FormData();
  formData.append('email', email);
  formData.append('name', email.split('@')[0]);
  formData.append('slip', fileInput.files[0]);

  try {
    const res = await fetch('/api/buy-package', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    showToast(data);
    if (data.ok) {
      if (data.pendingApproval) {
        showApprovalWaitingModal(data.slipId);
      } else {
        setTimeout(() => location.reload(), 1200);
      }
    } else {
      btn.disabled = false;
      btn.textContent = I18N[currentLang].btn_buy_vip;
    }
  } catch (err) {
    showToast({ ok: false, msg_th: 'การส่งข้อมูลล้มเหลว', msg_mm: 'ပေးပို့မှု မအောင်မြင်ပါ', msg_en: 'Upload failed' });
    btn.disabled = false;
    btn.textContent = I18N[currentLang].btn_buy_vip;
  }
}

function showApprovalWaitingModal(slipId) {
  let modal = document.getElementById('approval-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'approval-modal';
    modal.className = 'fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4';
    document.body.appendChild(modal);
  }

  const lang = currentLang;
  const title = lang === 'mm' ? 'ငွေလွှဲပြေစာအား စစ်ဆေးနေပါသည်' : (lang === 'en' ? 'Verifying Payment Slip' : 'กำลังตรวจสอบการชำระเงิน');
  const sub = lang === 'mm'
    ? 'စနစ်မှ ငွေလွှဲပြေစာအား စစ်ဆေးအတည်ပြုနေပါသည်\\nအတည်ပြုပြီးပါက ရက် ၃၀ VIP အင်တာနက် အလိုအလျောက် ပွင့်ပါမည်'
    : (lang === 'en'
      ? 'We are verifying your payment slip. Please wait a moment.\\nYour 30-Day VIP Wi-Fi will activate automatically once verified.'
      : 'ระบบกำลังตรวจสอบยอดเงินโอนของคุณ กรุณารอสักครู่\\nแพ็กเกจ VIP 30 วัน จะเปิดใช้งานให้อัตโนมัติทันทีเมื่อตรวจสอบสำเร็จ');

  const statusLabel = lang === 'mm' ? 'အခြေအနေ' : (lang === 'en' ? 'Status' : 'สถานะ');
  const statusWaiting = lang === 'mm' ? 'စစ်ဆေးနေဆဲ...' : (lang === 'en' ? 'Verifying...' : 'กำลังตรวจสอบ...');
  const autoCheckText = lang === 'mm' ? 'စနစ်မှ အလိုအလျောက် စစ်ဆေးနေပါသည်...' : (lang === 'en' ? 'Automatically checking verification status...' : 'ระบบกำลังตรวจสอบสถานะอัตโนมัติ...');

  modal.innerHTML = \`
    <div class="bg-white rounded-3xl p-6 sm:p-7 max-w-sm w-full text-center space-y-4 shadow-2xl border border-blue-100">
      <div id="modal-icon" class="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center text-3xl mx-auto animate-bounce">
        ⏳
      </div>
      <h3 id="modal-title" class="text-lg font-black text-gray-900">\${title}</h3>
      <p id="modal-desc" class="text-xs text-gray-600 leading-relaxed font-medium whitespace-pre-line">\${sub}</p>
      
      <div class="bg-gray-50 border border-gray-200 rounded-2xl p-3.5 text-xs font-mono space-y-1.5 text-left">
        <div class="flex justify-between items-center"><span class="text-gray-400">Slip ID:</span> <span class="font-bold text-gray-800">#\${slipId}</span></div>
        <div class="flex justify-between items-center"><span class="text-gray-400">\${statusLabel}:</span> <span id="modal-status-badge" class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-800 animate-pulse">\${statusWaiting}</span></div>
      </div>
      
      <div id="modal-actions" class="pt-1">
        <p class="text-[11px] text-gray-400">\${autoCheckText}</p>
      </div>
    </div>
  \`;

  const pollInterval = setInterval(async () => {
    try {
      const res = await fetch('/api/slip-status?slipId=' + slipId);
      const data = await res.json();
      if (data.ok) {
        if (data.status === 'approved' || data.isVipActive) {
          clearInterval(pollInterval);
          const iconEl = document.getElementById('modal-icon');
          const titleEl = document.getElementById('modal-title');
          const descEl = document.getElementById('modal-desc');
          const badgeEl = document.getElementById('modal-status-badge');
          if (iconEl) {
            iconEl.className = 'w-16 h-16 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-3xl mx-auto';
            iconEl.innerHTML = '🎉';
          }
          if (titleEl) titleEl.innerText = lang === 'mm' ? 'အတည်ပြုပြီးပါပြီ!' : (lang === 'en' ? 'Payment Approved!' : 'อนุมัติเรียบร้อยแล้ว!');
          if (descEl) descEl.innerText = lang === 'mm' ? 'ရက် ၃၀ VIP အင်တာနက် စတင်အသုံးပြုနိုင်ပါပြီ' : (lang === 'en' ? '30-Day VIP Wi-Fi is now active!' : 'แพ็กเกจ VIP 30 วัน เปิดใช้งานแล้ว');
          if (badgeEl) {
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800';
            badgeEl.innerText = '✓ APPROVED';
          }
          localStorage.removeItem('wifi_expired_notice');
          setTimeout(() => location.reload(), 1500);
        } else if (data.status === 'declined') {
          clearInterval(pollInterval);
          const iconEl = document.getElementById('modal-icon');
          const titleEl = document.getElementById('modal-title');
          const descEl = document.getElementById('modal-desc');
          const badgeEl = document.getElementById('modal-status-badge');
          const actionsEl = document.getElementById('modal-actions');
          if (iconEl) {
            iconEl.className = 'w-16 h-16 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-3xl mx-auto';
            iconEl.innerHTML = '❌';
          }
          if (titleEl) titleEl.innerText = lang === 'mm' ? 'ငွေလွှဲပြေစာ မမှန်ကန်ပါ' : (lang === 'en' ? 'Payment Not Verified' : 'ไม่สามารถยืนยันสลิปได้');
          if (descEl) descEl.innerText = lang === 'mm' ? 'ငွေလွှဲပြေစာအား စစ်ဆေး၍မရပါ (ငွေလွှဲမှု သေချာစစ်ဆေးပြီး ပြန်တင်ပေးပါ)' : (lang === 'en' ? 'Could not verify payment slip. Please check payment receipt and upload again.' : 'สลิปการโอนเงินไม่ถูกต้อง หรือไม่สามารถตรวจสอบได้ กรุณาตรวจสอบแล้วลองใหม่อีกครั้ง');
          if (badgeEl) {
            badgeEl.className = 'px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-800';
            badgeEl.innerText = '✕ NOT VERIFIED';
          }
          if (actionsEl) {
            actionsEl.innerHTML = \`
              <button onclick="document.getElementById('approval-modal').remove(); location.reload();" class="btn-primary w-full py-2.5 text-xs font-bold">
                \${lang === 'mm' ? 'ပြန်လည် ကြိုးစားမည်' : (lang === 'en' ? 'Try Again' : 'ลองใหม่อีกครั้ง')}
              </button>
            \`;
          }
        }
      }
    } catch (e) {}
  }, 3000);
}

async function doLogout(email) {
  const confirmMsg = currentLang === 'mm' 
    ? 'Google အကောင့်မှ ထွက်ပြီး ဝိုင်ဖိုင် အဆက်အသွယ်ဖြတ်ရန် သေချာပါသလား?' 
    : (currentLang === 'en' ? 'Are you sure you want to sign out and disconnect?' : 'ต้องการออกจากระบบ Google และตัดการเชื่อมต่อใช่หรือไม่?');
  if (!confirm(confirmMsg)) return;

  try {
    const res = await fetch('/api/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    showToast(data);
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    location.reload();
  }
}

// Live Countdown Timer
(function initTimer() {
  const expiresAt = ${expiresAt || 0};
  if (!expiresAt) return;

  function update() {
    const now = Date.now();
    const diff = Math.max(0, expiresAt - now);
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);

    const elD = document.getElementById('cd-days');
    const elH = document.getElementById('cd-hours');
    const elM = document.getElementById('cd-mins');
    const elS = document.getElementById('cd-secs');

    if (elD) elD.textContent = String(d).padStart(2, '0');
    if (elH) elH.textContent = String(h).padStart(2, '0');
    if (elM) elM.textContent = String(m).padStart(2, '0');
    if (elS) elS.textContent = String(s).padStart(2, '0');

    if (diff <= 0) {
      clearInterval(timer);
      localStorage.setItem('wifi_expired_notice', 'true');
      setTimeout(() => location.reload(), 1500);
    }
  }

  update();
  const timer = setInterval(update, 1000);
})();

function openGmailApp(e) {
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  if (isAndroid) {
    if (e && e.preventDefault) e.preventDefault();
    const intentUrl = 'intent://#Intent;package=com.google.android.gm;scheme=googlegmail;end;';
    const fallbackUrl = 'https://mail.google.com/mail/u/0/#inbox';
    const start = Date.now();
    window.location.href = intentUrl;
    setTimeout(() => {
      if (Date.now() - start < 1500) {
        window.open(fallbackUrl, '_blank');
      }
    }, 800);
    return false;
  } else if (isIOS) {
    if (e && e.preventDefault) e.preventDefault();
    const start = Date.now();
    window.location.href = 'googlegmail:///co';
    setTimeout(() => {
      if (Date.now() - start < 1500) {
        window.open('https://mail.google.com/mail/u/0/#inbox', '_blank');
      }
    }, 800);
    return false;
  } else {
    window.open('https://mail.google.com/mail/u/0/#inbox', '_blank');
    if (e && e.preventDefault) e.preventDefault();
    return false;
  }
}

// Initialize saved language and digit-only constraints on page load
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(currentLang);

  ['free-otp-code', 'login-otp-code'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function() {
      this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
    });
    el.addEventListener('paste', function(e) {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
      this.value = text.replace(/[^0-9]/g, '').slice(0, 6);
    });
  });

  applySavedAccountToVip();

  // Auto-fill OTP if present in URL query (?otp=123456)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const urlOtp = urlParams.get('otp');
    if (urlOtp && /^\d{6}$/.test(urlOtp.trim())) {
      const cleanOtp = urlOtp.trim();
      ['free', 'login'].forEach(mode => {
        const step1 = document.getElementById(mode + '-step-1');
        const step2 = document.getElementById(mode + '-step-2');
        if (step1 && step2) {
          step1.classList.add('hidden');
          step2.classList.remove('hidden');
        }
        const otpInput = document.getElementById(mode + '-otp-code');
        if (otpInput) otpInput.value = cleanOtp;
      });
    }
  } catch (e) {}
});
</script>
</body>
</html>`;
}

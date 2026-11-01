// ============================================================================
// Free Wi-Fi Captive Portal & Gateway Server
// Authentication: Google Account (Sign in with Google)
// Database: SQLite (wifi.db) for Google Accounts, Slips & IP Address Logs
// Languages: Thai (ไทย) 🇹🇭 | Burmese (မြန်မာ) 🇲🇲 | English 🇬🇧
// ============================================================================

const express = require('express');
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

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 10 * 1024 * 1024 } });

// Apply shared body parsing & static asset handling to both servers
[adminApp, userApp].forEach((instance) => {
  instance.use(express.urlencoded({ extended: true }));
  instance.use(express.json());
  instance.use(express.static(PUBLIC_DIR));
  instance.use('/public', express.static(PUBLIC_DIR));
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
// 1. OS Auto-Popup Captive Portal Detection (Critical CNA Routes)
// ============================================================================

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

// User App: Forward /admin requests to Admin Server on port 3000
userApp.all('/admin*', (req, res) => {
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

// ============================================================================
// 2. Telecom-Style Portal Route (GET /portal & GET / on Port 3001)
// ============================================================================

userApp.get('/portal', async (req, res) => {
  const ip = getClientIp(req);
  const account = await db.getAccountByIp(ip);
  const settings = await db.getAllSettings();
  res.status(200).send(renderPortal(account, settings));
});

userApp.get('/', async (req, res) => {
  const ip = getClientIp(req);
  const account = await db.getAccountByIp(ip);
  const settings = await db.getAllSettings();
  res.status(200).send(renderPortal(account, settings));
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
userApp.post('/api/buy-package', upload.single('slip'), async (req, res) => {
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
        msg_th: 'กรุณาแนบรูปภาพสลิปโอนเงิน',
        msg_mm: 'ကျေးဇူးပြု၍ ငွေလွှဲပြေစာ ဓာတ်ပုံ တင်ပေးပါ',
        msg_en: 'Please upload bank transfer slip screenshot'
      });
    }

    // Scan bank slip image for mini-QR code
    let qrPayload = null;
    try {
      const image = await Jimp.read(req.file.path);
      const { data, width, height } = image.bitmap;
      const qr = jsQR(new Uint8ClampedArray(data), width, height);
      if (qr && qr.data) qrPayload = qr.data.trim();
    } catch (imgErr) {
      console.error('[buy-package] Jimp/jsQR error:', imgErr.message);
    }

    if (!qrPayload || qrPayload.length < 25) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.json({
        ok: false,
        msg_th: 'ไม่พบ QR Code ธนาคารในสลิป หรือสลิปไม่ชัดเจน กรุณาอัปโหลดสลิปใหม่',
        msg_mm: 'ပြေစာတွင် ဘဏ် QR ကုဒ် မတွေ့ပါ သို့မဟုတ် ပုံမကြည်လင်ပါ။ ပြေစာအသစ် ပြန်တင်ပေးပါ',
        msg_en: 'No valid bank QR code found in slip. Please upload a clear bank receipt.'
      });
    }

    // Check if slip is already used
    const alreadyUsed = await db.isSlipUsed(qrPayload);
    if (alreadyUsed) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.json({
        ok: false,
        msg_th: 'สลิปนี้ถูกใช้งานไปแล้ว ไม่สามารถใช้ซ้ำได้',
        msg_mm: 'ဤငွေလွှဲပြေစာကို အသုံးပြုပြီးဖြစ်ပါသည်',
        msg_en: 'This payment slip has already been used.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);
    const mac = await getMacForIp(ip);
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const settings = await db.getAllSettings();
    const existing = await db.getAccount(cleanEmail);

    // Save slip screenshot to uploads directory
    const slipExt = path.extname(req.file.originalname) || '.jpg';
    const slipName = `slip_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}_${now}${slipExt}`;
    const slipDest = path.join(UPLOAD_DIR, slipName);
    fs.renameSync(req.file.path, slipDest);

    // Upload slip to Firebase Cloud Storage if active
    let cloudUrl = null;
    if (fb.isReady()) {
      cloudUrl = await fb.uploadSlipToStorage(slipDest, slipName, req.file.mimetype || 'image/jpeg');
    }

    // 1. Record Slip & IP Address in Firestore & SQLite Database
    await db.recordSlip({
      email: cleanEmail,
      ip,
      mac,
      filename: slipName,
      cloudUrl,
      qrPayload,
      amount: settings.monthlyPrice || 150,
      status: 'verified'
    });

    // 2. Log IP action in SQLite Database
    await db.logIpAction({ email: cleanEmail, ip, mac, action: 'buy_package' });

    // 3. Save Account in SQLite Database
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
      msg_th: 'ตรวจสอบสลิปสำเร็จ! ผูกบัญชี Google และเปิดแพ็กเกจ VIP 30 วัน เรียบร้อยแล้ว',
      msg_mm: 'ငွေလွှဲစစ်ဆေးပြီးပါပြီ! Google အကောင့်ဖြင့် ရက် ၃၀ VIP အင်တာနက် ရရှိပါပြီ',
      msg_en: 'Slip verified! 30-Day VIP Unlimited Wi-Fi activated for your Google account!',
      expiresAt: accountData.expiresAt
    });
  } catch (err) {
    console.error('[buy-package]', err);
    return res.json({
      ok: false,
      msg_th: 'เกิดข้อผิดพลาดในการตรวจสอบสลิป',
      msg_mm: 'ပြေစာစစ်ဆေးရာတွင် ချို့ယွင်းချက်ရှိပါသည်',
      msg_en: 'Error verifying slip. Please try again.'
    });
  }
});

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
    path.join(PUBLIC_DIR, '150B.jpg'),
    path.join(PUBLIC_DIR, '150b.jpg'),
    path.join(PUBLIC_DIR, 'thaiqr.jpg'),
    path.join(PUBLIC_DIR, 'thaiqr.png'),
    path.join(PUBLIC_DIR, 'qr.jpg'),
    path.join(PUBLIC_DIR, 'qr.png')
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

// Admin root: redirect directly to /admin
adminApp.get('/', (req, res) => {
  const pin = req.query.pin;
  if (pin) return res.redirect(`/admin?pin=${encodeURIComponent(pin)}`);
  return res.redirect('/admin');
});

// Admin shortcut to open user captive portal on port 3001
adminApp.get('/portal', (req, res) => {
  const host = req.hostname || 'localhost';
  return res.redirect(`http://${host}:${USER_PORT}/portal`);
});

adminApp.get('/admin', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) {
    return res.send(renderAdminLogin());
  }

  const accounts = await db.getAllAccounts();
  const slips = await db.getAllSlips();
  const ipLogs = await db.getRecentIpLogs(30);
  const isFirebaseActive = db.isFirebaseActive();
  const firebaseConfig = fb.getClientConfig();
  const msg = req.query.msg || null;
  const err = req.query.err || null;

  return res.send(renderAdmin({ accounts, slips, ipLogs, settings, pin, isFirebaseActive, firebaseConfig, msg, err }));
});

adminApp.post('/admin/upload-qr', upload.single('qr'), async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');
  if (!req.file) return res.redirect(`/admin?pin=${pin}&err=${encodeURIComponent('ကျေးဇူးပြု၍ ဖိုင်ရွေးချယ်ပါ')}`);
  const dest = path.join(PUBLIC_DIR, 'qr.jpg');
  fs.copyFileSync(req.file.path, dest);
  fs.unlinkSync(req.file.path);
  return res.redirect(`/admin?pin=${pin}&msg=${encodeURIComponent('QR ကုဒ် ဓာတ်ပုံ အောင်မြင်စွာ တင်ပြီးပါပြီ')}`);
});

adminApp.post('/admin/settings', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');

  const { monthlyPrice, trialMinutes, adminPin, googleClientId, smtpHost, smtpPort, smtpUser, smtpPass } = req.body;
  if (monthlyPrice) await db.setSetting('monthlyPrice', String(parseInt(monthlyPrice, 10) || 150));
  if (trialMinutes) await db.setSetting('trialMinutes', String(parseInt(trialMinutes, 10) || 60));
  if (adminPin && /^[0-9]{4,}$/.test(adminPin)) await db.setSetting('adminPin', adminPin);
  if (googleClientId !== undefined) await db.setSetting('googleClientId', googleClientId.trim());
  if (smtpHost !== undefined) await db.setSetting('smtpHost', smtpHost.trim());
  if (smtpPort !== undefined) await db.setSetting('smtpPort', smtpPort.trim() || '587');
  if (smtpUser !== undefined) await db.setSetting('smtpUser', smtpUser.trim());
  if (smtpPass !== undefined && smtpPass.trim() !== '') await db.setSetting('smtpPass', smtpPass.trim().replace(/\s+/g, ''));

  return res.redirect(`/admin?pin=${adminPin || settings.adminPin}&msg=${encodeURIComponent('စနစ် ဆက်တင်များနှင့် အီးမေးလ် ဆက်တင်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ')}`);
});

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
  const pin = req.query.pin || req.body.pin;
  const settings = await db.getAllSettings();
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');
  const { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId } = req.body;
  fb.saveClientConfig({
    apiKey: (apiKey || '').trim(),
    authDomain: (authDomain || '').trim(),
    projectId: (projectId || '').trim(),
    storageBucket: (storageBucket || '').trim(),
    messagingSenderId: (messagingSenderId || '').trim(),
    appId: (appId || '').trim()
  });
  return res.redirect(`/admin?pin=${pin}&msg=${encodeURIComponent('Firebase ဆက်တင်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ')}`);
});

adminApp.post('/admin/account/extend', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (!acc) return res.redirect(`/admin?pin=${pin}&err=${encodeURIComponent('အကောင့် မတွေ့ရှိပါ')}`);

  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  const base = acc.expiresAt && acc.expiresAt > Date.now() ? acc.expiresAt : Date.now();
  acc.expiresAt = base + thirtyDays;
  acc.plan = 'vip-30d';

  await db.saveAccount(acc);
  return res.redirect(`/admin?pin=${pin}&msg=${encodeURIComponent('ရက် ၃၀ သက်တမ်းတိုးခြင်း အောင်မြင်ပါသည်')}`);
});

adminApp.post('/admin/account/reset-trial', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (!acc) return res.redirect(`/admin?pin=${pin}&err=${encodeURIComponent('အကောင့် မတွေ့ရှိပါ')}`);
  acc.lastTrialAt = null;
  await db.saveAccount(acc);
  return res.redirect(`/admin?pin=${pin}&msg=${encodeURIComponent('အခမဲ့ စမ်းသုံးခွင့် ပြန်လည်စတင်ပြီးပါပြီ')}`);
});

adminApp.post('/admin/account/block', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');
  const email = req.body.email || req.query.email;
  const acc = await db.getAccount(email);
  if (!acc) return res.redirect(`/admin?pin=${pin}&err=${encodeURIComponent('အကောင့် မတွေ့ရှိပါ')}`);

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
  const statusMsg = acc.blocked ? 'အကောင့်အား ယာယီပိတ်လိုက်ပါပြီ' : 'အကောင့်အား ပြန်လည်ဖွင့်လိုက်ပါပြီ';
  return res.redirect(`/admin?pin=${pin}&msg=${encodeURIComponent(statusMsg)}`);
});

adminApp.post('/admin/account/delete', async (req, res) => {
  const settings = await db.getAllSettings();
  const pin = req.query.pin;
  if (pin !== settings.adminPin) return res.status(403).send('Unauthorized');
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
  return res.redirect(`/admin?pin=${pin}&msg=${encodeURIComponent('အကောင့်အား အပြီးပိုင် ဖျက်ပြီးပါပြီ')}`);
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
// Auto-revoke expired sessions background daemon (Every 30 seconds)
// ============================================================================

setInterval(async () => {
  try {
    const allAccounts = await db.getAllAccounts();
    const now = Date.now();
    for (const acc of allAccounts) {
      if (acc.activeIp && acc.expiresAt && now >= acc.expiresAt) {
        console.log(`[Auto-Revoke] Expired session for ${acc.email} (IP: ${acc.activeIp})`);
        try {
          await revokeIp(acc.activeIp);
        } catch (e) {
          console.error('[Auto-Revoke]', e.message);
        }
        await db.logIpAction({ email: acc.email, ip: acc.activeIp, mac: acc.activeMac, action: 'session_expired' });
        acc.activeIp = null;
        acc.activeMac = null;
        await db.saveAccount(acc);
      }
    }
  } catch (err) {
    console.error('[Auto-Revoke daemon error]', err.message);
  }
}, 30000);

// ============================================================================
// Start Servers (Admin on Port 3000, User Portal on Port 3001)
// ============================================================================

(async () => {
  await db.initDb();
  const lanIp = getServerIp();

  // 1. Admin Management Server (Port 3000)
  adminApp.listen(ADMIN_PORT, HOST, () => {
    console.log(`🛡️  Admin Server (Port ${ADMIN_PORT}): http://localhost:${ADMIN_PORT} (http://${lanIp}:${ADMIN_PORT}/admin)`);
  });

  // 2. User Wi-Fi Captive Portal Server (Port 3001)
  userApp.listen(USER_PORT, HOST, () => {
    console.log(`📶 User Portal  (Port ${USER_PORT}): http://localhost:${USER_PORT}/portal (http://${lanIp}:${USER_PORT}/portal)`);
  });

  console.log(`\n  =============================================================`);
  console.log(`    Free Wi-Fi Gateway Server (Dual-Port Architecture)        `);
  console.log(`    Admin Server (3000): http://localhost:${ADMIN_PORT} (PIN: 1234)`);
  console.log(`    User Portal  (3001): http://localhost:${USER_PORT}/portal`);
  console.log(`    Database:            SQLite (wifi.db) + Firestore          `);
  console.log(`    Admin Portal:        မြန်မာဘာသာ သီးသန့် (Burmese Only)    `);
  console.log(`    User Portal Lng:     Thai (ไทย) | Myanmar (မြန်မာ) | English`);
  console.log(`    Firewall:            ${DRY_RUN ? 'DRY_RUN (Safe / Emulated)' : 'LIVE (pfctl/iptables)'}`);
  console.log(`  =============================================================\n`);
})();

// ============================================================================
// HTML Page Renderers (Google Account Mobile-First UI)
// ============================================================================

function renderPortal(account, settings) {
  const connected = !!account;
  const email = account ? account.email : '';
  const name = account ? account.name : '';
  const picture = account ? account.picture : '';
  const plan = account ? account.plan : '';
  const expiresAt = account ? account.expiresAt : 0;
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
  
  <!-- Top Bar: Right Corner Language Flag Photos (No Text) -->
  <div class="flex items-center justify-end max-w-md mx-auto mb-2 relative z-30">
    <div class="inline-flex items-center space-x-2 bg-black bg-opacity-35 hover:bg-opacity-45 backdrop-blur-md px-2.5 py-1.5 rounded-full border border-white border-opacity-20 shadow-md">
      <!-- Thai Flag Photo -->
      <button type="button" onclick="setLanguage('th')" id="lang-btn-th" title="Thai Flag" class="lang-flag-btn relative p-0.5 rounded transition duration-150 active:scale-90 hover:opacity-100 opacity-60">
        <img src="/public/flags/th.svg" alt="Thai Flag" class="w-7 h-5 sm:w-8 sm:h-5.5 rounded-sm object-cover shadow-sm pointer-events-none border border-black border-opacity-25" />
      </button>

      <!-- Myanmar Flag Photo -->
      <button type="button" onclick="setLanguage('mm')" id="lang-btn-mm" title="Myanmar Flag" class="lang-flag-btn relative p-0.5 rounded transition duration-150 active:scale-90 hover:opacity-100 opacity-60">
        <img src="/public/flags/mm.svg" alt="Myanmar Flag" class="w-7 h-5 sm:w-8 sm:h-5.5 rounded-sm object-cover shadow-sm pointer-events-none border border-black border-opacity-25" />
      </button>

      <!-- GB Flag Photo -->
      <button type="button" onclick="setLanguage('en')" id="lang-btn-en" title="GB Flag" class="lang-flag-btn relative p-0.5 rounded transition duration-150 active:scale-90 hover:opacity-100 opacity-60">
        <img src="/public/flags/gb.svg" alt="GB Flag" class="w-7 h-5 sm:w-8 sm:h-5.5 rounded-sm object-cover shadow-sm pointer-events-none border border-black border-opacity-25" />
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
    <button class="tab-btn active py-2.5 sm:py-3 px-1 flex flex-col items-center justify-center min-h-[52px]" onclick="switchTab('tab-free')">
      <span class="text-base sm:text-lg mb-0.5 leading-none">🎁</span>
      <span class="text-xs sm:text-sm font-bold truncate max-w-full px-1" data-i18n="tab_free_title">เน็ตฟรี 1 ชม.</span>
      <span class="text-[10px] text-gray-400 font-medium leading-none" data-i18n="tab_free_sub">Free 1-Hr</span>
    </button>
    <button class="tab-btn py-2.5 sm:py-3 px-1 flex flex-col items-center justify-center min-h-[52px]" onclick="switchTab('tab-vip')">
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
  <div id="tab-free" class="tab-content active p-4 sm:p-6 text-center">
    <div class="mb-4">
      <span class="inline-block p-2 bg-blue-50 text-blue-600 rounded-full mb-1">⚡</span>
      <h2 class="text-lg font-black text-gray-800" data-i18n="free_heading">รับเน็ตฟรี ${trialMin} นาที</h2>
      <p class="text-xs text-gray-500" data-i18n="free_sub">เข้าสู่ระบบด้วยบัญชี Google รับสิทธิ์ได้ 1 ครั้ง ต่อ 24 ชม.</p>
    </div>

    <!-- Step 1: Request OTP -->
    <div id="free-step-1" class="space-y-3.5">
      <button type="button" onclick="triggerGoogleAuth('free')" class="btn-google">
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
              <span data-i18n="btn_open_gmail">เปิดแอป Gmail (ดูรหัส OTP)</span>
              <span class="text-[11px] text-gray-400">↗</span>
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
  <div id="tab-vip" class="tab-content p-4 sm:p-6">
    <div class="text-center mb-3">
      <div class="inline-flex items-center px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 text-xs font-bold mb-1.5" data-i18n="vip_badge_banner">
        ★ UNLIMITED WI-FI 30 DAYS
      </div>
      <h2 class="text-lg font-black text-gray-800" data-i18n="vip_heading">สมัครแพ็กเกจ 30 วัน (${price} บาท)</h2>
      <p class="text-xs text-gray-500" data-i18n="vip_sub">ผูกกับบัญชี Google เข้าใช้งานได้ตลอด 30 วัน</p>
    </div>

    <div class="bg-gray-50 border border-gray-200 rounded-xl p-3.5 mb-3 text-center">
      <div class="bg-white p-2 rounded-lg border border-gray-200 inline-block shadow-sm">
        <img src="/my-qr" alt="PromptPay QR" class="w-40 sm:w-48 h-40 sm:h-48 object-contain mx-auto" />
      </div>
      <p class="text-xs text-gray-500 mt-2"><span data-i18n="price_label">ยอดชำระ:</span> <strong id="price-display" class="text-blue-600 font-bold" data-i18n="price_amount">${price} บาท</strong></p>
    </div>

    <form onsubmit="handleBuyPackage(event)" class="space-y-3">
      <div>
        <label class="block text-xs font-bold text-gray-600 uppercase mb-1" data-i18n="label_google_email">บัญชี Google Email (สำหรับผูกแพ็กเกจ)</label>
        <div class="relative">
          <input type="email" id="vip-email" placeholder="your.name@gmail.com" required class="input-field pr-10" />
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
        ยืนยันและเปิดใช้งาน / Verify & Activate 30-Day VIP
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
      <button type="button" onclick="triggerGoogleAuth('login')" class="btn-google">
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
              <span data-i18n="btn_open_gmail">เปิดแอป Gmail (ดูรหัส OTP)</span>
              <span class="text-[11px] text-gray-400">↗</span>
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

<!-- Google Account Dialog Modal (Mobile Bottom-Sheet / Responsive Card) -->
<div id="google-dialog" class="hidden fixed inset-0 bg-black bg-opacity-65 flex items-center justify-center p-3 sm:p-4 z-50 backdrop-blur-sm" onclick="if(event.target.id==='google-dialog')closeGoogleDialog()">
  <div class="bg-white rounded-3xl p-5 sm:p-6 max-w-sm w-full relative shadow-2xl animate-fade max-h-[92vh] overflow-y-auto">
    <button onclick="closeGoogleDialog()" class="absolute top-3.5 right-4 text-gray-400 hover:text-gray-600 text-2xl font-bold p-1 leading-none">&times;</button>
    
    <div class="flex items-center space-x-2 mb-2">
      <svg class="w-6 h-6 flex-shrink-0" viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
      </svg>
      <span class="font-bold text-gray-800 text-sm">Sign in with Google</span>
    </div>

    <h3 class="text-base font-black text-gray-900 mb-1" data-i18n="google_dialog_title">เลือกบัญชี Google ของคุณ</h3>
    <p class="text-xs text-gray-500 mb-4" data-i18n="google_dialog_sub">เพื่อเข้าใช้งานอินเทอร์เน็ต Free Wi-Fi</p>

    <form onsubmit="confirmGoogleAccount(event)" class="space-y-3">
      <div>
        <label class="block text-xs font-bold text-gray-600 mb-1">Google Email</label>
        <input type="email" id="dlg-email" placeholder="username@gmail.com" autofocus required class="input-field text-base font-semibold" />
      </div>
      <div>
        <label class="block text-xs font-bold text-gray-600 mb-1">ชื่อที่แสดง (Display Name)</label>
        <input type="text" id="dlg-name" placeholder="ชื่อของคุณ (เช่น Somchai, Aung Myint)" class="input-field text-base" />
      </div>
      <button type="submit" id="dlg-btn" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl py-3 text-base min-h-[48px] transition active:scale-95 shadow-md">
        ดำเนินการต่อ / Continue with Google
      </button>
    </form>
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
    btn_buy_vip: "ยืนยันและเปิดใช้งาน VIP 30 วัน",
    login_heading: "เข้าสู่ระบบด้วย Google",
    login_sub: "สำหรับสมาชิกที่มีแพ็กเกจ 30 วัน หรือเวลาฟรียังไม่หมด",
    btn_google_login: "เข้าสู่ระบบด้วย Google Account",
    btn_login: "เข้าสู่ระบบ / Connect",
    footer_need_help: "ต้องการความช่วยเหลือ?",
    footer_click_here: "คลิกที่นี่",
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
    btn_open_gmail: "เปิดแอป Gmail (ดูรหัส OTP)"
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
    btn_open_gmail: "Gmail အက်ပ် ဖွင့်မည် (OTP ကြည့်ရန်)"
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
    label_slip: "Upload Transfer Slip",
    dropzone_label: "Tap to select bank receipt photo",
    btn_buy_vip: "Verify Slip & Activate 30-Day VIP",
    login_heading: "Sign in with Google",
    login_sub: "For existing 30-Day VIP members or active trial users",
    btn_google_login: "Sign in with Google Account",
    btn_login: "Login / Connect",
    footer_need_help: "Need help?",
    footer_click_here: "Click here",
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
    btn_open_gmail: "Open Gmail App (Check OTP)"
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

function switchTab(id) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  const btns = document.querySelectorAll('.tab-btn');
  if (id === 'tab-free') btns[0].classList.add('active');
  if (id === 'tab-vip') btns[1].classList.add('active');
  if (id === 'tab-login') btns[2].classList.add('active');
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
    if (preview && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = e => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
      };
      reader.readAsDataURL(file);
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

let firebaseReady = false;
let firebaseClientConfig = null;

// Initialize Firebase Client if config is present
async function initFirebaseClient() {
  try {
    const res = await fetch('/api/firebase-config');
    const data = await res.json();
    if (data.ok && data.config && data.config.apiKey && data.config.authDomain) {
      firebaseClientConfig = data.config;
      if (window.firebase && !firebase.apps.length) {
        firebase.initializeApp(firebaseClientConfig);
        if (typeof firebase.analytics === 'function' && firebaseClientConfig.measurementId) {
          firebase.analytics();
        }
      }
      firebaseReady = true;
      console.log('Firebase Web SDK initialized successfully.');
    }
  } catch (err) {
    console.warn('Firebase client config check:', err.message);
  }
}
initFirebaseClient();

// Google Auth Trigger: Firebase Google Sign-In with Fallback Dialog
async function triggerGoogleAuth(mode) {
  pendingAuthMode = mode;

  if (firebaseReady && window.firebase && firebase.auth) {
    try {
      showToast({ 
        msg_th: 'กำลังเปิดหน้าต่างลงชื่อเข้าใช้ Google...', 
        msg_mm: 'Google အကောင့်ဝင်ရန် ဖွင့်နေပါသည်...', 
        msg_en: 'Opening Google Sign-In...' 
      });
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.addScope('email');
      provider.addScope('profile');
      
      const result = await firebase.auth().signInWithPopup(provider);
      const user = result.user;
      const idToken = await user.getIdToken();
      const email = user.email;
      const name = user.displayName || email.split('@')[0];
      const picture = user.photoURL || null;

      if (mode === 'free') {
        await submitFreeTrial(email, name, picture, idToken);
      } else {
        await submitGoogleLogin(email, idToken);
      }
      return;
    } catch (popupErr) {
      console.warn('Firebase popup closed or blocked:', popupErr.message);
      // Fallback seamlessly to direct confirmation modal so captive portal user is NEVER blocked
    }
  }

  // Fallback modal if Firebase client config is not yet set or popup was blocked by restricted browser
  openGoogleDialogFallback(mode);
}

function openGoogleDialogFallback(mode) {
  pendingAuthMode = mode;
  document.getElementById('google-dialog').classList.remove('hidden');
  document.getElementById('dlg-email').focus();
}

function closeGoogleDialog() {
  document.getElementById('google-dialog').classList.add('hidden');
}

let currentEmail = { free: '', login: '' };
let resendTimers = { free: null, login: null };

async function confirmGoogleAccount(e) {
  e.preventDefault();
  const email = document.getElementById('dlg-email').value.trim();
  const name = document.getElementById('dlg-name').value.trim() || email.split('@')[0];
  closeGoogleDialog();

  if (email) {
    const inputEl = document.getElementById(pendingAuthMode + '-email');
    if (inputEl) inputEl.value = email;
    switchTab(pendingAuthMode === 'free' ? 'tab-free' : 'tab-login');
    await sendOtpRequest(email, pendingAuthMode, name);
  }
}

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
      setTimeout(() => location.reload(), 1000);
    }
  } catch (err) {
    showToast({ ok: false, msg_th: 'เข้าสู่ระบบไม่สำเร็จ', msg_mm: 'အကောင့်ဝင်ရောက်မှု မအောင်မြင်ပါ', msg_en: 'Login failed' });
  }
}

async function handleBuyPackage(e) {
  e.preventDefault();
  const email = document.getElementById('vip-email').value.trim();
  const fileInput = document.getElementById('slip-file');
  if (!fileInput.files || !fileInput.files[0]) {
    return showToast({ 
      ok: false, 
      msg_th: 'กรุณาเลือกไฟล์สลิปธนาคาร', 
      msg_mm: 'ငွေလွှဲပြေစာ ဓာတ်ပုံ ရွေးချယ်ပေးပါ', 
      msg_en: 'Please select bank slip image' 
    });
  }

  const btn = document.getElementById('btn-buy');
  btn.disabled = true;
  btn.textContent = currentLang === 'mm' ? 'ပြေစာအား စစ်ဆေးနေပါသည်...' : (currentLang === 'en' ? 'Scanning & Verifying slip...' : 'กำลังประมวลผลและสแกนสลิป...');

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
      setTimeout(() => location.reload(), 1200);
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
});
</script>
</body>
</html>`;
}

function renderAdminLogin() {
  return `<!DOCTYPE html>
<html lang="mm">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>စီမံခန့်ခွဲသူ အကောင့်ဝင်ရန် — Free Wi-Fi</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Myanmar Text', 'Pyidaungsu', 'Padauk', sans-serif; }
</style>
</head>
<body class="bg-gray-900 text-white min-h-screen flex items-center justify-center p-4">
  <div class="bg-gray-800 rounded-3xl p-8 max-w-sm w-full border border-gray-700 shadow-2xl text-center">
    <div class="inline-flex p-3 bg-blue-600 rounded-2xl mb-3 text-3xl shadow-lg">🛡️</div>
    <h1 class="text-xl font-black mb-1 tracking-tight">Free Wi-Fi စီမံခန့်ခွဲသူ</h1>
    <p class="text-xs text-gray-400 mb-6 font-medium">စီမံခန့်ခွဲသူ အကောင့်ဝင်ရောက်ရန်</p>
    
    <form method="get" action="/admin" class="space-y-4">
      <div>
        <label class="block text-left text-xs font-bold text-gray-400 mb-1.5 uppercase">PIN နံပါတ် ရိုက်ထည့်ပါ</label>
        <input type="password" name="pin" placeholder="PIN နံပါတ် (နဂိုမူလ: 1234)" autofocus required class="w-full bg-gray-900 border border-gray-700 rounded-xl px-4 py-3.5 text-center text-lg font-mono focus:border-blue-500 outline-none text-white tracking-widest" />
      </div>
      <button type="submit" class="w-full bg-blue-600 hover:bg-blue-700 font-bold rounded-xl py-3.5 text-sm transition shadow-md active:scale-95">
        ဒက်ရှ်ဘုတ်သို့ ဝင်ရောက်မည်
      </button>
    </form>
  </div>
</body>
</html>`;
}

function renderAdmin({ accounts, slips, ipLogs, settings, pin, isFirebaseActive = false, firebaseConfig = {}, msg = null, err = null }) {
  const totalUsers = accounts.length;
  const now = Date.now();
  let activeUsers = 0;
  let vipUsers = 0;
  let blockedUsers = 0;

  for (const a of accounts) {
    if (a.expiresAt && a.expiresAt > now && !a.blocked) activeUsers++;
    if (a.plan === 'vip-30d') vipUsers++;
    if (a.blocked) blockedUsers++;
  }

  // Action mapping for IP Activity logs in Burmese
  const actionLabels = {
    buy_package: 'ရက် ၃၀ VIP ဝယ်ယူခြင်း',
    free_trial: '၁ နာရီ အခမဲ့ ရယူခြင်း',
    free_trial_otp: 'အခမဲ့ OTP အောင်မြင်ခြင်း',
    login: 'အကောင့်ဝင်ရောက်ခြင်း',
    login_otp: 'OTP ဖြင့် အကောင့်ဝင်ခြင်း',
    logout: 'အကောင့်ထွက်ခြင်း',
    blocked: 'အကောင့် ပိတ်ခံရခြင်း'
  };

  // Account Rows (Google Email + Name)
  const accountRows = accounts
    .map((a) => {
      const isExpired = !a.expiresAt || a.expiresAt <= now;
      const daysLeft = a.expiresAt && !isExpired ? Math.ceil((a.expiresAt - now) / 86400000) : 0;
      const initial = a.name ? a.name.charAt(0).toUpperCase() : a.email.charAt(0).toUpperCase();
      const expDateStr = a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('en-GB') : '-';

      return `
      <tr class="border-b border-gray-100 hover:bg-gray-50 text-xs">
        <td class="py-3 px-3">
          <div class="flex items-center space-x-2">
            <div class="w-7 h-7 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center text-xs flex-shrink-0">${initial}</div>
            <div>
              <p class="font-bold text-gray-800">${a.name || '-'}</p>
              <p class="font-mono text-gray-500 text-[11px]">${a.email}</p>
            </div>
          </div>
        </td>
        <td class="py-3 px-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${a.plan === 'vip-30d' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'}">
            ${a.plan === 'vip-30d' ? 'ရက် ၃၀ VIP' : '၁ နာရီ အခမဲ့'}
          </span>
        </td>
        <td class="py-3 px-3 font-mono text-gray-600">${a.activeIp || '<span class="text-gray-400">-</span>'}</td>
        <td class="py-3 px-3 font-mono text-gray-500">${a.activeMac || '<span class="text-gray-400">-</span>'}</td>
        <td class="py-3 px-3">
          ${
            isExpired
              ? '<span class="text-red-500 font-bold">သက်တမ်းကုန်</span>'
              : '<span class="text-green-600 font-bold">' + daysLeft + ' ရက် ကျန်</span><br><span class="text-gray-400 text-[10px]">' + expDateStr + '</span>'
          }
        </td>
        <td class="py-3 px-3">
          ${a.blocked ? '<span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold">ပိတ်ထားသည်</span>' : '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold">ပုံမှန်</span>'}
        </td>
        <td class="py-3 px-3 space-x-1 whitespace-nowrap">
          <form method="post" action="/admin/account/extend?pin=${pin}" class="inline">
            <input type="hidden" name="email" value="${a.email}" />
            <button class="px-2 py-1 bg-green-600 hover:bg-green-700 text-white rounded font-bold" title="ရက် ၃၀ သက်တမ်းတိုးမည်">+ရက် ၃၀</button>
          </form>
          <form method="post" action="/admin/account/reset-trial?pin=${pin}" class="inline">
            <input type="hidden" name="email" value="${a.email}" />
            <button class="px-2 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded font-bold" title="အခမဲ့ စမ်းသုံးခွင့် ပြန်စမည်">အခမဲ့ပြန်စ</button>
          </form>
          <form method="post" action="/admin/account/block?pin=${pin}" class="inline">
            <input type="hidden" name="email" value="${a.email}" />
            <button class="px-2 py-1 ${a.blocked ? 'bg-gray-600 hover:bg-gray-700' : 'bg-red-600 hover:bg-red-700'} text-white rounded font-bold">
              ${a.blocked ? 'ပြန်ဖွင့်' : 'ပိတ်မည်'}
            </button>
          </form>
          <form method="post" action="/admin/account/delete?pin=${pin}" class="inline" onsubmit="return confirm('ဤ Google အကောင့်ကို အပြီးပိုင် ဖျက်ရန် သေချာပါသလား?')">
            <input type="hidden" name="email" value="${a.email}" />
            <button class="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded font-bold">ဖျက်မည်</button>
          </form>
        </td>
      </tr>
      `;
    })
    .join('');

  // Payment Slips Rows
  const slipRows = slips
    .map((s) => {
      const dateStr = new Date(s.uploaded_at).toLocaleString('en-GB');
      return `
      <tr class="border-b border-gray-100 hover:bg-gray-50 text-xs">
        <td class="py-3 px-3 font-mono text-gray-500">#${s.id}</td>
        <td class="py-3 px-3">
          <a href="${s.cloud_url || '/uploads/' + encodeURIComponent(s.filename)}" target="_blank" class="inline-flex items-center space-x-1 text-blue-600 hover:underline font-bold">
            <svg class="w-4 h-4 mr-1 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
            <span>${s.cloud_url ? 'Cloud Storage ပြေစာ ↗' : 'ပြေစာကြည့်မည်'}</span>
          </a>
        </td>
        <td class="py-3 px-3 font-mono font-bold text-gray-800">${s.email}</td>
        <td class="py-3 px-3 font-mono text-blue-700 font-bold bg-blue-50 rounded px-2 py-0.5 inline-block">${s.ip_address}</td>
        <td class="py-3 px-3 font-mono text-gray-500">${s.mac_address || '-'}</td>
        <td class="py-3 px-3 font-mono text-[10px] text-gray-500 break-all max-w-[200px]">${s.qr_payload ? s.qr_payload.substring(0, 30) + '...' : '-'}</td>
        <td class="py-3 px-3 font-bold text-green-700">${s.amount} ဘတ်</td>
        <td class="py-3 px-3 text-gray-500">${dateStr}</td>
        <td class="py-3 px-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-800">
            ${s.status === 'verified' ? '✓ စစ်ဆေးပြီး' : s.status}
          </span>
        </td>
      </tr>
      `;
    })
    .join('');

  // IP Activity Logs Rows
  const logRows = ipLogs
    .map((l) => {
      const timeStr = new Date(l.timestamp).toLocaleTimeString('en-GB');
      let badge = 'bg-gray-100 text-gray-700';
      if (l.action === 'buy_package') badge = 'bg-green-100 text-green-800 font-bold';
      if (l.action && l.action.startsWith('free_trial')) badge = 'bg-blue-100 text-blue-800 font-bold';
      if (l.action === 'blocked') badge = 'bg-red-100 text-red-800 font-bold';

      const actionText = actionLabels[l.action] || l.action;

      return `
      <tr class="border-b border-gray-100 text-xs">
        <td class="py-2.5 px-3 font-mono text-blue-600 font-bold">${l.ip_address}</td>
        <td class="py-2.5 px-3 font-mono text-gray-500">${l.mac_address || '-'}</td>
        <td class="py-2.5 px-3 font-mono">${l.email || '-'}</td>
        <td class="py-2.5 px-3">
          <span class="px-2.5 py-0.5 rounded-full text-xs ${badge}">${actionText}</span>
        </td>
        <td class="py-2.5 px-3 text-gray-500">${timeStr}</td>
      </tr>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="mm">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>စီမံခန့်ခွဲသူ ဒက်ရှ်ဘုတ် — Free Wi-Fi Database</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Myanmar Text', 'Pyidaungsu', 'Padauk', sans-serif; }
</style>
</head>
<body class="bg-gray-50 text-gray-900 min-h-screen">

<!-- Top Bar -->
<header class="bg-gray-900 text-white py-4 px-4 sm:px-6 shadow-md">
  <div class="max-w-6xl mx-auto flex items-center justify-between flex-wrap gap-2">
    <div class="flex items-center space-x-3">
      <span class="text-2xl">📡</span>
      <div>
        <h1 class="text-lg font-black tracking-tight">Free Wi-Fi စီမံခန့်ခွဲမှုစနစ်</h1>
        <p class="text-xs text-gray-400">Google အကောင့်များ၊ ငွေလွှဲပြေစာများနှင့် IP Address မှတ်တမ်း ဒေတာဘေ့စ် (SQLite & Firestore)</p>
      </div>
    </div>
    <div class="flex items-center space-x-2 sm:space-x-3">
      <a href="/admin" class="text-xs bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-lg font-bold">ထွက်မည်</a>
    </div>
  </div>
</header>

<main class="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">

  ${
    msg
      ? '<div class="bg-green-100 border border-green-300 text-green-800 px-4 py-3 rounded-xl font-bold text-xs flex items-center space-x-2"><span>✓</span><span>' + msg + '</span></div>'
      : ''
  }
  ${
    err
      ? '<div class="bg-red-100 border border-red-300 text-red-800 px-4 py-3 rounded-xl font-bold text-xs flex items-center space-x-2"><span>⚠️</span><span>' + err + '</span></div>'
      : ''
  }

  <!-- Stats Cards -->
  <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
    <div class="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
      <p class="text-xs text-gray-500 font-bold uppercase">စုစုပေါင်း Google အကောင့်</p>
      <p class="text-2xl font-black text-gray-800 mt-1">${totalUsers}</p>
    </div>
    <div class="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
      <p class="text-xs text-gray-500 font-bold uppercase">လက်ရှိ ချိတ်ဆက်ထားသူများ (Active)</p>
      <p class="text-2xl font-black text-green-600 mt-1">${activeUsers}</p>
    </div>
    <div class="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
      <p class="text-xs text-gray-500 font-bold uppercase">ရက် ၃၀ VIP အသင်းဝင်များ</p>
      <p class="text-2xl font-black text-indigo-600 mt-1">${vipUsers}</p>
    </div>
    <div class="bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
      <p class="text-xs text-gray-500 font-bold uppercase">စနစ်တွင်း ပြေစာများ</p>
      <p class="text-2xl font-black text-blue-600 mt-1">${slips.length}</p>
    </div>
  </div>

  <!-- Settings & QR Upload Grid -->
  <div class="grid md:grid-cols-2 gap-6">
    <!-- QR Photo Upload -->
    <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
      <div class="flex items-center space-x-2">
        <span class="text-xl">💳</span>
        <h2 class="font-black text-sm text-gray-800">ငွေလက်ခံမည့် PromptPay QR ကုဒ် ဓာတ်ပုံ</h2>
      </div>
      <p class="text-xs text-gray-500">သုံးစွဲသူများ ငွေလွှဲနိုင်ရန်အတွက် သင့် PromptPay QR ကုဒ် ဓာတ်ပုံကို တင်ပါ</p>
      <div class="flex items-center space-x-4">
        <div class="w-24 h-24 bg-gray-100 rounded-xl border border-gray-200 p-1 flex items-center justify-center flex-shrink-0">
          <img src="/my-qr" alt="QR Preview" class="max-w-full max-h-full object-contain" />
        </div>
        <form method="post" action="/admin/upload-qr?pin=${pin}" enctype="multipart/form-data" class="space-y-2 flex-1">
          <input type="file" name="qr" accept="image/*" required class="block w-full text-xs text-gray-500 file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition active:scale-95">QR ကုဒ် အသစ်တင်မည် / အစားထိုးမည်</button>
        </form>
      </div>
    </div>

    <!-- System Settings Form -->
    <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-3">
      <div class="flex items-center space-x-2">
        <span class="text-xl">⚙️</span>
        <h2 class="font-black text-sm text-gray-800">စနစ် ဆက်တင်များ</h2>
      </div>
      <form method="post" action="/admin/settings?pin=${pin}" class="space-y-3">
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">ရက် ၃၀ VIP ပက်ကေ့ဂျ် ဈေးနှုန်း (ဘတ်)</label>
            <input type="number" name="monthlyPrice" value="${settings.monthlyPrice || 150}" required class="w-full border border-gray-300 rounded-lg p-2 text-xs font-bold" />
          </div>
          <div>
            <label class="block text-xs font-bold text-gray-600 mb-1">အခမဲ့ သုံးစွဲခွင့် အချိန် (မိနစ်)</label>
            <input type="number" name="trialMinutes" value="${settings.trialMinutes || 60}" required class="w-full border border-gray-300 rounded-lg p-2 text-xs font-bold" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-bold text-gray-600 mb-1">စီမံခန့်ခွဲသူ PIN နံပါတ်</label>
          <input type="text" name="adminPin" value="${settings.adminPin || '1234'}" required class="w-full border border-gray-300 rounded-lg p-2 text-xs font-mono font-bold" />
        </div>

        <div class="pt-3 border-t border-gray-100">
          <div class="flex items-center space-x-1 mb-2">
            <span class="text-xs font-bold text-gray-700">📧 OTP အီးမေးလ် ပို့ဆောင်ရေး ဆက်တင်များ (Gmail SMTP)</span>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs">
            <div>
              <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">SMTP Host</label>
              <input type="text" name="smtpHost" value="${settings.smtpHost || ''}" placeholder="smtp.gmail.com" class="w-full border rounded p-1.5 font-mono text-xs bg-gray-50" />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Port (465 သို့ 587)</label>
              <input type="text" name="smtpPort" value="${settings.smtpPort || '587'}" placeholder="587" class="w-full border rounded p-1.5 font-mono text-xs bg-gray-50" />
            </div>
          </div>
          <div class="grid grid-cols-2 gap-2 text-xs mt-2">
            <div>
              <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Gmail / Sender Address</label>
              <input type="email" name="smtpUser" value="${settings.smtpUser || ''}" placeholder="mywifi@gmail.com" class="w-full border rounded p-1.5 font-mono text-xs bg-gray-50" />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-gray-500 mb-0.5">Google App Password (၁၆ လုံး)</label>
              <input type="password" name="smtpPass" placeholder="${settings.smtpPass ? '•••••••••••••••• (မပြောင်းလဲလိုပါက ကွက်လပ်ထားပါ)' : 'abcd efgh ijkl mnop'}" class="w-full border rounded p-1.5 font-mono text-xs bg-gray-50" />
            </div>
          </div>
          <p class="text-[10px] text-gray-400 mt-1.5">
            💡 Gmail ဖြင့်ပို့ပါက Google Account > Security > 2-Step Verification > <strong>App Passwords</strong> မှ ၁၆ လုံးပါ စကားဝှက် ရယူထည့်သွင်းပါ။ Spam/Junk မရောက်စေရန် Anti-Spam Headers နှင့် Multi-Part Plain Text အလိုအလျောက် ထည့်သွင်းထားပါသည်။
          </p>
        </div>

        <button type="submit" class="bg-green-600 hover:bg-green-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition active:scale-95">ဆက်တင်များ သိမ်းဆည်းမည်</button>
      </form>
    </div>
  </div>

  <!-- Firebase Cloud Database & Hosting Management -->
  <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-4">
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div class="flex items-center space-x-2">
        <span class="text-xl">🔥</span>
        <div>
          <h2 class="font-black text-sm text-gray-800">Firebase Cloud Database & Hosting ချိတ်ဆက်မှု</h2>
          <p class="text-xs text-gray-500">Database (Firestore)၊ Google Auth နှင့် Hosting အတွက် Google Firebase ချိတ်ဆက်မှုစနစ်</p>
        </div>
      </div>
      <span class="px-3 py-1 rounded-full text-xs font-bold ${isFirebaseActive ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}">
        ${isFirebaseActive ? '🟢 Cloud Firestore: ချိတ်ဆက်ပြီး (အလိုအလျောက် Sync လုပ်နေသည်)' : '🟡 SQLite ဖြင့် အလုပ်လုပ်နေသည် (Cloud ချိတ်ဆက်ရန် firebase-service-account.json ထည့်ပါ)'}
      </span>
    </div>

    <div class="grid md:grid-cols-2 gap-4 text-xs">
      <!-- Firebase Client Config Form -->
      <form method="post" action="/admin/firebase-config?pin=${pin}" class="space-y-2 bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div class="flex items-center justify-between">
          <h3 class="font-bold text-gray-700">၁။ Firebase Web Client သတ်မှတ်ချက်များ (Google Sign-In)</h3>
          <span class="text-[10px] text-blue-600 font-mono">firebase-client.json</span>
        </div>
        <p class="text-[11px] text-gray-500">Firebase Console > Project Settings > General > Your apps (Web) မှ ကူးယူပါ</p>
        <div>
          <label class="block font-semibold text-gray-600 mb-0.5">API Key (apiKey)</label>
          <input type="text" name="apiKey" value="${firebaseConfig.apiKey || ''}" placeholder="AIzaSy..." class="w-full border rounded p-1.5 font-mono text-xs bg-white" />
        </div>
        <div>
          <label class="block font-semibold text-gray-600 mb-0.5">Auth Domain (authDomain)</label>
          <input type="text" name="authDomain" value="${firebaseConfig.authDomain || ''}" placeholder="your-project.firebaseapp.com" class="w-full border rounded p-1.5 font-mono text-xs bg-white" />
        </div>
        <div>
          <label class="block font-semibold text-gray-600 mb-0.5">Project ID (projectId)</label>
          <input type="text" name="projectId" value="${firebaseConfig.projectId || ''}" placeholder="your-project-id" class="w-full border rounded p-1.5 font-mono text-xs bg-white" />
        </div>
        <div>
          <label class="block font-semibold text-gray-600 mb-0.5">App ID (appId)</label>
          <input type="text" name="appId" value="${firebaseConfig.appId || ''}" placeholder="1:123456789:web:abcdef" class="w-full border rounded p-1.5 font-mono text-xs bg-white" />
        </div>
        <button type="submit" class="bg-blue-600 hover:bg-blue-700 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition active:scale-95">Firebase Client ဆက်တင် သိမ်းဆည်းမည်</button>
      </form>

      <!-- Cloud Firestore & Hosting Instructions -->
      <div class="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div>
          <h3 class="font-bold text-gray-700">၂။ Cloud Firestore Backend သို့ ချိတ်ဆက်ခြင်း</h3>
          <p class="text-[11px] text-gray-600 mt-1">
            Service Account Key ကို <strong>Firebase Console > Project Settings > Service accounts > Generate new private key</strong> မှ ဒေါင်းလုဒ်လုပ်ပါ
          </p>
          <p class="text-[11px] text-gray-600 mt-0.5">ဖိုင်အား ပရောဂျက် ဖိုဒါထဲတွင် အောက်ပါအမည်ဖြင့် သိမ်းပါ:</p>
          <code class="block bg-gray-800 text-green-400 p-2 rounded text-[11px] font-mono break-all mt-1">
            d:\\Free-Wifi\\firebase-service-account.json
          </code>
        </div>

        <div class="pt-2 border-t border-gray-200">
          <h3 class="font-bold text-gray-700">၃။ Firebase Hosting သို့ တင်ခြင်း (Deploy)</h3>
          <p class="text-[11px] text-gray-600 mt-0.5"><code>firebase.json</code>၊ <code>.firebaserc</code> နှင့် <code>firestore.rules</code> ဖိုင်များကို ပြင်ဆင်ပြီးပါပြီ</p>
          <div class="bg-gray-800 text-blue-300 p-2.5 rounded text-[11px] font-mono space-y-1 mt-1">
            <p><span class="text-gray-500"># ၁။ Firebase CLI ကို ထည့်သွင်းပါ</span><br>npm install -g firebase-tools</p>
            <p><span class="text-gray-500"># ၂။ အကောင့်ဝင်ပြီး ပရောဂျက် ရွေးပါ</span><br>firebase login<br>firebase use --add</p>
            <p><span class="text-gray-500"># ၃။ Hosting & Firestore သို့ Deploy လုပ်ပါ</span><br>firebase deploy</p>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- TABLE 1: Accounts (Google Accounts) Table -->
  <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <span class="text-xl">👥</span>
        <div>
          <h2 class="font-black text-sm text-gray-800">Google အကောင့်များနှင့် Wi-Fi ချိတ်ဆက်မှုများ</h2>
          <p class="text-xs text-gray-500">ဖုန်းနံပါတ်နှင့် PIN အစား Google အကောင့်ဖြင့် အသုံးပြုခြင်း</p>
        </div>
      </div>
      <span class="text-xs text-gray-500">စုစုပေါင်း အကောင့် ${totalUsers} ခု</span>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
            <th class="py-2.5 px-3">Google အကောင့်</th>
            <th class="py-2.5 px-3">ပက်ကေ့ဂျ်</th>
            <th class="py-2.5 px-3">လက်ရှိ IP</th>
            <th class="py-2.5 px-3">MAC လိပ်စာ</th>
            <th class="py-2.5 px-3">သက်တမ်းကုန်ဆုံးမည့်ရက်</th>
            <th class="py-2.5 px-3">အခြေအနေ</th>
            <th class="py-2.5 px-3">စီမံခန့်ခွဲမှု</th>
          </tr>
        </thead>
        <tbody>
          ${accountRows || '<tr><td colspan="7" class="text-center py-6 text-xs text-gray-400">စနစ်ထဲတွင် Google အကောင့် မရှိသေးပါ</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- TABLE 2: Payment Slips & IP Log Database -->
  <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <span class="text-xl">🧾</span>
        <div>
          <h2 class="font-black text-sm text-gray-800">ငွေလွှဲပြေစာများနှင့် IP Address မှတ်တမ်း ဒေတာဘေ့စ်</h2>
          <p class="text-xs text-gray-500">ဖောက်သည်များ တင်ထားသော ပြေစာများ၊ Google အကောင့်နှင့် IP Address များကို စစ်ဆေးခြင်း</p>
        </div>
      </div>
      <span class="text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">စနစ်တွင်း ပြေစာ ${slips.length} စောင် ရှိသည်</span>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
            <th class="py-2.5 px-3">#နံပါတ်</th>
            <th class="py-2.5 px-3">ပြေစာပုံ</th>
            <th class="py-2.5 px-3">Google အကောင့်</th>
            <th class="py-2.5 px-3">တင်ခဲ့သော IP လိပ်စာ</th>
            <th class="py-2.5 px-3">MAC လိပ်စာ</th>
            <th class="py-2.5 px-3">ဘဏ် QR ကုဒ်</th>
            <th class="py-2.5 px-3">ငွေပမာဏ</th>
            <th class="py-2.5 px-3">တင်ခဲ့သည့် အချိန်</th>
            <th class="py-2.5 px-3">အခြေအနေ</th>
          </tr>
        </thead>
        <tbody>
          ${slipRows || '<tr><td colspan="9" class="text-center py-6 text-xs text-gray-400">ဒေတာဘေ့စ်တွင် ငွေလွှဲပြေစာ မရှိသေးပါ</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

  <!-- TABLE 3: Real-Time IP Connection & Activity Log -->
  <div class="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-2">
        <span class="text-xl">📊</span>
        <div>
          <h2 class="font-black text-sm text-gray-800">အချိန်နှင့်တပြေးညီ IP ချိတ်ဆက်မှုနှင့် လှုပ်ရှားမှု မှတ်တမ်း</h2>
          <p class="text-xs text-gray-500">အခမဲ့ရယူခြင်း၊ ငွေလွှဲခြင်း၊ အကောင့်ဝင်ခြင်းနှင့် သက်တမ်းကုန်ဆုံးခြင်း IP မှတ်တမ်းများ</p>
        </div>
      </div>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-left border-collapse">
        <thead>
          <tr class="border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider bg-gray-50">
            <th class="py-2.5 px-3">IP လိပ်စာ</th>
            <th class="py-2.5 px-3">MAC လိပ်စာ</th>
            <th class="py-2.5 px-3">Google အီးမေးလ်</th>
            <th class="py-2.5 px-3">ဆောင်ရွက်ချက်</th>
            <th class="py-2.5 px-3">အချိန်</th>
          </tr>
        </thead>
        <tbody>
          ${logRows || '<tr><td colspan="5" class="text-center py-4 text-xs text-gray-400">IP မှတ်တမ်း မရှိသေးပါ</td></tr>'}
        </tbody>
      </table>
    </div>
  </div>

</main>
</body>
</html>`;
}

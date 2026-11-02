// ============================================================================
// otp.js — One-Time Password (OTP) Generation, Verification & Email Delivery
// Free Wi-Fi Captive Portal & Gateway
// ============================================================================

const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./database');

// In-memory store: email -> { otp, expiresAt, mode, name, attempts, lastRequestedAt }
const otpStore = new Map();

/**
 * Generate a cryptographically secure 6-digit OTP code
 */
function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Request & store a new OTP for an email
 */
async function requestOtp(email, mode = 'free', name = '') {
  const cleanEmail = email.trim().toLowerCase();
  const now = Date.now();

  // Rate limiting: 30 seconds minimum between OTP requests for the same email
  const existing = otpStore.get(cleanEmail);
  if (existing && existing.lastRequestedAt && now - existing.lastRequestedAt < 30000) {
    const waitSecs = Math.ceil((30000 - (now - existing.lastRequestedAt)) / 1000);
    return {
      ok: false,
      rateLimited: true,
      waitSecs,
      msg_th: `กรุณารออีก ${waitSecs} วินาที ก่อนขอรหัส OTP ใหม่`,
      msg_mm: `နောက်ထပ် ${waitSecs} စက္ကန့် စောင့်ပြီးမှ OTP ကုဒ်အသစ် တောင်းပါ`,
      msg_en: `Please wait ${waitSecs} seconds before requesting a new OTP code.`
    };
  }

  const otp = generateCode();
  const expiresAt = now + 5 * 60 * 1000; // 5 minutes validity

  otpStore.set(cleanEmail, {
    otp,
    expiresAt,
    mode,
    name: name || cleanEmail.split('@')[0],
    attempts: 0,
    lastRequestedAt: now
  });

  console.log(`\n======================================================`);
  console.log(`🔑 [OTP GENERATED] Mode: ${mode.toUpperCase()}`);
  console.log(`📧 Target Email:   ${cleanEmail}`);
  console.log(`🔢 6-Digit OTP:    ${otp}`);
  console.log(`⏱ Valid Until:    ${new Date(expiresAt).toLocaleTimeString()}`);
  console.log(`======================================================\n`);

  // Attempt sending email via SMTP if configured
  const emailResult = await sendOtpEmail(cleanEmail, otp, mode);

  return {
    ok: true,
    email: cleanEmail,
    expiresAt,
    emailSent: emailResult.sent,
    msg_th: `ส่งรหัส OTP 6 หลัก ไปที่ ${cleanEmail} แล้ว กรุณาตรวจสอบในกล่องข้อความ Gmail (รหัสหมดอายุใน 5 นาที)`,
    msg_mm: `${cleanEmail} ထံသို့ ဂဏန်း ၆ လုံးပါ OTP ကုဒ် ပို့ပြီးပါပြီ။ Gmail တွင် စစ်ဆေးပါ`,
    msg_en: `A 6-digit OTP code has been sent to ${cleanEmail}. Please check your Gmail inbox.`
  };
}

/**
 * Verify an input OTP
 */
function verifyOtp(email, inputOtp, expectedMode = null) {
  if (!email || !inputOtp) {
    return {
      ok: false,
      msg_th: 'กรุณากรอกรหัส OTP ให้ครบ 6 หลัก',
      msg_mm: 'ဂဏန်း ၆ လုံးပါ OTP ကုဒ်ကို အပြည့်အစုံ ရိုက်ထည့်ပါ',
      msg_en: 'Please enter the 6-digit OTP code.'
    };
  }

  const cleanEmail = email.trim().toLowerCase();
  const record = otpStore.get(cleanEmail);

  if (!record) {
    return {
      ok: false,
      msg_th: 'ไม่พบรหัส OTP หรือหมดอายุแล้ว กรุณากดขอรหัสใหม่',
      msg_mm: 'OTP ကုဒ် မရှိပါ သို့မဟုတ် သက်တမ်းကုန်သွားပါပြီ။ ကုဒ်အသစ် ပြန်တောင်းပါ',
      msg_en: 'No active OTP found. Please request a new code.'
    };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(cleanEmail);
    return {
      ok: false,
      msg_th: 'รหัส OTP หมดอายุแล้ว (เกิน 5 นาที) กรุณาขอรหัสใหม่',
      msg_mm: 'OTP ကုဒ် သက်တမ်းကုန်သွားပါပြီ (၅ မိနစ်ကျော်လွန်)။ အသစ်ပြန်တောင်းပါ',
      msg_en: 'OTP code has expired. Please request a new code.'
    };
  }

  record.attempts += 1;
  if (record.attempts > 5) {
    otpStore.delete(cleanEmail);
    return {
      ok: false,
      msg_th: 'กรอกรหัสผิดเกินกำหนด กรุณากดขอรหัส OTP ใหม่อีกครั้ง',
      msg_mm: 'အကြိမ်ကြိမ် မှားယွင်းစွာ ရိုက်ထည့်ထားသဖြင့် ကုဒ်အသစ် ပြန်တောင်းပါ',
      msg_en: 'Too many incorrect attempts. Please request a new OTP.'
    };
  }

  const cleanInput = inputOtp.toString().trim();
  if (record.otp !== cleanInput) {
    const remainAttempts = 5 - record.attempts;
    return {
      ok: false,
      msg_th: `รหัส OTP ไม่ถูกต้อง (เหลือโอกาสอีก ${remainAttempts} ครั้ง)`,
      msg_mm: `OTP ကုဒ် မှားယွင်းနေပါသည် (နောက်ထပ် ${remainAttempts} ကြိမ် စမ်းနိုင်ပါသည်)`,
      msg_en: `Incorrect OTP code (${remainAttempts} attempts remaining).`
    };
  }

  // Verified successfully! Remove one-time code to prevent replay
  otpStore.delete(cleanEmail);

  return {
    ok: true,
    email: cleanEmail,
    mode: record.mode,
    name: record.name,
    msg_th: 'ยืนยันรหัส OTP สำเร็จ!',
    msg_mm: 'OTP ကုဒ် အောင်မြင်စွာ အတည်ပြုပြီးပါပြီ!',
    msg_en: 'OTP verified successfully!'
  };
}

/**
 * High-deliverability transactional email dispatcher with anti-spam optimization
 */
async function sendOtpEmail(email, otp, mode) {
  try {
    const settings = await db.getAllSettings();
    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
      return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
    }

    const smtpPort = parseInt(settings.smtpPort, 10) || 587;
    const isSecure = smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: smtpPort,
      secure: isSecure,
      requireTLS: !isSecure,
      auth: {
        user: settings.smtpUser,
        pass: settings.smtpPass
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Clean, trusted verification subject (avoids promotional spam triggers)
    const subject = `${otp} is your Free Wi-Fi verification code`;

    // Multipart plain-text alternative (avoids MIME_HTML_ONLY anti-spam penalty)
    const textBody = 
`Free Wi-Fi Verification Code: ${otp}

Your one-time security code is: ${otp}

Enter this code on the Wi-Fi sign-in screen to complete your connection.
• Valid for 5 minutes only.
• For your security, never share this code with anyone.
• Free Wi-Fi staff will never ask for your verification code.

If you did not request this verification code, you can safely ignore this message.

--
Free Wi-Fi Captive Portal Service
`;

    // High-deliverability responsive HTML email body
    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Wi-Fi Verification Code</title>
</head>
<body style="margin: 0; padding: 20px; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 460px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Header -->
    <div style="background-color: #2563eb; padding: 24px 20px; text-align: center;">
      <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">Free Wi-Fi Service</h1>
      <p style="margin: 4px 0 0; color: #bfdbfe; font-size: 13px;">Security Verification / รหัสยืนยันตัวตน</p>
    </div>

    <!-- Body Content -->
    <div style="padding: 28px 24px;">
      <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.5; color: #334155; text-align: center;">
        Here is your one-time verification code to connect to <strong>Free Wi-Fi</strong>:
      </p>

      <!-- OTP Display Box -->
      <div style="background-color: #f1f5f9; border: 2px dashed #cbd5e1; border-radius: 12px; padding: 18px 12px; text-align: center; margin: 20px 0;">
        <span style="font-family: 'Courier New', Courier, monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #0f172a; display: inline-block;">${otp}</span>
      </div>

      <p style="margin: 16px 0 8px; font-size: 13px; color: #475569; text-align: center;">
        ⏱ This code expires in <strong>5 minutes</strong> and can only be used once.
      </p>

      <div style="background-color: #fffbeb; border: 1px solid #fef3c7; border-radius: 10px; padding: 12px 14px; margin-top: 20px;">
        <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #92400e;">
          🔒 <strong>Security Tip:</strong> Never share this code. Free Wi-Fi staff will never ask for your verification code.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 16px 20px; text-align: center;">
      <p style="margin: 0; font-size: 11px; line-height: 1.4; color: #94a3b8;">
        This automated security message was sent because a Wi-Fi connection was requested for <strong>${email}</strong>.<br>
        If you did not request this, you can safely ignore this email.
      </p>
    </div>

  </div>
</body>
</html>
`;

    // Sender details aligned for SPF / DKIM verification
    const fromAddress = settings.smtpUser.trim();
    const fromDomain = fromAddress.includes('@') ? fromAddress.split('@')[1] : 'freewifi.local';
    const messageId = `<otp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}@${fromDomain}>`;

    const mailOptions = {
      from: `"Free Wi-Fi" <${fromAddress}>`,
      to: email,
      replyTo: fromAddress,
      subject: subject,
      text: textBody,
      html: htmlBody,
      headers: {
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
        'Precedence': 'bulk',
        'Importance': 'high',
        'X-Priority': '1',
        'X-Mailer': 'Free-WiFi-Gateway/2.0'
      },
      messageId: messageId,
      envelope: {
        from: fromAddress,
        to: email
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[OTP EMAIL SENT] To: ${email} MessageId: ${info.messageId || messageId}`);

    return { sent: true, messageId: info.messageId || messageId };
  } catch (err) {
    console.warn('[OTP EMAIL ERROR]', err.message);
    return { sent: false, error: err.message };
  }
}

/**
 * Periodically scan Firestore for pending OTP email dispatches from Firebase Hosting CDN
 */
let isSyncingOtps = false;
async function syncPendingFirestoreOtps() {
  if (isSyncingOtps) return;
  isSyncingOtps = true;
  try {
    const res = await fetch('https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/otps');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents || !Array.isArray(data.documents)) return;

    for (const doc of data.documents) {
      const fields = doc.fields || {};
      const status = fields.status?.stringValue || '';
      const expiresAt = parseInt(fields.expiresAt?.integerValue || '0', 10);
      const now = Date.now();

      if (status === 'pending_email' && expiresAt > now) {
        const parts = doc.name.split('/');
        const email = decodeURIComponent(parts[parts.length - 1]);
        const otp = fields.otp?.stringValue;
        const mode = fields.mode?.stringValue || 'free';

        if (email && otp) {
          console.log(`📧 [FIREBASE OTP] Dispatching OTP email to ${email} via Gmail SMTP...`);
          const resEmail = await sendOtpEmail(email, otp, mode);
          if (resEmail.sent) {
            console.log(`✅ [FIREBASE OTP] Email sent successfully to ${email}`);
            await fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/otps/${encodeURIComponent(email)}?updateMask.fieldPaths=status&updateMask.fieldPaths=sent_at`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                fields: {
                  status: { stringValue: 'sent' },
                  sent_at: { stringValue: new Date().toISOString() }
                }
              })
            }).catch(() => {});
          }
        }
      }
    }
  } catch (err) {
    // quiet catch
  } finally {
    isSyncingOtps = false;
  }
}

function startOtpSyncDaemon() {
  setInterval(() => {
    syncPendingFirestoreOtps().catch(() => {});
  }, 4000);
}

module.exports = {
  requestOtp,
  verifyOtp,
  sendOtpEmail,
  syncPendingFirestoreOtps,
  startOtpSyncDaemon
};

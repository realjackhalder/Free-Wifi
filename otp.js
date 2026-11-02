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
  const emailResult = await sendOtpEmail(cleanEmail, otp, mode, name);

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
 * Formatted specifically for Gmail's native OTP Quick-Action Card ("Code Requested" [Copy code])
 */
async function sendOtpEmail(email, otp, mode = 'free', name = '') {
  try {
    const settings = await db.getAllSettings();
    if (!settings.smtpHost || !settings.smtpUser || !settings.smtpPass) {
      return { sent: false, reason: 'SMTP_NOT_CONFIGURED' };
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    const rawName = (name || cleanEmail.split('@')[0] || 'User').trim();
    const capitalizedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);

    const smtpPort = parseInt(settings.smtpPort, 10) || 587;
    const isSecure = smtpPort === 465;

    const transporter = nodemailer.createTransport({
      host: settings.smtpHost,
      port: smtpPort,
      secure: isSecure,
      requireTLS: !isSecure,
      auth: {
        user: (settings.smtpUser || '').trim(),
        pass: (settings.smtpPass || '').replace(/\s+/g, '')
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    // Subject matching Gmail OTP trigger specifications ("Your security code")
    const subject = 'Your security code';

    // Plain-text alternative formatted for instant parser recognition
    const textBody = 
`Your security code

Hi ${capitalizedName},

A security code was requested for your Free Wi-Fi account. Please use the following security code to complete your sign-in:

Your security code is: ${otp}

Code Requested: ${otp}

• Valid for 5 minutes only.
• For your security, never share this code with anyone.

If you did not request this security code, you can safely ignore this email.

--
Free Wi-Fi
`;

    // Responsive HTML email designed to trigger Gmail's "Code Requested" [Copy code] Card
    const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your security code</title>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "EmailMessage",
  "description": "Code Requested: ${otp}",
  "potentialAction": {
    "@type": "ViewAction",
    "name": "Copy code",
    "target": "https://free-wifi-portal.web.app?otp=${otp}"
  }
}
</script>
</head>
<body style="margin: 0; padding: 32px 16px; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #111827; -webkit-font-smoothing: antialiased;">
  <!-- Gmail Preheader (triggers OTP extraction in notifications & summary cards) -->
  <div style="display: none; max-height: 0px; overflow: hidden; font-size: 1px; line-height: 1px; color: #ffffff; opacity: 0; mso-hide: all;">
    Code Requested: ${otp}. Your security code is: ${otp}. Use this code to complete sign-in to Free Wi-Fi.
  </div>

  <table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 480px; margin: 0 auto; background-color: #ffffff;">
    <!-- Centered Brand Logo Badge -->
    <tr>
      <td style="text-align: center; padding-bottom: 24px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td style="width: 50px; height: 50px; background-color: #000000; border-radius: 12px; text-align: center; vertical-align: middle; box-shadow: 0 4px 12px rgba(0,0,0,0.12);">
              <span style="color: #ffffff; font-size: 24px; line-height: 1;">⚡</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Main Title -->
    <tr>
      <td style="text-align: center; padding-bottom: 20px;">
        <h1 style="margin: 0; font-size: 26px; font-weight: 800; color: #000000; letter-spacing: -0.5px; line-height: 1.2;">
          Your security code
        </h1>
      </td>
    </tr>

    <!-- Greeting Line -->
    <tr>
      <td style="padding-bottom: 14px; font-size: 16px; color: #111827; line-height: 1.5;">
        Hi ${capitalizedName},
      </td>
    </tr>

    <!-- Instructional Text -->
    <tr>
      <td style="padding-bottom: 20px; font-size: 15px; color: #374151; line-height: 1.5;">
        A security code was requested for your <strong>Free Wi-Fi</strong> account. Please use the following security code to complete your sign-in:
      </td>
    </tr>

    <!-- Contiguous 6-Digit Security Code Container -->
    <tr>
      <td style="padding-bottom: 18px; text-align: center;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
          <tr>
            <td align="center" style="background-color: #f4f4f5; border: 1px solid #e4e4e7; border-radius: 12px; padding: 16px 28px; text-align: center;">
              <span style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Courier New', monospace; font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #000000; display: inline-block; user-select: all; -webkit-user-select: all;">${otp}</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- In-Email "Copy code" Pill Button -->
    <tr>
      <td style="text-align: center; padding-bottom: 24px;">
        <a href="https://free-wifi-portal.web.app?otp=${otp}" target="_blank" style="display: inline-block; background-color: #0b57d0; color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; text-decoration: none; padding: 10px 28px; border-radius: 20px; box-shadow: 0 2px 6px rgba(11,87,208,0.25);">
          Copy code
        </a>
      </td>
    </tr>

    <!-- Security Disclaimers -->
    <tr>
      <td style="border-top: 1px solid #f3f4f6; padding-top: 18px; font-size: 13px; line-height: 1.6; color: #6b7280;">
        <p style="margin: 0 0 6px;">• This security code will expire in <strong>5 minutes</strong>.</p>
        <p style="margin: 0 0 6px;">• Never share this code with anyone. Free Wi-Fi staff will never ask for your code.</p>
        <p style="margin: 0;">• If you did not request this security code, you can safely ignore this email.</p>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding-top: 24px; text-align: center; font-size: 12px; color: #9ca3af;">
        Free Wi-Fi Captive Portal • High-Speed Wireless Service
      </td>
    </tr>
  </table>
</body>
</html>
`;

    // Sender details aligned for SPF / DKIM verification
    const fromAddress = settings.smtpUser.trim();
    const fromDomain = fromAddress.includes('@') ? fromAddress.split('@')[1] : 'freewifi.local';
    const messageId = `<otp-${Date.now()}-${crypto.randomBytes(6).toString('hex')}@${fromDomain}>`;

    const mailOptions = {
      from: `"Free Wi-Fi" <${fromAddress}>`,
      to: cleanEmail,
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
        to: cleanEmail
      }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[OTP EMAIL SENT] To: ${cleanEmail} Subject: "${subject}" MessageId: ${info.messageId || messageId}`);

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
        const name = fields.name?.stringValue || '';

        if (email && otp) {
          console.log(`📧 [FIREBASE OTP] Dispatching OTP email to ${email} via Gmail SMTP...`);
          const resEmail = await sendOtpEmail(email, otp, mode, name);
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

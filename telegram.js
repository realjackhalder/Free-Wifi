// ============================================================================
// telegram.js — Telegram Bot Slip Notification & One-Click Approval System
// Free Wi-Fi Captive Portal & Gateway
// ============================================================================

const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const db = require('./database');
const { allowIp } = require('./firewall');

let isPolling = false;
let pollingAbortController = null;
let lastUpdateId = 0;

/**
 * Fetch current Telegram Bot Token & Chat ID from database settings or environment
 */
async function getConfig() {
  try {
    const settings = await db.getAllSettings();
    let token = (settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    let chatId = (settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();

    // Fallback: fetch from Cloud Firestore settings/config if not in SQLite
    if (!token || !chatId) {
      try {
        const res = await fetch('https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/settings/config');
        if (res.ok) {
          const d = await res.json();
          if (d?.fields?.telegramBotToken?.stringValue) token = d.fields.telegramBotToken.stringValue.trim();
          if (d?.fields?.telegramChatId?.stringValue) chatId = d.fields.telegramChatId.stringValue.trim();
        }
      } catch (e) {}
    }

    return { token, chatId };
  } catch (err) {
    return {
      token: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
      chatId: (process.env.TELEGRAM_CHAT_ID || '').trim()
    };
  }
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Send a payment slip to Telegram with Device IP, Email, and [Approve] / [Decline] buttons
 */
async function sendSlipNotification({ slipId, slipNum, email, ip, mac, amount, slipFilePath, qrPayload }) {
  const { token, chatId } = await getConfig();
  if (!token || !chatId) {
    console.warn('[TELEGRAM] Slip uploaded but Bot Token or Chat ID not configured. Configure in /admin.');
    return { success: false, reason: 'unconfigured' };
  }

  const cleanEmail = (email || 'Unknown').trim();
  const timeStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  const displayNum = slipNum ? String(slipNum).padStart(3, '0') : (String(slipId).replace(/^slip_/, '').length > 6 ? '001' : String(slipId).padStart(3, '0'));

  const captionHtml = 
`🧾 <b>Slip #${displayNum} • ${escapeHtml(cleanEmail)}</b>

🧾 <b>Slip:</b> <code>Slip #${displayNum}</code>
📧 <b>Google Email:</b> <code>${escapeHtml(cleanEmail)}</code>
💰 <b>Amount:</b> <b>${escapeHtml(amount || 150)} Baht</b> (30-Day VIP)
📱 <b>Device IP:</b> <code>${escapeHtml(ip || 'Unknown')}</code>
🏷️ <b>MAC Address:</b> <code>${escapeHtml(mac || 'Unknown')}</code>
⏰ <b>Upload Time:</b> ${escapeHtml(timeStr)}

Approve 30-Day VIP Wi-Fi access for this user?`;

  const captionPlain = 
`🧾 Slip #${displayNum} • ${cleanEmail}

🧾 Slip: Slip #${displayNum}
📧 Email: ${cleanEmail}
💰 Amount: ${amount || 150} Baht (30-Day VIP)
📱 Device IP: ${ip || 'Unknown'}
🏷️ MAC: ${mac || '-'}
⏰ Upload Time: ${timeStr}

Approve 30-Day VIP Wi-Fi access for this user?`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: `✅ Approve Slip #${displayNum}`, callback_data: `approve:${slipId}` },
        { text: `❌ Decline Slip #${displayNum}`, callback_data: `decline:${slipId}` }
      ]
    ]
  };

  try {
    // 1. Send payslip as Photo (sendPhoto) — NEVER as a document/file
    if (slipFilePath && fs.existsSync(slipFilePath)) {
      const fileBuffer = fs.readFileSync(slipFilePath);
      let photoBuffer = fileBuffer;
      let photoMime = 'image/jpeg';
      let photoFileName = 'payslip.jpg';

      try {
        const img = await Jimp.read(fileBuffer);
        // If image is very large (> 2048px), downscale to fit within 2048px for fast Telegram transfer
        if (img.bitmap.width > 2048 || img.bitmap.height > 2048) {
          img.scaleToFit(2048, 2048);
        }
        photoBuffer = await img.quality(90).getBufferAsync(Jimp.MIME_JPEG);
        photoMime = 'image/jpeg';
        photoFileName = 'payslip.jpg';
      } catch (imgErr) {
        console.warn('[TELEGRAM] Jimp normalization skipped:', imgErr.message);
        const ext = path.extname(slipFilePath).toLowerCase();
        photoMime = ext === '.png' ? 'image/png' : 'image/jpeg';
        photoFileName = ext === '.png' ? 'payslip.png' : 'payslip.jpg';
      }

      // Attempt 1: sendPhoto with formatted HTML caption
      try {
        const blob = new Blob([photoBuffer], { type: photoMime });
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, photoFileName);
        formData.append('caption', captionHtml);
        formData.append('parse_mode', 'HTML');
        formData.append('reply_markup', JSON.stringify(inlineKeyboard));

        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.ok) {
          console.log(`✅ [TELEGRAM] Slip #${slipId} photo sent successfully to Telegram chat ${chatId}`);
          return { success: true, messageId: data.result.message_id };
        } else {
          console.warn(`[TELEGRAM sendPhoto HTML caption failed: ${data.description}]. Retrying with plain caption...`);
        }
      } catch (e1) {
        console.warn('[TELEGRAM sendPhoto attempt 1 error]:', e1.message);
      }

      // Attempt 2: sendPhoto with plain text caption (bypasses any HTML parsing errors)
      try {
        const blob = new Blob([photoBuffer], { type: photoMime });
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, photoFileName);
        formData.append('caption', captionPlain);
        formData.append('reply_markup', JSON.stringify(inlineKeyboard));

        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.ok) {
          console.log(`✅ [TELEGRAM] Slip #${slipId} photo sent with plain caption to Telegram`);
          return { success: true, messageId: data.result.message_id };
        } else {
          console.warn(`[TELEGRAM sendPhoto attempt 2 failed: ${data.description}]. Retrying with minimal caption...`);
        }
      } catch (e2) {
        console.warn('[TELEGRAM sendPhoto attempt 2 error]:', e2.message);
      }

      // Attempt 3: sendPhoto with short caption
      try {
        const blob = new Blob([photoBuffer], { type: photoMime });
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('photo', blob, photoFileName);
        formData.append('caption', `🧾 New Payment Slip #${slipId}\nEmail: ${cleanEmail}\nDevice IP: ${ip || 'Unknown'}\nAmount: 150 Baht (30-Day VIP)`);
        formData.append('reply_markup', JSON.stringify(inlineKeyboard));

        const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.ok) {
          console.log(`✅ [TELEGRAM] Slip #${slipId} photo sent with minimal caption`);
          return { success: true, messageId: data.result.message_id };
        }
      } catch (e3) {
        console.warn('[TELEGRAM sendPhoto attempt 3 error]:', e3.message);
      }
    }

    // 2. Fallback to HTML text message
    try {
      const textRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: captionHtml,
          parse_mode: 'HTML',
          reply_markup: inlineKeyboard
        })
      });
      const textData = await textRes.json();
      if (textData.ok) {
        console.log(`✅ [TELEGRAM] Slip #${slipId} text message sent to chat ${chatId}`);
        return { success: true, messageId: textData.result?.message_id };
      }
    } catch (e) {}

    // 3. Ultra-failsafe: Plain text message without any formatting
    const plainRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: captionPlain,
        reply_markup: inlineKeyboard
      })
    });
    const plainData = await plainRes.json();
    if (plainData.ok) {
      console.log(`✅ [TELEGRAM] Slip #${slipId} plain text fallback delivered to chat ${chatId}`);
      return { success: true, messageId: plainData.result?.message_id };
    } else {
      console.error(`❌ [TELEGRAM ERROR] All send attempts failed:`, plainData.description);
      return { success: false, error: plainData.description };
    }
  } catch (err) {
    console.error('[TELEGRAM sendSlipNotification error]:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Send a test notification to verify Bot Token and Chat ID
 */
async function sendTestMessage(customToken = null, customChatId = null) {
  const config = await getConfig();
  const token = customToken || config.token;
  const chatId = customChatId || config.chatId;

  if (!token || !chatId) {
    return { success: false, error: 'Telegram Bot Token or Chat ID is not configured' };
  }

  const text =
`🤖 <b>Free Wi-Fi Telegram Bot Test Notification</b>

📡 System: Free Wi-Fi Captive Portal & Gateway
⏰ Time: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}
✅ Connected successfully! When users upload payment slips, notifications will arrive here with [Approve] and [Decline] buttons.`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML'
      })
    });
    const data = await res.json();
    if (data.ok) {
      return { success: true };
    } else {
      return { success: false, error: data.description || 'Telegram API Error' };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Handle inline button click (Approve or Decline)
 */
/**
 * Handle inline button click (Approve or Decline)
 */
async function handleCallbackQuery(query, token) {
  const queryId = query.id;
  const data = query.data || '';
  const message = query.message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;

  const [action, ...idParts] = data.split(':');
  const slipIdStr = idParts.join(':').trim();

  if (!slipIdStr) {
    await answerCallback(token, queryId, '⚠️ Invalid slip ID');
    return;
  }

  let slip = null;
  let isFirestoreSlip = false;

  // 1. Try local SQLite first (if numeric ID)
  const numId = parseInt(slipIdStr, 10);
  if (!isNaN(numId) && String(numId) === slipIdStr) {
    slip = await db.getSlipById(numId);
  }

  // 2. If not found in SQLite, look up in Cloud Firestore REST API
  if (!slip) {
    try {
      const fsRes = await fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/slips/${encodeURIComponent(slipIdStr)}`);
      if (fsRes.ok) {
        const fsDoc = await fsRes.json();
        if (fsDoc && fsDoc.fields) {
          isFirestoreSlip = true;
          slip = {
            id: slipIdStr,
            slipNum: fsDoc.fields.slipNum?.stringValue || null,
            email: fsDoc.fields.email?.stringValue || fsDoc.fields.name?.stringValue || '',
            amount: parseInt(fsDoc.fields.amount?.integerValue || fsDoc.fields.amount?.stringValue || '150', 10),
            status: fsDoc.fields.status?.stringValue || 'pending',
            ip_address: fsDoc.fields.ip?.stringValue || fsDoc.fields.ip_address?.stringValue || 'Web Portal',
            mac_address: fsDoc.fields.mac?.stringValue || fsDoc.fields.mac_address?.stringValue || null
          };
        }
      }
    } catch (fsErr) {
      console.warn('[TELEGRAM] Firestore slip lookup error:', fsErr.message);
    }
  }

  if (!slip) {
    await answerCallback(token, queryId, `⚠️ Slip ${slipIdStr} not found in database or Firebase`);
    return;
  }

  const cleanEmail = slip.email.trim().toLowerCase();
  const targetIp = slip.ip_address;
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const newExp = now + thirtyDaysMs;
  const timeStr = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' });

  // Calculate chronological slip number (e.g. 001, 002) matching Admin Dashboard
  let displayNum = '001';
  if (slip.slipNum) {
    displayNum = String(slip.slipNum).padStart(3, '0');
  } else if (!isNaN(numId)) {
    try {
      const allSlips = await db.getAllSlips();
      const sorted = [...allSlips].sort((a, b) => (a.uploaded_at || 0) - (b.uploaded_at || 0));
      const idx = sorted.findIndex(s => s.id === numId);
      displayNum = String(idx !== -1 ? idx + 1 : numId).padStart(3, '0');
    } catch (e) {
      displayNum = String(numId).padStart(3, '0');
    }
  }

  if (action === 'approve') {
    // 1. Activate 30-Day VIP in Cloud Firestore (Account)
    if (cleanEmail) {
      try {
        await fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/accounts/${encodeURIComponent(cleanEmail)}?updateMask.fieldPaths=email&updateMask.fieldPaths=plan&updateMask.fieldPaths=package_type&updateMask.fieldPaths=status&updateMask.fieldPaths=expiresAt&updateMask.fieldPaths=expires_at&updateMask.fieldPaths=updated_at`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fields: {
              email: { stringValue: cleanEmail },
              plan: { stringValue: 'vip-30d' },
              package_type: { stringValue: 'vip_30d' },
              status: { stringValue: 'active' },
              expiresAt: { integerValue: String(newExp) },
              expires_at: { stringValue: new Date(newExp).toISOString() },
              updated_at: { stringValue: new Date(now).toISOString() }
            }
          })
        });
      } catch (e) {
        console.warn('[TELEGRAM] Failed to patch Firestore account:', e.message);
      }
    }

    // 2. Mark slip approved in Cloud Firestore
    try {
      await fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/slips/${encodeURIComponent(slipIdStr)}?updateMask.fieldPaths=status&updateMask.fieldPaths=approved_at&updateMask.fieldPaths=verified_at`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            status: { stringValue: 'approved' },
            approved_at: { stringValue: new Date(now).toISOString() },
            verified_at: { stringValue: new Date(now).toISOString() }
          }
        })
      });
    } catch (e) {
      console.warn('[TELEGRAM] Failed to patch Firestore slip status:', e.message);
    }

    // 3. Save to local SQLite database & Firewall
    const existing = await db.getAccount(cleanEmail);
    const accountData = {
      email: cleanEmail,
      name: existing?.name || cleanEmail.split('@')[0],
      plan: 'vip-30d',
      createdAt: existing?.createdAt || now,
      expiresAt: newExp,
      lastTrialAt: existing?.lastTrialAt || null,
      activeIp: targetIp,
      activeMac: slip.mac_address || null,
      blocked: false
    };
    await db.saveAccount(accountData);

    if (targetIp && targetIp !== 'Web Portal' && targetIp !== 'Unknown') {
      try { await allowIp(targetIp); } catch (e) {}
    }

    if (!isFirestoreSlip && !isNaN(numId)) {
      await db.updateSlipStatus(numId, 'approved');
    }
    await db.logIpAction({ email: cleanEmail, ip: targetIp, mac: slip.mac_address, action: 'buy_package' });

    console.log(`🎉 [TELEGRAM APPROVE] Slip #${displayNum} (${slipIdStr}) approved for ${cleanEmail} (IP: ${targetIp}). 30-Day VIP granted!`);

    // 4. Answer callback with popup alert
    await answerCallback(token, queryId, `✅ Approved Slip #${displayNum} for ${cleanEmail}!\n30-Day VIP Wi-Fi has been activated.`, true);

    // 5. Update message caption & remove buttons
    const updatedCaption =
`✅ <b>[PAYMENT APPROVED] — Slip #${displayNum}</b>

🧾 <b>Slip Number:</b> <code>Slip #${displayNum}</code>
📧 <b>Google Email:</b> <code>${cleanEmail}</code>
💰 <b>Package:</b> <b>★ 30-Day VIP (Unlimited)</b>
📱 <b>Device IP:</b> <code>${targetIp}</code>
🏷️ <b>MAC:</b> <code>${slip.mac_address || 'Unknown'}</code>
⏰ <b>Approved Time:</b> ${timeStr}

✓ Approved by Admin via Telegram`;

    await editMessage(token, chatId, messageId, updatedCaption);

  } else if (action === 'decline') {
    // 1. Mark slip declined in Cloud Firestore
    try {
      await fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/slips/${encodeURIComponent(slipIdStr)}?updateMask.fieldPaths=status&updateMask.fieldPaths=declined_at&updateMask.fieldPaths=verified_at`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            status: { stringValue: 'declined' },
            declined_at: { stringValue: new Date(now).toISOString() },
            verified_at: { stringValue: new Date(now).toISOString() }
          }
        })
      });
    } catch (e) {
      console.warn('[TELEGRAM] Failed to patch Firestore decline status:', e.message);
    }

    // 2. Mark slip declined in local SQLite
    if (!isFirestoreSlip && !isNaN(numId)) {
      await db.updateSlipStatus(numId, 'declined');
    }
    console.log(`❌ [TELEGRAM DECLINE] Slip #${displayNum} (${slipIdStr}) declined for ${cleanEmail}`);

    await answerCallback(token, queryId, `❌ Declined Slip #${displayNum} (${cleanEmail})`, false);

    const declinedCaption =
`❌ <b>[PAYMENT DECLINED] — Slip #${displayNum}</b>

🧾 <b>Slip Number:</b> <code>Slip #${displayNum}</code>
📧 <b>Google Email:</b> <code>${cleanEmail}</code>
💰 <b>Status:</b> Payment slip was declined
📱 <b>Device IP:</b> <code>${targetIp}</code>
⏰ <b>Declined Time:</b> ${timeStr}

✕ Declined by Admin via Telegram`;

    await editMessage(token, chatId, messageId, declinedCaption);
  }
}

async function answerCallback(token, callbackQueryId, text, showAlert = false) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text,
        show_alert: showAlert
      })
    });
  } catch (e) {
    /* ignore */
  }
}

async function editMessage(token, chatId, messageId, caption) {
  try {
    // Try editing photo caption
    const res = await fetch(`https://api.telegram.org/bot${token}/editMessageCaption`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        caption,
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [] }
      })
    });
    const data = await res.json();
    if (!data.ok) {
      // Fallback: edit text if original wasn't a photo
      await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageId,
          text: caption,
          parse_mode: 'HTML',
          reply_markup: { inline_keyboard: [] }
        })
      });
    }
  } catch (e) {
    /* ignore */
  }
}

/**
 * Send a Firestore-originated slip notification to Telegram
 */
async function sendFirestoreSlipNotification(token, chatId, slipId, email, amount, imageBase64, slipNum) {
  const cleanEmail = (email || 'Unknown').trim();
  const timeStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  const displayNum = slipNum ? String(slipNum).padStart(3, '0') : '001';

  const captionHtml = 
`🧾 <b>Slip #${displayNum} • ${escapeHtml(cleanEmail)}</b>

🧾 <b>Slip Number:</b> <code>Slip #${displayNum}</code>
📧 <b>Google Email:</b> <code>${escapeHtml(cleanEmail)}</code>
💰 <b>Amount:</b> <b>${escapeHtml(amount || 150)} Baht</b> (30-Day VIP)
📱 <b>Device:</b> <code>Web Portal (Firebase)</code>
⏰ <b>Upload Time:</b> ${escapeHtml(timeStr)}

Approve 30-Day VIP Wi-Fi access for this user?`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: `✅ Approve Slip #${displayNum}`, callback_data: `approve:${slipId}` },
        { text: `❌ Decline Slip #${displayNum}`, callback_data: `decline:${slipId}` }
      ]
    ]
  };

  // Try sending photo from base64 if available
  if (imageBase64 && typeof imageBase64 === 'string') {
    try {
      const b64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
      const photoBuffer = Buffer.from(b64Data, 'base64');
      const blob = new Blob([photoBuffer], { type: 'image/jpeg' });
      const fd = new FormData();
      fd.append('chat_id', chatId);
      fd.append('photo', blob, 'payslip.jpg');
      fd.append('caption', captionHtml);
      fd.append('parse_mode', 'HTML');
      fd.append('reply_markup', JSON.stringify(inlineKeyboard));

      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: fd
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`✅ [TELEGRAM] Sent Firestore slip #${slipId} photo to Telegram`);
        return true;
      }
    } catch (e) {
      console.warn('[TELEGRAM] sendFirestoreSlipNotification photo error:', e.message);
    }
  }

  // Fallback to text message
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: captionHtml,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      })
    });
    const data = await res.json();
    return !!data.ok;
  } catch (e) {
    console.warn('[TELEGRAM] sendFirestoreSlipNotification text error:', e.message);
    return false;
  }
}

/**
 * Periodically check Cloud Firestore for pending slips that haven't been notified to Telegram
 */
async function checkFirestorePendingSlips(token, chatId) {
  try {
    const res = await fetch('https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/slips');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.documents || !Array.isArray(data.documents)) return;

    // Sort documents chronologically so slip number counts upwards from 001
    const sortedDocs = [...data.documents].sort((a, b) => {
      const tA = a.fields?.uploaded_at?.stringValue ? new Date(a.fields.uploaded_at.stringValue).getTime() : parseInt(a.fields?.createdAt?.integerValue || '0', 10);
      const tB = b.fields?.uploaded_at?.stringValue ? new Date(b.fields.uploaded_at.stringValue).getTime() : parseInt(b.fields?.createdAt?.integerValue || '0', 10);
      return tA - tB;
    });

    for (let i = 0; i < sortedDocs.length; i++) {
      const doc = sortedDocs[i];
      const fields = doc.fields || {};
      const status = (fields.status?.stringValue || 'pending').toLowerCase();
      const tgNotified = fields.telegram_notified?.booleanValue;
      if (status === 'pending' && !tgNotified) {
        const parts = doc.name.split('/');
        const slipId = parts[parts.length - 1];
        const slipNum = fields.slipNum?.stringValue || String(i + 1).padStart(3, '0');
        const email = fields.email?.stringValue || fields.name?.stringValue || 'Unknown';
        const amount = fields.amount?.integerValue || fields.amount?.stringValue || '150';
        const imageBase64 = fields.imageBase64?.stringValue;

        console.log(`📡 [TELEGRAM] Found unnotified pending Firestore Slip #${slipNum} (${slipId}). Sending to Telegram...`);
        const sent = await sendFirestoreSlipNotification(token, chatId, slipId, email, amount, imageBase64, slipNum);

        if (sent) {
          await fetch(`https://firestore.googleapis.com/v1/projects/free-wifi-portal/databases/(default)/documents/slips/${encodeURIComponent(slipId)}?updateMask.fieldPaths=telegram_notified&updateMask.fieldPaths=slipNum`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fields: {
                telegram_notified: { booleanValue: true },
                slipNum: { stringValue: slipNum }
              }
            })
          }).catch(() => {});
        }
      }
    }
  } catch (err) {
    // quiet catch
  }
}

/**
 * Long-polling worker loop to receive Telegram button clicks anywhere behind NAT/firewall
 */
async function startPolling() {
  if (isPolling) return;
  isPolling = true;

  console.log('🤖 [TELEGRAM] Telegram Bot polling daemon started.');

  const initialCfg = await getConfig();
  if (initialCfg.token) {
    await fetch(`https://api.telegram.org/bot${initialCfg.token}/deleteWebhook`).catch(() => {});
  }

  while (isPolling) {
    const { token, chatId } = await getConfig();
    if (!token) {
      // Wait 10 seconds and recheck if token was added in /admin
      await new Promise(r => setTimeout(r, 10000));
      continue;
    }

    try {
      // Periodically check Cloud Firestore for pending slips that need Telegram notification
      checkFirestorePendingSlips(token, chatId).catch(() => {});

      pollingAbortController = new AbortController();
      const timeoutId = setTimeout(() => pollingAbortController.abort(), 35000);

      const url = `https://api.telegram.org/bot${token}/getUpdates?offset=${lastUpdateId + 1}&timeout=25`;
      const res = await fetch(url, { signal: pollingAbortController.signal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }

      const data = await res.json();
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          lastUpdateId = Math.max(lastUpdateId, update.update_id);

          // Handle inline button press
          if (update.callback_query) {
            await handleCallbackQuery(update.callback_query, token);
          }

          // Handle /start or /id commands in private chat
          if (update.message && update.message.text) {
            const txt = update.message.text.trim();
            if (txt === '/start' || txt === '/id' || txt === '/chatid') {
              const fromId = update.message.chat.id;
              await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: fromId,
                  parse_mode: 'HTML',
                  text: `📡 <b>Free Wi-Fi Captive Portal Bot</b>\n\nYour Chat ID is: <code>${fromId}</code>\n\nEnter this Chat ID in the Web Admin (<code>/admin</code>) settings to receive payment slip notifications and one-click [Approve] / [Decline] buttons here.`
                })
              }).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('⚠️ [TELEGRAM POLLING ERROR]', err.message);
        await new Promise(r => setTimeout(r, 5000));
      } else {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }
}

function stopPolling() {
  isPolling = false;
  if (pollingAbortController) {
    try { pollingAbortController.abort(); } catch (e) {}
  }
}

function reload() {
  console.log('🔄 [TELEGRAM] Reloading Telegram configuration...');
  // Loop will pick up new credentials on next iteration
}

module.exports = {
  getConfig,
  sendSlipNotification,
  sendTestMessage,
  startPolling,
  stopPolling,
  reload
};

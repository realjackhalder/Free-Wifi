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
    const token = (settings.telegramBotToken || process.env.TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = (settings.telegramChatId || process.env.TELEGRAM_CHAT_ID || '').trim();
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
async function sendSlipNotification({ slipId, email, ip, mac, amount, slipFilePath, qrPayload }) {
  const { token, chatId } = await getConfig();
  if (!token || !chatId) {
    console.warn('[TELEGRAM] Slip uploaded but Bot Token or Chat ID not configured. Configure in /admin.');
    return { success: false, reason: 'unconfigured' };
  }

  const cleanEmail = (email || 'Unknown').trim();
  const timeStr = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' });
  const rawQr = qrPayload ? qrPayload.substring(0, 40) : '';
  const qrNote = rawQr
    ? `Verified (${escapeHtml(rawQr)}...)`
    : 'File Attached / Manual Check';

  const captionHtml = 
`🧾 <b>New Payment Slip Received (#${slipId})</b>
──────────────────────────────
📧 <b>Google Email:</b> <code>${escapeHtml(cleanEmail)}</code>
📱 <b>Device IP:</b> <code>${escapeHtml(ip || 'Unknown')}</code>
🏷️ <b>MAC Address:</b> <code>${escapeHtml(mac || 'Unknown')}</code>
💰 <b>Amount:</b> <b>${escapeHtml(amount || 150)} Baht</b> (30-Day VIP)
⏰ <b>Upload Time:</b> ${escapeHtml(timeStr)}
🔍 <b>QR / File Info:</b> ${qrNote}
──────────────────────────────
Approve 30-Day VIP Wi-Fi access for this user?`;

  const captionPlain = 
`🧾 New Payment Slip Received (#${slipId})
──────────────────────────────
📧 Email: ${cleanEmail}
📱 Device IP: ${ip || 'Unknown'}
🏷️ MAC: ${mac || '-'}
💰 Amount: ${amount || 150} Baht (30-Day VIP)
⏰ Upload Time: ${timeStr}
──────────────────────────────
Approve 30-Day VIP Wi-Fi access for this user?`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve', callback_data: `approve:${slipId}` },
        { text: '❌ Decline', callback_data: `decline:${slipId}` }
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
──────────────────────────────
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
async function handleCallbackQuery(query, token) {
  const queryId = query.id;
  const data = query.data || '';
  const message = query.message;
  const chatId = message?.chat?.id;
  const messageId = message?.message_id;

  const [action, idStr] = data.split(':');
  const slipId = parseInt(idStr, 10);

  if (!slipId) {
    await answerCallback(token, queryId, '⚠️ Invalid slip ID');
    return;
  }

  const slip = await db.getSlipById(slipId);
  if (!slip) {
    await answerCallback(token, queryId, '⚠️ Slip record not found in database');
    return;
  }

  const cleanEmail = slip.email.trim().toLowerCase();
  const targetIp = slip.ip_address;
  const now = Date.now();
  const timeStr = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Bangkok' });

  if (action === 'approve') {
    // 1. Activate 30-Day VIP for the user
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const existing = await db.getAccount(cleanEmail);
    const accountData = {
      email: cleanEmail,
      name: existing?.name || cleanEmail.split('@')[0],
      plan: 'vip-30d',
      createdAt: existing?.createdAt || now,
      expiresAt: now + thirtyDaysMs,
      lastTrialAt: existing?.lastTrialAt || null,
      activeIp: targetIp,
      activeMac: slip.mac_address || null,
      blocked: false
    };

    await db.saveAccount(accountData);

    // 2. Open firewall for user's IP
    await allowIp(targetIp);

    // 3. Mark slip approved & log
    await db.updateSlipStatus(slipId, 'approved');
    await db.logIpAction({ email: cleanEmail, ip: targetIp, mac: slip.mac_address, action: 'buy_package' });

    console.log(`🎉 [TELEGRAM APPROVE] Slip #${slipId} approved for ${cleanEmail} (IP: ${targetIp}). 30-Day VIP granted!`);

    // 4. Answer callback with popup alert
    await answerCallback(token, queryId, `✅ Payment Approved!\n\nEmail: ${cleanEmail}\nIP: ${targetIp}\n30-Day VIP Wi-Fi has been activated!`, true);

    // 5. Update message caption & remove buttons
    const updatedCaption =
`✅ <b>[PAYMENT APPROVED]</b>
──────────────────────────────
📧 <b>Email:</b> <code>${cleanEmail}</code>
📱 <b>Device IP:</b> <code>${targetIp}</code> (Internet Unlocked)
🏷️ <b>MAC:</b> <code>${slip.mac_address || 'Unknown'}</code>
💰 <b>Package:</b> <b>★ VIP 30-Day (Unlimited)</b>
⏰ <b>Approved Time:</b> ${timeStr}
──────────────────────────────
✓ Approved by Admin via Telegram`;

    await editMessage(token, chatId, messageId, updatedCaption);

  } else if (action === 'decline') {
    // Mark slip as declined
    await db.updateSlipStatus(slipId, 'declined');
    console.log(`❌ [TELEGRAM DECLINE] Slip #${slipId} declined for ${cleanEmail}`);

    await answerCallback(token, queryId, `❌ Payment slip declined (${cleanEmail})`, false);

    const declinedCaption =
`❌ <b>[PAYMENT DECLINED]</b>
──────────────────────────────
📧 <b>Email:</b> <code>${cleanEmail}</code>
📱 <b>Device IP:</b> <code>${targetIp}</code>
💰 <b>Status:</b> Payment slip was declined
⏰ <b>Declined Time:</b> ${timeStr}
──────────────────────────────
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

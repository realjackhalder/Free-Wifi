// ============================================================================
// telegram.js — Telegram Bot Slip Notification & One-Click Approval System
// Free Wi-Fi Captive Portal & Gateway
// ============================================================================

const fs = require('fs');
const path = require('path');
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
  const qrNote = qrPayload
    ? `စစ်ဆေးပြီး (${qrPayload.substring(0, 24)}...)`
    : 'လက်စွဲစစ်ဆေးရန် (Manual Check)';

  const caption = 
`🧾 <b>ငွေလွှဲပြေစာ အသစ် ရောက်ရှိပါသည် (New Payment Slip)</b>
──────────────────────────────
📧 <b>Google Email:</b> <code>${cleanEmail}</code>
📱 <b>စက် IP လိပ်စာ (Device IP):</b> <code>${ip || 'Unknown'}</code>
🏷️ <b>MAC Address:</b> <code>${mac || 'မသိရှိပါ'}</code>
💰 <b>ပမာဏ (Amount):</b> <b>${amount || 150} Baht</b> (30-Day VIP)
⏰ <b>တင်ခဲ့သည့် အချိန်:</b> ${timeStr}
🔍 <b>ဘဏ် QR အချက်အလက်:</b> ${qrNote}
──────────────────────────────
ဤအသုံးပြုသူအား ရက် ၃၀ VIP အင်တာနက် ဖွင့်ပေးရန် ခွင့်ပြုမလား?`;

  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: '✅ Approve (အတည်ပြုမည်)', callback_data: `approve:${slipId}` },
        { text: '❌ Decline (ပယ်ဖျက်မည်)', callback_data: `decline:${slipId}` }
      ]
    ]
  };

  try {
    // 1. Try sending as Photo if file exists
    if (slipFilePath && fs.existsSync(slipFilePath)) {
      const formData = new FormData();
      const fileBuffer = fs.readFileSync(slipFilePath);
      const ext = path.extname(slipFilePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');
      const blob = new Blob([fileBuffer], { type: mime });

      formData.append('chat_id', chatId);
      formData.append('photo', blob, path.basename(slipFilePath));
      formData.append('caption', caption);
      formData.append('parse_mode', 'HTML');
      formData.append('reply_markup', JSON.stringify(inlineKeyboard));

      const res = await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (data.ok) {
        console.log(`✅ [TELEGRAM] Slip #${slipId} photo sent to Telegram chat ${chatId}`);
        return { success: true, messageId: data.result.message_id };
      } else {
        console.warn(`[TELEGRAM sendPhoto failed]`, data.description);
      }
    }

    // 2. Fallback to text message if photo fails
    const textRes = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: caption,
        parse_mode: 'HTML',
        reply_markup: inlineKeyboard
      })
    });
    const textData = await textRes.json();
    return { success: textData.ok, messageId: textData.result?.message_id };
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
    return { success: false, error: 'Telegram Bot Token သို့မဟုတ် Chat ID ထည့်သွင်းထားခြင်း မရှိပါ' };
  }

  const text =
`🤖 <b>Free Wi-Fi Telegram Bot စမ်းသပ်မှု အောင်မြင်ပါသည်!</b>
──────────────────────────────
📡 စနစ်: Free Wi-Fi Captive Portal & Gateway
⏰ အချိန်: ${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Bangkok' })}
✅ အသုံးပြုသူများ ငွေလွှဲပြေစာ တင်သည့်အခါ ဤနေရာသို့ ချက်ချင်း ပေးပို့မည်ဖြစ်ပြီး <b>[Approve]</b> ခလုတ် နှိပ်ရုံဖြင့် အင်တာနက် ဖွင့်ပေးနိုင်ပါပြီ။`;

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
    await answerCallback(token, queryId, '⚠️ မမှန်ကန်သော ပြေစာနံပါတ်');
    return;
  }

  const slip = await db.getSlipById(slipId);
  if (!slip) {
    await answerCallback(token, queryId, '⚠️ ပြေစာကို ဒေတာဘေ့စ်တွင် မတွေ့ရှိပါ');
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
    await answerCallback(token, queryId, `✅ အတည်ပြုပြီးပါပြီ!\n\nအီးမေးလ်: ${cleanEmail}\nIP: ${targetIp}\nရက် ၃၀ VIP အင်တာနက် ဖွင့်ပေးလိုက်ပါပြီ!`, true);

    // 5. Update message caption & remove buttons
    const updatedCaption =
`✅ <b>[အတည်ပြုပြီး / APPROVED]</b>
──────────────────────────────
📧 <b>Email:</b> <code>${cleanEmail}</code>
📱 <b>Device IP:</b> <code>${targetIp}</code> (အင်တာနက် ဖွင့်ပေးပြီး)
🏷️ <b>MAC:</b> <code>${slip.mac_address || 'မသိရှိပါ'}</code>
💰 <b>ပက်ကေ့ဂျ်:</b> <b>★ VIP 30-Day (Unlimited)</b>
⏰ <b>အတည်ပြုချိန်:</b> ${timeStr}
──────────────────────────────
✓ စီမံခန့်ခွဲသူမှ Telegram မှတစ်ဆင့် အောင်မြင်စွာ ခွင့်ပြုပေးခဲ့သည်`;

    await editMessage(token, chatId, messageId, updatedCaption);

  } else if (action === 'decline') {
    // Mark slip as declined
    await db.updateSlipStatus(slipId, 'declined');
    console.log(`❌ [TELEGRAM DECLINE] Slip #${slipId} declined for ${cleanEmail}`);

    await answerCallback(token, queryId, `❌ ပြေစာအား ငြင်းပယ်လိုက်ပါသည် (${cleanEmail})`, false);

    const declinedCaption =
`❌ <b>[ငြင်းပယ်ပြီး / DECLINED]</b>
──────────────────────────────
📧 <b>Email:</b> <code>${cleanEmail}</code>
📱 <b>Device IP:</b> <code>${targetIp}</code>
💰 <b>အခြေအနေ:</b> ငွေလွှဲပြေစာအား ပယ်ဖျက်ထားပါသည်
⏰ <b>ပယ်ဖျက်ချိန်:</b> ${timeStr}
──────────────────────────────
✕ စီမံခန့်ခွဲသူမှ အတည်မပြုဘဲ ပယ်ဖျက်ခဲ့ပါသည်`;

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
                  text: `📡 <b>Free Wi-Fi Captive Portal Bot</b>\n\nသင့် Chat ID မှာ: <code>${fromId}</code> ဖြစ်ပါသည်\n\nဤ Chat ID အား Web Admin (<code>/admin</code>) ဆက်တင်ထဲတွင် ထည့်သွင်းပါက ငွေလွှဲပြေစာများနှင့် [Approve] / [Decline] ခလုတ်များ ဤနေရာသို့ ရောက်ရှိလာပါမည်။`
                })
              }).catch(() => {});
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        // Network or connection error: brief sleep to prevent rapid looping
        await new Promise(r => setTimeout(r, 5000));
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

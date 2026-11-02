// ============================================================================
// database.js — Hybrid Cloud Firestore & SQLite Database Storage
// Free Wi-Fi Captive Portal & Gateway
// ============================================================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const fb = require('./firebase-backend');

const DB_PATH = path.join(__dirname, 'wifi.db');
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/**
 * Initialize SQLite Database & Tables
 */
async function initDb() {
  await run(`
    CREATE TABLE IF NOT EXISTS accounts (
      email TEXT PRIMARY KEY,
      name TEXT,
      picture TEXT,
      google_id TEXT,
      plan TEXT DEFAULT 'free-1h',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_trial_at INTEGER,
      active_ip TEXT,
      active_mac TEXT,
      blocked INTEGER DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS slips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      ip_address TEXT NOT NULL,
      mac_address TEXT,
      filename TEXT NOT NULL,
      cloud_url TEXT,
      qr_payload TEXT UNIQUE NOT NULL,
      amount INTEGER DEFAULT 150,
      status TEXT DEFAULT 'verified',
      uploaded_at INTEGER NOT NULL
    )
  `);

  try {
    await run(`ALTER TABLE slips ADD COLUMN cloud_url TEXT`);
  } catch (e) {
    /* column already exists */
  }
  try {
    await run(`ALTER TABLE accounts ADD COLUMN last_ip TEXT`);
  } catch (e) {
    /* column already exists */
  }
  try {
    await run(`ALTER TABLE accounts ADD COLUMN last_mac TEXT`);
  } catch (e) {
    /* column already exists */
  }

  await run(`
    CREATE TABLE IF NOT EXISTS ip_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT,
      ip_address TEXT NOT NULL,
      mac_address TEXT,
      action TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Default settings
  const price = await get(`SELECT value FROM settings WHERE key = 'monthlyPrice'`);
  if (!price) await run(`INSERT INTO settings (key, value) VALUES ('monthlyPrice', '150')`);

  const trial = await get(`SELECT value FROM settings WHERE key = 'trialMinutes'`);
  if (!trial) await run(`INSERT INTO settings (key, value) VALUES ('trialMinutes', '60')`);

  const pin = await get(`SELECT value FROM settings WHERE key = 'adminPin'`);
  if (!pin) await run(`INSERT INTO settings (key, value) VALUES ('adminPin', '1234')`);

  const googleClientId = await get(`SELECT value FROM settings WHERE key = 'googleClientId'`);
  if (!googleClientId || !googleClientId.value) {
    await run(`INSERT OR REPLACE INTO settings (key, value) VALUES ('googleClientId', '197252344762-1lbm4e209p2ri1m5pu9b789fegj61m7s.apps.googleusercontent.com')`);
  }

  const jack = await get(`SELECT email FROM accounts WHERE email = 'realjackhalder@gmail.com'`);
  if (!jack) {
    const now = Date.now();
    await run(`INSERT INTO accounts (email, name, picture, plan, created_at, expires_at, last_trial_at, blocked) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ['realjackhalder@gmail.com', 'Jack Halder', null, 'free-1h', now, 0, null, 0]
    );
  }

  const vpnEndpoint = await get(`SELECT value FROM settings WHERE key = 'vpnEndpoint'`);
  if (!vpnEndpoint) await run(`INSERT INTO settings (key, value) VALUES ('vpnEndpoint', '')`);
}

// ============================================================================
// Google Account Operations (Firestore + SQLite Hybrid)
// ============================================================================

async function getAccount(email) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();

  // Try Firestore first if available
  if (fb.isReady()) {
    try {
      const doc = await fb.getDb().collection('accounts').doc(cleanEmail).get();
      if (doc.exists) {
        const d = doc.data();
        return {
          email: d.email || cleanEmail,
          name: d.name || cleanEmail.split('@')[0],
          picture: d.picture || null,
          googleId: d.googleId || null,
          plan: d.plan || 'free-1h',
          createdAt: d.createdAt || Date.now(),
          expiresAt: d.expiresAt || 0,
          lastTrialAt: d.lastTrialAt || null,
          activeIp: d.activeIp || null,
          activeMac: d.activeMac || null,
          blocked: !!d.blocked
        };
      }
    } catch (e) {
      console.warn('[FIRESTORE getAccount]', e.message);
    }
  }

  // Local SQLite fallback
  const row = await get(`SELECT * FROM accounts WHERE LOWER(email) = LOWER(?)`, [cleanEmail]);
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    picture: row.picture,
    googleId: row.google_id,
    plan: row.plan,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastTrialAt: row.last_trial_at,
    activeIp: row.active_ip,
    activeMac: row.active_mac,
    blocked: !!row.blocked
  };
}

async function getAccountByIp(ip) {
  if (!ip) return null;
  const now = Date.now();

  // Fast local SQLite check for CNA probes
  const row = await get(
    `SELECT * FROM accounts WHERE active_ip = ? AND expires_at > ? AND blocked = 0`,
    [ip, now]
  );
  if (row) {
    return {
      email: row.email,
      name: row.name,
      picture: row.picture,
      googleId: row.google_id,
      plan: row.plan,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      lastTrialAt: row.last_trial_at,
      activeIp: row.active_ip,
      activeMac: row.active_mac,
      blocked: !!row.blocked
    };
  }

  // Firestore check if available
  if (fb.isReady()) {
    try {
      const snap = await fb.getDb().collection('accounts')
        .where('activeIp', '==', ip)
        .where('expiresAt', '>', now)
        .where('blocked', '==', false)
        .limit(1)
        .get();
      if (!snap.empty) {
        const d = snap.docs[0].data();
        return {
          email: d.email,
          name: d.name,
          picture: d.picture || null,
          googleId: d.googleId || null,
          plan: d.plan || 'free-1h',
          createdAt: d.createdAt,
          expiresAt: d.expiresAt,
          lastTrialAt: d.lastTrialAt,
          activeIp: d.activeIp,
          activeMac: d.activeMac,
          blocked: !!d.blocked
        };
      }
    } catch (e) {
      /* ignore */
    }
  }

  return null;
}

async function saveAccount(acc) {
  const email = acc.email.trim().toLowerCase();
  const accountData = {
    email,
    name: acc.name || email.split('@')[0],
    picture: acc.picture || null,
    googleId: acc.googleId || null,
    plan: acc.plan || 'free-1h',
    createdAt: acc.createdAt || Date.now(),
    expiresAt: acc.expiresAt || 0,
    lastTrialAt: acc.lastTrialAt || null,
    activeIp: acc.activeIp || null,
    activeMac: acc.activeMac || null,
    blocked: !!acc.blocked
  };

  // Sync to Cloud Firestore if ready
  if (fb.isReady()) {
    try {
      await fb.getDb().collection('accounts').doc(email).set(accountData, { merge: true });
    } catch (e) {
      console.warn('[FIRESTORE saveAccount]', e.message);
    }
  }

  // Always save to local SQLite
  return await run(
    `INSERT INTO accounts (email, name, picture, google_id, plan, created_at, expires_at, last_trial_at, active_ip, active_mac, last_ip, last_mac, blocked)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = COALESCE(excluded.name, accounts.name),
       picture = COALESCE(excluded.picture, accounts.picture),
       google_id = COALESCE(excluded.google_id, accounts.google_id),
       plan = excluded.plan,
       expires_at = excluded.expires_at,
       last_trial_at = excluded.last_trial_at,
       active_ip = excluded.active_ip,
       active_mac = excluded.active_mac,
       last_ip = COALESCE(excluded.active_ip, accounts.last_ip),
       last_mac = COALESCE(excluded.active_mac, accounts.last_mac),
       blocked = excluded.blocked`,
    [
      email,
      accountData.name,
      accountData.picture,
      accountData.googleId,
      accountData.plan,
      accountData.createdAt,
      accountData.expiresAt,
      accountData.lastTrialAt,
      accountData.activeIp,
      accountData.activeMac,
      accountData.activeIp || null,
      accountData.activeMac || null,
      accountData.blocked ? 1 : 0
    ]
  );
}

async function getAllAccounts() {
  if (fb.isReady()) {
    try {
      const snap = await fb.getDb().collection('accounts').orderBy('expiresAt', 'desc').get();
      if (!snap.empty) {
        return snap.docs.map(doc => doc.data());
      }
    } catch (e) {
      console.warn('[FIRESTORE getAllAccounts]', e.message);
    }
  }

  const rows = await all(`SELECT * FROM accounts ORDER BY expires_at DESC`);
  return rows.map((r) => ({
    email: r.email,
    name: r.name,
    picture: r.picture,
    googleId: r.google_id,
    plan: r.plan,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastTrialAt: r.last_trial_at,
    activeIp: r.active_ip,
    activeMac: r.active_mac,
    blocked: !!r.blocked
  }));
}

async function deleteAccount(email) {
  const cleanEmail = email.trim().toLowerCase();
  if (fb.isReady()) {
    try {
      await fb.getDb().collection('accounts').doc(cleanEmail).delete();
    } catch (e) {
      console.warn('[FIRESTORE deleteAccount]', e.message);
    }
  }
  return await run(`DELETE FROM accounts WHERE LOWER(email) = LOWER(?)`, [cleanEmail]);
}

// ============================================================================
// Payment Slips & IP Log Operations (Firestore + SQLite Hybrid)
// ============================================================================

async function recordSlip({ email, ip, mac, filename, qrPayload, amount = 150, status = 'verified', cloudUrl = null }) {
  const cleanEmail = email.trim().toLowerCase();
  const slipData = {
    email: cleanEmail,
    ip_address: ip || '127.0.0.1',
    mac_address: mac || null,
    filename,
    cloud_url: cloudUrl || null,
    qr_payload: qrPayload,
    amount,
    status,
    uploaded_at: Date.now()
  };

  if (fb.isReady()) {
    try {
      await fb.getDb().collection('slips').add(slipData);
    } catch (e) {
      console.warn('[FIRESTORE recordSlip]', e.message);
    }
  }

  return await run(
    `INSERT INTO slips (email, ip_address, mac_address, filename, cloud_url, qr_payload, amount, status, uploaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [cleanEmail, slipData.ip_address, slipData.mac_address, filename, cloudUrl || null, qrPayload, amount, status, slipData.uploaded_at]
  );
}

async function isSlipUsed(qrPayload) {
  if (fb.isReady()) {
    try {
      const snap = await fb.getDb().collection('slips').where('qr_payload', '==', qrPayload).limit(1).get();
      if (!snap.empty) return true;
    } catch (e) {
      /* ignore */
    }
  }
  const row = await get(`SELECT id FROM slips WHERE qr_payload = ?`, [qrPayload]);
  return !!row;
}

async function getAllSlips() {
  if (fb.isReady()) {
    try {
      const snap = await fb.getDb().collection('slips').orderBy('uploaded_at', 'desc').get();
      if (!snap.empty) {
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } catch (e) {
      /* ignore */
    }
  }
  return await all(`SELECT * FROM slips ORDER BY uploaded_at DESC`);
}

async function getSlipById(id) {
  return await get(`SELECT * FROM slips WHERE id = ?`, [id]);
}

async function updateSlipStatus(id, status) {
  if (fb.isReady()) {
    try {
      await fb.getDb().collection('slips').doc(String(id)).set({ status }, { merge: true });
    } catch (e) {
      /* ignore */
    }
  }
  return await run(`UPDATE slips SET status = ? WHERE id = ?`, [status, id]);
}

async function logIpAction({ email, ip, mac, action }) {
  if (!ip) return;
  const logData = {
    email: email ? email.trim().toLowerCase() : null,
    ip_address: ip,
    mac_address: mac || null,
    action,
    timestamp: Date.now()
  };

  if (fb.isReady()) {
    try {
      await fb.getDb().collection('ip_logs').add(logData);
    } catch (e) {
      /* ignore */
    }
  }

  return await run(
    `INSERT INTO ip_logs (email, ip_address, mac_address, action, timestamp)
     VALUES (?, ?, ?, ?, ?)`,
    [logData.email, ip, mac || null, action, logData.timestamp]
  );
}

async function getRecentIpLogs(limit = 50) {
  if (fb.isReady()) {
    try {
      const snap = await fb.getDb().collection('ip_logs').orderBy('timestamp', 'desc').limit(limit).get();
      if (!snap.empty) {
        return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      }
    } catch (e) {
      /* ignore */
    }
  }
  return await all(`SELECT * FROM ip_logs ORDER BY timestamp DESC LIMIT ?`, [limit]);
}

async function clearIpLogs() {
  return await run(`DELETE FROM ip_logs`);
}

async function deleteSlip(id) {
  if (fb.isReady()) {
    try { await fb.getDb().collection('slips').doc(String(id)).delete(); } catch (e) {}
  }
  return await run(`DELETE FROM slips WHERE id = ?`, [id]);
}

// ============================================================================
// Settings Operations
// ============================================================================

async function getSetting(key, fallback = '') {
  const row = await get(`SELECT value FROM settings WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

async function setSetting(key, value) {
  if (fb.isReady()) {
    try {
      await fb.getDb().collection('settings').doc('config').set({ [key]: String(value) }, { merge: true });
    } catch (e) {
      /* ignore */
    }
  }
  return await run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}

async function getAllSettings() {
  const rows = await all(`SELECT * FROM settings`);
  const settings = {
    monthlyPrice: 150,
    trialMinutes: 60,
    adminPin: '1234',
    googleClientId: '',
    vpnEndpoint: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPass: '',
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID || ''
  };
  rows.forEach((r) => {
    if (r.key === 'monthlyPrice' || r.key === 'trialMinutes') {
      settings[r.key] = parseInt(r.value, 10) || settings[r.key];
    } else {
      settings[r.key] = r.value;
    }
  });
  return settings;
}

async function getExpiredAccount({ ip, mac, email } = {}) {
  const now = Date.now();
  let row = null;
  if (email) {
    row = await get(
      `SELECT * FROM accounts WHERE LOWER(email) = LOWER(?) AND expires_at <= ? AND blocked = 0 ORDER BY expires_at DESC LIMIT 1`,
      [email.trim(), now]
    );
  }
  if (!row && ip && ip !== '127.0.0.1' && ip !== '::1') {
    row = await get(
      `SELECT * FROM accounts WHERE (active_ip = ? OR last_ip = ?) AND expires_at <= ? AND blocked = 0 ORDER BY expires_at DESC LIMIT 1`,
      [ip, ip, now]
    );
  }
  if (!row && mac && mac !== 'localhost') {
    row = await get(
      `SELECT * FROM accounts WHERE (active_mac = ? OR last_mac = ?) AND expires_at <= ? AND blocked = 0 ORDER BY expires_at DESC LIMIT 1`,
      [mac, mac, now]
    );
  }
  if (!row && (ip || mac)) {
    const logRow = await get(
      `SELECT email FROM ip_logs WHERE (ip_address = ? OR mac_address = ?) AND email IS NOT NULL AND email != '' ORDER BY timestamp DESC LIMIT 1`,
      [ip || '', mac || '']
    );
    if (logRow && logRow.email) {
      row = await get(
        `SELECT * FROM accounts WHERE LOWER(email) = LOWER(?) AND expires_at <= ? AND blocked = 0 ORDER BY expires_at DESC LIMIT 1`,
        [logRow.email, now]
      );
    }
  }
  if (!row) return null;
  return {
    email: row.email,
    name: row.name,
    picture: row.picture,
    googleId: row.google_id,
    plan: row.plan,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastTrialAt: row.last_trial_at,
    activeIp: row.active_ip,
    activeMac: row.active_mac,
    lastIp: row.last_ip,
    lastMac: row.last_mac,
    blocked: !!row.blocked
  };
}

module.exports = {
  initDb,
  getAccount,
  getAccountByIp,
  findAccountByIp: getAccountByIp,
  getExpiredAccount,
  saveAccount,
  getAllAccounts,
  deleteAccount,
  recordSlip,
  getSlipById,
  updateSlipStatus,
  isSlipUsed,
  getAllSlips,
  deleteSlip,
  logIpAction,
  getRecentIpLogs,
  clearIpLogs,
  getSetting,
  setSetting,
  getAllSettings,
  isFirebaseActive: () => fb.isReady(),
  firebase: fb
};

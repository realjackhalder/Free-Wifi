// ============================================================================
// firebase-backend.js — Firebase Admin Auth & Cloud Firestore Integration
// Free Wi-Fi Captive Portal & Gateway
// ============================================================================

const fs = require('fs');
const path = require('path');
let admin = null;
let getCert = null;
let getFirestoreFn = null;
let getAuthFn = null;
let getStorageFn = null;

try {
  admin = require('firebase-admin');
  try {
    getCert = (admin && admin.credential && admin.credential.cert) || (admin && admin.cert) || require('firebase-admin/app').cert;
  } catch (e) {}
  try {
    getFirestoreFn = require('firebase-admin/firestore').getFirestore;
  } catch (e) {}
  try {
    getAuthFn = require('firebase-admin/auth').getAuth;
  } catch (e) {}
  try {
    getStorageFn = require('firebase-admin/storage').getStorage;
  } catch (e) {}
} catch (e) {
  console.warn('[FIREBASE] firebase-admin package not loaded:', e.message);
}

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'firebase-service-account.json');
const CLIENT_CONFIG_PATH = path.join(__dirname, 'firebase-client.json');

const CANDIDATE_KEY_PATHS = [
  process.env.GOOGLE_APPLICATION_CREDENTIALS,
  path.join(__dirname, 'free-wifi-portal-firebase-adminsdk.json'),
  path.join(__dirname, 'serviceAccountKey.json'),
  path.join(__dirname, 'firebase-service-account.json')
].filter(Boolean);

let isInitialized = false;
let firestoreDb = null;
let firebaseAuth = null;
let firebaseStorage = null;
let authErrorLogged = false;
let quotaErrorLogged = false;
let quotaPausedUntil = 0;

const DEFAULT_DATABASE_URL = process.env.FIREBASE_DATABASE_URL || 'https://free-wifi-portal-default-rtdb.asia-southeast1.firebasedatabase.app';
const DEFAULT_STORAGE_BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'free-wifi-portal.firebasestorage.app';

function markUnavailable(reason = '') {
  isInitialized = false;
  firestoreDb = null;
  firebaseAuth = null;
  firebaseStorage = null;
  if (!authErrorLogged) {
    authErrorLogged = true;
    console.warn(`⚠️ [FIREBASE] Authentication failed (${reason}). Disabling Cloud Firestore and using local SQLite (wifi.db).`);
    console.warn('👉 To re-enable Cloud Firestore: Generate a fresh private key in Firebase Console -> Project Settings -> Service Accounts -> "Generate new private key", and replace firebase-service-account.json');
  }
}

function markQuotaExhausted(reason = '') {
  quotaPausedUntil = Date.now() + 10 * 60 * 1000;
  if (!quotaErrorLogged) {
    quotaErrorLogged = true;
    console.warn(`⚠️ [FIREBASE] Firestore free daily quota exceeded (${reason}). Cloud sync paused; seamlessly serving from local SQLite (wifi.db).`);
    console.warn('👉 Local captive portal & admin operations are unaffected. Cloud sync will automatically resume when quota resets.');
  }
}

function getActiveServiceAccountPath() {
  for (const p of CANDIDATE_KEY_PATHS) {
    if (fs.existsSync(p)) return p;
  }
  return SERVICE_ACCOUNT_PATH;
}

function resolveCredential(serviceAccount) {
  if (admin && admin.credential && typeof admin.credential.cert === 'function') {
    return admin.credential.cert(serviceAccount);
  }
  if (typeof getCert === 'function') {
    return getCert(serviceAccount);
  }
  if (admin && typeof admin.cert === 'function') {
    return admin.cert(serviceAccount);
  }
  return null;
}

function resolveFirestore() {
  if (typeof admin.firestore === 'function') return admin.firestore();
  if (typeof getFirestoreFn === 'function') return getFirestoreFn();
  return null;
}

function resolveAuth() {
  if (typeof admin.auth === 'function') return admin.auth();
  if (typeof getAuthFn === 'function') return getAuthFn();
  return null;
}

function resolveStorage() {
  if (typeof admin.storage === 'function') return admin.storage();
  if (typeof getStorageFn === 'function') return getStorageFn();
  return null;
}

/**
 * Initialize Firebase Admin with service account JSON or environment variables
 */
function initFirebase() {
  if (!admin) return false;
  if (admin.apps && admin.apps.length > 0) {
    isInitialized = true;
    firestoreDb = resolveFirestore();
    firebaseAuth = resolveAuth();
    firebaseStorage = resolveStorage();
    return true;
  }

  try {
    // 1. Check for local service account files (adminsdk / service-account)
    const activeKeyPath = getActiveServiceAccountPath();
    if (fs.existsSync(activeKeyPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(activeKeyPath, 'utf-8'));
      const credential = resolveCredential(serviceAccount);
      admin.initializeApp({
        ...(credential ? { credential } : {}),
        databaseURL: DEFAULT_DATABASE_URL,
        storageBucket: DEFAULT_STORAGE_BUCKET
      });
      isInitialized = true;
      firestoreDb = resolveFirestore();
      firebaseAuth = resolveAuth();
      firebaseStorage = resolveStorage();

      const keyName = path.basename(activeKeyPath);
      if (credential && typeof credential.getAccessToken === 'function') {
        credential.getAccessToken().then(() => {
          console.log(`✅ [FIREBASE] Successfully authenticated with Cloud Firestore via ${keyName}`);
        }).catch((err) => {
          markUnavailable(err.message || 'Invalid JWT Signature');
        });
      } else {
        console.log(`✅ [FIREBASE] Initialized with ${keyName}`);
      }
      return true;
    }

    // 2. Check for environment variables
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      const credential = resolveCredential(serviceAccount);
      admin.initializeApp({
        ...(credential ? { credential } : {}),
        databaseURL: DEFAULT_DATABASE_URL,
        storageBucket: DEFAULT_STORAGE_BUCKET
      });
      isInitialized = true;
      firestoreDb = resolveFirestore();
      firebaseAuth = resolveAuth();
      firebaseStorage = resolveStorage();

      if (credential && typeof credential.getAccessToken === 'function') {
        credential.getAccessToken().then(() => {
          console.log('✅ [FIREBASE] Successfully authenticated with Cloud Firestore via FIREBASE_SERVICE_ACCOUNT env');
        }).catch((err) => {
          markUnavailable(err.message || 'Invalid JWT Signature');
        });
      } else {
        console.log('✅ [FIREBASE] Successfully initialized with FIREBASE_SERVICE_ACCOUNT env');
      }
      return true;
    }

    // 3. Application Default Credentials (e.g. Google Cloud / Cloud Functions)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG) {
      admin.initializeApp({
        databaseURL: DEFAULT_DATABASE_URL,
        storageBucket: DEFAULT_STORAGE_BUCKET
      });
      isInitialized = true;
      firestoreDb = resolveFirestore();
      firebaseAuth = resolveAuth();
      firebaseStorage = resolveStorage();
      console.log('✅ [FIREBASE] Initialized with Application Default Credentials');
      return true;
    }

    console.log('ℹ️ [FIREBASE] Not configured yet. (Place firebase-service-account.json in root to enable Cloud Firestore & Storage)');
    return false;
  } catch (err) {
    console.warn('⚠️ [FIREBASE] Initialization warning:', err.message);
    return false;
  }
}

/**
 * Upload a payment slip to Firebase Cloud Storage and return public/signed URL
 */
async function uploadSlipToStorage(localFilePath, destinationFileName, mimeType = 'application/octet-stream') {
  const storage = resolveStorage();
  if (!isInitialized || !storage || typeof storage.bucket !== 'function') return null;
  try {
    const bucket = storage.bucket();
    await bucket.upload(localFilePath, {
      destination: `slips/${destinationFileName}`,
      metadata: {
        contentType: mimeType
      }
    });
    const file = bucket.file(`slips/${destinationFileName}`);
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '03-01-2036'
    });
    console.log(`✅ [FIREBASE STORAGE] Slip uploaded to Cloud Storage: slips/${destinationFileName}`);
    return signedUrl;
  } catch (err) {
    console.warn('[FIREBASE STORAGE] Slip upload error:', err.message);
    return null;
  }
}

/**
 * Get Client-Side Firebase Configuration (for frontend Firebase Web SDK)
 */
function getClientConfig() {
  if (fs.existsSync(CLIENT_CONFIG_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(CLIENT_CONFIG_PATH, 'utf-8'));
    } catch (e) {
      /* ignore */
    }
  }

  // Fallback defaults or environment config
  return {
    apiKey: process.env.FIREBASE_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.FIREBASE_APP_ID || ''
  };
}

/**
 * Save Client-Side Firebase Configuration
 */
function saveClientConfig(config) {
  try {
    fs.writeFileSync(CLIENT_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('[FIREBASE] Failed to save client config:', err);
    return false;
  }
}

/**
 * Verify a Firebase ID Token sent from the frontend Google Sign-In
 */
async function verifyIdToken(idToken) {
  if (!idToken) return null;
  if (!isInitialized || !firebaseAuth) {
    console.warn('[FIREBASE] verifyIdToken called but Firebase Admin is not initialized.');
    return null;
  }
  try {
    const decodedToken = await firebaseAuth.verifyIdToken(idToken);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name || decodedToken.email.split('@')[0],
      picture: decodedToken.picture || null,
      emailVerified: decodedToken.email_verified
    };
  } catch (err) {
    console.error('[FIREBASE] Token verification failed:', err.message);
    return null;
  }
}

// Initialize on module load
initFirebase();

module.exports = {
  admin,
  initFirebase,
  markUnavailable,
  markQuotaExhausted,
  isReady: () => isInitialized && !!firestoreDb && Date.now() > quotaPausedUntil,
  getDb: () => firestoreDb,
  getAuth: () => firebaseAuth,
  getStorage: () => firebaseStorage,
  uploadSlipToStorage,
  verifyIdToken,
  getClientConfig,
  saveClientConfig,
  getActiveServiceAccountPath,
  SERVICE_ACCOUNT_PATH,
  CLIENT_CONFIG_PATH
};

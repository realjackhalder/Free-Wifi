// ============================================================================
// firebase-backend.js — Firebase Admin Auth & Cloud Firestore Integration
// Free Wi-Fi Captive Portal & Gateway
// ============================================================================

const fs = require('fs');
const path = require('path');
let admin = null;
try {
  admin = require('firebase-admin');
} catch (e) {
  console.warn('[FIREBASE] firebase-admin package not loaded:', e.message);
}

const SERVICE_ACCOUNT_PATH = path.join(__dirname, 'firebase-service-account.json');
const CLIENT_CONFIG_PATH = path.join(__dirname, 'firebase-client.json');

let isInitialized = false;
let firestoreDb = null;
let firebaseAuth = null;

/**
 * Initialize Firebase Admin with service account JSON or environment variables
 */
function initFirebase() {
  if (!admin) return false;
  if (admin.apps && admin.apps.length > 0) {
    isInitialized = true;
    firestoreDb = admin.firestore();
    firebaseAuth = admin.auth();
    return true;
  }

  try {
    // 1. Check for local firebase-service-account.json
    if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf-8'));
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
      firestoreDb = admin.firestore();
      firebaseAuth = admin.auth();
      console.log('✅ [FIREBASE] Successfully initialized with firebase-service-account.json');
      return true;
    }

    // 2. Check for environment variables
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      isInitialized = true;
      firestoreDb = admin.firestore();
      firebaseAuth = admin.auth();
      console.log('✅ [FIREBASE] Successfully initialized with FIREBASE_SERVICE_ACCOUNT env');
      return true;
    }

    // 3. Application Default Credentials (e.g. Google Cloud / Cloud Functions)
    if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CONFIG) {
      admin.initializeApp();
      isInitialized = true;
      firestoreDb = admin.firestore();
      firebaseAuth = admin.auth();
      console.log('✅ [FIREBASE] Initialized with Application Default Credentials');
      return true;
    }

    console.log('ℹ️ [FIREBASE] Not configured yet. (Place firebase-service-account.json in root to enable Cloud Firestore)');
    return false;
  } catch (err) {
    console.warn('⚠️ [FIREBASE] Initialization warning:', err.message);
    return false;
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
  isReady: () => isInitialized && !!firestoreDb,
  getDb: () => firestoreDb,
  getAuth: () => firebaseAuth,
  verifyIdToken,
  getClientConfig,
  saveClientConfig,
  SERVICE_ACCOUNT_PATH,
  CLIENT_CONFIG_PATH
};

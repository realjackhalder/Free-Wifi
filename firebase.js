// ============================================================================
// firebase.js — Firebase Client Modular SDK Initialization
// ============================================================================

import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import clientConfig from "./firebase-client.json" assert { type: "json" };

const app = !getApps().length ? initializeApp(clientConfig) : getApp();
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("email");
googleProvider.addScope("profile");

export { app, auth, db, googleProvider, clientConfig };

# 🌐 Free Wi-Fi Captive Portal (Firebase Auth & Cloud Firestore)
### 🇹🇭 ภาษาไทย &bull; 🇲🇲 မြန်မာဘာသာ &bull; 🇬🇧 English

A production-ready, zero-cost telecom-style Wi-Fi Captive Portal web application (modeled after **True Free WiFi / AIS SMART Login**) built with **Node.js (Express)**, **Tailwind CSS**, and **Google Firebase** (Firebase Auth, Cloud Firestore, and Firebase Hosting).

Features **Firebase Google Authentication** (replacing legacy phone/PIN), **trilingual language switching** (Thai, Burmese, English), **automated bank slip QR verification**, and **instant OS Captive Network Assistant (CNA) auto-popup detection**.

---

## 🌍 Trilingual Support (ภาษาไทย | မြန်မာ | English)
- **Interactive Language Switcher:** 1-click switcher buttons located in the **top-left corner** displaying each flag (`🇹🇭 ไทย`, `🇲🇲 မြန်မာ`, `🇬🇧 Eng`).
- **Instant Client-Side Switching:** No page refresh required; persists client preference in `localStorage`.
- **Trilingual Messages & Countdown:** All validation messages, payment notifications, and countdown labels dynamically adapt to the user's selected language.
- **Optimized Myanmar Unicode Typography:** Cross-platform Burmese font stack (`Myanmar Text`, `Padauk`, `Pyidaungsu`).
- **Clean Mobile Footer & Help Link:** Support link pointing directly to `t.me/petharsupport` with clickable "Click here" link in Thai, Burmese, and English. Languages remain cleanly in the top header.
- **Mobile-First Ergonomics:** Safe-area notch insets (`env(safe-area-inset-*)`), iOS Safari form auto-zoom prevention (16px base font), 48px+ touch targets, instant image preview for bank slip uploads, and responsive grid layouts tested on small 320px–414px smartphone screens.

---

## 🚀 Key Capabilities

### 1. OS Auto-Popup Captive Portal Detection (CNA)
Seamless automatic detection and popup when clients connect to Wi-Fi on:
- **Apple iOS / macOS:** `/hotspot-detect.html`, `/library/test/success.html`
  - Unauthenticated: `302 Redirect` to `http://<SERVER_IP>:3001/portal`
  - Authenticated: HTTP 200 `<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>`
- **Android / Google:** `/generate_204`, `/gen_204`
  - Unauthenticated: `302 Redirect` to `http://<SERVER_IP>:3001/portal`
  - Authenticated: `204 No Content`
- **Windows 10/11 NCSI:** `/connecttest.txt`, `/ncsi.txt`
  - Unauthenticated: `302 Redirect` to `http://<SERVER_IP>:3001/portal`
  - Authenticated: `200 OK` with `Microsoft Connect Test`
- **Catch-All Middleware:** Any unknown route on port 80/3001 automatically redirects unauthenticated users to `/portal`.

### 2. Telecom-Style Portal UI (`GET /portal`)
- **Connected State View (when authenticated):**
  - Displays user's Google Profile (Name & Email), Plan badge (`Free 1-Hour` or `30-Day VIP`), and a live countdown timer (Days, Hours, Minutes, Seconds).
  - **Disconnect / Sign Out Button:** Clears the active IP binding in SQLite and firewall, redirecting future requests back to the portal.
- **Tab 1 — Free 1-Hour Wi-Fi (รับเน็ตฟรี 1 ชม. / ၁ နာရီ အခမဲ့):**
  - Sign in with Google Account (or enter email).
  - Enforces 24-hour quota check per Google Account, client IP, and MAC address.
  - Automatically activates a 60-minute session and whitelists their device.
- **Tab 2 — Buy 30-Day VIP Package (สมัครแพ็กเกจ 30 วัน / ရက် ၃၀ VIP):**
  - Displays PromptPay QR (`/my-qr`), accepts bank slip screenshot upload (`image/*`).
  - Decodes mini-QR inside the Thai bank slip screenshot using `multer`, `jimp`, and `jsqr`.
  - Verifies QR payload length ($\ge 25$) and prevents duplicate slip reuse via SQLite database lookup.
  - Activates 30 days of unlimited Wi-Fi immediately upon verification.
- **Tab 3 — Member Login (เข้าสู่ระบบ / အကောင့်ဝင်ရန်):**
  - Existing 30-day VIP subscribers or active trial members sign in with their Google Account.
  - Automatically migrates the active session to the current client IP/MAC, disconnecting any previous device (**strictly 1 device per account at a time**).

### 3. Firebase Cloud Firestore & Hybrid SQLite Database
Powered by **Google Cloud Firestore** (via `firebase-admin`) with local SQLite edge caching:
- **`accounts` Collection:** Stores Google email, name, profile picture, plan type, creation timestamp, expiration timestamp, last trial timestamp, active IP, active MAC, and blocked status.
- **`slips` Collection:** Records each uploaded bank transfer slip along with the client's **IP address**, **MAC address**, filename, decoded QR payload, amount, verification status, and upload timestamp.
- **`ip_logs` Collection:** Complete audit log of network actions (`free_trial`, `buy_package`, `login`, `logout`, `expire`) tied to specific IP addresses and Google accounts.
- **`settings` Collection:** Dynamic runtime settings for 30-day package price, free trial duration, and admin PIN.
- **Edge Resilience:** If offline or before Firebase keys are set, falls back to local SQLite (`wifi.db`) so the gateway never fails.

### 4. Firebase Hosting & Cloud Deployment
- Ready-to-deploy configuration: [`firebase.json`](file:///d:/Free-Wifi/firebase.json), [`.firebaserc`](file:///d:/Free-Wifi/.firebaserc), and [`firestore.rules`](file:///d:/Free-Wifi/firestore.rules).
- Deploy frontend and serverless Cloud Functions backend with a single command (`firebase deploy`).

### 5. Admin Management Dashboard (`GET /admin`)
Protected by Admin PIN (default: `1234`):
- **Firebase Status & Config:** Live indicator showing Cloud Firestore sync status and a web form to update Firebase Client keys (`apiKey`, `authDomain`, `projectId`, `appId`).
- **Upload PromptPay QR Photo:** Replace the payment QR image anytime directly from disk (`public/150b.jpg` / `public/150B.jpg`).
- **System Settings:** Update 30-Day price (THB), free trial minutes, and Admin PIN.
- **Accounts Table:** View all registered Google accounts, current plan, active IP & MAC address, remaining time, with actions to **+30 Days**, **Reset Free Trial**, **Block/Unblock**, or **Delete**.
- **Payment Slips & IP Log Database:** Review all uploaded bank slips with client IP addresses, decoded QR payloads, and full connection audit history.

### 6. Network Gateway & Firewall Automation (`firewall.js` + `setup-gateway.sh`)
- Safe `DRY_RUN` emulation mode out of the box for testing on any OS.
- Real firewall execution on Linux/macOS via `sudo pfctl -t allowed_wifi -T add/delete <ip>` or `iptables`.
- Automatic background worker checks `wifi.db` every 30 seconds to revoke expired sessions.
- `dns-captive.js`: Lightweight UDP port 53 DNS responder redirecting LAN DNS queries to the portal.

---

## 🛠️ Quick Start

### 1. Install Dependencies & Start Server
```powershell
Set-Location d:\Free-Wifi
npm install
npm start
```
- **Admin Panel (Port 3000):** [http://localhost:3000](http://localhost:3000) (Default PIN: `1234`)
- **User Portal (Port 3001):** [http://localhost:3001/portal](http://localhost:3001/portal)

### 2. Testing Endpoints & Verification
Run the built-in diagnostic test:
```powershell
node -e "const http = require('http'); http.get('http://127.0.0.1:3001/api/session-status', res => res.pipe(process.stdout));"
```

---

## 📁 File Structure
- `server.js` — Main Express web application, CNA probe routes, Google Auth API endpoints, Portal & Admin UI renderers.
- `database.js` — SQLite database manager (`wifi.db`) for Google accounts, uploaded slips with IP/MAC, and IP audit logs.
- `firewall.js` — Network firewall controller (`pfctl` / `iptables`) with `DRY_RUN` toggle and ARP MAC address resolver.
- `dns-captive.js` — Lightweight UDP port 53 DNS responder redirecting queries to captive portal.
- `setup-gateway.sh` — Gateway port-forwarding setup script for macOS / Linux pf & iptables.
- `wifi.db` — SQLite database file storing all accounts, slips, and IP connection logs.
- `public/` — Static assets, including PromptPay QR image (`150b.jpg` / `150B.jpg` / `qr.jpg`).
- `uploads/` — Directory where bank payment slip screenshots are securely stored.

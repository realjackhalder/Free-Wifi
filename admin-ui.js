// ============================================================================
// Free Wi-Fi Gateway - White Mode Interface
// Symmetrical, Apple-style Frosted Glass UI with multi-tab actions
// ============================================================================

function renderAdminLogin(error = null) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Admin Portal — Free Wi-Fi Gateway</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>
  :root {
    --glisse-bg: #f8fafc;
    --glisse-surface: rgba(255, 255, 255, 0.92);
    --glisse-border: rgba(226, 232, 240, 0.9);
    --glisse-border-top: #ffffff;
    --glisse-shadow: 0 20px 50px -12px rgba(15, 23, 42, 0.08), 0 8px 16px -4px rgba(15, 23, 42, 0.03);
    --glisse-inner: inset 0 1px 1px 0 rgba(255, 255, 255, 0.9);
    --glisse-blur: blur(28px) saturate(180%);
  }
  body {
    background-color: var(--glisse-bg);
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
    overflow-x: hidden;
  }
  .glisse-aura {
    position: fixed;
    pointer-events: none;
    z-index: 0;
    filter: blur(100px);
    opacity: 0.7;
    border-radius: 50%;
  }
  .glisse-aura-1 {
    top: -120px;
    left: 15%;
    width: 500px;
    height: 500px;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, rgba(147, 197, 253, 0.1) 50%, transparent 70%);
  }
  .glisse-aura-2 {
    bottom: -100px;
    right: 15%;
    width: 540px;
    height: 540px;
    background: radial-gradient(circle, rgba(168, 85, 247, 0.16) 0%, rgba(244, 114, 182, 0.08) 50%, transparent 70%);
  }
  .glisse-card {
    background: var(--glisse-surface);
    backdrop-filter: var(--glisse-blur);
    -webkit-backdrop-filter: var(--glisse-blur);
    border: 1px solid var(--glisse-border);
    border-top: 1px solid var(--glisse-border-top);
    box-shadow: var(--glisse-inner), var(--glisse-shadow);
    border-radius: 28px;
  }
  .glisse-input {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.03);
    color: #0f172a;
    border-radius: 16px;
    outline: none;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }
  .glisse-btn-primary {
    background: linear-gradient(135deg, #2563eb, #0284c7);
    border: 1px solid rgba(37, 99, 235, 0.3);
    border-top: 1px solid rgba(255, 255, 255, 0.4);
    box-shadow: 0 8px 20px -4px rgba(37, 99, 235, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    color: #ffffff;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 12px 28px -4px rgba(37, 99, 235, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.4);
    filter: brightness(1.05);
  }
  .glisse-btn-primary:active {
    transform: translateY(1px) scale(0.98);
  }
</style>
</head>
<body class="flex items-center justify-center p-4 min-h-screen relative">
  <div class="glisse-aura glisse-aura-1"></div>
  <div class="glisse-aura glisse-aura-2"></div>

  <div class="glisse-card p-8 sm:p-10 max-w-md w-full relative z-10 text-center">
    <div class="inline-flex p-4 rounded-3xl mb-4 bg-gradient-to-tr from-blue-500/15 to-cyan-500/10 border border-blue-200/60 shadow-sm backdrop-blur-xl">
      <span class="text-4xl">🛡️</span>
    </div>
    
    <h1 class="text-2xl font-black tracking-tight text-slate-900 mb-1">Gateway Admin</h1>
    <p class="text-xs text-slate-500 mb-6 font-medium">Administrator Access Portal</p>
    
    ${error ? `<div class="bg-red-50 border border-red-200 text-red-700 text-xs px-4 py-2.5 rounded-2xl mb-5 font-semibold">${error}</div>` : ''}

    <form method="post" action="/admin/login" class="space-y-5 text-left">
      <div>
        <label class="block text-xs font-bold text-slate-600 mb-2 uppercase tracking-wider">Administrator PIN</label>
        <input type="password" name="pin" placeholder="••••" autofocus required class="glisse-input w-full px-4 py-3.5 text-center text-xl font-mono tracking-widest" />
      </div>
      <button type="submit" class="glisse-btn-primary w-full py-3.5 rounded-2xl font-bold text-sm tracking-wide shadow-md">
        Unlock Dashboard →
      </button>
    </form>
  </div>
</body>
</html>`;
}

function renderAdmin({ accounts, slips, ipLogs, settings, isFirebaseActive = false, firebaseConfig = {}, msg = null, err = null, activeTab = 'accounts' }) {
  const totalUsers = accounts.length;
  const now = Date.now();
  let activeUsers = 0;
  let vipUsers = 0;
  let blockedUsers = 0;

  for (const a of accounts) {
    if (a.expiresAt && a.expiresAt > now && !a.blocked) activeUsers++;
    if (a.plan === 'vip-30d') vipUsers++;
    if (a.blocked) blockedUsers++;
  }

  const pendingSlips = slips.filter(s => s.status === 'pending');
  const pendingCount = pendingSlips.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Free Wi-Fi Gateway — Admin</title>
<link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
<style>
  :root {
    --glisse-bg: #f8fafc;
    --glisse-surface: rgba(255, 255, 255, 0.9);
    --glisse-surface-hover: rgba(255, 255, 255, 0.98);
    --glisse-border: rgba(226, 232, 240, 0.85);
    --glisse-border-specular: #ffffff;
    --glisse-shadow: 0 16px 36px -8px rgba(15, 23, 42, 0.05), 0 4px 12px -2px rgba(15, 23, 42, 0.02);
    --glisse-inner-specular: inset 0 1px 1px 0 #ffffff;
    --glisse-blur: blur(28px) saturate(180%);
  }

  body {
    background-color: var(--glisse-bg);
    color: #0f172a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }

  /* Ambient light orbs */
  .glisse-aura {
    position: fixed;
    pointer-events: none;
    z-index: 0;
    filter: blur(100px);
    opacity: 0.65;
    border-radius: 50%;
  }
  .glisse-aura-1 {
    top: -140px;
    left: 8%;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, rgba(147, 197, 253, 0.1) 50%, transparent 70%);
  }
  .glisse-aura-2 {
    top: 40px;
    right: 8%;
    width: 650px;
    height: 650px;
    background: radial-gradient(circle, rgba(168, 85, 247, 0.15) 0%, rgba(244, 114, 182, 0.08) 50%, transparent 70%);
  }
  .glisse-aura-3 {
    bottom: -150px;
    left: 35%;
    width: 700px;
    height: 700px;
    background: radial-gradient(circle, rgba(52, 211, 153, 0.14) 0%, rgba(56, 189, 248, 0.08) 50%, transparent 70%);
  }

  /* Frosted white cards */
  .glisse-card {
    background: var(--glisse-surface);
    backdrop-filter: var(--glisse-blur);
    -webkit-backdrop-filter: var(--glisse-blur);
    border: 1px solid var(--glisse-border);
    border-top: 1px solid var(--glisse-border-specular);
    box-shadow: var(--glisse-inner-specular), var(--glisse-shadow);
    border-radius: 24px;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-card:hover {
    border-color: rgba(203, 213, 225, 0.9);
    box-shadow: inset 0 1px 1px 0 #ffffff, 0 24px 48px -12px rgba(15, 23, 42, 0.08);
  }

  /* Frosted White Buttons */
  .glisse-btn-primary {
    background: linear-gradient(135deg, #2563eb, #0284c7);
    border: 1px solid rgba(37, 99, 235, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.4);
    box-shadow: 0 6px 18px -3px rgba(37, 99, 235, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.3);
    color: #ffffff;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-primary:hover {
    transform: translateY(-1px);
    box-shadow: 0 10px 24px -3px rgba(37, 99, 235, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.4);
    filter: brightness(1.05);
  }
  .glisse-btn-primary:active {
    transform: translateY(1px) scale(0.98);
  }

  .glisse-btn-secondary {
    background: rgba(255, 255, 255, 0.85);
    border: 1px solid #cbd5e1;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    color: #334155;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-secondary:hover {
    background: #ffffff;
    border-color: #94a3b8;
    color: #0f172a;
    transform: translateY(-1px);
    box-shadow: 0 4px 12px -2px rgba(15, 23, 42, 0.06);
  }

  .glisse-btn-danger {
    background: linear-gradient(135deg, #dc2626, #ef4444);
    border: 1px solid rgba(220, 38, 38, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 6px 16px -3px rgba(220, 38, 38, 0.35);
    color: #ffffff;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-danger:hover {
    transform: translateY(-1px);
    filter: brightness(1.05);
  }

  .glisse-btn-success {
    background: linear-gradient(135deg, #059669, #10b981);
    border: 1px solid rgba(5, 150, 105, 0.2);
    border-top: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 6px 16px -3px rgba(16, 185, 129, 0.35);
    color: #ffffff;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-success:hover {
    transform: translateY(-1px);
    filter: brightness(1.05);
  }

  /* Frosted White Inputs */
  .glisse-input {
    background: #ffffff;
    border: 1px solid #cbd5e1;
    box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.03);
    color: #0f172a;
    border-radius: 14px;
    padding: 9px 14px;
    font-size: 0.85rem;
    outline: none;
    transition: all 0.2s;
  }
  .glisse-input:focus {
    border-color: #2563eb;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
  }

  /* Symmetrical Segmented Dock in White Mode */
  .glisse-dock {
    background: rgba(255, 255, 255, 0.78);
    backdrop-filter: blur(28px);
    -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(203, 213, 225, 0.7);
    box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255, 255, 255, 1);
    border-radius: 9999px;
    padding: 5px;
    display: inline-flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 4px;
  }
  .glisse-tab {
    padding: 8px 18px;
    border-radius: 9999px;
    font-size: 0.825rem;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid transparent;
    user-select: none;
  }
  .glisse-tab:hover {
    color: #0f172a;
    background: rgba(241, 245, 249, 0.8);
  }
  .glisse-tab.active {
    color: #0f172a;
    background: #ffffff;
    border: 1px solid rgba(203, 213, 225, 0.8);
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.06), inset 0 1px 0 #ffffff;
    font-weight: 700;
  }

  /* Modal Backdrop */
  .glisse-modal-backdrop {
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
  }

  .tab-pane {
    display: none;
    animation: glisseFadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .tab-pane.active {
    display: block;
  }

  @keyframes glisseFadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
</head>
<body class="min-h-screen text-slate-800 relative pb-16">
  <!-- Chromatic Background Orbs -->
  <div class="glisse-aura glisse-aura-1"></div>
  <div class="glisse-aura glisse-aura-2"></div>
  <div class="glisse-aura glisse-aura-3"></div>

  <!-- Top Glass Bar (Symmetrical Layout) -->
  <header class="relative z-20 border-b border-slate-200/70 bg-white/70 backdrop-blur-xl py-4 px-4 sm:px-8">
    <div class="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
      <!-- Left: Logo & Branding -->
      <div class="flex items-center space-x-3.5">
        <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-blue-500/20 to-cyan-500/15 border border-blue-200 flex items-center justify-center text-xl shadow-sm">
          📡
        </div>
        <div>
          <h1 class="text-base font-black tracking-tight text-slate-900">
            Free Wi-Fi Gateway
          </h1>
          <p class="text-[11px] text-slate-500 font-medium">Admin Management Portal</p>
        </div>
      </div>

      <!-- Center: Status Pills -->
      <div class="hidden md:flex items-center space-x-2 text-xs">
        <span class="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold flex items-center gap-1.5 shadow-sm">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          Gateway Active
        </span>
      </div>

      <!-- Right: Action Pills -->
      <div class="flex items-center space-x-2.5">
        <button onclick="location.reload()" class="glisse-btn-secondary px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5" title="Refresh Dashboard">
          <span>🔄</span> Refresh
        </button>
        <a href="/admin/logout" class="glisse-btn-danger px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm">
          <span>🚪</span> Sign Out
        </a>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 pt-6 relative z-10 space-y-6">

    <!-- Flash Messages -->
    ${
      msg
        ? `<div class="glisse-card p-4 border-emerald-300 bg-emerald-50/90 text-emerald-800 text-xs font-bold flex items-center justify-between shadow-sm">
            <div class="flex items-center space-x-2"><span>✓</span><span>${msg}</span></div>
            <button onclick="this.parentElement.remove()" class="text-emerald-600 hover:text-emerald-900">✕</button>
          </div>`
        : ''
    }
    ${
      err
        ? `<div class="glisse-card p-4 border-red-300 bg-red-50/90 text-red-800 text-xs font-bold flex items-center justify-between shadow-sm">
            <div class="flex items-center space-x-2"><span>⚠️</span><span>${err}</span></div>
            <button onclick="this.parentElement.remove()" class="text-red-600 hover:text-red-900">✕</button>
          </div>`
        : ''
    }

    <!-- Symmetrical 4-Column Stat Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-500">Total Accounts</p>
          <span class="text-lg">👥</span>
        </div>
        <p class="text-3xl font-black text-slate-900 mt-2">${totalUsers}</p>
        <p class="text-[11px] text-slate-500 mt-1">Google Accounts registered</p>
      </div>

      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-500">Online Now</p>
          <span class="text-lg">🟢</span>
        </div>
        <p class="text-3xl font-black text-emerald-600 mt-2">${activeUsers}</p>
        <p class="text-[11px] text-slate-500 mt-1">Active Wi-Fi devices</p>
      </div>

      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-500">VIP Members</p>
          <span class="text-lg">⭐</span>
        </div>
        <p class="text-3xl font-black text-purple-600 mt-2">${vipUsers}</p>
        <p class="text-[11px] text-slate-500 mt-1">30-Day VIP Subscriptions</p>
      </div>

      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-slate-500">Payment Slips</p>
          <span class="text-lg">🧾</span>
        </div>
        <div class="flex items-baseline space-x-2 mt-2">
          <p class="text-3xl font-black text-amber-600">${slips.length}</p>
          ${pendingCount > 0 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300">${pendingCount} Pending</span>` : ''}
        </div>
        <p class="text-[11px] text-slate-500 mt-1">PromptPay slip uploads</p>
      </div>
    </div>

    <!-- Centered Symmetrical Segmented Dock (Tabs) -->
    <div class="flex justify-center w-full py-2">
      <div class="glisse-dock">
        <button onclick="switchTab('accounts')" id="tab-btn-accounts" class="glisse-tab ${activeTab === 'accounts' ? 'active' : ''}">
          <span>👥</span> Accounts
        </button>
        <button onclick="switchTab('slips')" id="tab-btn-slips" class="glisse-tab ${activeTab === 'slips' ? 'active' : ''}">
          <span>🧾</span> Slips
          ${pendingCount > 0 ? `<span class="bg-amber-500 text-white text-[10px] font-black px-1.5 py-0.2 rounded-full">${pendingCount}</span>` : ''}
        </button>
        <button onclick="switchTab('billing')" id="tab-btn-billing" class="glisse-tab ${activeTab === 'billing' ? 'active' : ''}">
          <span>💳</span> PromptPay QR
        </button>
        <button onclick="switchTab('telegram')" id="tab-btn-telegram" class="glisse-tab ${activeTab === 'telegram' ? 'active' : ''}">
          <span>🤖</span> Telegram Bot
        </button>
        <button onclick="switchTab('settings')" id="tab-btn-settings" class="glisse-tab ${activeTab === 'settings' ? 'active' : ''}">
          <span>⚙️</span> Security & Settings
        </button>
        <button onclick="switchTab('logs')" id="tab-btn-logs" class="glisse-tab ${activeTab === 'logs' ? 'active' : ''}">
          <span>📡</span> Traffic Logs
        </button>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- TAB 1: ACCOUNTS & ACCESS                                              -->
    <!-- ===================================================================== -->
    <div id="tab-pane-accounts" class="tab-pane ${activeTab === 'accounts' ? 'active' : ''} space-y-4">
      <!-- Symmetrical Tab Action Bar -->
      <div class="glisse-card p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div class="flex items-center space-x-2 w-full md:w-auto">
          <input type="text" id="account-search" placeholder="Search email, name or IP..." onkeyup="filterAccounts()" class="glisse-input w-full md:w-72 text-xs" />
          <div class="hidden sm:flex items-center space-x-1">
            <button onclick="filterAccountPlan('all')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary active-filter">All</button>
            <button onclick="filterAccountPlan('vip')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary">VIP</button>
            <button onclick="filterAccountPlan('trial')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary">Trial</button>
            <button onclick="filterAccountPlan('blocked')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary">Blocked</button>
          </div>
        </div>

        <div class="flex items-center space-x-2 w-full md:w-auto justify-end">
          <button onclick="openGrantModal()" class="glisse-btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-md">
            <span>➕</span> Grant VIP Access
          </button>
        </div>
      </div>

      <!-- Accounts Table -->
      <div class="glisse-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50/80">
                <th class="py-3 px-4">User / Google Account</th>
                <th class="py-3 px-3">Plan</th>
                <th class="py-3 px-3">Device IP</th>
                <th class="py-3 px-3">MAC Address</th>
                <th class="py-3 px-3">Remaining Time</th>
                <th class="py-3 px-3">Status</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="accounts-tbody" class="divide-y divide-slate-100">
              ${
                accounts.length === 0
                  ? '<tr><td colspan="7" class="py-12 text-center text-slate-400">No registered Google accounts found</td></tr>'
                  : accounts.map(a => {
                      const isExpired = !a.expiresAt || a.expiresAt <= now;
                      const daysLeft = a.expiresAt && !isExpired ? Math.ceil((a.expiresAt - now) / 86400000) : 0;
                      const expStr = a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('en-GB') : '-';
                      const initial = (a.name ? a.name.charAt(0) : (a.email ? a.email.charAt(0) : 'G')).toUpperCase();
                      const planType = a.plan === 'vip-30d' ? 'vip' : 'trial';

                      return `
                      <tr class="account-row hover:bg-slate-50/70 transition" data-email="${a.email.toLowerCase()}" data-name="${(a.name||'').toLowerCase()}" data-ip="${a.activeIp || ''}" data-plan="${planType}" data-blocked="${a.blocked ? '1' : '0'}">
                        <td class="py-3 px-4">
                          <div class="flex items-center space-x-3">
                            <div class="w-8 h-8 rounded-2xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center font-bold text-xs text-white shadow-sm">
                              ${initial}
                            </div>
                            <div>
                              <p class="font-bold text-slate-800">${a.name || '-'}</p>
                              <p class="font-mono text-[11px] text-slate-500">${a.email}</p>
                            </div>
                          </div>
                        </td>
                        <td class="py-3 px-3">
                          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${a.plan === 'vip-30d' ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}">
                            ${a.plan === 'vip-30d' ? '★ 30-Day VIP' : '1-Hour Free'}
                          </span>
                        </td>
                        <td class="py-3 px-3 font-mono text-slate-700">
                          ${a.activeIp ? `<span class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>${a.activeIp}</span>` : '<span class="text-slate-400">Offline</span>'}
                        </td>
                        <td class="py-3 px-3 font-mono text-slate-500">${a.activeMac || '-'}</td>
                        <td class="py-3 px-3">
                          ${isExpired ? '<span class="text-red-600 font-bold">Expired</span>' : `<span class="text-emerald-700 font-bold">${daysLeft}d left</span> <span class="text-[10px] text-slate-400">(${expStr})</span>`}
                        </td>
                        <td class="py-3 px-3">
                          ${a.blocked ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-50 text-red-700 border border-red-200">Blocked</span>' : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>'}
                        </td>
                        <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                          <form method="post" action="/admin/account/extend" class="inline">
                            <input type="hidden" name="email" value="${a.email}" />
                            <button type="submit" class="glisse-btn-success px-2 py-1 rounded-lg text-[11px] font-bold" title="Extend 30 Days VIP">+30d VIP</button>
                          </form>
                          <form method="post" action="/admin/account/reset-trial" class="inline">
                            <input type="hidden" name="email" value="${a.email}" />
                            <button type="submit" class="glisse-btn-secondary px-2 py-1 rounded-lg text-[11px] font-bold" title="Reset 1-Hour Free Trial">Reset Free</button>
                          </form>
                          ${a.activeIp ? `
                          <form method="post" action="/admin/account/revoke-ip" class="inline">
                            <input type="hidden" name="email" value="${a.email}" />
                            <button type="submit" class="glisse-btn-secondary px-2 py-1 rounded-lg text-[11px] font-bold" title="Kick Device from Wi-Fi">Kick IP</button>
                          </form>` : ''}
                          <form method="post" action="/admin/account/block" class="inline">
                            <input type="hidden" name="email" value="${a.email}" />
                            <button type="submit" class="${a.blocked ? 'glisse-btn-secondary' : 'glisse-btn-danger'} px-2 py-1 rounded-lg text-[11px] font-bold">
                              ${a.blocked ? 'Unblock' : 'Block'}
                            </button>
                          </form>
                          <form method="post" action="/admin/account/delete" class="inline" onsubmit="return confirm('Permanently delete account ${a.email}?')">
                            <input type="hidden" name="email" value="${a.email}" />
                            <button type="submit" class="glisse-btn-secondary px-2 py-1 rounded-lg text-[11px] text-red-500 hover:text-red-700 font-bold">✕</button>
                          </form>
                        </td>
                      </tr>`;
                    }).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- TAB 2: PAYMENT SLIPS & VERIFICATION                                   -->
    <!-- ===================================================================== -->
    <div id="tab-pane-slips" class="tab-pane ${activeTab === 'slips' ? 'active' : ''} space-y-4">
      <!-- Symmetrical Tab Action Bar -->
      <div class="glisse-card p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div class="flex items-center space-x-2">
          <button onclick="filterSlipStatus('all')" class="slip-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold glisse-btn-secondary active-filter">All Slips (${slips.length})</button>
          <button onclick="filterSlipStatus('pending')" class="slip-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold glisse-btn-secondary">Pending (${pendingCount})</button>
          <button onclick="filterSlipStatus('approved')" class="slip-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold glisse-btn-secondary">Approved</button>
          <button onclick="filterSlipStatus('declined')" class="slip-filter-btn px-3 py-1.5 rounded-xl text-xs font-bold glisse-btn-secondary">Declined</button>
        </div>
        <p class="text-xs text-slate-500 font-medium">Verify PromptPay receipts with 1-click VIP activation</p>
      </div>

      <!-- Slips Symmetrical Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="slips-grid">
        ${
          slips.length === 0
            ? '<div class="col-span-full glisse-card py-16 text-center text-slate-400">No payment slips uploaded yet.</div>'
            : slips.map(s => {
                const imgUrl = s.cloudUrl || (s.filename ? `/uploads/${s.filename}` : '/my-qr');
                const dateStr = new Date(s.uploaded_at).toLocaleString('en-GB');
                const isPending = s.status === 'pending';
                const isApproved = s.status === 'approved' || s.status === 'verified';

                return `
                <div class="glisse-card p-4 flex flex-col justify-between space-y-3 slip-card" data-status="${s.status}">
                  <div>
                    <div class="relative w-full h-44 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 group cursor-pointer" onclick="openLightbox('${imgUrl}', 'Slip #${s.id} - ${s.email}')">
                      <img src="${imgUrl}" alt="Slip #${s.id}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='/my-qr'" />
                      <div class="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent flex items-end p-3">
                        <span class="text-[11px] font-bold text-white bg-slate-900/70 px-2.5 py-0.5 rounded-lg backdrop-blur-md">🔍 Click to inspect</span>
                      </div>
                      <div class="absolute top-2.5 right-2.5">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold shadow-sm ${
                          isApproved ? 'bg-emerald-600 text-white' : (isPending ? 'bg-amber-500 text-white' : 'bg-red-600 text-white')
                        }">
                          ${s.status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div class="mt-3 space-y-1 text-xs">
                      <div class="flex items-center justify-between">
                        <span class="font-bold text-slate-900 text-sm">Slip #${s.id}</span>
                        <span class="font-mono font-bold text-blue-600">${s.amount || 150} THB</span>
                      </div>
                      <p class="font-mono text-slate-600 break-all">${s.email}</p>
                      <div class="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                        <span>IP: ${s.ip_address || '-'}</span>
                        <span>${dateStr}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Slip Actions -->
                  <div class="pt-3 border-t border-slate-100 flex items-center space-x-2">
                    ${
                      isPending
                        ? `
                        <form method="post" action="/admin/slip/approve" class="flex-1">
                          <input type="hidden" name="slipId" value="${s.id}" />
                          <button type="submit" class="glisse-btn-success w-full py-2 rounded-xl text-xs font-bold shadow-sm">
                            ✓ Approve VIP
                          </button>
                        </form>
                        <form method="post" action="/admin/slip/decline" class="flex-1">
                          <input type="hidden" name="slipId" value="${s.id}" />
                          <button type="submit" class="glisse-btn-secondary w-full py-2 rounded-xl text-xs font-bold text-red-600 hover:text-red-700">
                            ✕ Decline
                          </button>
                        </form>`
                        : `
                        <button onclick="openLightbox('${imgUrl}', 'Slip #${s.id} - ${s.email}')" class="glisse-btn-secondary flex-1 py-1.5 rounded-xl text-xs font-bold">
                          View Receipt
                        </button>
                        <form method="post" action="/admin/slip/delete" class="inline" onsubmit="return confirm('Delete this slip record?')">
                          <input type="hidden" name="slipId" value="${s.id}" />
                          <button type="submit" class="glisse-btn-secondary px-3 py-1.5 rounded-xl text-xs text-red-500 hover:text-red-700 font-bold" title="Delete slip">
                            🗑
                          </button>
                        </form>`
                    }
                  </div>
                </div>`;
              }).join('')
        }
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- TAB 3: PROMPTPAY QR & BILLING PACKAGES                                -->
    <!-- ===================================================================== -->
    <div id="tab-pane-billing" class="tab-pane ${activeTab === 'billing' ? 'active' : ''} space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Card A: Live PromptPay QR Management -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center space-x-2.5">
                <span class="text-2xl">💳</span>
                <div>
                  <h2 class="font-black text-sm text-slate-900">PromptPay QR Code</h2>
                  <p class="text-xs text-slate-500">Displayed on User Captive Portal for payment</p>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">Active</span>
            </div>

            <div class="flex flex-col sm:flex-row items-center gap-6 mt-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
              <div class="w-36 h-36 rounded-2xl bg-white p-2 shadow-sm border border-slate-200 flex items-center justify-center flex-shrink-0">
                <img src="/my-qr" alt="PromptPay QR" class="max-w-full max-h-full object-contain" />
              </div>
              <div class="space-y-2 text-xs text-slate-600 flex-1">
                <p class="font-bold text-slate-900">PromptPay Bank Transfer</p>
                <p class="text-slate-500 text-[11px]">Recommended: Upload your official Thai PromptPay QR Code JPG/PNG image so users can scan and pay seamlessly.</p>
                <div class="pt-1 flex items-center space-x-2">
                  <a href="/my-qr" target="_blank" download="promptpay-qr.jpg" class="glisse-btn-secondary px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1">
                    ⬇️ Download
                  </a>
                  <button onclick="openLightbox('/my-qr', 'Active PromptPay QR Code')" class="glisse-btn-secondary px-3 py-1 rounded-lg text-xs font-bold inline-flex items-center gap-1">
                    🔍 Fullscreen
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Upload QR Form -->
          <form method="post" action="/admin/upload-qr" enctype="multipart/form-data" class="space-y-3 pt-3 border-t border-slate-100">
            <label class="block text-xs font-bold text-slate-700">Upload / Replace QR Image</label>
            <div class="flex items-center space-x-3">
              <input type="file" name="qr" accept="image/*" required class="glisse-input flex-1 text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-blue-600 file:text-white" />
              <button type="submit" class="glisse-btn-primary px-4 py-2 rounded-xl text-xs font-bold shadow-md whitespace-nowrap">
                Upload QR
              </button>
            </div>
          </form>
        </div>

        <!-- Card B: Package & Pricing Settings -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center space-x-2.5 mb-2">
              <span class="text-2xl">💰</span>
              <div>
                <h2 class="font-black text-sm text-slate-900">VIP Package & Free Trial</h2>
                <p class="text-xs text-slate-500">Configure prices and trial duration</p>
              </div>
            </div>

            <form method="post" action="/admin/settings" class="space-y-4 mt-4">
              <input type="hidden" name="activeTab" value="billing" />
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">30-Day VIP Package Price (THB / Baht)</label>
                <div class="relative">
                  <input type="number" name="monthlyPrice" value="${settings.monthlyPrice || 150}" required class="glisse-input w-full pr-12 font-bold text-blue-600 text-sm" />
                  <span class="absolute right-3.5 top-2.5 text-xs font-bold text-slate-400">THB</span>
                </div>
                <p class="text-[11px] text-slate-500 mt-1">Displayed on the Wi-Fi payment portal.</p>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">Free Trial Duration (Minutes)</label>
                <div class="relative">
                  <input type="number" name="trialMinutes" value="${settings.trialMinutes || 60}" required class="glisse-input w-full pr-14 font-bold text-emerald-600 text-sm" />
                  <span class="absolute right-3.5 top-2.5 text-xs font-bold text-slate-400">Mins</span>
                </div>
                <p class="text-[11px] text-slate-500 mt-1">Duration of complimentary internet access per Google account.</p>
              </div>

              <div class="pt-3">
                <button type="submit" class="glisse-btn-primary w-full py-2.5 rounded-xl text-xs font-bold shadow-md">
                  Save Billing & Package Settings
                </button>
              </div>
            </form>
          </div>

          <div class="p-3.5 rounded-2xl bg-blue-50 border border-blue-200 text-xs text-blue-900">
            💡 <strong>VIP Package:</strong> Users receive unthrottled 30-day continuous internet access with automatic re-connect upon returning to the Wi-Fi network.
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- TAB 4: TELEGRAM BOT NOTIFICATIONS                                     -->
    <!-- ===================================================================== -->
    <div id="tab-pane-telegram" class="tab-pane ${activeTab === 'telegram' ? 'active' : ''} space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Left: Configuration Form & Test Action -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center justify-between mb-3">
              <div class="flex items-center space-x-2.5">
                <span class="text-2xl">🤖</span>
                <div>
                  <h2 class="font-black text-sm text-slate-900">Telegram Approval Bot</h2>
                  <p class="text-xs text-slate-500">1-Click approve/decline bank slips from your phone</p>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${settings.telegramBotToken && settings.telegramChatId ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}">
                ${settings.telegramBotToken && settings.telegramChatId ? 'Configured' : 'Not Set'}
              </span>
            </div>

            <form method="post" action="/admin/settings" class="space-y-4">
              <input type="hidden" name="activeTab" value="telegram" />
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">Telegram Bot Token</label>
                <input type="text" id="tg-token" name="telegramBotToken" value="${settings.telegramBotToken || ''}" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-slate-500 mt-1">Obtain from @BotFather on Telegram.</p>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">Your Telegram Chat ID</label>
                <input type="text" id="tg-chatid" name="telegramChatId" value="${settings.telegramChatId || ''}" placeholder="e.g. 1534450061" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-slate-500 mt-1">Send <code>/id</code> or <code>/start</code> to your bot to find your Chat ID.</p>
              </div>

              <div class="grid grid-cols-2 gap-3 pt-2">
                <button type="submit" class="glisse-btn-primary py-2.5 rounded-xl text-xs font-bold shadow-md">
                  Save Credentials
                </button>
                <button type="button" onclick="testTelegram()" class="glisse-btn-secondary py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5">
                  <span>⚡</span> Test Notification
                </button>
              </div>
            </form>
          </div>

          <div id="tg-test-result" class="hidden p-3 rounded-2xl text-xs font-bold"></div>
        </div>

        <!-- Right: Setup Guide & Bot Instructions -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center space-x-2.5 mb-3">
              <span class="text-2xl">📖</span>
              <div>
                <h2 class="font-black text-sm text-slate-900">How It Works</h2>
                <p class="text-xs text-slate-500">Step-by-step 3-minute setup</p>
              </div>
            </div>

            <ol class="space-y-3 text-xs text-slate-600 list-decimal list-inside">
              <li class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <strong class="text-slate-900">Create your Bot:</strong> Open <a href="https://t.me/BotFather" target="_blank" class="text-blue-600 underline font-bold">@BotFather</a> on Telegram, send <code>/newbot</code>, and copy the HTTP API Token.
              </li>
              <li class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <strong class="text-slate-900">Start your Bot:</strong> Search for your newly created bot username on Telegram, click <strong>START</strong>, or send <code>/start</code>.
              </li>
              <li class="p-2.5 rounded-xl bg-slate-50 border border-slate-200">
                <strong class="text-slate-900">Instant Notifications:</strong> When a user uploads a PromptPay slip photo, your phone immediately rings with the receipt photo and <strong>[Approve] / [Decline]</strong> buttons!
              </li>
            </ol>
          </div>

          <div class="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
            <span>🛡️</span>
            <span>No public IP or port forwarding required — uses secure outbound long-polling!</span>
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- TAB 5: SECURITY, PIN & SETTINGS                                       -->
    <!-- ===================================================================== -->
    <div id="tab-pane-settings" class="tab-pane ${activeTab === 'settings' ? 'active' : ''} space-y-6">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Security Card -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center space-x-2.5 mb-3">
              <span class="text-2xl">🔐</span>
              <div>
                <h2 class="font-black text-sm text-slate-900">Admin Authentication PIN</h2>
                <p class="text-xs text-slate-500">Change your dashboard password</p>
              </div>
            </div>

            <form method="post" action="/admin/settings" class="space-y-4">
              <input type="hidden" name="activeTab" value="settings" />
              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">New Administrator PIN</label>
                <input type="password" name="adminPin" value="${settings.adminPin || '1234'}" required class="glisse-input w-full font-mono text-xs tracking-widest" />
                <p class="text-[11px] text-slate-500 mt-1">Must be at least 4 numeric digits.</p>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">Google OAuth Client ID</label>
                <input type="text" name="googleClientId" value="${settings.googleClientId || ''}" placeholder="e.g. 197252344762-...apps.googleusercontent.com" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-slate-500 mt-1">For Sign In with Google authentication.</p>
              </div>

              <div class="pt-2">
                <button type="submit" class="glisse-btn-primary w-full py-2.5 rounded-xl text-xs font-bold shadow-md">
                  Update Admin Security Settings
                </button>
              </div>
            </form>
          </div>

          <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-500 space-y-1">
            <p><strong>Session Security:</strong> Authenticated via HttpOnly SameSite session cookies.</p>
            <p class="text-[11px] text-slate-400">PINs are never leaked into URLs or browser navigation history.</p>
          </div>
        </div>

        <!-- SMTP Email Card -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center space-x-2.5 mb-3">
              <span class="text-2xl">📧</span>
              <div>
                <h2 class="font-black text-sm text-slate-900">Gmail SMTP (Email OTP Delivery)</h2>
                <p class="text-xs text-slate-500">Deliver 6-digit verification codes to users</p>
              </div>
            </div>

            <form method="post" action="/admin/settings" class="space-y-3">
              <input type="hidden" name="activeTab" value="settings" />
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-bold text-slate-700 mb-1">SMTP Host</label>
                  <input type="text" name="smtpHost" value="${settings.smtpHost || ''}" placeholder="smtp.gmail.com" class="glisse-input w-full font-mono text-xs" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-slate-700 mb-1">SMTP Port</label>
                  <input type="text" name="smtpPort" value="${settings.smtpPort || '587'}" placeholder="587" class="glisse-input w-full font-mono text-xs" />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">SMTP Username / Email</label>
                <input type="text" name="smtpUser" value="${settings.smtpUser || ''}" placeholder="your-email@gmail.com" class="glisse-input w-full font-mono text-xs" />
              </div>

              <div>
                <label class="block text-xs font-bold text-slate-700 mb-1">Google App Password</label>
                <input type="password" name="smtpPass" value="${settings.smtpPass ? '********' : ''}" placeholder="16-character app password" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-slate-500 mt-1">Generate via Google Account > Security > 2-Step Verification > App passwords.</p>
              </div>

              <div class="pt-2">
                <button type="submit" class="glisse-btn-primary w-full py-2.5 rounded-xl text-xs font-bold shadow-md">
                  Save SMTP Configuration
                </button>
              </div>
            </form>
          </div>

          <div class="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
            ✉️ Optional fallback delivery when users log in with email instead of One-Tap Google Account.
          </div>
        </div>
      </div>
    </div>

    <!-- ===================================================================== -->
    <!-- TAB 6: TRAFFIC & FIREWALL LOGS                                        -->
    <!-- ===================================================================== -->
    <div id="tab-pane-logs" class="tab-pane ${activeTab === 'logs' ? 'active' : ''} space-y-4">
      <!-- Symmetrical Tab Action Bar -->
      <div class="glisse-card p-4 flex flex-col md:flex-row items-center justify-between gap-3">
        <div class="flex items-center space-x-2 w-full md:w-auto">
          <input type="text" id="log-search" placeholder="Search IP, email or action..." onkeyup="filterLogs()" class="glisse-input w-full md:w-72 text-xs" />
        </div>

        <div class="flex items-center space-x-2 w-full md:w-auto justify-end">
          <button onclick="exportLogsCSV()" class="glisse-btn-secondary px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <span>📥</span> Export CSV
          </button>
          <form method="post" action="/admin/logs/clear" onsubmit="return confirm('Clear all IP connection activity logs?')">
            <button type="submit" class="glisse-btn-danger px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5">
              <span>🗑</span> Clear Logs
            </button>
          </form>
        </div>
      </div>

      <!-- Logs Glass Table -->
      <div class="glisse-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-slate-200 text-[11px] font-bold text-slate-500 uppercase tracking-wider bg-slate-50/80">
                <th class="py-3 px-4">Device IP</th>
                <th class="py-3 px-3">MAC Address</th>
                <th class="py-3 px-3">Google Email</th>
                <th class="py-3 px-3">Action Event</th>
                <th class="py-3 px-3">Timestamp</th>
                <th class="py-3 px-4 text-right">Quick Action</th>
              </tr>
            </thead>
            <tbody id="logs-tbody" class="divide-y divide-slate-100">
              ${
                ipLogs.length === 0
                  ? '<tr><td colspan="6" class="py-12 text-center text-slate-400">No network traffic logs recorded yet</td></tr>'
                  : ipLogs.map(l => {
                      const timeStr = new Date(l.timestamp).toLocaleString('en-GB');
                      return `
                      <tr class="log-row hover:bg-slate-50/70 transition" data-ip="${l.ip_address}" data-email="${l.email || ''}" data-action="${l.action}">
                        <td class="py-3 px-4 font-mono font-bold text-blue-600">${l.ip_address}</td>
                        <td class="py-3 px-3 font-mono text-slate-500">${l.mac_address || '-'}</td>
                        <td class="py-3 px-3 font-mono text-slate-700">${l.email || '-'}</td>
                        <td class="py-3 px-3">
                          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            l.action === 'buy_package' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                            (l.action === 'blocked' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200')
                          }">
                            ${l.action}
                          </span>
                        </td>
                        <td class="py-3 px-3 text-slate-500">${timeStr}</td>
                        <td class="py-3 px-4 text-right">
                          <form method="post" action="/admin/account/revoke-ip" class="inline">
                            <input type="hidden" name="ip" value="${l.ip_address}" />
                            <button type="submit" class="glisse-btn-secondary px-2.5 py-1 rounded-lg text-[11px] font-bold text-red-600 hover:text-red-700" title="Revoke access immediately">
                              Kick IP
                            </button>
                          </form>
                        </td>
                      </tr>`;
                    }).join('')
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

  </main>

  <!-- ===================================================================== -->
  <!-- MODAL: GRANT VIP ACCESS (Action Dialog)                               -->
  <!-- ===================================================================== -->
  <div id="grant-modal" class="fixed inset-0 z-50 glisse-modal-backdrop hidden flex items-center justify-center p-4">
    <div class="glisse-card p-6 sm:p-8 max-w-md w-full relative space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-slate-200">
        <h3 class="font-black text-slate-900 text-base flex items-center gap-2">
          <span>➕</span> Grant VIP Access
        </h3>
        <button onclick="closeGrantModal()" class="text-slate-400 hover:text-slate-700 text-lg">✕</button>
      </div>

      <form method="post" action="/admin/account/grant" class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">User Email Address</label>
          <input type="email" name="email" required placeholder="user@gmail.com" class="glisse-input w-full" />
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">User Name (Optional)</label>
          <input type="text" name="name" placeholder="John Doe" class="glisse-input w-full" />
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">VIP Duration (Days)</label>
          <select name="days" class="glisse-input w-full font-bold text-blue-600">
            <option value="7">7 Days VIP</option>
            <option value="30" selected>30 Days VIP (Standard Package)</option>
            <option value="60">60 Days VIP</option>
            <option value="90">90 Days VIP (Quarterly)</option>
            <option value="365">365 Days VIP (Annual)</option>
          </select>
        </div>

        <div class="pt-2 flex items-center space-x-3">
          <button type="button" onclick="closeGrantModal()" class="glisse-btn-secondary flex-1 py-2.5 rounded-xl text-xs font-bold">
            Cancel
          </button>
          <button type="submit" class="glisse-btn-primary flex-1 py-2.5 rounded-xl text-xs font-bold shadow-md">
            Grant VIP Now
          </button>
        </div>
      </form>
    </div>
  </div>

  <!-- ===================================================================== -->
  <!-- MODAL: RECEIPT LIGHTBOX (Image Inspector)                             -->
  <!-- ===================================================================== -->
  <div id="lightbox-modal" class="fixed inset-0 z-50 glisse-modal-backdrop hidden flex items-center justify-center p-4" onclick="closeLightbox(event)">
    <div class="glisse-card p-4 sm:p-6 max-w-2xl w-full relative space-y-3" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between pb-2 border-b border-slate-200">
        <h4 id="lightbox-title" class="font-bold text-slate-900 text-sm">Receipt Inspector</h4>
        <button onclick="closeLightbox()" class="text-slate-400 hover:text-slate-700 text-lg">✕</button>
      </div>
      <div class="w-full max-h-[70vh] overflow-auto flex items-center justify-center rounded-2xl bg-slate-100 p-2 border border-slate-200">
        <img id="lightbox-img" src="" alt="Receipt" class="max-w-full max-h-[65vh] object-contain rounded-xl shadow-md" />
      </div>
      <div class="flex items-center justify-end space-x-2 pt-2">
        <a id="lightbox-download" href="" download="receipt.jpg" class="glisse-btn-secondary px-4 py-1.5 rounded-xl text-xs font-bold">
          ⬇️ Download Receipt
        </a>
        <button onclick="closeLightbox()" class="glisse-btn-primary px-4 py-1.5 rounded-xl text-xs font-bold">
          Close
        </button>
      </div>
    </div>
  </div>

  <!-- ===================================================================== -->
  <!-- CLIENT JAVASCRIPT CONTROLLERS                                         -->
  <!-- ===================================================================== -->
  <script>
    // Tab Switching Controller
    function switchTab(tabId) {
      document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.glisse-tab').forEach(el => el.classList.remove('active'));

      const targetPane = document.getElementById('tab-pane-' + tabId);
      const targetBtn = document.getElementById('tab-btn-' + tabId);

      if (targetPane) targetPane.classList.add('active');
      if (targetBtn) targetBtn.classList.add('active');

      history.replaceState(null, null, '#tab=' + tabId);
    }

    // Initialize Active Tab from URL Hash if present
    window.addEventListener('DOMContentLoaded', () => {
      const hash = window.location.hash;
      if (hash && hash.startsWith('#tab=')) {
        const tab = hash.replace('#tab=', '');
        if (document.getElementById('tab-pane-' + tab)) {
          switchTab(tab);
        }
      }
    });

    // Grant Modal
    function openGrantModal() {
      document.getElementById('grant-modal').classList.remove('hidden');
    }
    function closeGrantModal() {
      document.getElementById('grant-modal').classList.add('hidden');
    }

    // Lightbox Modal
    function openLightbox(url, title) {
      document.getElementById('lightbox-img').src = url;
      document.getElementById('lightbox-title').innerText = title || 'Receipt Inspector';
      document.getElementById('lightbox-download').href = url;
      document.getElementById('lightbox-modal').classList.remove('hidden');
    }
    function closeLightbox() {
      document.getElementById('lightbox-modal').classList.add('hidden');
    }

    // Real-time Account Filtering
    function filterAccounts() {
      const q = (document.getElementById('account-search').value || '').toLowerCase();
      document.querySelectorAll('.account-row').forEach(row => {
        const email = row.getAttribute('data-email') || '';
        const name = row.getAttribute('data-name') || '';
        const ip = row.getAttribute('data-ip') || '';
        if (email.includes(q) || name.includes(q) || ip.includes(q)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    function filterAccountPlan(plan) {
      document.querySelectorAll('.acc-filter-btn').forEach(btn => btn.classList.remove('active-filter'));
      event.target.classList.add('active-filter');

      document.querySelectorAll('.account-row').forEach(row => {
        const rowPlan = row.getAttribute('data-plan');
        const isBlocked = row.getAttribute('data-blocked') === '1';

        if (plan === 'all') row.style.display = '';
        else if (plan === 'vip') row.style.display = rowPlan === 'vip' ? '' : 'none';
        else if (plan === 'trial') row.style.display = rowPlan === 'trial' ? '' : 'none';
        else if (plan === 'blocked') row.style.display = isBlocked ? '' : 'none';
      });
    }

    // Slips Filtering
    function filterSlipStatus(status) {
      document.querySelectorAll('.slip-filter-btn').forEach(btn => btn.classList.remove('active-filter'));
      event.target.classList.add('active-filter');

      document.querySelectorAll('.slip-card').forEach(card => {
        const cardStatus = card.getAttribute('data-status');
        if (status === 'all' || cardStatus === status) {
          card.style.display = '';
        } else {
          card.style.display = 'none';
        }
      });
    }

    // Live Telegram Test Action
    async function testTelegram() {
      const token = document.getElementById('tg-token').value.trim();
      const chatId = document.getElementById('tg-chatid').value.trim();
      const resultBox = document.getElementById('tg-test-result');

      if (!token || !chatId) {
        alert('Please enter both Telegram Bot Token and Chat ID');
        return;
      }

      resultBox.className = 'p-3 rounded-2xl text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200';
      resultBox.innerText = '⏳ Sending test notification to Telegram...';
      resultBox.classList.remove('hidden');

      let testSuccess = false;
      let errorMsg = null;

      // 1. Try local server API first
      try {
        const res = await fetch('/admin/telegram-test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telegramBotToken: token, telegramChatId: chatId })
        });
        const contentType = res.headers.get('content-type') || '';
        if (res.ok && contentType.includes('application/json')) {
          const data = await res.json();
          if (data.success || data.ok) {
            testSuccess = true;
          } else {
            errorMsg = data.error || 'Failed to send';
          }
        }
      } catch (e) {}

      // 2. Direct Telegram Bot API fallback (works everywhere, including Firebase Hosting)
      if (!testSuccess && !errorMsg) {
        try {
          const tgUrl = 'https://api.telegram.org/bot' + encodeURIComponent(token) + '/sendMessage';
          const tgRes = await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '🔔 <b>Free Wi-Fi Gateway</b>\n\n✅ Telegram Bot connected successfully!\n🕒 Time: ' + new Date().toLocaleString() + '\n🌐 Dashboard: Admin Portal',
              parse_mode: 'HTML'
            })
          });
          const contentType = tgRes.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            const tgData = await tgRes.json();
            if (tgData.ok) {
              testSuccess = true;
            } else {
              errorMsg = tgData.description || 'Failed to send message via Telegram Bot API';
            }
          } else {
            errorMsg = 'Received unexpected response from Telegram server';
          }
        } catch (e) {
          errorMsg = e.message;
        }
      }

      if (testSuccess) {
        resultBox.className = 'p-3 rounded-2xl text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-300';
        resultBox.innerText = '✓ Test notification delivered to your Telegram app!';
      } else {
        resultBox.className = 'p-3 rounded-2xl text-xs font-bold bg-red-50 text-red-800 border border-red-300';
        resultBox.innerText = '⚠️ Telegram error: ' + (errorMsg || 'Failed to send');
      }
    }

    // Live Traffic Logs Filter
    function filterLogs() {
      const q = (document.getElementById('log-search').value || '').toLowerCase();
      document.querySelectorAll('.log-row').forEach(row => {
        const ip = row.getAttribute('data-ip') || '';
        const email = row.getAttribute('data-email') || '';
        const action = row.getAttribute('data-action') || '';
        if (ip.includes(q) || email.includes(q) || action.includes(q)) {
          row.style.display = '';
        } else {
          row.style.display = 'none';
        }
      });
    }

    // Export Logs CSV
    function exportLogsCSV() {
      const rows = document.querySelectorAll('#logs-tbody tr');
      let csv = 'Device IP,MAC Address,Email,Action,Timestamp\\n';
      rows.forEach(r => {
        const cols = r.querySelectorAll('td');
        if (cols.length >= 5) {
          const ip = cols[0].innerText.trim();
          const mac = cols[1].innerText.trim();
          const email = cols[2].innerText.trim();
          const action = cols[3].innerText.trim();
          const time = cols[4].innerText.trim();
          csv += '"' + ip + '","' + mac + '","' + email + '","' + action + '","' + time + '"\\n';
        }
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'wifi-traffic-logs-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      URL.revokeObjectURL(url);
    }
  </script>
</body>
</html>`;
}

module.exports = {
  renderAdminLogin,
  renderAdmin
};

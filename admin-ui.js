// ============================================================================
// Free Wi-Fi Gateway - True Dark Mode Interface with Liquid Glass
// Symmetrical, visionOS-style Dark Liquid Glass UI (Pure Solid & Glass Colors)
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
    --glass-bg: #000000;
    --glass-surface: rgba(255, 255, 255, 0.04);
    --glass-border: rgba(255, 255, 255, 0.09);
    --glass-border-specular: rgba(255, 255, 255, 0.22);
    --glass-shadow: 0 24px 48px -12px rgba(0, 0, 0, 0.95);
    --glass-inner: inset 0 1px 0 0 rgba(255, 255, 255, 0.16);
    --glass-blur: blur(32px) saturate(190%);
  }
  * { box-sizing: border-box; }
  body {
    background-color: var(--glass-bg);
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
    margin: 0;
    overflow-x: hidden;
  }
  .glisse-card {
    background: var(--glass-surface);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--glass-border);
    border-top: 1px solid var(--glass-border-specular);
    box-shadow: var(--glass-inner), var(--glass-shadow);
    border-radius: 28px;
  }
  .glisse-input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    color: #ffffff;
    border-radius: 16px;
    outline: none;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #ffffff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
  }
  .glisse-btn-primary {
    background: #ffffff;
    color: #000000;
    border: 1px solid #ffffff;
    box-shadow: 0 4px 16px rgba(255, 255, 255, 0.15);
    font-weight: 700;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-primary:hover {
    background: #e2e8f0;
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(255, 255, 255, 0.25);
  }
  .glisse-btn-primary:active {
    transform: translateY(1px) scale(0.98);
  }
</style>
</head>
<body class="flex items-center justify-center p-4 min-h-screen">
  <div class="glisse-card p-8 sm:p-10 max-w-md w-full relative z-10 text-center">
    <div class="inline-flex p-4 rounded-3xl mb-4 bg-white/5 border border-white/10 backdrop-blur-xl">
      <span class="text-4xl">🛡️</span>
    </div>
    
    <h1 class="text-2xl font-black tracking-tight text-white mb-1">Gateway Admin</h1>
    <p class="text-xs text-zinc-400 mb-6 font-medium">Administrator Access Portal</p>
    
    ${error ? `<div class="bg-red-950/40 border border-red-800/60 text-red-300 text-xs px-4 py-2.5 rounded-2xl mb-5 font-semibold">${error}</div>` : ''}

    <form method="post" action="/admin/login" class="space-y-5 text-left">
      <div>
        <label class="block text-xs font-bold text-zinc-400 mb-2 uppercase tracking-wider">Administrator PIN</label>
        <input type="password" name="pin" placeholder="••••" autofocus required class="glisse-input w-full px-4 py-3.5 text-center text-xl font-mono tracking-widest" />
      </div>
      <button type="submit" class="glisse-btn-primary w-full py-3.5 rounded-2xl font-bold text-sm tracking-wide">
        Unlock Dashboard →
      </button>
    </form>
  </div>
</body>
</html>`;
}

function renderAdmin({ accounts, slips, ipLogs, settings, isFirebaseActive = false, firebaseConfig = {}, msg = null, err = null, activeTab = 'accounts' }) {
  // Sort slips chronologically so Slip #001 is the first slip uploaded
  const sortedSlips = [...slips].sort((a, b) => {
    const tA = a.uploaded_at ? new Date(a.uploaded_at).getTime() : (a.createdAt || 0);
    const tB = b.uploaded_at ? new Date(b.uploaded_at).getTime() : (b.createdAt || 0);
    return tA - tB;
  });

  const getSlipNum = (slipId) => {
    const idx = sortedSlips.findIndex(s => String(s.id || s.slipId) === String(slipId));
    return idx !== -1 ? String(idx + 1).padStart(3, '0') : '001';
  };

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
    --glass-bg: #000000;
    --glass-surface: rgba(255, 255, 255, 0.035);
    --glass-border: rgba(255, 255, 255, 0.08);
    --glass-border-specular: rgba(255, 255, 255, 0.22);
    --glass-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.85);
    --glass-inner-specular: inset 0 1px 0 0 rgba(255, 255, 255, 0.15);
    --glass-blur: blur(32px) saturate(190%);
  }

  * { box-sizing: border-box; }

  body {
    background-color: var(--glass-bg);
    color: #f1f5f9;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }

  /* Dark Frosted Glass Cards */
  .glisse-card {
    background: var(--glass-surface);
    backdrop-filter: var(--glass-blur);
    -webkit-backdrop-filter: var(--glass-blur);
    border: 1px solid var(--glass-border);
    border-top: 1px solid var(--glass-border-specular);
    box-shadow: var(--glass-inner-specular), var(--glass-shadow);
    border-radius: 24px;
    transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-card:hover {
    border-color: rgba(255, 255, 255, 0.14);
    border-top-color: rgba(255, 255, 255, 0.32);
    box-shadow: inset 0 1px 1px 0 rgba(255, 255, 255, 0.22), 0 24px 50px -10px rgba(0, 0, 0, 0.95);
  }

  /* Frosted Glass Buttons - Pure Solid & Glass Styling */
  .glisse-btn-primary {
    background: #ffffff;
    color: #000000;
    border: 1px solid #ffffff;
    box-shadow: 0 4px 14px rgba(255, 255, 255, 0.15);
    font-weight: 700;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-primary:hover {
    background: #e2e8f0;
    color: #000000;
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(255, 255, 255, 0.25);
  }
  .glisse-btn-primary:active {
    transform: translateY(1px) scale(0.98);
  }

  .glisse-btn-secondary {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: #f1f5f9;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
    border-color: rgba(255, 255, 255, 0.25);
    color: #ffffff;
    transform: translateY(-1px);
  }

  .glisse-btn-danger {
    background: rgba(239, 68, 68, 0.18);
    border: 1px solid rgba(239, 68, 68, 0.45);
    border-top: 1px solid rgba(248, 113, 113, 0.6);
    color: #fca5a5;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-danger:hover {
    background: #dc2626;
    color: #ffffff;
    border-color: #dc2626;
    transform: translateY(-1px);
  }

  .glisse-btn-success {
    background: rgba(16, 185, 129, 0.18);
    border: 1px solid rgba(16, 185, 129, 0.45);
    border-top: 1px solid rgba(52, 211, 153, 0.6);
    color: #6ee7b7;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }
  .glisse-btn-success:hover {
    background: #059669;
    color: #ffffff;
    border-color: #059669;
    transform: translateY(-1px);
  }

  /* Frosted Glass Inputs */
  .glisse-input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-top: 1px solid rgba(255, 255, 255, 0.2);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.4);
    color: #ffffff;
    border-radius: 14px;
    padding: 9px 14px;
    font-size: 0.85rem;
    outline: none;
    transition: all 0.2s;
  }
  .glisse-input:focus {
    background: rgba(255, 255, 255, 0.08);
    border-color: #ffffff;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.25);
  }

  /* Symmetrical Segmented Dock in True Dark Frosted Glass */
  .glisse-dock {
    background: rgba(18, 18, 18, 0.72);
    backdrop-filter: blur(28px);
    -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-top: 1px solid rgba(255, 255, 255, 0.22);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), 0 16px 36px rgba(0, 0, 0, 0.8);
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
    color: #a1a1aa;
    cursor: pointer;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    display: flex;
    align-items: center;
    gap: 7px;
    border: 1px solid transparent;
    user-select: none;
  }
  .glisse-tab:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.06);
  }
  .glisse-tab.active {
    color: #000000;
    background: #ffffff;
    border: 1px solid #ffffff;
    box-shadow: 0 4px 14px rgba(255, 255, 255, 0.25);
    font-weight: 700;
  }

  /* Modal Backdrop */
  .glisse-modal-backdrop {
    background: rgba(0, 0, 0, 0.82);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
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
<body class="min-h-screen text-zinc-200 relative pb-16">

  <!-- Top Glass Bar (Symmetrical Layout) -->
  <header class="relative z-20 border-b border-white/10 bg-black/60 backdrop-blur-xl py-4 px-4 sm:px-8">
    <div class="max-w-7xl mx-auto flex items-center justify-between flex-wrap gap-4">
      <!-- Left: Logo & Branding -->
      <div class="flex items-center space-x-3.5">
        <div class="w-10 h-10 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-xl">
          📡
        </div>
        <div>
          <h1 class="text-base font-black tracking-tight text-white">
            Free Wi-Fi Gateway
          </h1>
          <p class="text-[11px] text-zinc-400 font-medium">Admin Management Portal</p>
        </div>
      </div>


      <!-- Right: Action Pills -->
      <div class="flex items-center space-x-2.5">
        <button onclick="location.reload()" class="glisse-btn-secondary px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5" title="Refresh Dashboard">
          <span>🔄</span> Refresh
        </button>
        <a href="/admin/logout" class="glisse-btn-danger px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5">
          <span>🚪</span> Sign Out
        </a>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 pt-6 relative z-10 space-y-6">

    <!-- Flash Messages -->
    ${
      msg
        ? `<div class="glisse-card p-4 border-emerald-800/60 bg-emerald-950/40 text-emerald-300 text-xs font-bold flex items-center justify-between">
            <div class="flex items-center space-x-2"><span>✓</span><span>${msg}</span></div>
            <button onclick="this.parentElement.remove()" class="text-emerald-400 hover:text-emerald-200">✕</button>
          </div>`
        : ''
    }
    ${
      err
        ? `<div class="glisse-card p-4 border-red-800/60 bg-red-950/40 text-red-300 text-xs font-bold flex items-center justify-between">
            <div class="flex items-center space-x-2"><span>⚠️</span><span>${err}</span></div>
            <button onclick="this.parentElement.remove()" class="text-red-400 hover:text-red-200">✕</button>
          </div>`
        : ''
    }

    <!-- Pending Payment Slips Alert Banner -->
    ${
      pendingCount > 0
        ? `<div class="glisse-card p-4 border border-amber-500/50 bg-amber-950/40 text-amber-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-lg">
            <div class="flex items-center space-x-3">
              <span class="text-2xl animate-pulse">🧾</span>
              <div>
                <p class="text-xs font-bold text-white">Action Required: ${pendingCount} New Payment Slip(s) Awaiting Approval</p>
                <p class="text-[11px] text-zinc-400">Users uploaded bank transfer slips waiting for 30-Day VIP Wi-Fi activation.</p>
              </div>
            </div>
            <button onclick="switchTab('slips')" class="glisse-btn-primary px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
              Review Slips Now (${pendingCount}) →
            </button>
          </div>`
        : ''
    }

    <!-- Symmetrical 4-Column Stat Cards -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-zinc-400">Total Accounts</p>
          <span class="text-lg">👥</span>
        </div>
        <p class="text-3xl font-black text-white mt-2">${totalUsers}</p>
        <p class="text-[11px] text-zinc-500 mt-1">Google Accounts registered</p>
      </div>

      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-zinc-400">Online Now</p>
          <span class="text-lg">🟢</span>
        </div>
        <p class="text-3xl font-black text-emerald-400 mt-2">${activeUsers}</p>
        <p class="text-[11px] text-zinc-500 mt-1">Active Wi-Fi devices</p>
      </div>

      <div class="glisse-card p-5 relative overflow-hidden group">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-zinc-400">VIP Members</p>
          <span class="text-lg">⭐</span>
        </div>
        <p class="text-3xl font-black text-purple-400 mt-2">${vipUsers}</p>
        <p class="text-[11px] text-zinc-500 mt-1">30-Day VIP Subscriptions</p>
      </div>

      <div class="glisse-card p-5 relative overflow-hidden group cursor-pointer hover:border-amber-400/50" onclick="switchTab('slips')" title="Click to view Payment Slips">
        <div class="flex items-center justify-between">
          <p class="text-xs font-bold uppercase tracking-wider text-zinc-400">Payment Slips</p>
          <span class="text-lg">🧾</span>
        </div>
        <div class="flex items-baseline space-x-2 mt-2">
          <p class="text-3xl font-black text-amber-400">${slips.length}</p>
          ${pendingCount > 0 ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-800/60">${pendingCount} Pending</span>` : ''}
        </div>
        <p class="text-[11px] text-zinc-500 mt-1">PromptPay slip uploads (click to view)</p>
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
          ${pendingCount > 0 ? `<span class="bg-amber-400 text-black text-[10px] font-black px-1.5 py-0.2 rounded-full">${pendingCount}</span>` : ''}
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
            <button onclick="filterAccountPlan('pending')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary ${pendingCount > 0 ? 'text-amber-300 font-bold border-amber-500/50' : ''}">Pending Slips (${pendingCount})</button>
            <button onclick="filterAccountPlan('vip')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary">VIP</button>
            <button onclick="filterAccountPlan('trial')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary">Trial</button>
            <button onclick="filterAccountPlan('blocked')" class="acc-filter-btn px-2.5 py-1 rounded-xl text-xs font-bold glisse-btn-secondary">Blocked</button>
          </div>
        </div>

        <div class="flex items-center space-x-2 w-full md:w-auto justify-end">
          <button onclick="openGrantModal()" class="glisse-btn-primary px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5">
            <span>➕</span> Grant VIP Access
          </button>
        </div>
      </div>

      <!-- Accounts Table -->
      <div class="glisse-card overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-white/10 text-[11px] font-bold text-zinc-400 uppercase tracking-wider bg-white/[0.02]">
                <th class="py-3 px-4">User / Google Account</th>
                <th class="py-3 px-3">Plan</th>
                <th class="py-3 px-3">Device IP</th>
                <th class="py-3 px-3">MAC Address</th>
                <th class="py-3 px-3">Remaining Time</th>
                <th class="py-3 px-3">Status</th>
                <th class="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody id="accounts-tbody" class="divide-y divide-white/[0.05]">
              ${
                accounts.length === 0
                  ? '<tr><td colspan="7" class="py-12 text-center text-zinc-500">No registered Google accounts found</td></tr>'
                  : accounts.map(a => {
                      const isExpired = !a.expiresAt || a.expiresAt <= now;
                      const daysLeft = a.expiresAt && !isExpired ? Math.ceil((a.expiresAt - now) / 86400000) : 0;
                      const expStr = a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('en-GB') : '-';
                      const initial = (a.name ? a.name.charAt(0) : (a.email ? a.email.charAt(0) : 'G')).toUpperCase();
                      const relatedSlip = sortedSlips.find(s => s.email && s.email.toLowerCase() === (a.email || '').toLowerCase() && (s.status || 'pending').toLowerCase() === 'pending');
                      const isPendingSlip = a.plan === 'pending-vip' || !!relatedSlip;
                      const relSlipNum = relatedSlip ? getSlipNum(relatedSlip.id) : '001';
                      const planType = isPendingSlip ? 'pending' : (a.plan === 'vip-30d' ? 'vip' : 'trial');

                      return `
                      <tr class="account-row hover:bg-white/[0.03] transition ${isPendingSlip ? 'bg-amber-950/20' : ''}" data-email="${(a.email||'').toLowerCase()}" data-name="${(a.name||'').toLowerCase()}" data-ip="${a.activeIp || ''}" data-plan="${planType}" data-blocked="${a.blocked ? '1' : '0'}">
                        <td class="py-3 px-4">
                          <div class="flex items-center space-x-3">
                            <div class="w-8 h-8 rounded-2xl bg-white/[0.08] border border-white/15 flex items-center justify-center font-bold text-xs text-white">
                              ${initial}
                            </div>
                            <div>
                              <p class="font-bold text-white">${a.name || '-'}</p>
                              <p class="font-mono text-[11px] text-zinc-400">${a.email}</p>
                            </div>
                          </div>
                        </td>
                        <td class="py-3 px-3">
                          ${
                            isPendingSlip
                              ? `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-950/60 text-amber-300 border border-amber-800/60 animate-pulse">⏳ Pending Slip</span>`
                              : `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${a.plan === 'vip-30d' ? 'bg-purple-950/40 text-purple-300 border border-purple-800/60' : 'bg-sky-950/40 text-sky-300 border border-sky-800/60'}">
                                  ${a.plan === 'vip-30d' ? '★ 30-Day VIP' : '1-Hour Free'}
                                </span>`
                          }
                        </td>
                        <td class="py-3 px-3 font-mono text-zinc-200">
                          ${a.activeIp ? `<span class="flex items-center gap-1.5"><span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>${a.activeIp}</span>` : '<span class="text-zinc-500">Offline</span>'}
                        </td>
                        <td class="py-3 px-3 font-mono text-zinc-400">${a.activeMac || '-'}</td>
                        <td class="py-3 px-3">
                          ${
                            isPendingSlip
                              ? '<span class="text-amber-400 font-bold">Awaiting Verification</span>'
                              : (isExpired ? '<span class="text-red-400 font-bold">Expired</span>' : `<span class="text-emerald-400 font-bold">${daysLeft}d left</span> <span class="text-[10px] text-zinc-500">(${expStr})</span>`)
                          }
                        </td>
                        <td class="py-3 px-3">
                          ${
                            isPendingSlip
                              ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-950/60 text-amber-300 border border-amber-800/60">Pending</span>'
                              : (a.blocked ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-950/40 text-red-300 border border-red-800/60">Blocked</span>' : '<span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-950/40 text-emerald-300 border border-emerald-800/60">Active</span>')
                          }
                        </td>
                        <td class="py-3 px-4 text-right space-x-1 whitespace-nowrap">
                          ${
                            relatedSlip
                              ? `
                              <button type="button" onclick="openLightbox('${relatedSlip.cloud_url || relatedSlip.cloudUrl || (relatedSlip.filename ? '/uploads/' + relatedSlip.filename : (relatedSlip.imageBase64 || '/my-qr'))}', 'Slip #${relSlipNum} • ${a.email}')" class="glisse-btn-secondary px-2 py-1 rounded-lg text-[11px] font-bold text-amber-300" title="Inspect slip photo">🔍 Slip</button>
                              <form method="post" action="/admin/slip/approve" class="inline">
                                <input type="hidden" name="slipId" value="${relatedSlip.id}" />
                                <button type="submit" class="glisse-btn-success px-2 py-1 rounded-lg text-[11px] font-bold" title="Approve 30-Day VIP">✓ Approve</button>
                              </form>`
                              : `
                              <form method="post" action="/admin/account/extend" class="inline">
                                <input type="hidden" name="email" value="${a.email}" />
                                <button type="submit" class="glisse-btn-success px-2 py-1 rounded-lg text-[11px] font-bold" title="Extend 30 Days VIP">+30d VIP</button>
                              </form>`
                          }
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
                            <button type="submit" class="glisse-btn-secondary px-2 py-1 rounded-lg text-[11px] text-red-400 hover:text-red-300 font-bold">✕</button>
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
        <p class="text-xs text-zinc-400 font-medium">Verify PromptPay receipts with 1-click VIP activation</p>
      </div>

      <!-- Slips Symmetrical Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" id="slips-grid">
        ${
          sortedSlips.length === 0
            ? '<div class="col-span-full glisse-card py-16 text-center text-zinc-500">No payment slips uploaded yet.</div>'
            : sortedSlips.map((s, idx) => {
                const slipNum = String(idx + 1).padStart(3, '0');
                const imgUrl = s.cloudUrl || s.cloud_url || (s.filename ? `/uploads/${s.filename}` : (s.imageBase64 || '/my-qr'));
                const dateStr = s.uploaded_at ? new Date(s.uploaded_at).toLocaleString('en-GB') : (s.createdAt ? new Date(s.createdAt).toLocaleString('en-GB') : '-');
                const isPending = (s.status || 'pending').toLowerCase() === 'pending';
                const isApproved = s.status === 'approved' || s.status === 'verified';

                return `
                <div class="glisse-card p-4 flex flex-col justify-between space-y-3 slip-card" data-status="${s.status}">
                  <div>
                    <div class="relative w-full h-44 rounded-2xl overflow-hidden bg-black/60 border border-white/10 group cursor-pointer" onclick="openLightbox('${imgUrl}', 'Slip #${slipNum} • ${s.email}')">
                      <img src="${imgUrl}" alt="Slip #${slipNum}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300" onerror="this.src='/my-qr'" />
                      <div class="absolute top-2.5 right-2.5">
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${
                          isApproved ? 'bg-emerald-950/70 text-emerald-300 border border-emerald-700/60' : (isPending ? 'bg-amber-950/70 text-amber-300 border border-amber-700/60' : 'bg-red-950/70 text-red-300 border border-red-700/60')
                        }">
                          ${s.status.toUpperCase()}
                        </span>
                      </div>
                    </div>

                    <div class="mt-3 space-y-1 text-xs">
                      <div class="flex items-center justify-between">
                        <span class="font-bold text-white text-sm">Slip #${slipNum}</span>
                        <span class="font-mono font-bold text-sky-400">${s.amount || 150} THB</span>
                      </div>
                      <p class="font-mono text-zinc-300 break-all">${s.email}</p>
                      <div class="flex items-center justify-between text-[11px] text-zinc-500 font-mono pt-1">
                        <span>IP: ${s.ip_address || '-'}</span>
                        <span>${dateStr}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Slip Actions -->
                  <div class="pt-3 border-t border-white/[0.08] flex items-center space-x-2">
                    ${
                      isPending
                        ? `
                        <form method="post" action="/admin/slip/approve" class="flex-1">
                          <input type="hidden" name="slipId" value="${s.id}" />
                          <button type="submit" class="glisse-btn-success w-full py-2 rounded-xl text-xs font-bold">
                            ✓ Approve VIP
                          </button>
                        </form>
                        <form method="post" action="/admin/slip/decline" class="flex-1">
                          <input type="hidden" name="slipId" value="${s.id}" />
                          <button type="submit" class="glisse-btn-secondary w-full py-2 rounded-xl text-xs font-bold text-red-400 hover:text-red-300">
                            ✕ Decline
                          </button>
                        </form>`
                        : `
                        <button onclick="openLightbox('${imgUrl}', 'Slip #${slipNum} • ${s.email}')" class="glisse-btn-secondary flex-1 py-1.5 rounded-xl text-xs font-bold">
                          View Receipt
                        </button>
                        <form method="post" action="/admin/slip/delete" class="inline" onsubmit="return confirm('Delete this slip record?')">
                          <input type="hidden" name="slipId" value="${s.id}" />
                          <button type="submit" class="glisse-btn-secondary px-3 py-1.5 rounded-xl text-xs text-red-400 hover:text-red-300 font-bold" title="Delete slip">
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
                  <h2 class="font-black text-sm text-white">PromptPay QR Code</h2>
                  <p class="text-xs text-zinc-400">Displayed on User Captive Portal for payment</p>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-sky-950/40 text-sky-300 border border-sky-800/60">Active</span>
            </div>

            <div class="flex flex-col sm:flex-row items-center gap-6 mt-4 p-4 rounded-2xl bg-white/[0.03] border border-white/10">
              <div class="w-36 h-36 rounded-2xl bg-white p-2 shadow-sm flex items-center justify-center flex-shrink-0">
                <img src="/my-qr" alt="PromptPay QR" class="max-w-full max-h-full object-contain" />
              </div>
              <div class="space-y-2 text-xs text-zinc-300 flex-1">
                <p class="font-bold text-white">PromptPay Bank Transfer</p>
                <p class="text-zinc-400 text-[11px]">Upload your official Thai PromptPay QR Code JPG/PNG image so users can scan and pay seamlessly.</p>
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
          <form method="post" action="/admin/upload-qr" enctype="multipart/form-data" class="space-y-3 pt-3 border-t border-white/[0.08]">
            <label class="block text-xs font-bold text-zinc-300">Upload / Replace QR Image</label>
            <div class="flex items-center space-x-3">
              <input type="file" name="qr" accept="image/*" required class="glisse-input flex-1 text-xs file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-white file:text-black" />
              <button type="submit" class="glisse-btn-primary px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
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
                <h2 class="font-black text-sm text-white">VIP Package & Free Trial</h2>
                <p class="text-xs text-zinc-400">Configure prices and trial duration</p>
              </div>
            </div>

            <form method="post" action="/admin/settings" class="space-y-4 mt-4">
              <input type="hidden" name="activeTab" value="billing" />
              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">30-Day VIP Package Price (THB / Baht)</label>
                <div class="relative">
                  <input type="number" name="monthlyPrice" value="${settings.monthlyPrice || 150}" required class="glisse-input w-full pr-12 font-bold text-sky-400 text-sm" />
                  <span class="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">THB</span>
                </div>
                <p class="text-[11px] text-zinc-500 mt-1">Displayed on the Wi-Fi payment portal.</p>
              </div>

              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">Free Trial Duration (Minutes)</label>
                <div class="relative">
                  <input type="number" name="trialMinutes" value="${settings.trialMinutes || 60}" required class="glisse-input w-full pr-14 font-bold text-emerald-400 text-sm" />
                  <span class="absolute right-3.5 top-2.5 text-xs font-bold text-zinc-500">Mins</span>
                </div>
                <p class="text-[11px] text-zinc-500 mt-1">Duration of complimentary internet access per Google account.</p>
              </div>

              <div class="pt-3">
                <button type="submit" class="glisse-btn-primary w-full py-2.5 rounded-xl text-xs font-bold">
                  Save Billing & Package Settings
                </button>
              </div>
            </form>
          </div>

          <div class="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-zinc-300">
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
                  <h2 class="font-black text-sm text-white">Telegram Approval Bot</h2>
                  <p class="text-xs text-zinc-400">1-Click approve/decline bank slips from your phone</p>
                </div>
              </div>
              <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${settings.telegramBotToken && settings.telegramChatId ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/60' : 'bg-white/5 text-zinc-500 border border-white/10'}">
                ${settings.telegramBotToken && settings.telegramChatId ? 'Configured' : 'Not Set'}
              </span>
            </div>

            <form method="post" action="/admin/settings" class="space-y-4">
              <input type="hidden" name="activeTab" value="telegram" />
              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">Telegram Bot Token</label>
                <input type="text" id="tg-token" name="telegramBotToken" value="${settings.telegramBotToken || ''}" placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-zinc-500 mt-1">Obtain from @BotFather on Telegram.</p>
              </div>

              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">Your Telegram Chat ID</label>
                <input type="text" id="tg-chatid" name="telegramChatId" value="${settings.telegramChatId || ''}" placeholder="e.g. 1534450061" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-zinc-500 mt-1">Send <code>/id</code> or <code>/start</code> to your bot to find your Chat ID.</p>
              </div>

              <div class="grid grid-cols-2 gap-3 pt-2">
                <button type="submit" class="glisse-btn-primary py-2.5 rounded-xl text-xs font-bold">
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
                <h2 class="font-black text-sm text-white">How It Works</h2>
                <p class="text-xs text-zinc-400">Step-by-step 3-minute setup</p>
              </div>
            </div>

            <ol class="space-y-3 text-xs text-zinc-300 list-decimal list-inside">
              <li class="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                <strong class="text-white">Create your Bot:</strong> Open <a href="https://t.me/BotFather" target="_blank" class="text-sky-400 underline font-bold">@BotFather</a> on Telegram, send <code>/newbot</code>, and copy the HTTP API Token.
              </li>
              <li class="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                <strong class="text-white">Start your Bot:</strong> Search for your newly created bot username on Telegram, click <strong>START</strong>, or send <code>/start</code>.
              </li>
              <li class="p-2.5 rounded-xl bg-white/[0.03] border border-white/10">
                <strong class="text-white">Instant Notifications:</strong> When a user uploads a PromptPay slip photo, your phone immediately rings with the receipt photo and <strong>[Approve] / [Decline]</strong> buttons!
              </li>
            </ol>
          </div>

          <div class="p-3.5 rounded-2xl bg-emerald-950/30 border border-emerald-800/50 text-xs text-emerald-300 flex items-center gap-2">
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
                <h2 class="font-black text-sm text-white">Admin Authentication PIN</h2>
                <p class="text-xs text-zinc-400">Change your dashboard password</p>
              </div>
            </div>

            <form method="post" action="/admin/settings" class="space-y-4">
              <input type="hidden" name="activeTab" value="settings" />
              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">New Administrator PIN</label>
                <input type="password" name="adminPin" value="${settings.adminPin || '1234'}" required class="glisse-input w-full font-mono text-xs tracking-widest" />
                <p class="text-[11px] text-zinc-500 mt-1">Must be at least 4 numeric digits.</p>
              </div>

              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">Google OAuth Client ID</label>
                <input type="text" name="googleClientId" value="${settings.googleClientId || ''}" placeholder="e.g. 197252344762-...apps.googleusercontent.com" class="glisse-input w-full font-mono text-xs" />
                <p class="text-[11px] text-zinc-500 mt-1">For Sign In with Google authentication.</p>
              </div>

              <div class="pt-2">
                <button type="submit" class="glisse-btn-primary w-full py-2.5 rounded-xl text-xs font-bold">
                  Update Admin Security Settings
                </button>
              </div>
            </form>
          </div>

          <div class="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-zinc-400 space-y-1">
            <p><strong>Session Security:</strong> Authenticated via HttpOnly SameSite session cookies.</p>
            <p class="text-[11px] text-zinc-500">PINs are never leaked into URLs or browser navigation history.</p>
          </div>
        </div>

        <!-- SMTP Email Card -->
        <div class="glisse-card p-6 flex flex-col justify-between space-y-4">
          <div>
            <div class="flex items-center space-x-2.5 mb-3">
              <span class="text-2xl">📧</span>
              <div class="flex-1">
                <div class="flex items-center justify-between">
                  <h2 class="font-black text-sm text-white">Gmail SMTP (Email OTP Delivery)</h2>
                  <span class="px-2.5 py-0.5 rounded-full text-xs font-bold ${settings.smtpUser && settings.smtpPass ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-800/60' : 'bg-white/5 text-zinc-500 border border-white/10'}">
                    ${settings.smtpUser && settings.smtpPass ? 'Configured ✓' : 'Not Set'}
                  </span>
                </div>
                <p class="text-xs text-zinc-400">Deliver 6-digit verification codes to users</p>
              </div>
            </div>

            <form method="post" action="/admin/settings" class="space-y-3">
              <input type="hidden" name="activeTab" value="settings" />
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="block text-xs font-bold text-zinc-300 mb-1">SMTP Host</label>
                  <input type="text" name="smtpHost" value="${settings.smtpHost || 'smtp.gmail.com'}" placeholder="smtp.gmail.com" class="glisse-input w-full font-mono text-xs" />
                </div>
                <div>
                  <label class="block text-xs font-bold text-zinc-300 mb-1">SMTP Port</label>
                  <input type="text" name="smtpPort" value="${settings.smtpPort || '465'}" placeholder="465" class="glisse-input w-full font-mono text-xs" />
                </div>
              </div>

              <div>
                <label class="block text-xs font-bold text-zinc-300 mb-1">SMTP Username / Email</label>
                <input type="text" name="smtpUser" value="${settings.smtpUser || ''}" placeholder="realjackhalder@gmail.com" class="glisse-input w-full font-mono text-xs" />
              </div>

              <div>
                <div class="flex items-center justify-between mb-1">
                  <label class="block text-xs font-bold text-zinc-300">Google App Password</label>
                  <button type="button" onclick="const p=document.getElementById('local-smtp-pass'); if(p) p.type=p.type==='password'?'text':'password';" class="text-[11px] text-sky-400 hover:text-sky-300 font-bold">Show / Hide</button>
                </div>
                <div class="relative">
                  <input type="password" id="local-smtp-pass" name="smtpPass" value="${settings.smtpPass || ''}" placeholder="ezdp arof dpin iduk" class="glisse-input w-full font-mono text-xs pr-10" />
                  <button type="button" onclick="const p=document.getElementById('local-smtp-pass'); if(p) p.type=p.type==='password'?'text':'password';" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white text-xs">👁️</button>
                </div>
                <p class="text-[11px] text-zinc-500 mt-1">Google App Password (16 letters, e.g. <code>ezdp arof dpin iduk</code>)</p>
              </div>

              <div class="pt-2">
                <button type="submit" class="glisse-btn-primary w-full py-2.5 rounded-xl text-xs font-bold">
                  Save SMTP Configuration
                </button>
              </div>
            </form>
          </div>

          <div class="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs text-zinc-400">
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
              <tr class="border-b border-white/10 text-[11px] font-bold text-zinc-400 uppercase tracking-wider bg-white/[0.02]">
                <th class="py-3 px-4">Device IP</th>
                <th class="py-3 px-3">MAC Address</th>
                <th class="py-3 px-3">Google Email</th>
                <th class="py-3 px-3">Action Event</th>
                <th class="py-3 px-3">Timestamp</th>
                <th class="py-3 px-4 text-right">Quick Action</th>
              </tr>
            </thead>
            <tbody id="logs-tbody" class="divide-y divide-white/[0.05]">
              ${
                ipLogs.length === 0
                  ? '<tr><td colspan="6" class="py-12 text-center text-zinc-500">No network traffic logs recorded yet</td></tr>'
                  : ipLogs.map(l => {
                      const timeStr = new Date(l.timestamp).toLocaleString('en-GB');
                      return `
                      <tr class="log-row hover:bg-white/[0.03] transition" data-ip="${l.ip_address}" data-email="${l.email || ''}" data-action="${l.action}">
                        <td class="py-3 px-4 font-mono font-bold text-sky-400">${l.ip_address}</td>
                        <td class="py-3 px-3 font-mono text-zinc-400">${l.mac_address || '-'}</td>
                        <td class="py-3 px-3 font-mono text-zinc-300">${l.email || '-'}</td>
                        <td class="py-3 px-3">
                          <span class="px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                            l.action === 'buy_package' ? 'bg-purple-950/40 text-purple-300 border border-purple-800/60' :
                            (l.action === 'blocked' ? 'bg-red-950/40 text-red-300 border border-red-800/60' : 'bg-sky-950/40 text-sky-300 border border-sky-800/60')
                          }">
                            ${l.action}
                          </span>
                        </td>
                        <td class="py-3 px-3 text-zinc-400">${timeStr}</td>
                        <td class="py-3 px-4 text-right">
                          <form method="post" action="/admin/account/revoke-ip" class="inline">
                            <input type="hidden" name="ip" value="${l.ip_address}" />
                            <button type="submit" class="glisse-btn-secondary px-2.5 py-1 rounded-lg text-[11px] font-bold text-red-400 hover:text-red-300" title="Revoke access immediately">
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
    <div class="glisse-card p-6 sm:p-8 max-w-md w-full relative space-y-4 bg-zinc-950">
      <div class="flex items-center justify-between pb-3 border-b border-white/10">
        <h3 class="font-black text-white text-base flex items-center gap-2">
          <span>➕</span> Grant VIP Access
        </h3>
        <button onclick="closeGrantModal()" class="text-zinc-400 hover:text-white text-lg">✕</button>
      </div>

      <form method="post" action="/admin/account/grant" class="space-y-4">
        <div>
          <label class="block text-xs font-bold text-zinc-300 mb-1">User Email Address</label>
          <input type="email" name="email" required placeholder="user@gmail.com" class="glisse-input w-full" />
        </div>

        <div>
          <label class="block text-xs font-bold text-zinc-300 mb-1">User Name (Optional)</label>
          <input type="text" name="name" placeholder="John Doe" class="glisse-input w-full" />
        </div>

        <div>
          <label class="block text-xs font-bold text-zinc-300 mb-1">VIP Duration (Days)</label>
          <select name="days" class="glisse-input w-full font-bold text-sky-400 bg-zinc-900">
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
          <button type="submit" class="glisse-btn-primary flex-1 py-2.5 rounded-xl text-xs font-bold">
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
    <div class="glisse-card p-4 sm:p-5 max-w-sm sm:max-w-md w-full relative space-y-3 bg-zinc-950/95 border border-white/15 shadow-2xl" onclick="event.stopPropagation()">
      <div class="flex items-center justify-between pb-2.5 border-b border-white/10 gap-3">
        <div class="flex items-center space-x-2 min-w-0 flex-1 overflow-hidden" style="min-width: 0;">
          <span class="text-base flex-shrink-0">🧾</span>
          <h4 id="lightbox-title" class="font-bold text-white text-xs sm:text-sm" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%;">Payment Slip</h4>
        </div>
        <div class="flex items-center space-x-1 flex-shrink-0" style="flex-shrink: 0;">
          <button type="button" onclick="zoomLightbox(-0.25)" class="glisse-btn-secondary px-2 py-0.5 rounded-lg text-xs font-bold" title="Zoom Out">−</button>
          <button type="button" onclick="resetLightboxZoom()" class="glisse-btn-secondary px-2 py-0.5 rounded-lg text-[10px] font-bold" title="Reset Zoom">100%</button>
          <button type="button" onclick="zoomLightbox(0.25)" class="glisse-btn-secondary px-2 py-0.5 rounded-lg text-xs font-bold" title="Zoom In">+</button>
          <button type="button" onclick="closeLightbox()" class="text-zinc-400 hover:text-white text-lg ml-1 px-1 leading-none">✕</button>
        </div>
      </div>
      <div class="w-full max-h-[48vh] sm:max-h-[420px] overflow-auto flex items-center justify-center rounded-2xl bg-black/80 p-2 sm:p-3 border border-white/10">
        <img id="lightbox-img" src="" alt="Receipt" onclick="toggleLightboxZoom()" class="max-h-[44vh] sm:max-h-[380px] max-w-[260px] sm:max-w-[320px] w-auto h-auto object-contain rounded-xl shadow-2xl transition-transform duration-150 cursor-zoom-in" />
      </div>
      <div class="flex items-center justify-between pt-1">
        <span class="text-[10px] text-zinc-500 font-medium">Click image to zoom</span>
        <div class="flex items-center space-x-2">
          <a id="lightbox-download" href="" download="receipt.jpg" class="glisse-btn-secondary px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1">
            <span>⬇️</span> Download
          </a>
          <button onclick="closeLightbox()" class="glisse-btn-primary px-3.5 py-1.5 rounded-xl text-xs font-bold">
            Close
          </button>
        </div>
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

    window.allSlips = ${JSON.stringify(sortedSlips.map(s => ({ id: String(s.id || s.slipId), uploaded_at: s.uploaded_at, email: s.email })))};

    function getSlipNum(sId) {
      if (!window.allSlips || !Array.isArray(window.allSlips)) return '001';
      const idx = window.allSlips.findIndex(s => String(s.id) === String(sId));
      return idx !== -1 ? String(idx + 1).padStart(3, '0') : '001';
    }

    // Lightbox Modal
    let lightboxZoom = 1;
    function openLightbox(url, title) {
      resetLightboxZoom();
      document.getElementById('lightbox-img').src = url;
      const titleEl = document.getElementById('lightbox-title');
      if (titleEl) {
        let cleanTitle = title || 'Payment Slip';
        if (cleanTitle.includes('slip_')) {
          const match = cleanTitle.match(/slip_\d+/);
          if (match) {
            cleanTitle = cleanTitle.replace(match[0], getSlipNum(match[0]));
          }
        }
        cleanTitle = cleanTitle.replace(/#+/g, '#');
        titleEl.innerText = cleanTitle;
        titleEl.title = cleanTitle;
      }
      document.getElementById('lightbox-download').href = url;
      document.getElementById('lightbox-modal').classList.remove('hidden');
    }
    function closeLightbox() {
      document.getElementById('lightbox-modal').classList.add('hidden');
      resetLightboxZoom();
    }
    function zoomLightbox(delta) {
      lightboxZoom = Math.min(2.5, Math.max(0.6, lightboxZoom + delta));
      applyLightboxZoom();
    }
    function resetLightboxZoom() {
      lightboxZoom = 1;
      applyLightboxZoom();
    }
    function toggleLightboxZoom() {
      lightboxZoom = lightboxZoom === 1 ? 1.75 : 1;
      applyLightboxZoom();
    }
    function applyLightboxZoom() {
      const img = document.getElementById('lightbox-img');
      if (img) {
        img.style.transform = 'scale(' + lightboxZoom + ')';
        img.className = img.className.replace(/cursor-zoom-(in|out)/, '') + (lightboxZoom > 1 ? ' cursor-zoom-out' : ' cursor-zoom-in');
      }
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
        else if (plan === 'pending') row.style.display = rowPlan === 'pending' ? '' : 'none';
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

      resultBox.className = 'p-3 rounded-2xl text-xs font-bold bg-white/5 text-sky-300 border border-sky-500/30';
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

      // 2. Direct Telegram Bot API fallback
      if (!testSuccess && !errorMsg) {
        try {
          const tgUrl = 'https://api.telegram.org/bot' + encodeURIComponent(token) + '/sendMessage';
          const tgRes = await fetch(tgUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: '🔔 <b>Free Wi-Fi Gateway</b>\\n\\n✅ Telegram Bot connected successfully!\\n🕒 Time: ' + new Date().toLocaleString() + '\\n🌐 Dashboard: Admin Portal',
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
        resultBox.className = 'p-3 rounded-2xl text-xs font-bold bg-emerald-950/40 text-emerald-300 border border-emerald-800/60';
        resultBox.innerText = '✓ Test notification delivered to your Telegram app!';
      } else {
        resultBox.className = 'p-3 rounded-2xl text-xs font-bold bg-red-950/40 text-red-300 border border-red-800/60';
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

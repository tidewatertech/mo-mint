import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, orderBy, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const provider = new GoogleAuthProvider();

// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let transactions = [];
let accounts = [];
let budgets = {};
let recurring = [];
let milestones = [];
let forecastHorizon = 12;
let forecastChart = null;
let forecastSettings = { includeBudgets: false, budgetAccount: '' };
let editingTxnId = null;
let editingRecurringId = null;
let editingMilestoneId = null;
let recatTxnId = null;
let txnType = 'out';
let recurType = 'out';
let moChart = null;

const CATEGORIES = [
  { id: 'housing',       label: 'Housing',           color: '#534AB7' },
  { id: 'groceries',     label: 'Groceries',          color: '#1D9E75' },
  { id: 'transport',     label: 'Transport',          color: '#5DCAA5' },
  { id: 'dining',        label: 'Dining out',         color: '#7F77DD' },
  { id: 'utilities',     label: 'Utilities',          color: '#AFA9EC' },
  { id: 'health',        label: 'Health',             color: '#0F6E56' },
  { id: 'personal',      label: 'Personal care',      color: '#085041' },
  { id: 'kids',          label: 'Kids & school',      color: '#3C3489' },
  { id: 'subscriptions', label: 'Subscriptions',      color: '#9898b0' },
  { id: 'entertainment', label: 'Entertainment',      color: '#BA7517' },
  { id: 'savings',       label: 'Savings / transfer', color: '#E24B4A' },
  { id: 'debt',          label: 'Debt payment',       color: '#A32D2D' },
  { id: 'income',        label: 'Income',             color: '#1D9E75' },
  { id: 'other',         label: 'Other',              color: '#5a5a72' }
];

const GROUP_LABELS = {
  liquid:            'Liquid assets',
  registered:        'Registered investments',
  loc:               'Lines of credit',
  'credit-card':     'Credit cards',
  'other-asset':     'Other assets',
  'other-liability': 'Other liabilities'
};

// Starting-point monthly budgets derived from the Financial Planning context.
// Housing ($3,200 full rent) is the one confirmed figure; the rest are
// estimates to be corrected. Loaded only on request, never silently saved.
const SUGGESTED_BUDGETS = {
  housing: 3200, groceries: 600, transport: 250, dining: 200, utilities: 400,
  health: 150, personal: 100, kids: 350, subscriptions: 60, entertainment: 100,
  savings: 450, debt: 500, other: 150
};

const FREQ_LABELS = {
  weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly',
  bimonthly: 'Every 2 months', quarterly: 'Quarterly', annual: 'Annually', once: 'One time'
};

// ── Helpers ────────────────────────────────────────────────────────────────
const fmt = n => {
  const abs = Math.abs(n);
  return (n < 0 ? '-' : '') + '$' + abs.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtShort = n => {
  const abs = Math.abs(n);
  if (abs >= 1000) return (n < 0 ? '-' : '') + '$' + (abs / 1000).toFixed(1) + 'k';
  return fmt(n);
};
const monthName = (m, y) => new Date(y, m, 1).toLocaleString('en-CA', { month: 'long', year: 'numeric' });
const todayStr = () => new Date().toISOString().split('T')[0];
// Display a balance with liability-aware sign: owed shows negative, an overpaid
// (credit) liability shows positive, never a double negative.
const balDisplay = (isLiability, bal) => !isLiability ? fmt(bal) : (bal >= 0 ? `-${fmt(bal)}` : `+${fmt(-bal)}`);

// Next calendar date a given day-of-month falls on, today or later.
function nextDueDate(dueDay) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  let y = t.getFullYear(), m = t.getMonth();
  const clamp = (yy, mm) => Math.min(dueDay, new Date(yy, mm + 1, 0).getDate());
  let d = new Date(y, m, clamp(y, m));
  if (d < t) { m++; if (m > 11) { m = 0; y++; } d = new Date(y, m, clamp(y, m)); }
  return d;
}

// Business days (Mon-Fri) from today until target date.
function businessDaysUntil(target) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  let n = 0;
  while (d < target) { d.setDate(d.getDate() + 1); const wd = d.getDay(); if (wd !== 0 && wd !== 6) n++; }
  return n;
}

function renderBillsDue() {
  const card = document.getElementById('bills-due-card');
  const el = document.getElementById('bills-due');
  if (!card || !el) return;
  const bills = accounts.filter(a => a.isLiability && a.dueDay)
    .map(a => { const nd = nextDueDate(a.dueDay); return { a, nd, bdays: businessDaysUntil(nd) }; })
    .sort((x, y) => x.nd - y.nd);
  if (bills.length === 0) { card.style.display = 'none'; return; }
  card.style.display = '';
  el.innerHTML = bills.map(({ a, nd, bdays }) => {
    const owed = accountBalance(a);
    const dueStr = nd.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
    const color = bdays <= 5 ? 'var(--red-400)' : bdays <= 10 ? 'var(--amber-400, #BA7517)' : 'var(--text-tertiary)';
    const when = bdays === 0 ? 'due today' : `in ${bdays} business day${bdays === 1 ? '' : 's'}`;
    return `<div class="ms-row">
      <div>
        <div class="ms-label">${a.name}</div>
        <div class="ms-sub">Due ${dueStr}${owed > 0.005 ? ' · ' + fmt(owed) + ' owing' : ''}</div>
      </div>
      <span style="font-size:12px;font-weight:500;color:${color};">${when}</span>
    </div>`;
  }).join('');
}
const getCat = id => CATEGORIES.find(c => c.id === id) || { label: id, color: '#5a5a72' };
const userCol = name => collection(db, 'users', currentUser.uid, name);
const userDocRef = path => doc(db, 'users', currentUser.uid, path);

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type} show`;
  setTimeout(() => t.className = 'toast', 3000);
}

// ── Theme ──────────────────────────────────────────────────────────────────
let isDark = true;
function toggleTheme() {
  isDark = !isDark;
  document.documentElement.setAttribute('data-theme', isDark ? '' : 'light');
  document.getElementById('theme-label').textContent = isDark ? 'Light' : 'Dark';
  localStorage.setItem('mo-mint-theme', isDark ? 'dark' : 'light');
}
function initTheme() {
  const saved = localStorage.getItem('mo-mint-theme');
  if (saved === 'light') {
    isDark = false;
    document.documentElement.setAttribute('data-theme', 'light');
    document.getElementById('theme-label').textContent = 'Dark';
  }
}

// ── Navigation ─────────────────────────────────────────────────────────────
const PAGE_TITLES = { dashboard: 'Overview', transactions: 'Transactions', budgets: 'Budgets', forecast: 'Forecast', accounts: 'Accounts', networth: 'Net worth' };
function switchPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${id}`).classList.add('active');
  document.querySelectorAll(`[data-page="${id}"]`).forEach(n => n.classList.add('active'));
  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;
  document.getElementById('month-nav').style.display = (id === 'accounts' || id === 'networth' || id === 'forecast') ? 'none' : 'flex';
  if (id === 'transactions') renderTransactions();
  if (id === 'budgets') renderBudgets();
  if (id === 'forecast') { populateExportMonths(); renderForecast(); }
  if (id === 'accounts') renderAccounts();
  if (id === 'networth') renderNetworth();
}
document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(item => {
  item.addEventListener('click', () => switchPage(item.dataset.page));
});

// ── Month nav ──────────────────────────────────────────────────────────────
function updateMonthLabel() {
  document.getElementById('month-label').textContent = monthName(currentMonth, currentYear);
}
function changeMonth(dir) {
  currentMonth += dir;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  if (currentMonth < 0)  { currentMonth = 11; currentYear--; }
  updateMonthLabel();
  renderDashboard();
}

// ── Firebase data ──────────────────────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadTransactions(), loadAccounts(), loadBudgets(), loadRecurring(), loadMilestones(), loadForecastSettings()]);
  renderDashboard();
}

async function loadTransactions() {
  const q = query(userCol('transactions'), orderBy('date', 'desc'));
  const snap = await getDocs(q);
  transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadAccounts() {
  const snap = await getDocs(userCol('accounts'));
  accounts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  // Migration: anchor date for the balance engine.
  for (const a of accounts.filter(x => !x.openingAsOf)) {
    a.openingAsOf = '2026-06-01';
    await updateDoc(doc(db, 'users', currentUser.uid, 'accounts', a.id), { openingAsOf: a.openingAsOf });
  }
  // Migration: assign a sortOrder within each group if missing, then persist.
  if (accounts.some(a => a.sortOrder === undefined)) {
    normalizeSortOrders();
    await Promise.all(accounts.map(a =>
      updateDoc(doc(db, 'users', currentUser.uid, 'accounts', a.id), { sortOrder: a.sortOrder })));
  }
}

function normalizeSortOrders() {
  const groups = {};
  accounts.forEach(a => { (groups[a.group] = groups[a.group] || []).push(a); });
  Object.values(groups).forEach(list => {
    list.sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999) || (a.name || '').localeCompare(b.name || ''));
    list.forEach((a, i) => a.sortOrder = i);
  });
}

async function loadRecurring() {
  const snap = await getDocs(userCol('recurring'));
  recurring = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadMilestones() {
  const snap = await getDocs(userCol('milestones'));
  milestones = snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function loadForecastSettings() {
  const snap = await getDoc(userDocRef('settings/forecast'));
  if (snap.exists()) forecastSettings = { includeBudgets: false, budgetAccount: '', ...snap.data() };
}

async function loadBudgets() {
  const ref = userDocRef('settings/budgets');
  const snap = await getDoc(ref);
  budgets = snap.exists() ? snap.data() : {};
}

// ── Dashboard ──────────────────────────────────────────────────────────────
function getMonthTxns(m, y) {
  return transactions.filter(t => {
    const d = new Date(t.date + 'T12:00:00');
    return d.getMonth() === m && d.getFullYear() === y;
  });
}

function renderGreeting() {
  const el = document.getElementById('greeting');
  if (!el || !currentUser) return;
  const name = currentUser.displayName ? currentUser.displayName.split(' ')[0] : '';
  const hour = new Date().getHours();
  const time = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  el.textContent = name ? `${time}, ${name}.` : `${time}.`;
}

function renderDashboard() {
  renderGreeting();
  updateMonthLabel();
  const txns     = getMonthTxns(currentMonth, currentYear);
  const income   = txns.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const spending = txns.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);
  const net      = income - spending;
  const savingsRate = income > 0 ? Math.round((net / income) * 100) : 0;

  const prevM = currentMonth === 0 ? 11 : currentMonth - 1;
  const prevY = currentMonth === 0 ? currentYear - 1 : currentYear;
  const prevTxns   = getMonthTxns(prevM, prevY);
  const prevIncome = prevTxns.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0);
  const prevSpend  = prevTxns.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0);

  document.getElementById('m-in').textContent  = fmt(income);
  document.getElementById('m-out').textContent = fmt(spending);
  const netEl = document.getElementById('m-net');
  netEl.textContent = (net >= 0 ? '+' : '') + fmt(net);
  netEl.className   = 'metric-value ' + (net >= 0 ? 'positive' : 'negative');
  document.getElementById('m-savings-rate').textContent = income > 0 ? `${savingsRate}% savings rate` : 'no income recorded';

  const diffIn  = income   - prevIncome;
  const diffOut = spending - prevSpend;
  document.getElementById('m-in-sub').textContent  = prevIncome > 0 ? `${diffIn  >= 0 ? '+' : ''}${fmtShort(diffIn)} vs last month`  : 'this month';
  document.getElementById('m-out-sub').textContent = prevSpend  > 0 ? `${diffOut >= 0 ? '+' : ''}${fmtShort(diffOut)} vs last month` : 'this month';
  document.getElementById('m-networth').textContent = fmt(calcNetWorth());

  const primary = accounts.find(a => a.isPrimary);
  const opEl  = document.getElementById('m-operating');
  const opSub = document.getElementById('m-operating-label');
  if (primary) {
    const b = accountBalance(primary);
    opEl.textContent = balDisplay(primary.isLiability, b);
    opEl.className   = 'metric-value ' + (primary.isLiability ? 'negative' : 'positive');
    opSub.textContent = primary.name;
  } else {
    opEl.textContent = '—';
    opEl.className = 'metric-value';
    opSub.textContent = 'Pin an account on Accounts';
  }

  renderBillsDue();
  renderSpendingRing(txns);
  renderMoChart();
  renderRecentTxns(txns);
}

// ── Balance engine ─────────────────────────────────────────────────────────
// Balances are computed, never stored as a running total. Each account carries
// an opening figure (`balance`) anchored to a date (`openingAsOf`); the live
// balance is that opening plus the effect of every transaction tagged to the
// account dated on or after the anchor. Add / edit / delete / import all "just
// work" because nothing is stored to drift.
//
// Effect is always from the perspective of the tagged account:
//   asset      → 'in' raises,  'out' lowers
//   liability  → 'in' (paydown) lowers owed,  'out' (charge/draw) raises owed
function txnEffect(t, a) {
  const into = t.type === 'in' ? 1 : -1;
  return a.isLiability ? -into * t.amount : into * t.amount;
}

// Effect of a single event (transaction OR recurring occurrence) on a named
// account. Shared by the live balance engine and the forecast projector so the
// signs can never diverge between them.
function eventEffectOn(ev, acctName, isLiab) {
  if (ev.type === 'transfer') {
    if (ev.account   === acctName) return isLiab ?  ev.amount : -ev.amount;
    if (ev.toAccount === acctName) return isLiab ? -ev.amount :  ev.amount;
    return 0;
  }
  if (ev.account !== acctName) return 0;
  const into = ev.type === 'in' ? 1 : -1;
  return isLiab ? -into * ev.amount : into * ev.amount;
}

// Balance of an account as of a given date (inclusive), from the opening anchor
// plus every transaction in [anchor, asOf].
function balanceAsOf(a, asOf) {
  const anchor = a.openingAsOf || '0000-01-01';
  let bal = a.balance || 0;
  for (const t of transactions) {
    if (t.date < anchor || t.date > asOf) continue;
    bal += eventEffectOn(t, a.name, a.isLiability);
  }
  return bal;
}

function accountBalance(a) {
  return balanceAsOf(a, '9999-12-31');
}

function calcNetWorth() {
  return accounts.reduce((s, a) => {
    const bal = accountBalance(a);
    return a.isLiability ? s - bal : s + bal;
  }, 0);
}

// Re-render the balance-bearing pages if the user is looking at one, so a
// transaction change is reflected immediately rather than on next navigation.
function refreshBalancesIfVisible() {
  if (document.getElementById('page-accounts').classList.contains('active')) renderAccounts();
  if (document.getElementById('page-networth').classList.contains('active')) renderNetworth();
}

function renderSpendingRing(txns) {
  const outTxns = txns.filter(t => t.type === 'out');
  const total   = outTxns.reduce((s, t) => s + t.amount, 0);
  const byCat   = {};
  outTxns.forEach(t => { byCat[t.category] = (byCat[t.category] || 0) + t.amount; });
  const sorted  = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const svg     = document.getElementById('spending-ring');
  const legend  = document.getElementById('ring-legend');
  svg.innerHTML = '';
  legend.innerHTML = '';

  if (total === 0) {
    svg.innerHTML = `<circle cx="60" cy="60" r="42" fill="none" stroke="var(--bg-input)" stroke-width="14"/>
      <text x="60" y="56" text-anchor="middle" font-size="12" fill="var(--text-tertiary)">No</text>
      <text x="60" y="72" text-anchor="middle" font-size="12" fill="var(--text-tertiary)">spending</text>`;
    return;
  }

  const r = 42, cx = 60, cy = 60, circ = 2 * Math.PI * r;
  svg.innerHTML = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-input)" stroke-width="14"/>`;
  let offset = 0;
  sorted.forEach(([catId, amt]) => {
    const cat  = getCat(catId);
    const dash = (amt / total) * circ;
    const el   = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', cx); el.setAttribute('cy', cy); el.setAttribute('r', r);
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', cat.color);
    el.setAttribute('stroke-width', '14');
    el.setAttribute('stroke-dasharray', `${dash.toFixed(2)} ${(circ - dash).toFixed(2)}`);
    el.setAttribute('stroke-dashoffset', (-offset).toFixed(2));
    el.setAttribute('transform', `rotate(-90 ${cx} ${cy})`);
    svg.appendChild(el);
    offset += dash;
    legend.innerHTML += `<div class="legend-row">
      <div class="legend-dot" style="background:${cat.color}"></div>
      <span class="legend-name">${cat.label}</span>
      <span class="legend-amt">${fmtShort(amt)}</span>
      <span class="legend-pct">${Math.round((amt/total)*100)}%</span>
    </div>`;
  });
  svg.innerHTML += `<text x="${cx}" y="${cy-6}" text-anchor="middle" font-size="13" font-weight="600" fill="var(--text-primary)">${fmtShort(total)}</text>
    <text x="${cx}" y="${cy+10}" text-anchor="middle" font-size="10" fill="var(--text-tertiary)">total out</text>`;
}

function renderMoChart() {
  const inData = [], outData = [], labels = [];
  for (let i = 5; i >= 0; i--) {
    let m = currentMonth - i, y = currentYear;
    if (m < 0) { m += 12; y--; }
    const txns = getMonthTxns(m, y);
    inData.push(txns.filter(t => t.type === 'in').reduce((s, t) => s + t.amount, 0));
    outData.push(txns.filter(t => t.type === 'out').reduce((s, t) => s + t.amount, 0));
    labels.push(new Date(y, m, 1).toLocaleString('en-CA', { month: 'short' }));
  }
  if (moChart) moChart.destroy();
  const ctx = document.getElementById('mo-chart');
  if (!ctx) return;
  moChart = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [
      { label: 'In',  data: inData,  backgroundColor: '#1D9E75', borderRadius: 4 },
      { label: 'Out', data: outData, backgroundColor: '#534AB7', borderRadius: 4 }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9898b0', font: { size: 11 } }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9898b0', font: { size: 11 }, callback: v => fmtShort(v) }, border: { display: false } }
      }
    }
  });
}

function renderRecentTxns(txns) {
  const el = document.getElementById('recent-txns');
  const recent = txns.slice(0, 7);
  if (recent.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-receipt-off"></i><p>No transactions this month yet.<br>Tap <strong>Add transaction</strong> to get started.</p></div>`;
    return;
  }
  el.innerHTML = recent.map(t => txnRowHTML(t)).join('');
}

// ── Transactions ───────────────────────────────────────────────────────────
function renderTransactions() {
  populateFilters();
  const cat  = document.getElementById('filter-category').value;
  const acc  = document.getElementById('filter-account').value;
  const type = document.getElementById('filter-type').value;
  const txns = getMonthTxns(currentMonth, currentYear).filter(t => {
    if (cat  && t.category !== cat)  return false;
    if (acc  && t.account !== acc && t.toAccount !== acc) return false;
    if (type && t.type     !== type) return false;
    return true;
  });
  const el = document.getElementById('all-txns');
  if (txns.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-receipt-off"></i><p>No transactions match your filters.</p></div>`;
    return;
  }
  el.innerHTML = txns.map(t => txnRowHTML(t)).join('');
}

function populateFilters() {
  const catSel = document.getElementById('filter-category');
  const accSel = document.getElementById('filter-account');
  if (catSel.options.length <= 1) CATEGORIES.forEach(c => { catSel.innerHTML += `<option value="${c.id}">${c.label}</option>`; });
  if (accSel.options.length <= 1) accounts.forEach(a => { accSel.innerHTML += `<option value="${a.name}">${a.name}</option>`; });
}

function txnRowHTML(t) {
  const dateStr = new Date(t.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  if (t.type === 'transfer') {
    return `<div class="txn-row">
      <div class="txn-icon" style="background:#7F77DD22;"><i class="ti ti-arrows-exchange" style="color:#7F77DD"></i></div>
      <div class="txn-info">
        <div class="txn-name">${t.payee}</div>
        <div class="txn-meta">Transfer · ${dateStr} · ${t.account} → ${t.toAccount}</div>
      </div>
      <div class="txn-right">
        <div class="txn-amount" style="color:#7F77DD;">${fmt(t.amount)}</div>
        <div class="txn-actions">
          <button class="icon-btn" onclick="openEditTxn('${t.id}')"     title="Edit"><i class="ti ti-edit"></i></button>
          <button class="icon-btn danger" onclick="deleteTxn('${t.id}')" title="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    </div>`;
  }
  const cat = getCat(t.category);
  return `<div class="txn-row">
    <div class="txn-icon" style="background:${cat.color}22;"><i class="ti ${catIcon(t.category)}" style="color:${cat.color}"></i></div>
    <div class="txn-info">
      <div class="txn-name">${t.payee}</div>
      <div class="txn-meta">${cat.label} · ${dateStr}${t.account ? ' · ' + t.account.split('—')[0].trim() : ''}</div>
    </div>
    <div class="txn-right">
      <div class="txn-amount ${t.type}">${t.type === 'in' ? '+' : '-'}${fmt(t.amount)}</div>
      <div class="txn-actions">
        <button class="icon-btn" onclick="openRecat('${t.id}')"       title="Recategorize"><i class="ti ti-tag"></i></button>
        <button class="icon-btn" onclick="openEditTxn('${t.id}')"     title="Edit"><i class="ti ti-edit"></i></button>
        <button class="icon-btn danger" onclick="deleteTxn('${t.id}')" title="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>
  </div>`;
}

function catIcon(cat) {
  const icons = { housing:'ti-home', groceries:'ti-shopping-cart', transport:'ti-car', dining:'ti-fork', utilities:'ti-bolt', health:'ti-stethoscope', personal:'ti-sparkles', kids:'ti-school', subscriptions:'ti-repeat', entertainment:'ti-device-tv', savings:'ti-piggy-bank', debt:'ti-credit-card', income:'ti-arrows-transfer-down', other:'ti-dots' };
  return icons[cat] || 'ti-receipt';
}

// ── Add / Edit transaction ─────────────────────────────────────────────────
function openAddTransaction() {
  window._editingTxnId = null;
  txnType = 'out';
  document.getElementById('txn-modal-title').textContent = 'Add transaction';
  document.getElementById('txn-save-btn').textContent    = 'Add transaction';
  document.getElementById('txn-date').value   = todayStr();
  document.getElementById('txn-amount').value = '';
  document.getElementById('txn-payee').value  = '';
  document.getElementById('txn-notes').value  = '';
  setType('out');
  populateTxnSelects();
  document.getElementById('txn-modal').style.display = 'flex';
}

function openEditTxn(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  window._editingTxnId = id;
  document.getElementById('txn-modal-title').textContent = 'Edit transaction';
  document.getElementById('txn-save-btn').textContent    = 'Save changes';
  document.getElementById('txn-date').value   = t.date;
  document.getElementById('txn-amount').value = t.amount;
  document.getElementById('txn-payee').value  = t.payee;
  document.getElementById('txn-notes').value  = t.notes || '';
  populateTxnSelects(t.category, t.account, t.toAccount || '');
  setType(t.type);
  document.getElementById('txn-modal').style.display = 'flex';
}

function populateTxnSelects(selCat = '', selAcc = '', selTo = '') {
  document.getElementById('txn-category').innerHTML = CATEGORIES.map(c => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${c.label}</option>`).join('');
  const accOpts = sel => accounts.map(a => `<option value="${a.name}" ${a.name === sel ? 'selected' : ''}>${a.name}</option>`).join('');
  document.getElementById('txn-account').innerHTML    = accOpts(selAcc);
  document.getElementById('txn-to-account').innerHTML = accOpts(selTo);
}

function setType(type) {
  txnType = type;
  document.getElementById('toggle-out').className      = 'toggle-btn' + (type === 'out'      ? ' active-out'      : '');
  document.getElementById('toggle-in').className       = 'toggle-btn' + (type === 'in'       ? ' active-in'       : '');
  document.getElementById('toggle-transfer').className = 'toggle-btn' + (type === 'transfer' ? ' active-transfer' : '');
  const isTransfer = type === 'transfer';
  document.getElementById('txn-to-account-group').style.display = isTransfer ? '' : 'none';
  document.getElementById('txn-category-group').style.display   = isTransfer ? 'none' : '';
  document.getElementById('txn-account-label').textContent      = isTransfer ? 'From account' : 'Account';
}

async function saveTransaction() {
  const date     = document.getElementById('txn-date').value;
  const amount   = parseFloat(document.getElementById('txn-amount').value);
  const payee    = document.getElementById('txn-payee').value.trim();
  const account  = document.getElementById('txn-account').value;
  const notes    = document.getElementById('txn-notes').value.trim();
  if (!date || isNaN(amount) || amount <= 0 || !payee) { showToast('Please fill in date, amount, and payee.', 'error'); return; }
  let data;
  if (txnType === 'transfer') {
    const toAccount = document.getElementById('txn-to-account').value;
    if (!account || !toAccount)  { showToast('Pick both accounts for a transfer.', 'error'); return; }
    if (account === toAccount)   { showToast('A transfer needs two different accounts.', 'error'); return; }
    data = { date, amount, payee, category: 'transfer', type: 'transfer', account, toAccount, notes };
  } else {
    const category = document.getElementById('txn-category').value;
    data = { date, amount, payee, category, account, type: txnType, toAccount: '', notes };
  }
  if (window._editingTxnId) {
    await updateDoc(doc(db, 'users', currentUser.uid, 'transactions', window._editingTxnId), data);
    const idx = transactions.findIndex(t => t.id === window._editingTxnId);
    if (idx > -1) transactions[idx] = { id: window._editingTxnId, ...data };
    showToast('Transaction updated');
  } else {
    const ref = await addDoc(userCol('transactions'), data);
    transactions.unshift({ id: ref.id, ...data });
    transactions.sort((a, b) => b.date.localeCompare(a.date));
    showToast('Transaction added');
  }
  document.getElementById('txn-modal').style.display = 'none';
  renderDashboard();
  if (document.getElementById('page-transactions').classList.contains('active')) renderTransactions();
  refreshBalancesIfVisible();
}

async function deleteTxn(id) {
  if (!confirm('Delete this transaction?')) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'transactions', id));
  transactions = transactions.filter(t => t.id !== id);
  showToast('Transaction deleted');
  renderDashboard();
  if (document.getElementById('page-transactions').classList.contains('active')) renderTransactions();
  refreshBalancesIfVisible();
}

// ── Recategorize ───────────────────────────────────────────────────────────
function openRecat(id) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  recatTxnId = id;
  document.getElementById('recat-payee').textContent  = t.payee;
  document.getElementById('recat-category').innerHTML = CATEGORIES.map(c => `<option value="${c.id}" ${c.id === t.category ? 'selected' : ''}>${c.label}</option>`).join('');
  document.getElementById('recat-modal').style.display = 'flex';
}

async function saveRecat() {
  const category = document.getElementById('recat-category').value;
  await updateDoc(doc(db, 'users', currentUser.uid, 'transactions', recatTxnId), { category });
  const idx = transactions.findIndex(t => t.id === recatTxnId);
  if (idx > -1) transactions[idx].category = category;
  document.getElementById('recat-modal').style.display = 'none';
  showToast('Category updated');
  renderDashboard();
  if (document.getElementById('page-transactions').classList.contains('active')) renderTransactions();
}

// ── Accounts ───────────────────────────────────────────────────────────────
function renderAccounts() {
  const el = document.getElementById('accounts-list');
  if (accounts.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-building-bank"></i><p>No accounts yet. Run the seed file locally to populate your accounts, or add them manually.</p></div>`;
    return;
  }
  const primary = accounts.find(a => a.isPrimary);
  const groups = {};
  accounts.filter(a => !a.isPrimary).forEach(a => { if (!groups[a.group]) groups[a.group] = []; groups[a.group].push(a); });
  const groupOrder = ['liquid','registered','loc','credit-card','other-asset','other-liability'];
  let html = '';
  if (primary) {
    html += `<div class="account-group">
      <div class="account-group-title">Operating account</div>
      ${accountRowHTML(primary, true)}
    </div>`;
  }
  html += groupOrder.filter(g => groups[g]).map(g => {
    const list = groups[g].slice().sort((a, b) => (a.sortOrder ?? 9999) - (b.sortOrder ?? 9999));
    return `<div class="account-group">
      <div class="account-group-title">${GROUP_LABELS[g]}</div>
      <div class="sortable-group" data-group="${g}">${list.map(a => accountRowHTML(a, false)).join('')}</div>
    </div>`;
  }).join('');
  el.innerHTML = html;
  initAccountSorting();
}

function accountRowHTML(a, solo) {
  const bal      = accountBalance(a);
  const balClass = a.isLiability ? 'liability' : (bal === 0 ? 'neutral' : 'asset');
  const balStr   = balDisplay(a.isLiability, bal);
  const handle   = solo ? '' : `<div class="drag-handle" title="Drag to reorder"><i class="ti ti-arrows-move"></i></div>`;
  return `<div class="account-row${a.isPrimary ? ' primary' : ''}" data-id="${a.id}">
    ${handle}
    <div class="account-left">
      <div class="account-name">${a.name}</div>
      <div class="account-type">${a.type.toUpperCase()}${a.rate ? ' · ' + a.rate : ''}${a.notes ? ' · ' + a.notes : ''}</div>
    </div>
    <div class="account-right">
      <div class="account-bal ${balClass}">${balStr}</div>
      <button class="icon-btn pin${a.isPrimary ? ' active' : ''}" onclick="togglePrimary('${a.id}')" title="${a.isPrimary ? 'Pinned as operating account' : 'Pin as operating account'}"><i class="ti ti-pin"></i></button>
      <button class="icon-btn" onclick="openEditAccount('${a.id}')" title="Edit account"><i class="ti ti-pencil"></i></button>
      <button class="icon-btn danger" onclick="deleteAccount('${a.id}')" title="Delete"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}

// Drag-to-reorder within each group (touch + desktop) via SortableJS. Reordering
// is within-group only; to move an account to a different group, change its group
// in the edit screen, since the group determines asset vs liability.
let _sortables = [];
function initAccountSorting() {
  if (typeof Sortable === 'undefined') return; // library blocked; rows still display fine
  _sortables.forEach(s => { try { s.destroy(); } catch (e) {} });
  _sortables = [];
  document.querySelectorAll('.sortable-group').forEach(container => {
    _sortables.push(Sortable.create(container, {
      handle: '.drag-handle',
      animation: 150,
      delay: 150,
      delayOnTouchOnly: true,
      ghostClass: 'drag-ghost',
      onEnd: async (evt) => {
        const ids = [...evt.to.querySelectorAll('[data-id]')].map(n => n.dataset.id);
        const changed = [];
        ids.forEach((id, i) => {
          const a = accounts.find(x => x.id === id);
          if (a && a.sortOrder !== i) { a.sortOrder = i; changed.push(a); }
        });
        await Promise.all(changed.map(a => updateDoc(doc(db, 'users', currentUser.uid, 'accounts', a.id), { sortOrder: a.sortOrder })));
      }
    }));
  });
}

async function togglePrimary(id) {
  const target = accounts.find(a => a.id === id);
  if (!target) return;
  const makePrimary = !target.isPrimary;
  const changed = [];
  accounts.forEach(a => {
    const want = makePrimary && a.id === id;
    if (!!a.isPrimary !== want) { a.isPrimary = want; changed.push(a); }
  });
  renderAccounts();
  renderDashboard();
  await Promise.all(changed.map(a => updateDoc(doc(db, 'users', currentUser.uid, 'accounts', a.id), { isPrimary: !!a.isPrimary })));
}

function openAddAccount() {
  window._editingAccId = null;
  document.getElementById('account-modal-title').textContent = 'Add account';
  document.getElementById('acc-save-btn').textContent        = 'Add account';
  ['acc-name','acc-balance','acc-rate','acc-notes','acc-due-day'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('acc-type').value  = 'chequing';
  document.getElementById('acc-group').value = 'liquid';
  document.getElementById('acc-opening-date').value = '2026-06-01';
  document.getElementById('acc-paid-full').checked = false;
  document.getElementById('account-modal').style.display = 'flex';
}

async function saveAccount() {
  const name  = document.getElementById('acc-name').value.trim();
  const type  = document.getElementById('acc-type').value;
  const group = document.getElementById('acc-group').value;
  const balance = parseFloat(document.getElementById('acc-balance').value) || 0;
  const rate  = document.getElementById('acc-rate').value.trim();
  const notes = document.getElementById('acc-notes').value.trim();
  const openingAsOf = document.getElementById('acc-opening-date').value || '2026-06-01';
  const dueDay = parseInt(document.getElementById('acc-due-day').value) || null;
  const paidInFull = document.getElementById('acc-paid-full').checked;
  const isLiability = ['loc','credit-card','other-liability'].includes(group);
  if (!name) { showToast('Please enter an account name.', 'error'); return; }
  const data = { name, type, group, balance, openingAsOf, dueDay, paidInFull, rate, notes, isLiability };
  if (window._editingAccId) {
    const prev = accounts.find(a => a.id === window._editingAccId);
    const oldName = prev ? prev.name : null;
    await updateDoc(doc(db, 'users', currentUser.uid, 'accounts', window._editingAccId), data);
    const idx = accounts.findIndex(a => a.id === window._editingAccId);
    if (idx > -1) accounts[idx] = { ...prev, ...data, id: window._editingAccId };
    if (oldName && oldName !== name) await relinkAccountName(oldName, name);
    showToast('Account updated');
  } else {
    const groupMax = accounts.filter(a => a.group === group).reduce((m, a) => Math.max(m, a.sortOrder ?? -1), -1);
    data.sortOrder = groupMax + 1;
    const ref = await addDoc(userCol('accounts'), data);
    accounts.push({ id: ref.id, ...data });
    showToast('Account added');
  }
  document.getElementById('account-modal').style.display = 'none';
  renderAccounts();
  renderDashboard();
}

// Keep transactions linked when an account is renamed (link is by name string).
async function relinkAccountName(oldName, newName) {
  const affected = transactions.filter(t => t.account === oldName || t.toAccount === oldName);
  for (const t of affected) {
    const patch = {};
    if (t.account === oldName)   { t.account = newName;   patch.account = newName; }
    if (t.toAccount === oldName) { t.toAccount = newName; patch.toAccount = newName; }
    await updateDoc(doc(db, 'users', currentUser.uid, 'transactions', t.id), patch);
  }
}

function openEditAccount(id) {
  const a = accounts.find(x => x.id === id);
  if (!a) return;
  window._editingAccId = id;
  document.getElementById('account-modal-title').textContent = 'Edit account';
  document.getElementById('acc-save-btn').textContent        = 'Save changes';
  document.getElementById('acc-name').value         = a.name || '';
  document.getElementById('acc-type').value         = a.type  || 'chequing';
  document.getElementById('acc-group').value        = a.group || 'liquid';
  document.getElementById('acc-balance').value      = a.balance ?? 0;
  document.getElementById('acc-rate').value         = a.rate  || '';
  document.getElementById('acc-notes').value        = a.notes || '';
  document.getElementById('acc-opening-date').value = a.openingAsOf || '2026-06-01';
  document.getElementById('acc-due-day').value = a.dueDay || '';
  document.getElementById('acc-paid-full').checked = !!a.paidInFull;
  document.getElementById('account-modal').style.display = 'flex';
}

async function deleteAccount(id) {
  if (!confirm('Delete this account? This cannot be undone.')) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'accounts', id));
  accounts = accounts.filter(a => a.id !== id);
  showToast('Account deleted');
  renderAccounts();
  renderDashboard();
}

// ── Budgets ────────────────────────────────────────────────────────────────
function renderBudgets() {
  const txns    = getMonthTxns(currentMonth, currentYear).filter(t => t.type === 'out');
  const spending = {};
  txns.forEach(t => { spending[t.category] = (spending[t.category] || 0) + t.amount; });
  const budgetCats = CATEGORIES.filter(c => c.id !== 'income');
  document.getElementById('budget-bars').innerHTML = budgetCats.map(c => {
    const spent  = spending[c.id] || 0;
    const budget = budgets[c.id]  || 0;
    if (spent === 0 && budget === 0) return '';
    const pct  = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
    const over = budget > 0 && spent > budget;
    return `<div class="budget-item">
      <div class="budget-header">
        <span class="budget-name">${c.label}</span>
        <span class="budget-amounts">${fmtShort(spent)}${budget > 0 ? ' / ' + fmtShort(budget) : ''}</span>
      </div>
      <div class="budget-track"><div class="budget-fill" style="width:${pct}%;background:${over ? 'var(--red-400)' : c.color};"></div></div>
    </div>`;
  }).join('');
  document.getElementById('budget-form-list').innerHTML = budgetCats.map(c => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <div style="width:8px;height:8px;border-radius:50%;background:${c.color};flex-shrink:0;"></div>
      <label style="flex:1;font-size:12px;color:var(--text-secondary);">${c.label}</label>
      <input type="number" class="form-input" style="width:90px;padding:5px 8px;" placeholder="0" value="${budgets[c.id] || ''}" data-cat="${c.id}">
    </div>`).join('');
  const totalBudget = budgetCats.reduce((s, c) => s + (budgets[c.id] || 0), 0);
  const totalSpent  = budgetCats.reduce((s, c) => s + (spending[c.id] || 0), 0);
  const totEl = document.getElementById('budget-total');
  if (totEl) totEl.innerHTML = `Spent <strong>${fmt(totalSpent)}</strong> of <strong>${fmt(totalBudget)}</strong> budgeted this month`;
}

// Fill the form inputs with context-derived starting points. Does not save:
// the person reviews and hits Save. Only housing ($3,200) is a confirmed figure.
function loadSuggestedBudgets() {
  document.querySelectorAll('#budget-form-list input').forEach(inp => {
    const v = SUGGESTED_BUDGETS[inp.dataset.cat];
    if (v !== undefined) inp.value = v;
  });
  showToast('Suggested amounts filled. Review, then Save.');
}

async function saveBudgets() {
  document.querySelectorAll('#budget-form-list input').forEach(inp => {
    const val = parseFloat(inp.value) || 0;
    if (val > 0) budgets[inp.dataset.cat] = val;
    else delete budgets[inp.dataset.cat];
  });
  await setDoc(userDocRef('settings/budgets'), budgets);
  showToast('Budgets saved');
  renderBudgets();
}

// ── Net worth ──────────────────────────────────────────────────────────────
function renderNetworth() {
  const assets      = accounts.filter(a => !a.isLiability).reduce((s, a) => s + accountBalance(a), 0);
  const liabilities = accounts.filter(a =>  a.isLiability).reduce((s, a) => s + accountBalance(a), 0);
  const nw    = assets - liabilities;
  const total = assets + liabilities;

  document.getElementById('nw-assets').textContent      = fmt(assets);
  document.getElementById('nw-liabilities').textContent = fmt(liabilities);
  document.getElementById('nw-total').textContent       = fmt(nw);
  document.getElementById('nw-label-assets').textContent      = fmt(assets);
  document.getElementById('nw-label-liabilities').textContent = fmt(liabilities);

  const assetPct = total > 0 ? (assets / total * 100).toFixed(1) : 50;
  const liabPct  = total > 0 ? (liabilities / total * 100).toFixed(1) : 50;
  document.getElementById('nw-bar-assets').style.width      = assetPct + '%';
  document.getElementById('nw-bar-liabilities').style.width = liabPct  + '%';

  function groupedList(accs, order) {
    const groups = {};
    accs.forEach(a => { if (!groups[a.group]) groups[a.group] = []; groups[a.group].push(a); });
    return order.filter(g => groups[g]).map(g => `
      <div style="margin-bottom:12px;">
        <div style="font-size:10px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;">${GROUP_LABELS[g]}</div>
        ${groups[g].map(a => `<div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--text-secondary);">${a.name.split('—')[0].trim()}</span>
          <span style="font-weight:500;color:${a.isLiability ? 'var(--red-400)' : 'var(--teal-400)'};">${balDisplay(a.isLiability, accountBalance(a))}</span>
        </div>`).join('')}
      </div>`).join('');
  }

  document.getElementById('nw-assets-list').innerHTML      = groupedList(accounts.filter(a => !a.isLiability), ['liquid','registered','other-asset']);
  document.getElementById('nw-liabilities-list').innerHTML = groupedList(accounts.filter(a =>  a.isLiability), ['loc','credit-card','other-liability']);
}

// ── Forecast / debt repayment planner ───────────────────────────────────────
const csvCell = v => { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const isoDate = d => d.toISOString().split('T')[0];
const fmtMonthYr = s => new Date(s + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', year: 'numeric' });

// Expand a recurring rule into dated occurrences within [startStr, endStr].
function buildOccurrences(rec, startStr, endStr) {
  const occ = [];
  const start = new Date(startStr + 'T12:00:00');
  const end   = new Date(endStr + 'T12:00:00');
  const recEnd = rec.endDate ? new Date(rec.endDate + 'T12:00:00') : null;
  const anchor = new Date((rec.anchorDate || startStr) + 'T12:00:00');
  const push = d => {
    if (d < start || d > end) return;
    if (recEnd && d > recEnd) return;
    occ.push({ ...rec, date: isoDate(d) });
  };
  const freq = rec.frequency || 'monthly';
  if (freq === 'once') { push(anchor); return occ; }
  if (freq === 'weekly' || freq === 'biweekly') {
    const step = freq === 'weekly' ? 7 : 14;
    const d = new Date(anchor);
    while (d < start) d.setDate(d.getDate() + step);
    while (d <= end) { push(new Date(d)); d.setDate(d.getDate() + step); }
    return occ;
  }
  const monthStep = freq === 'monthly' ? 1 : freq === 'bimonthly' ? 2 : freq === 'quarterly' ? 3 : 12;
  const day = anchor.getDate();
  let d = new Date(start.getFullYear(), start.getMonth(), 1, 12);
  while (d <= end) {
    const since = (d.getFullYear() - anchor.getFullYear()) * 12 + (d.getMonth() - anchor.getMonth());
    if (since >= 0 && since % monthStep === 0) {
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      push(new Date(d.getFullYear(), d.getMonth(), Math.min(day, dim), 12));
    }
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
  }
  return occ;
}

function activeRecurring() { return recurring.filter(r => r.active !== false); }

// Monthly lump outflows derived from budget categories that are NOT income,
// savings, or debt, and are NOT already covered by a recurring entry. Applied
// on the 1st of each FULL future month from the operating account, so the
// forecast accounts for variable everyday spending without double-counting
// scheduled items or the current partial month's actuals.
function budgetSpendEvents(today, endStr) {
  if (!forecastSettings.includeBudgets || !forecastSettings.budgetAccount) return [];
  const covered = new Set(activeRecurring().filter(r => r.type === 'out' && r.category).map(r => r.category));
  const skip = new Set(['income', 'savings', 'debt', 'transfer']);
  const total = Object.keys(budgets).reduce((s, c) =>
    (!skip.has(c) && !covered.has(c) && budgets[c] > 0) ? s + budgets[c] : s, 0);
  if (total <= 0) return [];
  const events = [];
  const start = new Date(today + 'T12:00:00');
  const end   = new Date(endStr + 'T12:00:00');
  let d = new Date(start.getFullYear(), start.getMonth() + 1, 1, 12); // first of next month
  while (d <= end) {
    events.push({ type: 'out', amount: total, account: forecastSettings.budgetAccount, category: 'budget', label: 'Budgeted spending', date: isoDate(d) });
    d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
  }
  return events;
}

function futureEvents(today, endStr) {
  let events = [];
  activeRecurring().forEach(r => buildOccurrences(r, today, endStr).forEach(o => { if (o.date > today) events.push(o); }));
  events = events.concat(budgetSpendEvents(today, endStr));
  return events.sort((a, b) => a.date.localeCompare(b.date));
}

function projectTimeline(horizonMonths) {
  const today = todayStr();
  const start = new Date(today + 'T12:00:00');
  const endStr = isoDate(new Date(start.getFullYear(), start.getMonth() + horizonMonths + 1, 0, 12));
  const bal = {};
  accounts.forEach(a => { bal[a.name] = balanceAsOf(a, today); });
  const liquidSet = new Set(accounts.filter(a => !a.isLiability && a.group === 'liquid').map(a => a.name));
  const totals = b => {
    let nw = 0, debt = 0, liquid = 0;
    accounts.forEach(a => {
      const v = b[a.name];
      if (a.isLiability) { nw -= v; debt += v; }
      else { nw += v; if (liquidSet.has(a.name)) liquid += v; }
    });
    return { netWorth: nw, debt, liquid };
  };
  const events = futureEvents(today, endStr);
  const snaps = [{ label: 'Now', date: today, ...totals(bal) }];
  let ei = 0;
  for (let m = 0; m < horizonMonths; m++) {
    const mEnd = isoDate(new Date(start.getFullYear(), start.getMonth() + m + 1, 0, 12));
    while (ei < events.length && events[ei].date <= mEnd) {
      const ev = events[ei];
      accounts.forEach(a => { bal[a.name] += eventEffectOn(ev, a.name, a.isLiability); });
      ei++;
    }
    snaps.push({ label: fmtMonthYr(mEnd), date: mEnd, ...totals(bal) });
  }
  return { today, endStr, snaps, finalBalances: { ...bal } };
}

function projectMilestone(mil, horizonMonths) {
  const acct = accounts.find(a => a.name === mil.account);
  if (!acct) return { state: 'noaccount' };
  const today = todayStr();
  const start = new Date(today + 'T12:00:00');
  const endStr = isoDate(new Date(start.getFullYear(), start.getMonth() + horizonMonths + 1, 0, 12));
  const target = mil.targetAmount || 0;
  const isLiab = acct.isLiability;
  const meets = b => isLiab ? b <= target + 0.005 : b >= target - 0.005;
  const current = balanceAsOf(acct, today);
  if (meets(current)) return { state: 'met', date: today, current, already: true };
  let bal = current;
  for (const ev of futureEvents(today, endStr)) {
    bal += eventEffectOn(ev, acct.name, isLiab);
    if (meets(bal)) return { state: 'met', date: ev.date, current };
  }
  return { state: 'beyond', current, projected: bal };
}

function setForecastHorizon(n) {
  forecastHorizon = n;
  document.getElementById('fc-h6').className  = 'seg-btn' + (n === 6  ? ' active' : '');
  document.getElementById('fc-h12').className = 'seg-btn' + (n === 12 ? ' active' : '');
  renderForecast();
}

function initForecastControls() {
  const sel = document.getElementById('fc-budget-account');
  if (sel) {
    const operating = accounts.filter(a => a.group === 'liquid' || a.group === 'loc');
    if (!forecastSettings.budgetAccount && operating.length) forecastSettings.budgetAccount = operating[0].name;
    sel.innerHTML = operating.map(a => `<option value="${a.name}" ${a.name === forecastSettings.budgetAccount ? 'selected' : ''}>${a.name}</option>`).join('');
    sel.style.display = forecastSettings.includeBudgets ? '' : 'none';
  }
  const chk = document.getElementById('fc-include-budgets');
  if (chk) chk.checked = !!forecastSettings.includeBudgets;
}

async function saveForecastSettings() {
  await setDoc(userDocRef('settings/forecast'), forecastSettings);
}

async function toggleBudgetForecast() {
  forecastSettings.includeBudgets = document.getElementById('fc-include-budgets').checked;
  const sel = document.getElementById('fc-budget-account');
  if (forecastSettings.includeBudgets && !forecastSettings.budgetAccount && sel && sel.value) forecastSettings.budgetAccount = sel.value;
  if (sel) sel.style.display = forecastSettings.includeBudgets ? '' : 'none';
  await saveForecastSettings();
  renderForecast();
}

async function saveBudgetForecastAccount() {
  forecastSettings.budgetAccount = document.getElementById('fc-budget-account').value;
  await saveForecastSettings();
  renderForecast();
}

function renderForecast() {
  initForecastControls();
  if (accounts.length === 0) {
    document.getElementById('fc-summary').innerHTML = `<div class="empty-state"><i class="ti ti-chart-line"></i><p>Add accounts first, then set recurring income and expenses below to see a projection.</p></div>`;
    document.getElementById('fc-debt-table').innerHTML = '';
    document.getElementById('fc-milestones').innerHTML = '';
    renderRecurringList();
    return;
  }
  const tl = projectTimeline(forecastHorizon);
  const now = tl.snaps[0], end = tl.snaps[tl.snaps.length - 1];
  const nwDelta   = end.netWorth - now.netWorth;
  const debtDelta = end.debt - now.debt;
  const upColor   = d => d > 0.005 ? 'var(--teal-400)' : d < -0.005 ? 'var(--red-400)' : 'var(--text-tertiary)';
  const debtColor = d => d < -0.005 ? 'var(--teal-400)' : d > 0.005 ? 'var(--red-400)' : 'var(--text-tertiary)';
  document.getElementById('fc-summary').innerHTML = `
    <div class="metric-card"><div class="metric-label">Net worth now</div><div class="metric-value indigo">${fmt(now.netWorth)}</div><div class="metric-sub">${fmt(now.debt)} total debt</div></div>
    <div class="metric-card"><div class="metric-label">Projected in ${forecastHorizon} mo</div><div class="metric-value ${end.netWorth >= 0 ? 'positive' : 'negative'}">${fmt(end.netWorth)}</div><div class="metric-sub" style="color:${upColor(nwDelta)};">${(nwDelta >= 0 ? '+' : '') + fmtShort(nwDelta)} net worth</div></div>
    <div class="metric-card"><div class="metric-label">Debt in ${forecastHorizon} mo</div><div class="metric-value negative">${fmt(end.debt)}</div><div class="metric-sub" style="color:${debtColor(debtDelta)};">${(debtDelta > 0 ? '+' : '') + fmtShort(debtDelta)} vs now</div></div>`;

  renderForecastChart(tl.snaps);

  // Debt payoff table: revolving liabilities being paid down. Accounts marked
  // "paid in full monthly" are excluded since they have no meaningful payoff date.
  const allLiabs = accounts.filter(a => a.isLiability);
  const liabs = allLiabs.filter(a => !a.paidInFull).sort((a, b) => accountBalance(b) - accountBalance(a));
  const hiddenCount = allLiabs.length - liabs.length;
  if (liabs.length === 0) {
    document.getElementById('fc-debt-table').innerHTML = '<p style="color:var(--text-tertiary);font-size:13px;">No revolving debt to track.</p>';
  } else {
    const rows = liabs.map(a => {
      const cur = accountBalance(a);
      const proj = tl.finalBalances[a.name];
      const pay = projectMilestone({ account: a.name, targetAmount: 0 }, forecastHorizon);
      const payTxt = cur <= 0.005 ? '<span style="color:var(--teal-400);">Clear</span>'
        : pay.state === 'met' ? `<span style="color:var(--teal-400);">${fmtMonthYr(pay.date)}</span>`
        : `<span style="color:var(--text-tertiary);">beyond ${forecastHorizon} mo</span>`;
      return `<tr>
        <td>${a.name}</td>
        <td style="text-align:right;">${fmt(cur)}</td>
        <td style="text-align:right;color:${proj < cur ? 'var(--teal-400)' : 'var(--text-secondary)'};">${fmt(proj)}</td>
        <td style="text-align:right;">${payTxt}</td>
      </tr>`;
    }).join('');
    document.getElementById('fc-debt-table').innerHTML = `<table class="fc-table">
      <thead><tr><th>Liability</th><th style="text-align:right;">Now</th><th style="text-align:right;">In ${forecastHorizon} mo</th><th style="text-align:right;">Paid off</th></tr></thead>
      <tbody>${rows}</tbody></table>${hiddenCount ? `<div style="font-size:11px;color:var(--text-tertiary);margin-top:8px;">${hiddenCount} paid-in-full account${hiddenCount === 1 ? '' : 's'} hidden from the payoff outlook.</div>` : ''}`;
  }

  // Milestones
  const msEl = document.getElementById('fc-milestones');
  if (milestones.length === 0) {
    msEl.innerHTML = `<p style="color:var(--text-tertiary);font-size:13px;">No milestones yet. Add a savings target or debt payoff goal to track it.</p>`;
  } else {
    msEl.innerHTML = milestones.map(m => {
      const r = projectMilestone(m, forecastHorizon);
      let status, color;
      if (r.state === 'noaccount') { status = 'account not found'; color = 'var(--red-400)'; }
      else if (r.already) { status = 'Already met'; color = 'var(--teal-400)'; }
      else if (r.state === 'met') {
        const onTrack = !m.targetDate || r.date <= m.targetDate;
        status = `${fmtMonthYr(r.date)}${m.targetDate ? (onTrack ? ' · on track' : ' · behind target') : ''}`;
        color = onTrack ? 'var(--teal-400)' : 'var(--amber-400, #BA7517)';
      } else { status = `Beyond ${forecastHorizon} mo (proj. ${fmt(r.projected)})`; color = 'var(--text-tertiary)'; }
      return `<div class="ms-row">
        <div>
          <div class="ms-label">${m.label}</div>
          <div class="ms-sub">${m.account} · target ${fmt(m.targetAmount || 0)}${m.targetDate ? ' by ' + fmtMonthYr(m.targetDate) : ''}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:12px;color:${color};font-weight:500;">${status}</span>
          <button class="icon-btn" onclick="openEditMilestone('${m.id}')" title="Edit"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn danger" onclick="deleteMilestone('${m.id}')" title="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }
  renderRecurringList();
}

function renderForecastChart(snaps) {
  if (forecastChart) forecastChart.destroy();
  const ctx = document.getElementById('forecast-chart');
  if (!ctx) return;
  forecastChart = new Chart(ctx, {
    type: 'line',
    data: { labels: snaps.map(s => s.label), datasets: [
      { label: 'Net worth', data: snaps.map(s => s.netWorth), borderColor: '#534AB7', backgroundColor: 'rgba(83,74,183,0.12)', fill: true, tension: 0.25, pointRadius: 2 },
      { label: 'Total debt', data: snaps.map(s => s.debt), borderColor: '#E24B4A', backgroundColor: 'transparent', fill: false, tension: 0.25, pointRadius: 2, borderDash: [5, 4] }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: true, labels: { color: '#9898b0', font: { size: 11 }, boxWidth: 12 } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#9898b0', font: { size: 10 }, maxRotation: 0, autoSkip: true }, border: { display: false } },
        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#9898b0', font: { size: 11 }, callback: v => fmtShort(v) }, border: { display: false } }
      }
    }
  });
}

// ── Recurring entries CRUD ───────────────────────────────────────────────────
function renderRecurringList() {
  const el = document.getElementById('recurring-list');
  if (!el) return;
  if (recurring.length === 0) {
    el.innerHTML = `<p style="color:var(--text-tertiary);font-size:13px;">No recurring entries. Add your pay, bills, savings transfers, and debt payments to build the projection.</p>`;
    return;
  }
  const sign = r => r.type === 'in' ? '+' : r.type === 'transfer' ? '' : '-';
  const color = r => r.type === 'in' ? 'var(--teal-400)' : r.type === 'transfer' ? '#7F77DD' : 'var(--red-400)';
  el.innerHTML = recurring.slice().sort((a, b) => (b.amount || 0) - (a.amount || 0)).map(r => `
    <div class="ms-row">
      <div>
        <div class="ms-label">${r.label}${r.active === false ? ' <span style="color:var(--text-tertiary);font-weight:400;">(paused)</span>' : ''}</div>
        <div class="ms-sub">${FREQ_LABELS[r.frequency] || r.frequency} · ${r.type === 'transfer' ? `${r.account} → ${r.toAccount}` : r.account || 'no account'}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="font-size:13px;font-weight:600;color:${color(r)};">${sign(r)}${fmtShort(r.amount || 0)}</span>
        <button class="icon-btn" onclick="openEditRecurring('${r.id}')" title="Edit"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn danger" onclick="deleteRecurring('${r.id}')" title="Delete"><i class="ti ti-trash"></i></button>
      </div>
    </div>`).join('');
}

function populateRecurSelects(selCat = '', selAcc = '', selTo = '') {
  document.getElementById('recur-category').innerHTML = CATEGORIES.map(c => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${c.label}</option>`).join('');
  const opts = sel => accounts.map(a => `<option value="${a.name}" ${a.name === sel ? 'selected' : ''}>${a.name}</option>`).join('');
  document.getElementById('recur-account').innerHTML    = opts(selAcc);
  document.getElementById('recur-to-account').innerHTML = opts(selTo);
}

function setRecurType(type) {
  recurType = type;
  document.getElementById('recur-toggle-out').className      = 'toggle-btn' + (type === 'out'      ? ' active-out'      : '');
  document.getElementById('recur-toggle-in').className       = 'toggle-btn' + (type === 'in'       ? ' active-in'       : '');
  document.getElementById('recur-toggle-transfer').className = 'toggle-btn' + (type === 'transfer' ? ' active-transfer' : '');
  const isT = type === 'transfer';
  document.getElementById('recur-to-account-group').style.display = isT ? '' : 'none';
  document.getElementById('recur-category-group').style.display   = isT ? 'none' : '';
  document.getElementById('recur-account-label').textContent      = isT ? 'From account' : 'Account';
}

function openAddRecurring() {
  editingRecurringId = null;
  document.getElementById('recur-modal-title').textContent = 'Add recurring entry';
  document.getElementById('recur-save-btn').textContent    = 'Add entry';
  document.getElementById('recur-label').value  = '';
  document.getElementById('recur-amount').value = '';
  document.getElementById('recur-frequency').value = 'monthly';
  document.getElementById('recur-anchor').value = todayStr();
  populateRecurSelects();
  setRecurType('out');
  document.getElementById('recur-modal').style.display = 'flex';
}

function openEditRecurring(id) {
  const r = recurring.find(x => x.id === id);
  if (!r) return;
  editingRecurringId = id;
  document.getElementById('recur-modal-title').textContent = 'Edit recurring entry';
  document.getElementById('recur-save-btn').textContent    = 'Save changes';
  document.getElementById('recur-label').value     = r.label || '';
  document.getElementById('recur-amount').value    = r.amount || '';
  document.getElementById('recur-frequency').value = r.frequency || 'monthly';
  document.getElementById('recur-anchor').value    = r.anchorDate || todayStr();
  populateRecurSelects(r.category || 'other', r.account || '', r.toAccount || '');
  setRecurType(r.type || 'out');
  document.getElementById('recur-modal').style.display = 'flex';
}

async function saveRecurring() {
  const label      = document.getElementById('recur-label').value.trim();
  const amount     = parseFloat(document.getElementById('recur-amount').value);
  const frequency  = document.getElementById('recur-frequency').value;
  const anchorDate = document.getElementById('recur-anchor').value;
  const account    = document.getElementById('recur-account').value;
  if (!label || isNaN(amount) || amount <= 0 || !anchorDate) { showToast('Fill in label, amount, and a start date.', 'error'); return; }
  let data;
  if (recurType === 'transfer') {
    const toAccount = document.getElementById('recur-to-account').value;
    if (!account || !toAccount) { showToast('Pick both accounts for a transfer.', 'error'); return; }
    if (account === toAccount)  { showToast('A transfer needs two different accounts.', 'error'); return; }
    data = { label, type: 'transfer', amount, account, toAccount, category: 'transfer', frequency, anchorDate, active: true };
  } else {
    data = { label, type: recurType, amount, account, toAccount: '', category: document.getElementById('recur-category').value, frequency, anchorDate, active: true };
  }
  if (editingRecurringId) {
    const prev = recurring.find(r => r.id === editingRecurringId);
    if (prev && prev.active === false) data.active = false;
    await updateDoc(doc(db, 'users', currentUser.uid, 'recurring', editingRecurringId), data);
    const idx = recurring.findIndex(r => r.id === editingRecurringId);
    if (idx > -1) recurring[idx] = { id: editingRecurringId, ...data };
    showToast('Recurring entry updated');
  } else {
    const ref = await addDoc(userCol('recurring'), data);
    recurring.push({ id: ref.id, ...data });
    showToast('Recurring entry added');
  }
  document.getElementById('recur-modal').style.display = 'none';
  renderForecast();
}

async function deleteRecurring(id) {
  if (!confirm('Delete this recurring entry?')) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'recurring', id));
  recurring = recurring.filter(r => r.id !== id);
  showToast('Recurring entry deleted');
  renderForecast();
}

// ── Milestones CRUD ──────────────────────────────────────────────────────────
function populateMilestoneAccounts(sel = '') {
  document.getElementById('ms-account').innerHTML = accounts.map(a => `<option value="${a.name}" ${a.name === sel ? 'selected' : ''}>${a.name}${a.isLiability ? ' (debt)' : ''}</option>`).join('');
}

function openAddMilestone() {
  editingMilestoneId = null;
  document.getElementById('ms-modal-title').textContent = 'Add milestone';
  document.getElementById('ms-save-btn').textContent    = 'Add milestone';
  document.getElementById('ms-label').value  = '';
  document.getElementById('ms-target').value = '';
  document.getElementById('ms-date').value   = '';
  populateMilestoneAccounts();
  document.getElementById('ms-modal').style.display = 'flex';
}

function openEditMilestone(id) {
  const m = milestones.find(x => x.id === id);
  if (!m) return;
  editingMilestoneId = id;
  document.getElementById('ms-modal-title').textContent = 'Edit milestone';
  document.getElementById('ms-save-btn').textContent    = 'Save changes';
  document.getElementById('ms-label').value  = m.label || '';
  document.getElementById('ms-target').value = m.targetAmount ?? '';
  document.getElementById('ms-date').value   = m.targetDate || '';
  populateMilestoneAccounts(m.account || '');
  document.getElementById('ms-modal').style.display = 'flex';
}

async function saveMilestone() {
  const label        = document.getElementById('ms-label').value.trim();
  const account      = document.getElementById('ms-account').value;
  const targetAmount = parseFloat(document.getElementById('ms-target').value);
  const targetDate   = document.getElementById('ms-date').value || '';
  if (!label || !account || isNaN(targetAmount)) { showToast('Fill in label, account, and target amount.', 'error'); return; }
  const data = { label, account, targetAmount, targetDate };
  if (editingMilestoneId) {
    await updateDoc(doc(db, 'users', currentUser.uid, 'milestones', editingMilestoneId), data);
    const idx = milestones.findIndex(m => m.id === editingMilestoneId);
    if (idx > -1) milestones[idx] = { id: editingMilestoneId, ...data };
    showToast('Milestone updated');
  } else {
    const ref = await addDoc(userCol('milestones'), data);
    milestones.push({ id: ref.id, ...data });
    showToast('Milestone added');
  }
  document.getElementById('ms-modal').style.display = 'none';
  renderForecast();
}

async function deleteMilestone(id) {
  if (!confirm('Delete this milestone?')) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'milestones', id));
  milestones = milestones.filter(m => m.id !== id);
  showToast('Milestone deleted');
  renderForecast();
}

// ── Export projected month as an import-ready transactions CSV (item 3) ───────
function populateExportMonths() {
  const sel = document.getElementById('fc-export-month');
  if (!sel || sel.options.length) return;
  const base = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1);
    sel.innerHTML += `<option value="${d.getFullYear()}-${d.getMonth()}">${d.toLocaleString('en-CA', { month: 'long', year: 'numeric' })}</option>`;
  }
}

function exportProjectionCSV() {
  const sel = document.getElementById('fc-export-month');
  const [year, monthIdx] = sel.value.split('-').map(Number);
  const first = isoDate(new Date(year, monthIdx, 1, 12));
  const last  = isoDate(new Date(year, monthIdx + 1, 0, 12));
  let rows = [];
  activeRecurring().forEach(r => buildOccurrences(r, first, last).forEach(o => {
    rows.push([o.date, r.label, r.type === 'transfer' ? 'transfer' : (r.category || 'other'), r.type, (r.amount || 0).toFixed(2), r.account || '', r.toAccount || '', 'projected']);
  }));
  rows.sort((a, b) => a[0].localeCompare(b[0]));
  const header = 'date,payee,category,type,amount,account,toAccount,notes';
  const csv = [header, ...rows.map(r => r.map(csvCell).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mo-mint-projected-${year}-${String(monthIdx + 1).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast(rows.length ? `${rows.length} projected rows exported` : 'No recurring entries fall in that month', rows.length ? 'success' : 'error');
}

// ── CSV Import ─────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim(); });
    return obj;
  });
}

async function importAccountsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCSV(text);
  let count = 0;
  for (const row of rows) {
    if (!row.name) continue;
    const data = {
      name:        row.name,
      type:        row.type        || 'other',
      group:       row.group       || 'liquid',
      balance:     parseFloat(row.balance) || 0,
      openingAsOf: row.openingAsOf || row.asOf || '2026-06-01',
      rate:        row.rate        || '',
      notes:       row.notes       || '',
      isLiability: row.isLiability === 'true'
    };
    const ref = await addDoc(userCol('accounts'), data);
    accounts.push({ id: ref.id, ...data });
    count++;
  }
  event.target.value = '';
  showToast(`${count} accounts imported`);
  renderAccounts();
  renderDashboard();
}

async function importTransactionsCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  const rows = parseCSV(text);
  // Identity of a transaction for dedup: date, payee, amount, type, and the
  // account(s). Category and notes are excluded because they can be edited
  // after import, and a re-import shouldn't duplicate something you recategorized.
  const sig = t => [t.date, (t.payee || '').trim().toLowerCase(), (parseFloat(t.amount) || 0).toFixed(2), t.type || 'out', (t.account || '').trim(), (t.toAccount || '').trim()].join('|');
  const existing = new Set(transactions.map(sig)); // snapshot before import
  const known = new Set(accounts.map(a => a.name));
  const unknown = new Set();
  let count = 0, skipped = 0;
  for (const row of rows) {
    if (!row.date || !row.payee || !row.amount) continue;
    const type = row.type || 'out';
    const data = {
      date:      row.date,
      payee:     row.payee,
      category:  type === 'transfer' ? 'transfer' : (row.category || 'other'),
      type,
      amount:    parseFloat(row.amount) || 0,
      account:   (row.account   || '').trim(),
      toAccount: (row.toAccount || '').trim(),
      notes:     row.notes     || ''
    };
    if (type === 'transfer' && (!data.account || !data.toAccount || data.account === data.toAccount)) continue;
    [data.account, data.toAccount].forEach(n => { if (n && !known.has(n)) unknown.add(n); });
    if (existing.has(sig(data))) { skipped++; continue; } // already present from a prior import
    const ref = await addDoc(userCol('transactions'), data);
    transactions.unshift({ id: ref.id, ...data });
    count++;
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  event.target.value = '';
  let msg = skipped ? `${count} imported, ${skipped} skipped as duplicates` : `${count} transactions imported`;
  if (unknown.size) msg += ` · ${unknown.size} reference unknown accounts (won't update a balance): ${[...unknown].slice(0, 3).join(', ')}${unknown.size > 3 ? '…' : ''}`;
  showToast(msg, unknown.size ? 'error' : 'success');
  renderTransactions();
  renderDashboard();
  refreshBalancesIfVisible();
}

// ── Modal helpers ──────────────────────────────────────────────────────────
// Click-away close is intentionally disabled: it was discarding in-progress
// entries on any stray click on the backdrop. Dismiss via Cancel or Escape.
function closeModal(event, id) { /* no-op: see note above */ }

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => { if (m.style.display !== 'none') m.style.display = 'none'; });
  }
});

// ── Auth ───────────────────────────────────────────────────────────────────
async function signInWithGoogle() {
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    errEl.textContent = 'Sign-in failed. Please try again.';
    errEl.style.display = 'block';
  }
}
function signOutUser() { signOut(auth); }

// ── Expose globals ─────────────────────────────────────────────────────────
window.importAccountsCSV     = importAccountsCSV;
window.importTransactionsCSV = importTransactionsCSV;
window.toggleTheme        = toggleTheme;
window.changeMonth        = changeMonth;
window.switchPage         = switchPage;
window.openAddTransaction = openAddTransaction;
window.openEditTxn        = openEditTxn;
window.deleteTxn          = deleteTxn;
window.openRecat          = openRecat;
window.saveRecat          = saveRecat;
window.setType            = setType;
window.saveTransaction    = saveTransaction;
window.openAddAccount     = openAddAccount;
window.saveAccount        = saveAccount;
window.openEditAccount    = openEditAccount;
window.deleteAccount      = deleteAccount;
window.saveBudgets        = saveBudgets;
window.loadSuggestedBudgets = loadSuggestedBudgets;
window.togglePrimary      = togglePrimary;
window.setForecastHorizon = setForecastHorizon;
window.openAddRecurring   = openAddRecurring;
window.openEditRecurring  = openEditRecurring;
window.setRecurType       = setRecurType;
window.saveRecurring      = saveRecurring;
window.deleteRecurring    = deleteRecurring;
window.openAddMilestone   = openAddMilestone;
window.openEditMilestone  = openEditMilestone;
window.saveMilestone      = saveMilestone;
window.deleteMilestone    = deleteMilestone;
window.exportProjectionCSV = exportProjectionCSV;
window.toggleBudgetForecast = toggleBudgetForecast;
window.saveBudgetForecastAccount = saveBudgetForecastAccount;
window.closeModal         = closeModal;
window.renderTransactions = renderTransactions;
window.signInWithGoogle   = signInWithGoogle;
window.signOutUser        = signOutUser;

// ── Boot ───────────────────────────────────────────────────────────────────
initTheme();

onAuthStateChanged(auth, user => {
  const loginScreen = document.getElementById('login-screen');
  const appEl       = document.getElementById('app');
  if (user) {
    currentUser = user;
    loginScreen.style.display = 'none';
    appEl.style.display       = 'flex';
    loadAll();
  } else {
    currentUser = null;
    loginScreen.style.display = 'flex';
    appEl.style.display       = 'none';
  }
});

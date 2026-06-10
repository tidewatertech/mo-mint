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
let editingTxnId = null;
let recatTxnId = null;
let balanceAccId = null;
let txnType = 'out';
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
const PAGE_TITLES = { dashboard: 'Overview', transactions: 'Transactions', budgets: 'Budgets', accounts: 'Accounts', networth: 'Net worth' };
function switchPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`page-${id}`).classList.add('active');
  document.querySelectorAll(`[data-page="${id}"]`).forEach(n => n.classList.add('active'));
  document.getElementById('page-title').textContent = PAGE_TITLES[id] || id;
  document.getElementById('month-nav').style.display = (id === 'accounts' || id === 'networth') ? 'none' : 'flex';
  if (id === 'transactions') renderTransactions();
  if (id === 'budgets') renderBudgets();
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
  await Promise.all([loadTransactions(), loadAccounts(), loadBudgets()]);
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

  renderSpendingRing(txns);
  renderMoChart();
  renderRecentTxns(txns);
}

function calcNetWorth() {
  return accounts.reduce((s, a) => a.isLiability ? s - a.balance : s + a.balance, 0);
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
    if (acc  && t.account  !== acc)  return false;
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
  const cat     = getCat(t.category);
  const dateStr = new Date(t.date + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
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
  setType(t.type);
  populateTxnSelects(t.category, t.account);
  document.getElementById('txn-modal').style.display = 'flex';
}

function populateTxnSelects(selCat = '', selAcc = '') {
  document.getElementById('txn-category').innerHTML = CATEGORIES.map(c => `<option value="${c.id}" ${c.id === selCat ? 'selected' : ''}>${c.label}</option>`).join('');
  document.getElementById('txn-account').innerHTML  = accounts.map(a => `<option value="${a.name}" ${a.name === selAcc ? 'selected' : ''}>${a.name}</option>`).join('');
}

function setType(type) {
  txnType = type;
  document.getElementById('toggle-out').className = 'toggle-btn' + (type === 'out' ? ' active-out' : '');
  document.getElementById('toggle-in').className  = 'toggle-btn' + (type === 'in'  ? ' active-in'  : '');
}

async function saveTransaction() {
  const date     = document.getElementById('txn-date').value;
  const amount   = parseFloat(document.getElementById('txn-amount').value);
  const payee    = document.getElementById('txn-payee').value.trim();
  const category = document.getElementById('txn-category').value;
  const account  = document.getElementById('txn-account').value;
  const notes    = document.getElementById('txn-notes').value.trim();
  if (!date || isNaN(amount) || amount <= 0 || !payee) { showToast('Please fill in date, amount, and payee.', 'error'); return; }
  const data = { date, amount, payee, category, account, type: txnType, notes };
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
}

async function deleteTxn(id) {
  if (!confirm('Delete this transaction?')) return;
  await deleteDoc(doc(db, 'users', currentUser.uid, 'transactions', id));
  transactions = transactions.filter(t => t.id !== id);
  showToast('Transaction deleted');
  renderDashboard();
  if (document.getElementById('page-transactions').classList.contains('active')) renderTransactions();
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
  const groups = {};
  accounts.forEach(a => { if (!groups[a.group]) groups[a.group] = []; groups[a.group].push(a); });
  const groupOrder = ['liquid','registered','loc','credit-card','other-asset','other-liability'];
  if (accounts.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-building-bank"></i><p>No accounts yet. Run the seed file locally to populate your accounts, or add them manually.</p></div>`;
    return;
  }
  el.innerHTML = groupOrder.filter(g => groups[g]).map(g => `
    <div class="account-group">
      <div class="account-group-title">${GROUP_LABELS[g]}</div>
      ${groups[g].map(a => accountRowHTML(a)).join('')}
    </div>`).join('');
}

function accountRowHTML(a) {
  const balClass = a.isLiability ? 'liability' : (a.balance === 0 ? 'neutral' : 'asset');
  const balStr   = a.isLiability ? `-${fmt(a.balance)}` : fmt(a.balance);
  return `<div class="account-row">
    <div class="account-left">
      <div class="account-name">${a.name}</div>
      <div class="account-type">${a.type.toUpperCase()}${a.rate ? ' · ' + a.rate : ''}${a.notes ? ' · ' + a.notes : ''}</div>
    </div>
    <div class="account-right">
      <div class="account-bal ${balClass}">${balStr}</div>
      <button class="icon-btn" onclick="openEditBalance('${a.id}')" title="Update balance"><i class="ti ti-pencil"></i></button>
      <button class="icon-btn danger" onclick="deleteAccount('${a.id}')" title="Delete"><i class="ti ti-trash"></i></button>
    </div>
  </div>`;
}

function openAddAccount() {
  document.getElementById('account-modal-title').textContent = 'Add account';
  document.getElementById('acc-save-btn').textContent        = 'Add account';
  ['acc-name','acc-balance','acc-rate','acc-notes'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('account-modal').style.display = 'flex';
}

async function saveAccount() {
  const name  = document.getElementById('acc-name').value.trim();
  const type  = document.getElementById('acc-type').value;
  const group = document.getElementById('acc-group').value;
  const balance = parseFloat(document.getElementById('acc-balance').value) || 0;
  const rate  = document.getElementById('acc-rate').value.trim();
  const notes = document.getElementById('acc-notes').value.trim();
  const isLiability = ['loc','credit-card','other-liability'].includes(group);
  if (!name) { showToast('Please enter an account name.', 'error'); return; }
  const data = { name, type, group, balance, rate, notes, isLiability };
  const ref  = await addDoc(userCol('accounts'), data);
  accounts.push({ id: ref.id, ...data });
  document.getElementById('account-modal').style.display = 'none';
  showToast('Account added');
  renderAccounts();
}

function openEditBalance(id) {
  const acc = accounts.find(a => a.id === id);
  if (!acc) return;
  balanceAccId = id;
  document.getElementById('bal-account-name').textContent = acc.name;
  document.getElementById('bal-amount').value = acc.balance;
  document.getElementById('balance-modal').style.display = 'flex';
}

async function saveBalance() {
  const balance = parseFloat(document.getElementById('bal-amount').value);
  if (isNaN(balance) || balance < 0) { showToast('Please enter a valid balance.', 'error'); return; }
  await updateDoc(doc(db, 'users', currentUser.uid, 'accounts', balanceAccId), { balance });
  const acc = accounts.find(a => a.id === balanceAccId);
  if (acc) acc.balance = balance;
  document.getElementById('balance-modal').style.display = 'none';
  showToast('Balance updated');
  renderAccounts();
  renderDashboard();
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
  const assets      = accounts.filter(a => !a.isLiability).reduce((s, a) => s + a.balance, 0);
  const liabilities = accounts.filter(a =>  a.isLiability).reduce((s, a) => s + a.balance, 0);
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
          <span style="font-weight:500;color:${a.isLiability ? 'var(--red-400)' : 'var(--teal-400)'};">${a.isLiability ? '-' : ''}${fmt(a.balance)}</span>
        </div>`).join('')}
      </div>`).join('');
  }

  document.getElementById('nw-assets-list').innerHTML      = groupedList(accounts.filter(a => !a.isLiability), ['liquid','registered','other-asset']);
  document.getElementById('nw-liabilities-list').innerHTML = groupedList(accounts.filter(a =>  a.isLiability), ['loc','credit-card','other-liability']);
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
  let count = 0;
  for (const row of rows) {
    if (!row.date || !row.payee || !row.amount) continue;
    const data = {
      date:     row.date,
      payee:    row.payee,
      category: row.category || 'other',
      type:     row.type     || 'out',
      amount:   parseFloat(row.amount) || 0,
      account:  row.account  || '',
      notes:    row.notes    || ''
    };
    const ref = await addDoc(userCol('transactions'), data);
    transactions.unshift({ id: ref.id, ...data });
    count++;
  }
  transactions.sort((a, b) => b.date.localeCompare(a.date));
  event.target.value = '';
  showToast(`${count} transactions imported`);
  renderTransactions();
  renderDashboard();
}

// ── Modal helpers ──────────────────────────────────────────────────────────
function closeModal(event, id) {
  if (event.target.classList.contains('modal-overlay')) document.getElementById(id).style.display = 'none';
}

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
window.openEditBalance    = openEditBalance;
window.saveBalance        = saveBalance;
window.deleteAccount      = deleteAccount;
window.saveBudgets        = saveBudgets;
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

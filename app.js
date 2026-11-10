const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = n => INR.format(n);

// Exact Supabase Client Initialization on window
const SUPABASE_URL = "https://srewazpfpwmmooaitdyv.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_q9IMaTaNz3KODiPgjEUhkg_d4eDWA99";
window.sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const sbClient = window.sbClient;

// Dynamic Multi-Tenant Context
let currentSessionUser = null;
let currentSchoolId = null;
let currentProfile = null;
let CURRENT_USER = "Financial Admin";

let ledgers = [];
let subLedgers = [];
let vouchers = [];
let auditLogs = [];
let nextVchCounter = 101;

let ledgerMap = new Map();
let ledgerOptionsCache = '';
let currentBalancesMap = {};

let voucherDraftRows = [
  { ledgerId: '', dr: 0, cr: 0, remark: '' },
  { ledgerId: '', dr: 0, cr: 0, remark: '' }
];

let editingVoucherId = null;
let currentSortColumn = 'name';
let sortAscending = true;

// INIT
window.addEventListener('DOMContentLoaded', () => {
  checkAuthSession();
});

// 1. AUTH LOGIN HANDLER
async function handleAuthLogin(e) {
  e.preventDefault();

  const emailInput = document.getElementById('authEmailInput');
  const passwordInput = document.getElementById('authPasswordInput');
  const btn = document.getElementById('authLoginBtn');
  const errMsg = document.getElementById('authErrorMsg');

  const email = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;

  if (errMsg) errMsg.classList.add('hidden');
  btn.disabled = true;
  btn.innerText = "Signing in...";

  try {
    const { data, error } = await sbClient.auth.signInWithPassword({
      email: email,
      password: password
    });

    if (error) throw error;
    if (!data || !data.session) throw new Error("Unable to establish session. Please check credentials.");

    await checkAuthSession();
  } catch (err) {
    console.error("Login process failed:", err);
    btn.disabled = false;
    btn.innerText = "Login & Load Accounts";
    
    if (errMsg) {
      errMsg.innerText = err.message || "Invalid email or password.";
      errMsg.classList.remove('hidden');
    } else {
      alert("Login Error: " + (err.message || "Invalid credentials"));
    }
  }
}

// 2. AUTH CHECK ON LOAD / AFTER LOGIN
async function checkAuthSession() {
  const { data: { session }, error } = await sbClient.auth.getSession();

  if (!session) {
    document.getElementById('authModal').classList.remove('hidden');
    const statusText = document.getElementById('sidebarStatusText');
    if (statusText) statusText.innerText = "Not Authenticated";
    return;
  }

  currentSessionUser = session.user;

  const { data: profileData, error: profErr } = await sbClient
    .from('profiles')
    .select('*, schools(*)')
    .eq('id', session.user.id)
    .maybeSingle();

  if (profErr) {
    console.error("Profile fetch error:", profErr.message);
    showToast("Error loading profile: " + profErr.message, true);
    return;
  }

  if (!profileData || !profileData.schools) {
    console.warn("No profile or school linked for UID:", session.user.id);
    document.getElementById('authModal').classList.remove('hidden');
    const statusText = document.getElementById('sidebarStatusText');
    if (statusText) statusText.innerText = "Profile Incomplete";
    showToast("Account not linked to any school. Please contact Admin.", true);
    return;
  }

  currentProfile = profileData;
  currentSchoolId = profileData.school_id;
  CURRENT_USER = profileData.full_name || "Financial Admin";

  // Super Admin UI Check
  const superAdminNav = document.getElementById('superAdminNavBlock');
  if (superAdminNav) {
    if (currentProfile.role === 'super_admin' || currentProfile.is_super_admin === true) {
      superAdminNav.classList.remove('hidden');
    } else {
      superAdminNav.classList.add('hidden');
    }
  }

  // UI updates
  const topSchoolHeading = document.getElementById('topSchoolHeading');
  const topSchoolSubheading = document.getElementById('topSchoolSubheading');
  const topSchoolDropdownOpt = document.getElementById('topSchoolDropdownOpt');
  const currentOperatorName = document.getElementById('currentOperatorName');
  const currentOperatorRole = document.getElementById('currentOperatorRole');
  const currentOperatorAvatar = document.getElementById('currentOperatorAvatar');
  const slipPreparedBy = document.getElementById('slipPreparedBy');
  const sidebarStatusText = document.getElementById('sidebarStatusText');

  if (topSchoolHeading) topSchoolHeading.innerText = profileData.schools.name;
  if (topSchoolSubheading) topSchoolSubheading.innerText = `${profileData.schools.city || ''} ${profileData.schools.state || ''}`;
  if (topSchoolDropdownOpt) topSchoolDropdownOpt.innerText = profileData.schools.name;
  if (currentOperatorName) currentOperatorName.innerText = profileData.full_name;
  if (currentOperatorRole) currentOperatorRole.innerText = (profileData.role || 'accountant').toUpperCase();
  if (currentOperatorAvatar) currentOperatorAvatar.innerText = profileData.full_name ? profileData.full_name.split(' ').map(n => n[0]).join('').slice(0, 2) : "AJ";
  if (slipPreparedBy) slipPreparedBy.innerText = profileData.full_name;
  if (sidebarStatusText) sidebarStatusText.innerText = "Live Synced";

  document.getElementById('authModal').classList.add('hidden');
  showToast(`Welcome ${profileData.full_name}! Loaded ${profileData.schools.name}`);

  await syncSchoolDataFromCloud();
}

// 3. MASTER ONBOARDING MODAL FUNCTIONS
function openMasterOnboardingModal() {
  document.getElementById('masterSchoolModal').classList.remove('hidden');
}

function closeMasterOnboardingModal() {
  document.getElementById('masterSchoolModal').classList.add('hidden');
}

async function handleMasterSchoolProvisioning(e) {
  e.preventDefault();
  
  const schoolName = document.getElementById('mSchoolName').value.trim();
  const city = document.getElementById('mSchoolCity').value.trim() || 'Varanasi';
  const accountantName = document.getElementById('mAccountantName').value.trim();
  const email = document.getElementById('mAccountantEmail').value.trim();
  const password = document.getElementById('mAccountantPassword').value;

  const btn = document.getElementById('btnMasterProvision');
  btn.disabled = true;
  btn.innerText = "Provisioning via Database...";

  try {
    const { data, error } = await sbClient.rpc('master_provision_school', {
      p_school_name: schoolName,
      p_school_city: city,
      p_accountant_name: accountantName,
      p_user_email: email,
      p_user_password: password
    });

    if (error) throw new Error(error.message);

    alert(`✅ School & User Onboarded Successfully!\n\nSchool: ${schoolName}\nEmail: ${email}\nPassword: ${password}\n\nClient can now log in with these credentials.`);
    
    closeMasterOnboardingModal();
    document.getElementById('mSchoolName').value = '';
    document.getElementById('mAccountantName').value = '';
    document.getElementById('mAccountantEmail').value = '';

  } catch (err) {
    alert("Provisioning Error: " + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = "Provision School & Generate Credentials";
  }
}

// 4. LOGOUT
async function handleAuthLogout() {
  if (!confirm("Are you sure you want to log out of this school session?")) return;
  await sbClient.auth.signOut();
  window.location.reload();
}

// 5. CLOUD SYNC
async function syncSchoolDataFromCloud() {
  showToast("Fetching school accounts from cloud...");

  const { data: cloudLedgers, error: lErr } = await sbClient
    .from('ledgers')
    .select('*');

  const { data: cloudVouchers, error: vErr } = await sbClient
    .from('vouchers')
    .select('*')
    .order('voucher_date', { ascending: false });

  if (cloudLedgers) {
    ledgers = cloudLedgers.map(l => ({
      id: l.id,
      name: l.name,
      group: l.account_group,
      incharge: l.incharge || 'ABC',
      opBal: parseFloat(l.op_bal) || 0,
      opType: l.op_type || 'Dr'
    }));
  }

  if (cloudVouchers) {
    vouchers = cloudVouchers.map(v => ({
      id: v.voucher_no,
      dbId: v.id,
      date: v.voucher_date,
      type: v.voucher_type,
      refMode: v.ref_mode || 'Cash',
      refNo: v.ref_no || '',
      narration: v.narration || '',
      rows: Array.isArray(v.rows) ? v.rows : []
    }));
    nextVchCounter = vouchers.length + 101;
  }

  buildLedgerIndex();
  calculateMasterBalances();
  renderLedgersTable();
  renderDayBookEntries();
  renderPassbookData();
  renderSelectedLedgerStatement();
  populateDropdownOptions();
  setupVoucherDraft();
}

function buildLedgerIndex() {
  ledgerMap.clear();
  let opts = '<option value="" disabled selected>-- Select Ledger --</option>';
  ledgers.forEach(l => {
    ledgerMap.set(l.id, l);
    opts += `<option value="${l.id}">${escapeHtml(l.name)} (${l.group})</option>`;
  });
  ledgerOptionsCache = opts;
}

function recordAuditLog(action, item, details) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const logEntry = {
    timestamp: `${dateStr} ${timeStr}`,
    action: action.toUpperCase(),
    item,
    user: CURRENT_USER,
    details
  };

  auditLogs.unshift(logEntry);
  renderAuditTrailLog();
}

function navigateTo(viewId, category, pageTitle) {
  const views = [
    'add-ledger', 'add-subledger', 'voucher-entry', 'day-book', 'passbook',
    'ledger-statement', 'trial-balance', 'income-expenditure', 'balance-sheet', 'audit-trail'
  ];

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
    const navBtn = document.getElementById(`navLink-${v}`);
    if (navBtn) {
      navBtn.classList.remove('bg-white/15', 'font-semibold', 'text-white');
      navBtn.classList.add('text-white/80');
    }
  });

  const target = document.getElementById(`view-${viewId}`);
  if (target) target.classList.remove('hidden');

  const activeNav = document.getElementById(`navLink-${viewId}`);
  if (activeNav) {
    activeNav.classList.add('bg-white/15', 'font-semibold', 'text-white');
    activeNav.classList.remove('text-white/80');
  }

  document.getElementById('breadcrumbCategory').innerText = category;
  document.getElementById('breadcrumbPage').innerText = pageTitle;

  calculateMasterBalances();
  if (viewId === 'day-book') renderDayBookEntries();
  if (viewId === 'passbook') renderPassbookData();
  if (viewId === 'ledger-statement') renderSelectedLedgerStatement();
  if (viewId === 'add-subledger') renderSubLedgersTable();
  if (viewId === 'audit-trail') renderAuditTrailLog();

  if (window.innerWidth < 768) {
    document.getElementById('mainSidebar').classList.add('-translate-x-full');
  }
}

function toggleAccordion(cId, aId) {
  const c = document.getElementById(cId);
  const a = document.getElementById(aId);
  const isHidden = c.classList.toggle('hidden');
  a.className = isHidden ? 'fa-solid fa-chevron-down text-[10px] text-white/50' : 'fa-solid fa-chevron-up text-[10px] text-amber-300';
}

function toggleSidebarCollapse() {
  document.getElementById('mainSidebar').classList.toggle('-translate-x-full');
}

function showToast(msg, isErr = false) {
  const t = document.getElementById('appToast');
  document.getElementById('toastMsg').innerText = msg;
  document.getElementById('toastIcon').className = isErr ? "fa-solid fa-circle-exclamation text-red-400" : "fa-solid fa-circle-check text-emerald-400";
  t.classList.remove('translate-y-24');
  setTimeout(() => t.classList.add('translate-y-24'), 3000);
}

// EXPORT UTILITIES
function downloadCsvFile(filename, csvContent) {
  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${filename}.csv`);
}

function exportPageToPdf(elementId, title) {
  const target = document.getElementById(elementId);
  if (!target) return;

  const printWin = window.open('', '_blank', 'width=900,height=700');
  const schoolName = currentProfile && currentProfile.schools ? currentProfile.schools.name : 'DEMO PUBLIC SCHOOL';
  const schoolLocation = currentProfile && currentProfile.schools ? `${currentProfile.schools.city}, ${currentProfile.schools.state}` : 'Varanasi, Uttar Pradesh';

  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${title} - ${schoolName}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; font-size: 11px; }
        h1 { margin: 0; font-size: 16px; color: #00407a; text-transform: uppercase; }
        h2 { margin: 4px 0 16px 0; font-size: 13px; color: #475569; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
        th { background-color: #f1f5f9; font-weight: bold; color: #0f172a; }
        .no-print, button, input { display: none !important; }
        .text-right { text-align: right; }
        .text-center { text-align: center; }
        .header { text-align: center; border-bottom: 2px solid #00407a; padding-bottom: 12px; margin-bottom: 16px; }
        .footer { margin-top: 24px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${schoolName}</h1>
        <h2>${schoolLocation} | ${title.replace(/_/g, ' ')} | Session: 2026-27</h2>
        <div style="font-size:10px; color:#64748b;">Printed on: ${new Date().toLocaleString('en-GB')} | Generated by: ${CURRENT_USER}</div>
      </div>
      <div>${target.outerHTML}</div>
      <div class="footer">
        <span>Official Financial Accounting Record</span>
        <span>Audited &amp; Verified</span>
      </div>
      <script>
        window.onload = function() { window.print(); setTimeout(() => window.close(), 500); }
      <\/script>
    </body>
    </html>
  `);
  printWin.document.close();
}

function exportLedgersToExcel() {
  let csv = "Account Group,Ledger Name,In-Charge,Opening Balance,Balance Type\n";
  ledgers.forEach(l => {
    csv += `"${l.group}","${l.name}","${l.incharge}","${l.opBal}","${l.opType}"\n`;
  });
  downloadCsvFile("Ledger_Master_List", csv);
}

function exportSubLedgersToExcel() {
  let csv = "SubLedger Code,SubLedger Name,Parent Ledger Account,Account Group\n";
  subLedgers.forEach(s => {
    const parent = ledgerMap.get(s.parentLedgerId) || { name: 'Unknown', group: 'N/A' };
    csv += `"${s.code}","${s.name}","${parent.name}","${parent.group}"\n`;
  });
  downloadCsvFile("SubLedger_Master_List", csv);
}

function exportDayBookToExcel() {
  let csv = "Date,Voucher No,Voucher Type,Debit Ledger,Credit Ledger,Amount (INR),Payment Mode,Instrument Ref,Narration\n";
  vouchers.forEach(v => {
    const drLedgers = v.rows.filter(r => r.dr > 0).map(r => (ledgerMap.get(r.ledgerId) || {}).name).join(" / ");
    const crLedgers = v.rows.filter(r => r.cr > 0).map(r => (ledgerMap.get(r.ledgerId) || {}).name).join(" / ");
    const total = v.rows.reduce((s, r) => s + r.dr, 0);
    csv += `"${v.date}","${v.id}","${v.type}","${drLedgers}","${crLedgers}","${total}","${v.refMode}","${v.refNo}","${v.narration}"\n`;
  });
  downloadCsvFile("Day_Book_Transactions", csv);
}

function exportPassbookToExcel() {
  const select = document.getElementById('passbookAccountSelect');
  const ledger = ledgerMap.get(select.value || 'L1');
  if (!ledger) return;

  let csv = `Passbook Statement - ${ledger.name} (${ledger.group})\n`;
  csv += "Date,Voucher No,Particulars,Debit / Deposit (INR),Credit / Withdrawal (INR),Running Balance (INR)\n";
  
  let running = (ledger.opType === 'Dr' ? ledger.opBal : -ledger.opBal);
  csv += `"2026-04-01","-","Opening Balance Brought Forward","${ledger.opType === 'Dr' ? ledger.opBal : 0}","${ledger.opType === 'Cr' ? ledger.opBal : 0}","${running}"\n`;

  for (let i = vouchers.length - 1; i >= 0; i--) {
    const v = vouchers[i];
    v.rows.forEach(r => {
      if (r.ledgerId === ledger.id) {
        running += (r.dr - r.cr);
        const opp = v.rows.find(x => x.ledgerId !== ledger.id);
        const oppName = opp && ledgerMap.get(opp.ledgerId) ? ledgerMap.get(opp.ledgerId).name : 'Multiple Ledgers';
        csv += `"${v.date}","${v.id}","${oppName} - ${v.narration}","${r.dr}","${r.cr}","${running}"\n`;
      }
    });
  }
  downloadCsvFile(`Passbook_${ledger.name.replace(/\s+/g, '_')}`, csv);
}

function exportLedgerStatementToExcel() {
  const select = document.getElementById('ledgerSelectStatement');
  const ledger = ledgerMap.get(select.value || 'L4');
  if (!ledger) return;

  let csv = `Ledger Statement - ${ledger.name} (${ledger.group})\n`;
  csv += "Date,Voucher No,Particulars,Debit (INR),Credit (INR),Running Balance (INR)\n";

  let running = (ledger.opType === 'Dr' ? ledger.opBal : -ledger.opBal);
  csv += `"2026-04-01","-","Opening Balance B/F","${ledger.opType === 'Dr' ? ledger.opBal : 0}","${ledger.opType === 'Cr' ? ledger.opBal : 0}","${running}"\n`;

  for (let i = vouchers.length - 1; i >= 0; i--) {
    const v = vouchers[i];
    v.rows.forEach(r => {
      if (r.ledgerId === ledger.id) {
        running += (r.dr - r.cr);
        const opp = v.rows.find(x => x.ledgerId !== ledger.id);
        const oppName = opp && ledgerMap.get(opp.ledgerId) ? ledgerMap.get(opp.ledgerId).name : 'Various';
        csv += `"${v.date}","${v.id}","${oppName} - ${v.narration}","${r.dr}","${r.cr}","${running}"\n`;
      }
    });
  }
  downloadCsvFile(`Statement_${ledger.name.replace(/\s+/g, '_')}`, csv);
}

function exportTrialBalanceToExcel() {
  let csv = "S.No.,Ledger Particulars,Account Group,Debit Balance (INR),Credit Balance (INR)\n";
  let grandDr = 0, grandCr = 0, sno = 1;

  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    const drAmt = net > 0 ? net : 0;
    const crAmt = net < 0 ? Math.abs(net) : 0;
    grandDr += drAmt;
    grandCr += crAmt;
    csv += `"${sno++}","${l.name}","${l.group}","${drAmt}","${crAmt}"\n`;
  });
  csv += `"","GRAND TOTAL","","${grandDr}","${grandCr}"\n`;
  downloadCsvFile("Trial_Balance_Report", csv);
}

function exportIncomeExpToExcel() {
  let csv = "Category,Account Particulars,Amount (INR)\n";
  let totalExp = 0, totalInc = 0;

  csv += "EXPENDITURE,,,\n";
  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    if (l.group === 'Indirect Expenses') {
      totalExp += net;
      csv += `"Expenditure","${l.name}","${net}"\n`;
    }
  });
  csv += `"Total Expenditure","","${totalExp}"\n\n`;

  csv += "INCOME,,,\n";
  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    if (['Direct Income', 'Indirect Income'].includes(l.group)) {
      const amt = Math.abs(net);
      totalInc += amt;
      csv += `"Income","${l.name}","${amt}"\n`;
    }
  });
  csv += `"Total Revenue Income","","${totalInc}"\n`;
  csv += `"Net Surplus / Deficit","","${totalInc - totalExp}"\n`;

  downloadCsvFile("Income_Expenditure_Account", csv);
}

function exportBalanceSheetToExcel() {
  let csv = "Side,Account Particulars,Account Group,Amount (INR)\n";
  let totalLiab = 0, totalAsset = 0;

  csv += "ASSETS,,,\n";
  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    if (['Fixed Assets', 'Current Assets', 'Bank Accounts', 'Cash-in-Hand'].includes(l.group)) {
      totalAsset += net;
      csv += `"Asset","${l.name}","${l.group}","${net}"\n`;
    }
  });
  csv += `"Total Assets","","","${totalAsset}"\n\n`;

  csv += "LIABILITIES & CORPUS FUND,,,\n";
  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    if (['Current Liabilities', 'Corpus / Capital Fund'].includes(l.group)) {
      const amt = Math.abs(net);
      totalLiab += amt;
      csv += `"Liability","${l.name}","${l.group}","${amt}"\n`;
    }
  });

  let totalExp = 0, totalInc = 0;
  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    if (l.group === 'Indirect Expenses') totalExp += net;
    else if (['Direct Income', 'Indirect Income'].includes(l.group)) totalInc += Math.abs(net);
  });
  const netSurplus = totalInc - totalExp;
  totalLiab += netSurplus;

  csv += `"Current Year Surplus","I&E Account","Surplus","${netSurplus}"\n`;
  csv += `"Total Liabilities & Fund","","","${totalLiab}"\n`;

  downloadCsvFile("Balance_Sheet_Report", csv);
}

function exportAuditTrailToExcel() {
  let csv = "Timestamp,Action,Voucher / Item,Performed By,Description & Financial Impact\n";
  auditLogs.forEach(log => {
    csv += `"${log.timestamp}","${log.action}","${log.item}","${log.user}","${log.details}"\n`;
  });
  downloadCsvFile("Audit_Trail_Changes_Log", csv);
}

// PRINT VOUCHER SLIP
function printVoucherSlip(voucherId) {
  const vch = vouchers.find(v => v.id === voucherId);
  if (!vch) return showToast('Voucher not found!', true);

  document.getElementById('slipVchNo').innerText = vch.id;
  document.getElementById('slipDate').innerText = vch.date;
  document.getElementById('slipPaymentMode').innerText = vch.refMode || 'Cash';
  document.getElementById('slipRefNo').innerText = vch.refNo || 'N/A';
  document.getElementById('slipNarration').innerText = vch.narration || 'Being financial transaction recorded.';
  document.getElementById('slipVoucherTypeHeading').innerText = `${vch.type.toUpperCase()} VOUCHER`;
  document.getElementById('slipPrintTime').innerText = new Date().toLocaleString('en-GB');

  const tbody = document.getElementById('slipRowsContainer');
  tbody.innerHTML = '';
  let sumDr = 0, sumCr = 0;

  vch.rows.forEach(r => {
    const l = ledgerMap.get(r.ledgerId) || { name: 'Account', group: '-' };
    sumDr += (r.dr || 0);
    sumCr += (r.cr || 0);

    const tr = document.createElement('tr');
    tr.className = "border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-2 px-3 text-center font-bold font-mono">
        <span class="px-1.5 py-0.5 rounded text-[10px] ${r.dr > 0 ? 'bg-blue-50 text-blue-800' : 'bg-amber-50 text-amber-800'}">
          ${r.dr > 0 ? 'Dr.' : 'To'}
        </span>
      </td>
      <td class="py-2 px-3">
        <span class="font-bold text-gray-800">${escapeHtml(l.name)}</span>
        <span class="block text-[10px] text-gray-400 font-mono">${escapeHtml(l.group)} ${r.remark ? ' | Note: ' + escapeHtml(r.remark) : ''}</span>
      </td>
      <td class="py-2 px-3 text-right font-mono font-semibold">${r.dr > 0 ? '₹' + fmt(r.dr) : '-'}</td>
      <td class="py-2 px-3 text-right font-mono font-semibold">${r.cr > 0 ? '₹' + fmt(r.cr) : '-'}</td>
    `;
    tbody.appendChild(tr);
  });

  document.getElementById('slipTotalDebit').innerText = `₹${fmt(sumDr)}`;
  document.getElementById('slipTotalCredit').innerText = `₹${fmt(sumCr)}`;

  document.getElementById('printVoucherModal').classList.remove('hidden');
}

function closePrintVoucherModal() {
  document.getElementById('printVoucherModal').classList.add('hidden');
}

// AUDIT LOG
function renderAuditTrailLog() {
  const tbody = document.getElementById('auditTrailTableBody');
  if (!tbody) return;
  const search = (document.getElementById('auditSearchInput').value || '').toLowerCase();
  tbody.innerHTML = '';

  const filtered = auditLogs.filter(log => {
    if (!search) return true;
    return log.item.toLowerCase().includes(search) ||
           log.action.toLowerCase().includes(search) ||
           log.user.toLowerCase().includes(search) ||
           log.details.toLowerCase().includes(search);
  });

  document.getElementById('auditCount').innerText = filtered.length;
  const frag = document.createDocumentFragment();

  filtered.forEach(log => {
    let badgeColor = 'bg-blue-100 text-blue-800';
    if (log.action === 'CREATE') badgeColor = 'bg-emerald-100 text-emerald-800';
    if (log.action === 'UPDATE') badgeColor = 'bg-amber-100 text-amber-800';
    if (log.action === 'DELETE') badgeColor = 'bg-rose-100 text-rose-800';

    const tr = document.createElement('tr');
    tr.className = "hover:bg-gray-50 border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-mono text-gray-600 whitespace-nowrap">${log.timestamp}</td>
      <td class="py-2.5 px-3 text-center">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold ${badgeColor}">${log.action}</span>
      </td>
      <td class="py-2.5 px-3 font-mono font-bold text-[#00407a]">${escapeHtml(log.item)}</td>
      <td class="py-2.5 px-3 font-semibold text-gray-800">${escapeHtml(log.user)}</td>
      <td class="py-2.5 px-3 text-gray-600">${escapeHtml(log.details)}</td>
    `;
    frag.appendChild(tr);
  });

  if (filtered.length === 0) tbody.innerHTML = '<tr><td colspan="5" class="py-6 text-center text-gray-400 italic">No audit records found.</td></tr>';
  else tbody.appendChild(frag);
}

function clearAuditTrail() {
  if (!confirm("Are you sure you want to clear older audit records?")) return;
  auditLogs = [];
  renderAuditTrailLog();
  showToast("Audit logs cleared.");
}

// VOUCHER TRANSACTION HANDLERS
function setupVoucherDraft() {
  editingVoucherId = null;
  document.getElementById('vchFormHeading').innerText = "Voucher Transaction";
  document.getElementById('vchFormSubtitle').innerText = "Double-entry accounting transaction form. Total Dr must equal Total Cr.";
  document.getElementById('vchEditModeBadge').classList.add('hidden');
  document.getElementById('btnSaveVoucherSubmit').innerText = "Save Voucher Transaction";

  document.getElementById('vchNumberInput').value = `VR-${nextVchCounter}`;
  document.getElementById('vchDateInput').value = new Date().toISOString().slice(0, 10);
  document.getElementById('vchInstrumentNo').value = '';
  document.getElementById('vchMainNarration').value = '';

  voucherDraftRows = [
    { ledgerId: '', dr: 0, cr: 0, remark: '' },
    { ledgerId: '', dr: 0, cr: 0, remark: '' }
  ];
  renderVoucherRowsDraft();
}

function editVoucherTransaction(voucherId) {
  const vch = vouchers.find(v => v.id === voucherId);
  if (!vch) return showToast('Voucher not found!', true);

  editingVoucherId = vch.id;
  navigateTo('voucher-entry', 'Financial Accounting', 'Voucher Transaction (Edit)');

  document.getElementById('vchFormHeading').innerText = "Edit Voucher Transaction";
  document.getElementById('vchFormSubtitle').innerText = "Make necessary corrections and click 'Update Voucher Transaction'.";
  document.getElementById('vchEditingId').innerText = vch.id;
  document.getElementById('vchEditModeBadge').classList.remove('hidden');
  document.getElementById('btnSaveVoucherSubmit').innerText = "Update Voucher Transaction";

  document.getElementById('vchNumberInput').value = vch.id;
  document.getElementById('vchDateInput').value = vch.date;
  document.getElementById('vchTypeSelect').value = vch.type;
  document.getElementById('vchPaymentMode').value = vch.refMode || 'Cash';
  document.getElementById('vchInstrumentNo').value = vch.refNo || '';
  document.getElementById('vchMainNarration').value = vch.narration || '';

  voucherDraftRows = vch.rows.map(r => ({
    ledgerId: r.ledgerId,
    dr: r.dr || 0,
    cr: r.cr || 0,
    remark: r.remark || ''
  }));

  renderVoucherRowsDraft();
  showToast(`Loaded ${vch.id} for correction.`);
}

function cancelVoucherEdit() {
  setupVoucherDraft();
  showToast('Edit mode canceled. Reset to new voucher.');
}

async function deleteVoucherTransaction(voucherId) {
  if (!confirm(`Are you sure you want to delete/cancel voucher ${voucherId}? This action will reverse cloud balances and be recorded in the audit trail.`)) {
    return;
  }

  const vch = vouchers.find(v => v.id === voucherId);
  const totalAmount = vch ? vch.rows.reduce((s, r) => s + r.dr, 0) : 0;

  if (vch && vch.dbId) {
    const { error } = await sbClient.from('vouchers').delete().eq('id', vch.dbId);
    if (error) return showToast("Cloud Delete Failed: " + error.message, true);
  }

  recordAuditLog('DELETE', voucherId, `Deleted ${vch ? vch.type : ''} voucher totaling ₹${fmt(totalAmount)} (Reversed in accounts)`);

  if (editingVoucherId === voucherId) {
    setupVoucherDraft();
  }

  await syncSchoolDataFromCloud();
  showToast(`Voucher ${voucherId} deleted and updated in cloud.`);
}

function onVoucherTypeChange() {
  const type = document.getElementById('vchTypeSelect').value;
  const mode = document.getElementById('vchPaymentMode');
  mode.value = type === 'Receipt' ? 'UPI / Online' : (type === 'Payment' ? 'Cheque' : (type === 'Contra' ? 'Cash' : 'Direct / NA'));
}

function getLedgerBalText(ledgerId) {
  const ledger = ledgerMap.get(ledgerId);
  if (!ledger) return '';
  const opText = `Opening: ₹${fmt(ledger.opBal)} ${ledger.opType}`;
  const curNet = currentBalancesMap[ledgerId] !== undefined ? currentBalancesMap[ledgerId] : (ledger.opType === 'Dr' ? ledger.opBal : -ledger.opBal);
  const curText = `Current: ₹${fmt(Math.abs(curNet))} ${curNet >= 0 ? 'Dr' : 'Cr'}`;

  return `
    <div class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
      <span class="inline-flex items-center px-2 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-semibold shadow-xs">
        <i class="fa-solid fa-clock-rotate-left mr-1 text-[10px] text-amber-600"></i> ${opText}
      </span>
      <span class="inline-flex items-center px-2 py-0.5 rounded bg-blue-50 text-blue-900 border border-blue-200 font-bold shadow-xs">
        <i class="fa-solid fa-wallet mr-1 text-[10px] text-blue-600"></i> ${curText}
      </span>
    </div>
  `;
}

function renderVoucherRowsDraft() {
  const container = document.getElementById('vchRowsContainer');
  container.innerHTML = '';
  const frag = document.createDocumentFragment();

  voucherDraftRows.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.id = `vch-row-${idx}`;
    tr.className = "hover:bg-gray-50 border-b border-gray-100";

    const balHtml = row.ledgerId ? getLedgerBalText(row.ledgerId) : '<div class="mt-0.5 text-[10px] text-gray-400 italic">Select a ledger to view Opening & Current balance</div>';

    tr.innerHTML = `
      <td class="py-2.5 px-3 text-center font-bold align-top">
        <span id="badge-dr-cr-${idx}" class="px-2 py-0.5 rounded text-[11px] ${row.dr > 0 ? 'bg-blue-100 text-blue-800' : (row.cr > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500')}">
          ${row.dr > 0 ? 'Dr' : (row.cr > 0 ? 'Cr' : (idx === 0 ? 'Dr' : 'Cr'))}
        </span>
      </td>
      <td class="py-2.5 px-3 align-top">
        <select onchange="onVoucherRowLedgerSelect(${idx}, this.value)" class="w-full text-xs border border-gray-300 rounded px-2.5 py-1.5 bg-white outline-none font-medium">
          ${ledgerOptionsCache}
        </select>
        <div id="badge-bal-container-${idx}">${balHtml}</div>
      </td>
      <td class="py-2.5 px-3 text-right align-top">
        <input type="number" step="0.01" min="0" value="${row.dr || ''}" placeholder="0.00"
          oninput="updateRowAmt(${idx}, 'dr', this.value)"
          class="w-full text-right text-xs border border-gray-300 rounded px-2.5 py-1.5 font-mono outline-none" />
      </td>
      <td class="py-2.5 px-3 text-right align-top">
        <input type="number" step="0.01" min="0" value="${row.cr || ''}" placeholder="0.00"
          oninput="updateRowAmt(${idx}, 'cr', this.value)"
          class="w-full text-right text-xs border border-gray-300 rounded px-2.5 py-1.5 font-mono outline-none" />
      </td>
      <td class="py-2.5 px-3 align-top">
        <input type="text" value="${escapeHtml(row.remark || '')}" placeholder="Line note"
          oninput="voucherDraftRows[${idx}].remark = this.value"
          class="w-full text-xs border border-gray-200 rounded px-2.5 py-1.5 outline-none" />
      </td>
      <td class="py-2.5 px-3 text-center align-top no-print">
        ${voucherDraftRows.length > 2 ? `
          <button onclick="removeVoucherRowItem(${idx})" class="text-gray-400 hover:text-red-500 pt-1">
            <i class="fa-solid fa-xmark text-sm"></i>
          </button>
        ` : `<span class="text-gray-300 pt-1 block">-</span>`}
      </td>
    `;

    if (row.ledgerId) {
      tr.querySelector('select').value = row.ledgerId;
    }
    frag.appendChild(tr);
  });

  container.appendChild(frag);
  validateVoucherCalculations();
}

function onVoucherRowLedgerSelect(idx, ledgerId) {
  voucherDraftRows[idx].ledgerId = ledgerId;
  const balContainer = document.getElementById(`badge-bal-container-${idx}`);
  if (balContainer) balContainer.innerHTML = getLedgerBalText(ledgerId);
  validateVoucherCalculations();
}

function updateRowAmt(idx, type, val) {
  const num = parseFloat(val) || 0;
  const row = voucherDraftRows[idx];
  const rowEl = document.getElementById(`vch-row-${idx}`);

  if (type === 'dr') {
    row.dr = num;
    if (num > 0) {
      row.cr = 0;
      if (rowEl) rowEl.querySelectorAll('input[type="number"]')[1].value = '';
    }
  } else {
    row.cr = num;
    if (num > 0) {
      row.dr = 0;
      if (rowEl) rowEl.querySelectorAll('input[type="number"]')[0].value = '';
    }
  }

  const badge = document.getElementById(`badge-dr-cr-${idx}`);
  if (badge) {
    badge.innerText = row.dr > 0 ? 'Dr' : (row.cr > 0 ? 'Cr' : (idx === 0 ? 'Dr' : 'Cr'));
    badge.className = `px-2 py-0.5 rounded text-[11px] ${row.dr > 0 ? 'bg-blue-100 text-blue-800' : (row.cr > 0 ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500')}`;
  }

  validateVoucherCalculations();
}

function addVoucherRowItem() {
  voucherDraftRows.push({ ledgerId: '', dr: 0, cr: 0, remark: '' });
  renderVoucherRowsDraft();
}

function removeVoucherRowItem(i) {
  if (voucherDraftRows.length <= 2) return;
  voucherDraftRows.splice(i, 1);
  renderVoucherRowsDraft();
}

function validateVoucherCalculations() {
  let sumDr = 0, sumCr = 0;
  let allValid = true;

  for (let i = 0; i < voucherDraftRows.length; i++) {
    const r = voucherDraftRows[i];
    sumDr += (r.dr || 0);
    sumCr += (r.cr || 0);
    if (!r.ledgerId || (r.dr === 0 && r.cr === 0)) allValid = false;
  }

  const diff = Math.abs(sumDr - sumCr);
  document.getElementById('vchSumDebit').innerText = `₹${fmt(sumDr)}`;
  document.getElementById('vchSumCredit').innerText = `₹${fmt(sumCr)}`;
  document.getElementById('vchSumDiff').innerText = `₹${fmt(diff)}`;

  const badge = document.getElementById('vchStatusBadge');
  const submitBtn = document.getElementById('btnSaveVoucherSubmit');

  if (sumDr > 0 && sumCr > 0 && diff < 0.01 && allValid) {
    badge.className = "px-3 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300";
    badge.innerHTML = '<i class="fa-solid fa-circle-check mr-1"></i> Balanced (Dr = Cr)';
    submitBtn.disabled = false;
    submitBtn.className = "bg-[#0062a3] hover:bg-[#004d80] text-white text-xs font-bold py-2.5 px-5 rounded shadow cursor-pointer transition";
  } else {
    badge.className = "px-3 py-1 rounded text-xs font-bold bg-red-100 text-red-800 border border-red-300";
    badge.innerHTML = diff > 0 ? `Unbalanced (Diff: ₹${diff.toFixed(2)})` : 'Incomplete Fields';
    submitBtn.disabled = true;
    submitBtn.className = "bg-gray-400 text-white text-xs font-bold py-2.5 px-5 rounded shadow cursor-not-allowed transition";
  }
}

async function submitVoucherEntry() {
  if (!currentSchoolId) return showToast("No active school session! Please login.", true);

  const vchNo = document.getElementById('vchNumberInput').value;
  const vchType = document.getElementById('vchTypeSelect').value;
  const totalAmount = voucherDraftRows.reduce((s, r) => s + (parseFloat(r.dr) || 0), 0);

  const payload = {
    school_id: currentSchoolId,
    voucher_no: vchNo,
    voucher_date: document.getElementById('vchDateInput').value,
    voucher_type: vchType,
    ref_mode: document.getElementById('vchPaymentMode').value,
    ref_no: document.getElementById('vchInstrumentNo').value.trim() || 'N/A',
    narration: document.getElementById('vchMainNarration').value.trim() || 'Voucher transaction',
    rows: voucherDraftRows.map(r => ({
      ledgerId: r.ledgerId,
      dr: parseFloat(r.dr) || 0,
      cr: parseFloat(r.cr) || 0,
      remark: r.remark || ''
    })),
    created_by: CURRENT_USER
  };

  const btn = document.getElementById('btnSaveVoucherSubmit');
  btn.disabled = true;
  btn.innerText = "Saving to Cloud...";

  if (editingVoucherId) {
    const existing = vouchers.find(v => v.id === editingVoucherId);
    if (existing && existing.dbId) {
      const { error } = await sbClient
        .from('vouchers')
        .update(payload)
        .eq('id', existing.dbId);

      if (error) {
        btn.disabled = false;
        btn.innerText = "Update Voucher Transaction";
        return showToast("Update Failed: " + error.message, true);
      }
      recordAuditLog('UPDATE', vchNo, `Updated ${vchType} Voucher totaling ₹${fmt(totalAmount)}`);
      showToast(`Voucher ${vchNo} updated in cloud!`);
    }
  } else {
    const { error } = await sbClient.from('vouchers').insert([payload]);
    if (error) {
      btn.disabled = false;
      btn.innerText = "Save Voucher Transaction";
      return showToast("Save Failed: " + error.message, true);
    }
    recordAuditLog('CREATE', vchNo, `Posted new ${vchType} Voucher totaling ₹${fmt(totalAmount)} via ${payload.ref_mode}`);
    showToast(`Voucher ${vchNo} synced to cloud!`);
  }

  await syncSchoolDataFromCloud();
}

// CLOUD ADD LEDGER
async function handleFormSubmitLedger(e) {
  e.preventDefault();
  if (!currentSchoolId) return showToast("No active school session! Please login.", true);

  const group = document.getElementById('inputLedgerGroup').value;
  const name = document.getElementById('inputLedgerName').value.trim();
  const incharge = document.getElementById('inputLedgerInCharge').value.trim() || 'ABC';
  const opBal = parseFloat(document.getElementById('inputLedgerOpBal').value) || 0;
  const opType = document.getElementById('inputLedgerBalType').value;

  if (!name || !group) return showToast('Please enter Ledger Name and Group!', true);
  if (ledgers.some(l => l.name.toLowerCase() === name.toLowerCase())) return showToast('Ledger already exists!', true);

  const btn = document.getElementById('btnSubmitLedger');
  btn.disabled = true;
  btn.innerText = "Adding...";

  const { data, error } = await sbClient.from('ledgers').insert([{
    school_id: currentSchoolId,
    name,
    account_group: group,
    incharge,
    op_bal: opBal,
    op_type: opType
  }]).select().single();

  btn.disabled = false;
  btn.innerText = "Click To Add";

  if (error) return showToast("Failed to save: " + error.message, true);

  recordAuditLog('CREATE', data.id, `Created Ledger "${name}" under Group "${group}" (Op. Bal ₹${fmt(opBal)} ${opType})`);
  document.getElementById('ledgerCreationForm').reset();
  document.getElementById('inputLedgerOpBal').value = '0';
  showToast(`Ledger "${name}" synced to cloud!`);

  await syncSchoolDataFromCloud();
}

function sortLedgers(col) {
  if (currentSortColumn === col) sortAscending = !sortAscending;
  else { currentSortColumn = col; sortAscending = true; }
  renderLedgersTable();
}

function renderLedgersTable() {
  const tbody = document.getElementById('ledgersTableBody');
  const search = (document.getElementById('ledgerSearchInput').value || '').toLowerCase();
  tbody.innerHTML = '';

  const list = ledgers.filter(l => 
    l.name.toLowerCase().includes(search) || 
    l.group.toLowerCase().includes(search) || 
    l.incharge.toLowerCase().includes(search)
  ).sort((a, b) => {
    let valA = a[currentSortColumn] ? a[currentSortColumn].toString().toLowerCase() : '';
    let valB = b[currentSortColumn] ? b[currentSortColumn].toString().toLowerCase() : '';
    return (valA < valB ? -1 : 1) * (sortAscending ? 1 : -1);
  });

  document.getElementById('ledgerFilteredCount').innerText = list.length;
  const frag = document.createDocumentFragment();

  list.forEach(l => {
    const isPnL = ['Direct Income', 'Indirect Income', 'Indirect Expenses'].includes(l.group);
    const tr = document.createElement('tr');
    tr.className = "hover:bg-amber-50/40 transition-colors";
    tr.innerHTML = `
      <td class="py-2.5 px-4 font-semibold text-gray-700">${escapeHtml(l.group)}</td>
      <td class="py-2.5 px-4 font-bold text-gray-900">${escapeHtml(l.name)}</td>
      <td class="py-2.5 px-4 text-gray-600">${escapeHtml(l.incharge)}</td>
      <td class="py-2.5 px-4 text-right font-mono text-gray-800">${l.opBal > 0 ? `₹${fmt(l.opBal)} <span class="font-bold text-[10px] text-gray-500">${l.opType}</span>` : '₹0.00'}</td>
      <td class="py-2.5 px-4 text-center"><span class="text-[10px] uppercase font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">${isPnL ? 'Income & Exp' : 'Balance Sheet'}</span></td>
      <td class="py-2.5 px-4 text-center no-print">
        <button onclick="editLedgerAction('${l.id}')" title="Edit" class="text-blue-600 hover:text-blue-800 mr-2"><i class="fa-regular fa-pen-to-square"></i></button>
        <button onclick="deleteLedgerAction('${l.id}')" title="Delete" class="text-gray-400 hover:text-red-600"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

async function deleteLedgerAction(id) {
  if (vouchers.some(v => v.rows.some(r => r.ledgerId === id))) return showToast('Cannot delete ledger used in vouchers!', true);
  const l = ledgerMap.get(id);

  const { error } = await sbClient.from('ledgers').delete().eq('id', id);
  if (error) return showToast("Cloud Delete Failed: " + error.message, true);

  if (l) recordAuditLog('DELETE', l.id, `Deleted Ledger Account "${l.name}"`);
  showToast('Ledger deleted from cloud.');
  await syncSchoolDataFromCloud();
}

function editLedgerAction(id) {
  const l = ledgerMap.get(id);
  if (!l) return;
  document.getElementById('inputLedgerName').value = l.name;
  document.getElementById('inputLedgerGroup').value = l.group;
  document.getElementById('inputLedgerInCharge').value = l.incharge;
  document.getElementById('inputLedgerOpBal').value = l.opBal;
  document.getElementById('inputLedgerBalType').value = l.opType;
  showToast(`Loaded ${l.name} for editing.`);
}

// SUBLEDGERS
function handleFormSubmitSubLedger(e) {
  e.preventDefault();
  const parentId = document.getElementById('inputSubParentLedger').value;
  const name = document.getElementById('inputSubLedgerName').value.trim();
  const code = document.getElementById('inputSubLedgerCode').value.trim() || `SUB-${subLedgers.length + 101}`;

  if (!parentId || !name) return showToast('Select Parent Ledger and Name!', true);

  subLedgers.push({ id: 'SL' + (Date.now() % 100000), code, name, parentLedgerId: parentId });
  renderSubLedgersTable();
  document.getElementById('subLedgerCreationForm').reset();
  showToast(`SubLedger "${name}" added!`);
}

function renderSubLedgersTable() {
  const tbody = document.getElementById('subLedgersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  const frag = document.createDocumentFragment();

  subLedgers.forEach(s => {
    const parent = ledgerMap.get(s.parentLedgerId) || { name: 'Unknown', group: 'N/A' };
    const tr = document.createElement('tr');
    tr.className = "hover:bg-gray-50 border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-2.5 px-4 font-mono font-bold text-[#00407a]">${escapeHtml(s.code)}</td>
      <td class="py-2.5 px-4 font-semibold text-gray-800">${escapeHtml(s.name)}</td>
      <td class="py-2.5 px-4 text-gray-700">${escapeHtml(parent.name)}</td>
      <td class="py-2.5 px-4 text-gray-500 font-semibold">${escapeHtml(parent.group)}</td>
      <td class="py-2.5 px-4 text-center no-print">
        <button onclick="deleteSubLedger('${s.id}')" title="Delete" class="text-gray-400 hover:text-red-600"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;
    frag.appendChild(tr);
  });
  tbody.appendChild(frag);
}

function deleteSubLedger(id) {
  subLedgers = subLedgers.filter(s => s.id !== id);
  renderSubLedgersTable();
  showToast('SubLedger deleted.');
}

// DAY BOOK RENDER
function renderDayBookEntries() {
  const tbody = document.getElementById('dayBookTableContent');
  if (!tbody) return;
  tbody.innerHTML = '';

  const filterType = document.getElementById('dayBookFilter') ? document.getElementById('dayBookFilter').value : 'ALL';
  const search = (document.getElementById('dayBookSearchInput') ? document.getElementById('dayBookSearchInput').value : '').toLowerCase();

  const filtered = vouchers.filter(v => {
    const matchesType = (filterType === 'ALL' || v.type === filterType);
    const matchesSearch = !search || v.id.toLowerCase().includes(search) || 
                          v.narration.toLowerCase().includes(search) ||
                          v.rows.some(r => {
                            const l = ledgerMap.get(r.ledgerId);
                            return l && l.name.toLowerCase().includes(search);
                          });
    return matchesType && matchesSearch;
  });

  const frag = document.createDocumentFragment();
  filtered.forEach(v => {
    const total = v.rows.reduce((sum, r) => sum + (r.dr || 0), 0);
    const drLedgers = v.rows.filter(r => r.dr > 0).map(r => (ledgerMap.get(r.ledgerId) || {}).name).join(', ');
    const crLedgers = v.rows.filter(r => r.cr > 0).map(r => (ledgerMap.get(r.ledgerId) || {}).name).join(', ');

    const tr = document.createElement('tr');
    tr.className = "hover:bg-gray-50 border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-2.5 px-3 font-mono">${v.date}</td>
      <td class="py-2.5 px-3 font-mono font-bold text-[#00407a]">${v.id}</td>
      <td class="py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-800">${v.type}</span></td>
      <td class="py-2.5 px-3"><div><span class="font-semibold text-gray-800">${escapeHtml(drLedgers || '-')}</span></div><div class="text-[10px] text-gray-400">To: ${escapeHtml(crLedgers || '-')}</div></td>
      <td class="py-2.5 px-3 text-right font-mono font-semibold">₹${fmt(total)}</td>
      <td class="py-2.5 px-3 text-right font-mono font-semibold">₹${fmt(total)}</td>
      <td class="py-2.5 px-3 text-gray-600 truncate max-w-xs">${escapeHtml(v.narration || '-')}</td>
      <td class="py-2.5 px-3 text-center no-print">
        <button onclick="printVoucherSlip('${v.id}')" class="text-gray-500 hover:text-blue-600 mr-2" title="Print"><i class="fa-solid fa-print"></i></button>
        <button onclick="editVoucherTransaction('${v.id}')" class="text-blue-600 hover:text-blue-800 mr-2" title="Edit"><i class="fa-regular fa-pen-to-square"></i></button>
        <button onclick="deleteVoucherTransaction('${v.id}')" class="text-gray-400 hover:text-red-600" title="Delete"><i class="fa-regular fa-trash-can"></i></button>
      </td>
    `;
    frag.appendChild(tr);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="py-6 text-center text-gray-400 italic">No vouchers found for selected filters.</td></tr>';
  } else {
    tbody.appendChild(frag);
  }
}

// REGISTERS RENDERING
function renderPassbookData() {
  const select = document.getElementById('passbookAccountSelect');
  const ledger = ledgerMap.get(select.value || (ledgers[0] ? ledgers[0].id : ''));
  if (!ledger) return;

  document.getElementById('passbookOpBal').innerText = `₹${fmt(ledger.opBal)} ${ledger.opType}`;
  const tbody = document.getElementById('passbookTableBody');
  tbody.innerHTML = '';

  let running = (ledger.opType === 'Dr' ? ledger.opBal : -ledger.opBal);
  let totalIn = 0;
  const frag = document.createDocumentFragment();

  const trOp = document.createElement('tr');
  trOp.className = "bg-gray-50 italic font-semibold text-gray-600";
  trOp.innerHTML = `
    <td class="py-2 px-3">2026-04-01</td>
    <td class="py-2 px-3">-</td>
    <td class="py-2 px-3">Opening Balance Brought Forward</td>
    <td class="py-2 px-3 text-right font-mono">${ledger.opType === 'Dr' ? '₹' + fmt(ledger.opBal) : '-'}</td>
    <td class="py-2 px-3 text-right font-mono">${ledger.opType === 'Cr' ? '₹' + fmt(ledger.opBal) : '-'}</td>
    <td class="py-2 px-3 text-right font-mono font-bold text-gray-800">₹${fmt(Math.abs(running))} ${running >= 0 ? 'Dr' : 'Cr'}</td>
  `;
  frag.appendChild(trOp);

  for (let i = vouchers.length - 1; i >= 0; i--) {
    const v = vouchers[i];
    for (let j = 0; j < v.rows.length; j++) {
      const r = v.rows[j];
      if (r.ledgerId === ledger.id) {
        running += (r.dr - r.cr);
        if (r.dr > 0) totalIn += r.dr;
        const opp = v.rows.find(x => x.ledgerId !== ledger.id);
        const oppLed = opp ? ledgerMap.get(opp.ledgerId) : null;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-blue-50/40 border-b border-gray-100";
        tr.innerHTML = `
          <td class="py-2 px-3 text-gray-600">${v.date}</td>
          <td class="py-2 px-3 font-mono text-[#00407a] font-bold">${v.id}</td>
          <td class="py-2 px-3">
            <span class="font-medium text-gray-900">${oppLed ? escapeHtml(oppLed.name) : 'Multiple Ledgers'}</span>
            <span class="block text-[10px] text-gray-400">${escapeHtml(v.narration)}</span>
          </td>
          <td class="py-2 px-3 text-right font-mono text-emerald-700 font-semibold">${r.dr > 0 ? '₹' + fmt(r.dr) : '-'}</td>
          <td class="py-2 px-3 text-right font-mono text-rose-700 font-semibold">${r.cr > 0 ? '₹' + fmt(r.cr) : '-'}</td>
          <td class="py-2 px-3 text-right font-mono font-bold text-gray-900">₹${fmt(Math.abs(running))} <span class="text-[10px] text-gray-500">${running >= 0 ? 'Dr' : 'Cr'}</span></td>
        `;
        frag.appendChild(tr);
      }
    }
  }

  tbody.appendChild(frag);
  document.getElementById('passbookTotalIn').innerText = `₹${fmt(totalIn)}`;
  document.getElementById('passbookClosingBal').innerText = `₹${fmt(Math.abs(running))} ${running >= 0 ? 'Dr' : 'Cr'}`;
}

function renderSelectedLedgerStatement() {
  const select = document.getElementById('ledgerSelectStatement');
  const ledger = ledgerMap.get(select.value || (ledgers[0] ? ledgers[0].id : ''));
  if (!ledger) return;

  document.getElementById('stmtLedgerName').innerText = ledger.name;
  document.getElementById('stmtLedgerGroup').innerText = ledger.group;
  document.getElementById('stmtOpeningBal').innerText = `₹${fmt(ledger.opBal)} ${ledger.opType}`;

  const tbody = document.getElementById('ledgerStatementTableBody');
  tbody.innerHTML = '';

  let running = (ledger.opType === 'Dr' ? ledger.opBal : -ledger.opBal);
  const frag = document.createDocumentFragment();

  const trOp = document.createElement('tr');
  trOp.className = "bg-gray-50 italic font-semibold text-gray-600";
  trOp.innerHTML = `
    <td class="py-2 px-3">2026-04-01</td>
    <td class="py-2 px-3">-</td>
    <td class="py-2 px-3">Opening Balance B/F</td>
    <td class="py-2 px-3 text-right font-mono">${ledger.opType === 'Dr' ? '₹' + fmt(ledger.opBal) : '-'}</td>
    <td class="py-2 px-3 text-right font-mono">${ledger.opType === 'Cr' ? '₹' + fmt(ledger.opBal) : '-'}</td>
    <td class="py-2 px-3 text-right font-mono font-bold text-gray-800">₹${fmt(Math.abs(running))} ${running >= 0 ? 'Dr' : 'Cr'}</td>
  `;
  frag.appendChild(trOp);

  for (let i = vouchers.length - 1; i >= 0; i--) {
    const v = vouchers[i];
    for (let j = 0; j < v.rows.length; j++) {
      const r = v.rows[j];
      if (r.ledgerId === ledger.id) {
        running += (r.dr - r.cr);
        const opp = v.rows.find(x => x.ledgerId !== ledger.id);
        const oppLed = opp ? ledgerMap.get(opp.ledgerId) : null;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-amber-50/40 border-b border-gray-100";
        tr.innerHTML = `
          <td class="py-2 px-3 text-gray-600">${v.date}</td>
          <td class="py-2 px-3 font-mono text-[#00407a] font-bold">${v.id}</td>
          <td class="py-2 px-3 font-medium text-gray-900">
            ${oppLed ? escapeHtml(oppLed.name) : 'Multiple Ledger Allocation'}
            <span class="block text-[10px] text-gray-400">${escapeHtml(v.narration)}</span>
          </td>
          <td class="py-2 px-3 text-right font-mono text-blue-700">${r.dr > 0 ? '₹' + fmt(r.dr) : '-'}</td>
          <td class="py-2 px-3 text-right font-mono text-amber-700">${r.cr > 0 ? '₹' + fmt(r.cr) : '-'}</td>
          <td class="py-2 px-3 text-right font-mono font-bold text-gray-900">₹${fmt(Math.abs(running))} <span class="text-[10px] text-gray-500">${running >= 0 ? 'Dr' : 'Cr'}</span></td>
        `;
        frag.appendChild(tr);
      }
    }
  }

  tbody.appendChild(frag);
  document.getElementById('stmtClosingBal').innerText = `₹${fmt(Math.abs(running))} ${running >= 0 ? 'Dr' : 'Cr'}`;
}

// AUDIT & FINANCIAL BALANCE ENGINE
function calculateMasterBalances() {
  currentBalancesMap = {};
  ledgers.forEach(l => {
    currentBalancesMap[l.id] = (l.opType === 'Dr' ? l.opBal : -l.opBal);
  });

  let todaySum = 0;
  const todayIso = new Date().toISOString().slice(0, 10);

  vouchers.forEach(v => {
    const isToday = (v.date === todayIso && v.type === 'Receipt');
    v.rows.forEach(r => {
      if (currentBalancesMap[r.ledgerId] !== undefined) {
        currentBalancesMap[r.ledgerId] += (r.dr - r.cr);
      }
      if (isToday) todaySum += r.dr;
    });
  });

  const cashObj = ledgers.find(l => l.group === 'Cash-in-Hand');
  const bankObj = ledgers.find(l => l.group === 'Bank Accounts');
  document.getElementById('quickCashDisplay').innerText = `Cash: ₹${fmt(cashObj ? currentBalancesMap[cashObj.id] : 0)}`;
  document.getElementById('quickBankDisplay').innerText = `Bank: ₹${fmt(bankObj ? currentBalancesMap[bankObj.id] : 0)}`;
  document.getElementById('todayCollectionAmount').innerText = `₹${fmt(todaySum)}`;

  renderTrialBalance();
  renderIncomeExpAndBS();
}

function renderTrialBalance() {
  const tbody = document.getElementById('trialBalanceTableBody');
  tbody.innerHTML = '';
  let grandDr = 0, grandCr = 0, sno = 1;
  const frag = document.createDocumentFragment();

  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    const drAmt = net > 0 ? net : 0;
    const crAmt = net < 0 ? Math.abs(net) : 0;
    grandDr += drAmt;
    grandCr += crAmt;

    const tr = document.createElement('tr');
    tr.className = "hover:bg-gray-50 border-b border-gray-100";
    tr.innerHTML = `
      <td class="py-2 px-4 text-gray-500 font-mono">${sno++}</td>
      <td class="py-2 px-4 font-semibold text-gray-900">${escapeHtml(l.name)}</td>
      <td class="py-2 px-4 text-gray-600">${escapeHtml(l.group)}</td>
      <td class="py-2 px-4 text-right font-mono text-gray-800">${drAmt > 0 ? '₹' + fmt(drAmt) : '-'}</td>
      <td class="py-2 px-4 text-right font-mono text-gray-800">${crAmt > 0 ? '₹' + fmt(crAmt) : '-'}</td>
    `;
    frag.appendChild(tr);
  });

  tbody.appendChild(frag);
  document.getElementById('tbGrandDebit').innerText = `₹${fmt(grandDr)}`;
  document.getElementById('tbGrandCredit').innerText = `₹${fmt(grandCr)}`;

  const badge = document.getElementById('trialBalBadge');
  const isBalanced = Math.abs(grandDr - grandCr) < 0.01;
  badge.className = `px-3 py-1 rounded text-xs font-bold border ${isBalanced ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'}`;
  badge.innerHTML = isBalanced ? '<i class="fa-solid fa-circle-check mr-1"></i> Books Perfectly Balanced' : `<i class="fa-solid fa-circle-exclamation mr-1"></i> Mismatch: ₹${fmt(Math.abs(grandDr - grandCr))}`;
}

function renderIncomeExpAndBS() {
  const expList = document.getElementById('incExpExpList');
  const incList = document.getElementById('incExpIncList');
  const liabList = document.getElementById('bsLiabList');
  const assetList = document.getElementById('bsAssetList');

  expList.innerHTML = ''; incList.innerHTML = ''; liabList.innerHTML = ''; assetList.innerHTML = '';
  let totalExp = 0, totalInc = 0, totalLiab = 0, totalAsset = 0;

  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    if (l.group === 'Indirect Expenses') {
      totalExp += net;
      expList.innerHTML += `<div class="flex justify-between py-1 text-gray-700"><span>${escapeHtml(l.name)}</span><span class="font-mono font-semibold">₹${fmt(net)}</span></div>`;
    } else if (['Direct Income', 'Indirect Income'].includes(l.group)) {
      const amt = Math.abs(net);
      totalInc += amt;
      incList.innerHTML += `<div class="flex justify-between py-1 text-gray-700"><span>${escapeHtml(l.name)}</span><span class="font-mono font-semibold">₹${fmt(amt)}</span></div>`;
    }

    if (['Fixed Assets', 'Current Assets', 'Bank Accounts', 'Cash-in-Hand'].includes(l.group)) {
      totalAsset += net;
      assetList.innerHTML += `<div class="flex justify-between py-1 text-gray-700"><div><span class="font-medium">${escapeHtml(l.name)}</span><span class="text-[10px] text-gray-400 block">${l.group}</span></div><span class="font-mono font-semibold">₹${fmt(net)}</span></div>`;
    } else if (['Current Liabilities', 'Corpus / Capital Fund'].includes(l.group)) {
      const amt = Math.abs(net);
      totalLiab += amt;
      liabList.innerHTML += `<div class="flex justify-between py-1 text-gray-700"><div><span class="font-medium">${escapeHtml(l.name)}</span><span class="text-[10px] text-gray-400 block">${l.group}</span></div><span class="font-mono font-semibold">₹${fmt(amt)}</span></div>`;
    }
  });

  document.getElementById('incExpTotalExpDisplay').innerText = `₹${fmt(totalExp)}`;
  document.getElementById('incExpTotalIncDisplay').innerText = `₹${fmt(totalInc)}`;

  const netSurplus = totalInc - totalExp;
  const surplusBadge = document.getElementById('pnlSurplusBadge');
  surplusBadge.className = `px-3 py-1 rounded text-xs font-bold border ${netSurplus >= 0 ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'}`;
  surplusBadge.innerText = `${netSurplus >= 0 ? 'Net Surplus' : 'Net Deficit'}: ₹${fmt(Math.abs(netSurplus))}`;

  totalLiab += netSurplus;
  liabList.innerHTML += `
    <div class="flex justify-between py-1 text-blue-900 bg-blue-50 p-1.5 rounded font-semibold mt-2">
      <span>Add: Current Year Surplus</span>
      <span class="font-mono">₹${fmt(netSurplus)}</span>
    </div>
  `;

  document.getElementById('bsTotalLiabDisplay').innerText = `₹${fmt(totalLiab)}`;
  document.getElementById('bsTotalAssetDisplay').innerText = `₹${fmt(totalAsset)}`;

  const bsBadge = document.getElementById('bsMatchBadge');
  const isMatched = Math.abs(totalLiab - totalAsset) < 1.0;
  bsBadge.className = `px-3 py-1 rounded text-xs font-bold border ${isMatched ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-rose-100 text-rose-800 border-rose-300'}`;
  bsBadge.innerHTML = isMatched ? '<i class="fa-solid fa-circle-check mr-1"></i> Balance Sheet Matched' : `<i class="fa-solid fa-circle-exclamation mr-1"></i> Diff: ₹${fmt(Math.abs(totalLiab - totalAsset))}`;
}

function populateDropdownOptions() {
  const subParentSelect = document.getElementById('inputSubParentLedger');
  if (subParentSelect) {
    subParentSelect.innerHTML = '<option value="" disabled selected>-- Select Parent Ledger --</option>';
    ledgers.forEach(l => {
      subParentSelect.innerHTML += `<option value="${l.id}">${escapeHtml(l.name)} (${l.group})</option>`;
    });
  }

  const pSelect = document.getElementById('passbookAccountSelect');
  pSelect.innerHTML = '';
  ledgers.filter(l => ['Bank Accounts', 'Cash-in-Hand'].includes(l.group)).forEach(l => {
    pSelect.innerHTML += `<option value="${l.id}">${escapeHtml(l.name)} (${l.group})</option>`;
  });

  const sSelect = document.getElementById('ledgerSelectStatement');
  sSelect.innerHTML = '';
  ledgers.forEach(l => {
    sSelect.innerHTML += `<option value="${l.id}">${escapeHtml(l.name)} (${l.group})</option>`;
  });
}

function showTodaySummaryModal() {
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayVouchers = vouchers.filter(v => v.date === todayIso && v.type === 'Receipt');
  const todaySum = todayVouchers.reduce((acc, v) => acc + v.rows.reduce((s, r) => s + r.dr, 0), 0);
  showToast(`Today's Collection: ₹${fmt(todaySum)} across ${todayVouchers.length} vouchers.`);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// --- DOM HELPERS & FORMATTERS ---
const $ = id => document.getElementById(id);
const val = id => ($(id) ? $(id).value.trim() : '');
const INR = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = n => INR.format(n || 0);
const escapeHtml = s => String(s || '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));

// --- SUPABASE CONFIG ---
window.sbClient = window.supabase.createClient(
  "https://srewazpfpwmmooaitdyv.supabase.co",
  "sb_publishable_q9IMaTaNz3KODiPgjEUhkg_d4eDWA99"
);
const sbClient = window.sbClient;

// --- STATE ---
let currentSessionUser = null, currentSchoolId = null, currentProfile = null, CURRENT_USER = "Financial Admin";
let ledgers = [], subLedgers = [], vouchers = [], auditLogs = [], ledgerMap = new Map(), currentBalancesMap = {}, nextVchCounter = 101;
let voucherDraftRows = [{ ledgerId: '', dr: 0, cr: 0, remark: '' }, { ledgerId: '', dr: 0, cr: 0, remark: '' }];
let editingVoucherId = null;

window.addEventListener('DOMContentLoaded', checkAuthSession);

// --- AUTHENTICATION & SESSION ---
async function handleAuthLogin(e) {
  e.preventDefault();
  const btn = $('authLoginBtn'), errMsg = $('authErrorMsg');
  btn.disabled = true; btn.innerText = "Signing in...";
  if (errMsg) errMsg.classList.add('hidden');

  const { error } = await sbClient.auth.signInWithPassword({ email: val('authEmailInput').toLowerCase(), password: val('authPasswordInput') });
  if (error) {
    btn.disabled = false; btn.innerText = "Login & Load Accounts";
    if (errMsg) { errMsg.innerText = error.message; errMsg.classList.remove('hidden'); }
    return;
  }
  await checkAuthSession();
}

async function checkAuthSession() {
  const { data: { session } } = await sbClient.auth.getSession();
  if (!session) return toggleModal('authModal', true);

  currentSessionUser = session.user;
  const { data: profile } = await sbClient.from('profiles').select('*, schools(*)').eq('id', session.user.id).maybeSingle();

  if (!profile || !profile.schools) return showToast("Account not linked to school.", true);

  currentProfile = profile; currentSchoolId = profile.school_id; CURRENT_USER = profile.full_name;

  if ($('superAdminNavBlock')) $('superAdminNavBlock').classList.toggle('hidden', !(profile.role === 'super_admin' || profile.is_super_admin));
  if ($('topSchoolHeading')) $('topSchoolHeading').innerText = profile.schools.name;
  if ($('topSchoolSubheading')) $('topSchoolSubheading').innerText = `${profile.schools.city || ''} ${profile.schools.state || ''}`;
  if ($('currentOperatorName')) $('currentOperatorName').innerText = profile.full_name;

  toggleModal('authModal', false);
  showToast(`Welcome ${profile.full_name}!`);
  await syncSchoolData();
}

async function handleAuthLogout() {
  if (confirm("Log out?")) { await sbClient.auth.signOut(); location.reload(); }
}

// --- MASTER ONBOARDING ---
async function handleMasterSchoolProvisioning(e) {
  e.preventDefault();
  const btn = $('btnMasterProvision'); btn.disabled = true; btn.innerText = "Provisioning...";

  const { error } = await sbClient.rpc('master_provision_school', {
    p_school_name: val('mSchoolName'), p_school_city: val('mSchoolCity') || 'Varanasi',
    p_accountant_name: val('mAccountantName'), p_user_email: val('mAccountantEmail'), p_user_password: val('mAccountantPassword')
  });

  btn.disabled = false; btn.innerText = "Provision School & Account";
  if (error) return alert("Failed: " + error.message);

  alert(`School & User created successfully!`);
  toggleModal('masterSchoolModal', false);
}

// --- DATA SYNC & BALANCE CALCULATION ---
async function syncSchoolData() {
  const [{ data: cLedgers }, { data: cVouchers }] = await Promise.all([
    sbClient.from('ledgers').select('*'),
    sbClient.from('vouchers').select('*').order('voucher_date', { ascending: false })
  ]);

  ledgers = (cLedgers || []).map(l => ({ id: l.id, name: l.name, group: l.account_group, incharge: l.incharge || 'ABC', opBal: parseFloat(l.op_bal) || 0, opType: l.op_type || 'Dr' }));
  vouchers = (cVouchers || []).map(v => ({ id: v.voucher_no, dbId: v.id, date: v.voucher_date, type: v.voucher_type, refMode: v.ref_mode || 'Cash', refNo: v.ref_no || '', narration: v.narration || '', rows: v.rows || [] }));
  nextVchCounter = vouchers.length + 101;

  ledgerMap.clear();
  let opts = '<option value="" disabled selected>-- Select Ledger --</option>';
  ledgers.forEach(l => { ledgerMap.set(l.id, l); opts += `<option value="${l.id}">${escapeHtml(l.name)} (${l.group})</option>`; });

  ['inputSubParentLedger', 'passbookAccountSelect', 'ledgerSelectStatement'].forEach(id => { if ($(id)) $(id).innerHTML = opts; });

  calcBalances();
  renderLedgersTable();
  renderDayBookEntries();
  renderPassbookData();
  renderSelectedLedgerStatement();
  setupVoucherDraft();
}

function calcBalances() {
  currentBalancesMap = {};
  ledgers.forEach(l => currentBalancesMap[l.id] = (l.opType === 'Dr' ? l.opBal : -l.opBal));
  
  let todaySum = 0, today = new Date().toISOString().slice(0, 10);
  vouchers.forEach(v => {
    v.rows.forEach(r => {
      if (currentBalancesMap[r.ledgerId] !== undefined) currentBalancesMap[r.ledgerId] += ((r.dr || 0) - (r.cr || 0));
      if (v.date === today && v.type === 'Receipt') todaySum += (r.dr || 0);
    });
  });

  const cash = ledgers.find(l => l.group === 'Cash-in-Hand'), bank = ledgers.find(l => l.group === 'Bank Accounts');
  if ($('quickCashDisplay')) $('quickCashDisplay').innerText = `Cash: ₹${fmt(cash ? currentBalancesMap[cash.id] : 0)}`;
  if ($('quickBankDisplay')) $('quickBankDisplay').innerText = `Bank: ₹${fmt(bank ? currentBalancesMap[bank.id] : 0)}`;
  if ($('todayCollectionAmount')) $('todayCollectionAmount').innerText = `₹${fmt(todaySum)}`;

  renderFinancialReports();
}

// --- FINANCIAL REPORTS (Trial Balance, PnL, Balance Sheet) ---
function renderFinancialReports() {
  let gDr = 0, gCr = 0, tExp = 0, tInc = 0, tAsset = 0, tLiab = 0, sno = 1;
  let tbHtml = '', expHtml = '', incHtml = '', assetHtml = '', liabHtml = '';

  ledgers.forEach(l => {
    const net = currentBalancesMap[l.id] || 0;
    const dr = net > 0 ? net : 0, cr = net < 0 ? Math.abs(net) : 0;
    gDr += dr; gCr += cr;
    tbHtml += `<tr><td class="p-2">${sno++}</td><td class="p-2 font-bold">${escapeHtml(l.name)}</td><td class="p-2">${l.group}</td><td class="p-2 text-right">₹${fmt(dr)}</td><td class="p-2 text-right">₹${fmt(cr)}</td></tr>`;

    if (l.group === 'Indirect Expenses') { tExp += net; expHtml += `<div class="flex justify-between py-1"><span>${l.name}</span><strong>₹${fmt(net)}</strong></div>`; }
    else if (['Direct Income', 'Indirect Income'].includes(l.group)) { const a = Math.abs(net); tInc += a; incHtml += `<div class="flex justify-between py-1"><span>${l.name}</span><strong>₹${fmt(a)}</strong></div>`; }

    if (['Fixed Assets', 'Current Assets', 'Bank Accounts', 'Cash-in-Hand'].includes(l.group)) { tAsset += net; assetHtml += `<div class="flex justify-between py-1"><span>${l.name}</span><strong>₹${fmt(net)}</strong></div>`; }
    else if (['Current Liabilities', 'Corpus / Capital Fund'].includes(l.group)) { const a = Math.abs(net); tLiab += a; liabHtml += `<div class="flex justify-between py-1"><span>${l.name}</span><strong>₹${fmt(a)}</strong></div>`; }
  });

  const surplus = tInc - tExp; tLiab += surplus;
  liabHtml += `<div class="flex justify-between py-1 font-bold text-blue-900 bg-blue-50 p-1"><span>Surplus:</span><span>₹${fmt(surplus)}</span></div>`;

  if ($('trialBalanceTableBody')) $('trialBalanceTableBody').innerHTML = tbHtml;
  if ($('tbGrandDebit')) $('tbGrandDebit').innerText = `₹${fmt(gDr)}`;
  if ($('tbGrandCredit')) $('tbGrandCredit').innerText = `₹${fmt(gCr)}`;
  if ($('incExpExpList')) $('incExpExpList').innerHTML = expHtml;
  if ($('incExpIncList')) $('incExpIncList').innerHTML = incHtml;
  if ($('incExpTotalExpDisplay')) $('incExpTotalExpDisplay').innerText = `₹${fmt(tExp)}`;
  if ($('incExpTotalIncDisplay')) $('incExpTotalIncDisplay').innerText = `₹${fmt(tInc)}`;
  if ($('bsAssetList')) $('bsAssetList').innerHTML = assetHtml;
  if ($('bsLiabList')) $('bsLiabList').innerHTML = liabHtml;
  if ($('bsTotalAssetDisplay')) $('bsTotalAssetDisplay').innerText = `₹${fmt(tAsset)}`;
  if ($('bsTotalLiabDisplay')) $('bsTotalLiabDisplay').innerText = `₹${fmt(tLiab)}`;
}

// --- VOUCHER TRANSACTIONS ---
function setupVoucherDraft() {
  editingVoucherId = null;
  $('vchNumberInput').value = `VR-${nextVchCounter}`;
  $('vchDateInput').value = new Date().toISOString().slice(0, 10);
  voucherDraftRows = [{ ledgerId: '', dr: 0, cr: 0 }, { ledgerId: '', dr: 0, cr: 0 }];
  renderVoucherRows();
}

function renderVoucherRows() {
  const container = $('vchRowsContainer'); container.innerHTML = '';
  let opts = '<option value="" disabled selected>-- Select Ledger --</option>';
  ledgers.forEach(l => opts += `<option value="${l.id}">${escapeHtml(l.name)}</option>`);

  voucherDraftRows.forEach((r, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-2 text-center font-bold text-xs">${r.dr > 0 ? 'Dr' : 'Cr'}</td>
      <td class="p-2"><select onchange="voucherDraftRows[${idx}].ledgerId=this.value;validateVoucher();" class="w-full border p-1 rounded">${opts}</select></td>
      <td class="p-2"><input type="number" step="0.01" value="${r.dr || ''}" placeholder="0.00" oninput="voucherDraftRows[${idx}].dr=parseFloat(this.value)||0;voucherDraftRows[${idx}].cr=0;validateVoucher();renderVoucherRows();" class="w-full border p-1 text-right"></td>
      <td class="p-2"><input type="number" step="0.01" value="${r.cr || ''}" placeholder="0.00" oninput="voucherDraftRows[${idx}].cr=parseFloat(this.value)||0;voucherDraftRows[${idx}].dr=0;validateVoucher();renderVoucherRows();" class="w-full border p-1 text-right"></td>
      <td class="p-2"><input type="text" value="${r.remark || ''}" oninput="voucherDraftRows[${idx}].remark=this.value" placeholder="Note" class="w-full border p-1"></td>
      <td class="p-2 text-center"><button onclick="if(voucherDraftRows.length>2){voucherDraftRows.splice(${idx},1);renderVoucherRows();}" class="text-red-500 font-bold">&times;</button></td>
    `;
    if (r.ledgerId) tr.querySelector('select').value = r.ledgerId;
    container.appendChild(tr);
  });
  validateVoucher();
}

function addVoucherRowItem() { voucherDraftRows.push({ ledgerId: '', dr: 0, cr: 0 }); renderVoucherRows(); }

function validateVoucher() {
  const sumDr = voucherDraftRows.reduce((s, r) => s + (r.dr || 0), 0);
  const sumCr = voucherDraftRows.reduce((s, r) => s + (r.cr || 0), 0);
  const diff = Math.abs(sumDr - sumCr);

  $('vchSumDebit').innerText = `₹${fmt(sumDr)}`;
  $('vchSumCredit').innerText = `₹${fmt(sumCr)}`;
  $('vchSumDiff').innerText = `₹${fmt(diff)}`;

  const ok = sumDr > 0 && diff < 0.01 && voucherDraftRows.every(r => r.ledgerId && (r.dr || r.cr));
  $('btnSaveVoucherSubmit').disabled = !ok;
  $('btnSaveVoucherSubmit').className = ok ? "bg-[#0062a3] hover:bg-[#004d80] text-white font-bold py-2.5 px-5 rounded cursor-pointer" : "bg-gray-400 text-white font-bold py-2.5 px-5 rounded cursor-not-allowed";
  $('vchStatusBadge').className = ok ? "px-3 py-1 rounded text-xs font-bold bg-emerald-100 text-emerald-800" : "px-3 py-1 rounded text-xs font-bold bg-amber-100 text-amber-800";
  $('vchStatusBadge').innerText = ok ? "Balanced" : "Incomplete";
}

async function submitVoucherEntry() {
  const payload = {
    school_id: currentSchoolId, voucher_no: val('vchNumberInput'), voucher_date: val('vchDateInput'),
    voucher_type: val('vchTypeSelect'), ref_mode: val('vchPaymentMode'), ref_no: val('vchInstrumentNo') || 'N/A',
    narration: val('vchMainNarration') || 'Transaction', rows: voucherDraftRows, created_by: CURRENT_USER
  };
  await sbClient.from('vouchers').insert([payload]);
  showToast("Voucher Saved!");
  await syncSchoolData();
}

// --- REGISTERS: DAY BOOK, PASSBOOK, STATEMENT ---
function renderDayBookEntries() {
  const tbody = $('dayBookTableContent'), search = val('dayBookSearchInput').toLowerCase();
  if (!tbody) return;
  tbody.innerHTML = vouchers.filter(v => !search || v.id.toLowerCase().includes(search) || v.narration.toLowerCase().includes(search)).map(v => `
    <tr class="border-b"><td class="p-2 font-mono">${v.date}</td><td class="p-2 font-bold text-[#00407a]">${v.id}</td><td class="p-2">${v.type}</td><td class="p-2">${v.rows.map(r => (ledgerMap.get(r.ledgerId) || {}).name).join(', ')}</td><td class="p-2 text-right">₹${fmt(v.rows.reduce((s,r)=>s+r.dr,0))}</td><td class="p-2 text-right">₹${fmt(v.rows.reduce((s,r)=>s+r.cr,0))}</td><td class="p-2 text-gray-500">${v.narration}</td><td class="p-2 text-center no-print"><button onclick="deleteVoucher('${v.dbId}')" class="text-red-500"><i class="fa-regular fa-trash-can"></i></button></td></tr>
  `).join('');
}

async function deleteVoucher(id) {
  if (confirm("Delete voucher?")) { await sbClient.from('vouchers').delete().eq('id', id); await syncSchoolData(); }
}

function renderPassbookData() {
  const id = val('passbookAccountSelect') || (ledgers[0] ? ledgers[0].id : ''), tbody = $('passbookTableBody');
  if (!tbody || !ledgerMap.has(id)) return;
  let running = ledgerMap.get(id).opBal;
  tbody.innerHTML = vouchers.filter(v => v.rows.some(r => r.ledgerId === id)).map(v => {
    const r = v.rows.find(x => x.ledgerId === id);
    running += ((r.dr || 0) - (r.cr || 0));
    return `<tr class="border-b"><td class="p-2">${v.date}</td><td class="p-2 font-bold">${v.id}</td><td class="p-2">${v.narration}</td><td class="p-2 text-right text-emerald-700 font-bold">₹${fmt(r.dr)}</td><td class="p-2 text-right text-rose-700 font-bold">₹${fmt(r.cr)}</td><td class="p-2 text-right font-mono">₹${fmt(running)}</td></tr>`;
  }).join('');
}

function renderSelectedLedgerStatement() { renderPassbookData(); }

// --- ADD LEDGER & SUBLEDGER ---
async function handleFormSubmitLedger(e) {
  e.preventDefault();
  await sbClient.from('ledgers').insert([{
    school_id: currentSchoolId, name: val('inputLedgerName'), account_group: val('inputLedgerGroup'),
    incharge: val('inputLedgerInCharge') || 'ABC', op_bal: parseFloat(val('inputLedgerOpBal')) || 0, op_type: val('inputLedgerBalType')
  }]);
  $('ledgerCreationForm').reset();
  showToast("Ledger Added!");
  await syncSchoolData();
}

function renderLedgersTable() {
  const tbody = $('ledgersTableBody'), search = val('ledgerSearchInput').toLowerCase();
  if (!tbody) return;
  const filtered = ledgers.filter(l => l.name.toLowerCase().includes(search) || l.group.toLowerCase().includes(search));
  $('ledgerFilteredCount').innerText = filtered.length;
  tbody.innerHTML = filtered.map(l => `
    <tr class="border-b"><td class="p-2.5">${l.group}</td><td class="p-2.5 font-bold">${l.name}</td><td class="p-2.5 text-gray-500">${l.incharge}</td><td class="p-2.5 text-right font-mono">₹${fmt(l.opBal)} ${l.opType}</td><td class="p-2.5 text-center"><span class="bg-gray-100 text-[10px] px-2 py-0.5 rounded font-bold">${l.group.includes('Income')||l.group.includes('Expenses')?'PnL':'Balance Sheet'}</span></td><td class="p-2.5 text-center no-print"><button onclick="deleteLedger('${l.id}')" class="text-red-500"><i class="fa-regular fa-trash-can"></i></button></td></tr>
  `).join('');
}

async function deleteLedger(id) {
  if (confirm("Delete ledger?")) { await sbClient.from('ledgers').delete().eq('id', id); await syncSchoolData(); }
}

function handleFormSubmitSubLedger(e) {
  e.preventDefault();
  subLedgers.push({ id: Date.now(), parentId: val('inputSubParentLedger'), name: val('inputSubLedgerName'), code: val('inputSubLedgerCode') || 'SUB' });
  $('subLedgersTableBody').innerHTML = subLedgers.map(s => `<tr class="border-b"><td class="p-2 font-mono">${s.code}</td><td class="p-2 font-bold">${s.name}</td><td class="p-2">${(ledgerMap.get(s.parentId)||{}).name}</td><td class="p-2 text-center no-print"><button onclick="this.closest('tr').remove()" class="text-red-500"><i class="fa-regular fa-trash-can"></i></button></td></tr>`).join('');
  $('subLedgerCreationForm').reset();
}

// --- ROUTING & MODAL UI HELPERS ---
function navigateTo(viewId, cat, title) {
  ['add-ledger','add-subledger','voucher-entry','day-book','passbook','ledger-statement','trial-balance','income-expenditure','balance-sheet','audit-trail'].forEach(v => {
    if ($(`view-${v}`)) $(`view-${v}`).classList.toggle('hidden', v !== viewId);
  });
  $('breadcrumbCategory').innerText = cat; $('breadcrumbPage').innerText = title;
}
function toggleModal(id, show) { if ($(id)) $(id).classList.toggle('hidden', !show); }
function toggleSidebar() { $('mainSidebar').classList.toggle('-translate-x-full'); }
function toggleAccordion(cId, aId) { $(cId).classList.toggle('hidden'); $(aId).classList.toggle('fa-chevron-down'); }
function showToast(msg, isErr=false) {
  $('toastMsg').innerText = msg; $('toastIcon').className = isErr ? "fa-solid fa-circle-exclamation text-red-400" : "fa-solid fa-circle-check text-emerald-400";
  $('appToast').classList.remove('translate-y-24'); setTimeout(() => $('appToast').classList.add('translate-y-24'), 3000);
}
function exportPageToPdf(id, title) { window.print(); }
function exportLedgersToExcel() { alert("Exporting master data..."); }
function showTodaySummaryModal() { alert($('todayCollectionAmount').innerText); }
function onVoucherTypeChange() { $('vchPaymentMode').value = val('vchTypeSelect') === 'Receipt' ? 'UPI / Online' : 'Cash'; }
function cancelVoucherEdit() { setupVoucherDraft(); }

(() => {
  'use strict';

  const STORAGE_KEY = 'recebimentos-semanais-v1';
  const DATA_VERSION = 20;
  const EARNING_APPS = ['Amazon Flex','Grubhub','Outros'];
  const EARNING_PEOPLE = ['Matheus','Esposa'];
  const FINANCE_DEFAULT_CATEGORIES = ['Gasolina','Mercado','Restaurante','Aluguel / Moradia','Contas','Compras','Transporte','Automóvel','Lazer','Saúde','Pets','Criança / Família','Assinaturas','Outros'];
  const FINANCE_DEFAULT_ACCOUNTS = ['Checking','Savings','Credit Card 1','Credit Card 2'];
  const FINANCE_RESPONSIBLES = { user1:'Usuário 1', user2:'Usuário 2', shared:'Compartilhado' };
  const DAYS = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const CLIENT_ALIASES = {
    PEDAMZ: ['PED AMZ','PEDRO AMZ','PEDDRO AMZ','PEDRO'],
    GRAZI: ['GRAZI','GRAZIELLE'],
    GABIGH: ['GAB GH','GABI GH','GABRIEL GH','GABRIEL'],
    IVOGH: ['IVO GH','IVO'],
    TIAGOGH: ['TIAGO GH','THIAGO GH','TIAGO','THIAGO'],
    JON2GH: ['JON2GH','JON 2 GH','JONATAS','JONATAS GH']
  };
  const $ = (id) => document.getElementById(id);
  let state = loadState();
  let toastTimer;
  let notificationTimer;
  let pushSyncTimer;
  let renderedDay = '';
  let payerSearchTerm = '';
  let financeFilter = { responsible:'all', period:'month' };

  function loadState() {
    try {
      return {
        payers: [], payments: {}, paymentHistory: [], earnings: [], earningsSettings: { weeklyGoal: 0, dailyGoal: 250 }, finance: defaultFinanceState(), auth: {}, settings: { notifications: false, pushSubscribed: false, lastNotificationDate: '' },
        ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
      };
    } catch {
      return { payers: [], payments: {}, paymentHistory: [], earnings: [], earningsSettings: { weeklyGoal: 0, dailyGoal: 250 }, finance: defaultFinanceState(), auth: {}, settings: { notifications: false, pushSubscribed: false, lastNotificationDate: '' } };
    }
  }

  function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); queuePushSnapshotSync(); }
  function exportBackup() {
    state.settings ||= {}; state.settings.lastBackupAt = new Date().toISOString(); saveState();
    const payload = { app: 'recebimentos-semanais', version: DATA_VERSION, exportedAt: new Date().toISOString(), data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `backup-recebimentos-${localDate()}.json`; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); showToast('Backup exportado com sucesso.'); renderBackupStatus();
  }
  function exportCsv() {
    const rows = [['Cliente','Status do cadastro','Data do pagamento','Vencimento','Valor recebido','Situação']];
    allVisiblePayers().forEach(payer => recordsFor(payer).filter(item => item.payment.status === 'paid').sort((a,b) => (a.payment.receivedDate || '').localeCompare(b.payment.receivedDate || '')).forEach(({ key,payment }) => {
      const due = payment.dueDate || localDate(dueDate(payer,parseLocalDate(key)));
      rows.push([payer.name,payer.active === false ? 'Inativo' : 'Ativo',payment.receivedDate || '',due,Number(payment.received) || 0,payment.paidLate ? 'Pago atrasado' : 'Pago em dia']);
    }));
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value).replace(/"/g,'""')}"`).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})); const link = document.createElement('a');
    link.href=url; link.download=`relatorio-recebimentos-${localDate()}.csv`; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000); showToast('Relatório CSV exportado.');
  }
  function mergeBackup(incoming) {
    const payerMap = new Map((state.payers || []).map(payer => [payer.id, payer]));
    (incoming.payers || []).forEach(payer => payerMap.set(payer.id, { ...(payerMap.get(payer.id) || {}), ...payer }));
    const payments = { ...(state.payments || {}) };
    Object.entries(incoming.payments || {}).forEach(([week, records]) => { payments[week] = { ...(payments[week] || {}), ...records }; });
    const historyMap = new Map((state.paymentHistory || []).map(record => [record.id, record]));
    (incoming.paymentHistory || []).forEach(record => historyMap.set(record.id, record));
    const earningMap = new Map((state.earnings || []).map(record => [record.id, record]));
    (incoming.earnings || []).forEach(record => earningMap.set(record.id, record));
    const currentFinance = state.finance || defaultFinanceState();
    const incomingFinance = incoming.finance || {};
    const financeTransactions = new Map((currentFinance.transactions || []).map(record => [record.id, record]));
    (incomingFinance.transactions || []).forEach(record => financeTransactions.set(record.id, record));
    const financeCategories = new Map((currentFinance.categories || []).map(record => [record.id, record]));
    (incomingFinance.categories || []).forEach(record => financeCategories.set(record.id, { ...(financeCategories.get(record.id) || {}), ...record }));
    const financeAccounts = new Map((currentFinance.accounts || []).map(record => [record.id, record]));
    (incomingFinance.accounts || []).forEach(record => financeAccounts.set(record.id, { ...(financeAccounts.get(record.id) || {}), ...record }));
    const financeBatches = new Map((currentFinance.importBatches || []).map(record => [record.id, record]));
    (incomingFinance.importBatches || []).forEach(record => financeBatches.set(record.id, record));
    const finance = { ...currentFinance, ...incomingFinance, transactions:[...financeTransactions.values()], categories:[...financeCategories.values()], accounts:[...financeAccounts.values()], importBatches:[...financeBatches.values()], settings:{ ...(currentFinance.settings || {}), ...(incomingFinance.settings || {}) } };
    state = { ...state, ...incoming, payers: [...payerMap.values()], payments, paymentHistory: [...historyMap.values()], earnings: [...earningMap.values()], finance, earningsSettings: { ...(state.earningsSettings || {}), ...(incoming.earningsSettings || {}) }, auth: { ...(state.auth || {}), ...(incoming.auth || {}) }, settings: { ...(state.settings || {}), ...(incoming.settings || {}) } };
  }
  async function importBackup(file) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()); const incoming = parsed?.data || parsed;
      if (!incoming || !Array.isArray(incoming.payers) || typeof incoming.payments !== 'object') throw new Error('Formato inválido');
      if (!confirm(`Importar o backup com ${incoming.payers.length} pagador(es)? Os dados atuais serão preservados e combinados.`)) return;
      mergeBackup(incoming); migrateState(); saveState(); renderAll(); showToast('Backup importado. Dados restaurados!');
    } catch (error) { console.error(error); alert('Este arquivo não é um backup válido do aplicativo.'); }
    finally { $('backupFileInput').value = ''; }
  }
  function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
  function localDate(date = new Date()) { const d = new Date(date); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
  function parseLocalDate(value) { if (!value) return null; const [y, m, d] = value.split('-').map(Number); return new Date(y, m - 1, d); }
  function startOfWeek(date = new Date()) { const d = new Date(date); d.setHours(0, 0, 0, 0); const offset = d.getDay() === 0 ? -6 : 1 - d.getDay(); d.setDate(d.getDate() + offset); return d; }
  function weekKey(date = new Date()) { return localDate(startOfWeek(date)); }
  function termsForWeek(payer, week = startOfWeek()) { const key = weekKey(week); const history = (payer.termsHistory || []).slice().sort((a,b) => a.effectiveWeek.localeCompare(b.effectiveWeek)); return history.filter(item => item.effectiveWeek <= key).pop() || history[0] || { amount:Number(payer.amount),day:Number(payer.day) }; }
  function amountForWeek(payer, week = startOfWeek()) { return Number(termsForWeek(payer,week).amount) || 0; }
  function dueDate(payer, week = startOfWeek()) { const start = startOfWeek(week); const day = Number(termsForWeek(payer,start).day); const d = new Date(start); const offset = day === 0 ? 6 : day - 1; d.setDate(d.getDate() + offset); return d; }
  function firstDueOnOrAfter(date, day) { const result = new Date(date); result.setHours(0, 0, 0, 0); result.setDate(result.getDate() + ((day - result.getDay() + 7) % 7)); return result; }
  function money(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0); }
  function dollars(value) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value) || 0); }
  function parseMoney(value) { return Number(String(value).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(?:\D|$))/g, '').replace(',', '.')); }
  function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c])); }
  function slugify(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `item-${uid()}`; }
  function formatShort(date) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(date); }
  function formatFull(date) { return new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).format(date); }
  function formatDate(value) { const date = parseLocalDate(value); return date ? new Intl.DateTimeFormat('pt-BR').format(date) : 'Nenhum registrado'; }
  function statusLabel(status) { return { paid: 'Pago', partial: 'Pago Parcial', unpaid: 'Não Pago' }[status] || 'Não Pago'; }
  function paymentFor(payerId, key = weekKey()) { const payer = state.payers.find(item => item.id === payerId); const imported = payer ? importedPaymentFor(payer,key) : null; if (imported?.status === 'paid') return imported; const explicit = payer ? relatedPayers(payer).map(item => state.payments[key]?.[item.id]).find(Boolean) : state.payments[key]?.[payerId]; return explicit || imported || { status: 'unpaid', received: 0, notes: '' }; }
  function showToast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2400); }
  function autoTheme() { const hour = new Date().getHours(); return hour >= 18 || hour < 6 ? 'dark' : 'light'; }
  function currentTheme() { const mode = state.settings?.themeMode || 'auto'; return mode === 'auto' ? autoTheme() : mode; }
  function applyTheme() {
    const mode = state.settings?.themeMode || 'auto';
    const theme = currentTheme();
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme === 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#080d0b' : '#173f35');
    document.querySelectorAll('[data-theme-set]').forEach(button => {
      const active = button.dataset.themeSet === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  function setThemeMode(mode) {
    if (!['auto','light','dark'].includes(mode)) return;
    state.settings ||= {};
    state.settings.themeMode = mode;
    saveState(); applyTheme();
    const label = mode === 'auto' ? `Automático (${currentTheme() === 'dark' ? 'escuro' : 'claro'} agora)` : (mode === 'dark' ? 'Escuro' : 'Claro');
    showToast(`Tema: ${label}.`);
  }
  function defaultFinanceState() {
    const now = new Date().toISOString();
    return {
      transactions: [],
      categories: FINANCE_DEFAULT_CATEGORIES.map(name => ({ id: slugify(name), name, archived:false, createdAt:now, updatedAt:now })),
      accounts: FINANCE_DEFAULT_ACCOUNTS.map(name => ({ id: slugify(name), name, archived:false, createdAt:now, updatedAt:now })),
      importBatches: [],
      settings: { user1Label:'Usuário 1', user2Label:'Usuário 2' }
    };
  }
  function ensureFinanceState() {
    let changed = false;
    const defaults = defaultFinanceState();
    if (!state.finance || typeof state.finance !== 'object') { state.finance = defaults; return true; }
    ['transactions','categories','accounts','importBatches'].forEach(key => { if (!Array.isArray(state.finance[key])) { state.finance[key] = defaults[key]; changed = true; } });
    state.finance.settings = { ...defaults.settings, ...(state.finance.settings || {}) };
    const addMissing = (key, items) => {
      const current = new Set((state.finance[key] || []).map(item => item.id));
      items.forEach(item => { if (!current.has(item.id)) { state.finance[key].push(item); changed = true; } });
    };
    addMissing('categories', defaults.categories);
    addMissing('accounts', defaults.accounts);
    state.finance.transactions.forEach(item => {
      if (!item.id) { item.id = uid(); changed = true; }
      if (!item.date) { item.date = localDate(); changed = true; }
      if (!['income','expense'].includes(item.type)) { item.type = 'expense'; changed = true; }
      item.amount = Math.abs(Number(item.amount) || 0);
      if (!['user1','user2','shared'].includes(item.responsible)) { item.responsible = 'user1'; changed = true; }
      if (!['pending','posted'].includes(item.status)) { item.status = 'posted'; changed = true; }
      if (!item.categoryId) { item.categoryId = state.finance.categories[0]?.id || 'outros'; changed = true; }
      if (!item.accountId) { item.accountId = state.finance.accounts[0]?.id || 'checking'; changed = true; }
      if (!item.createdAt) { item.createdAt = item.updatedAt || new Date().toISOString(); changed = true; }
      if (!item.updatedAt) { item.updatedAt = item.createdAt; changed = true; }
      if (!item.subtype) { item.subtype = item.type === 'income' ? 'income' : 'regular'; changed = true; }
    });
    return changed;
  }
  function financeResponsibleLabel(value) { return state.finance?.settings?.[`${value}Label`] || FINANCE_RESPONSIBLES[value] || value || 'Todos'; }
  function financeCategoryById(id) { return (state.finance?.categories || []).find(item => item.id === id) || { id, name:'Outros' }; }
  function financeAccountById(id) { return (state.finance?.accounts || []).find(item => item.id === id) || { id, name:'Sem conta' }; }
  function financePeriodRange(period = financeFilter.period) {
    const today = new Date();
    if (period === 'week') { const start = startOfWeek(today); const end = new Date(start); end.setDate(start.getDate() + 7); return { start:localDate(start), end:localDate(end), label:`Semana de ${formatShort(start)}` }; }
    if (period === 'all') return { start:'0000-01-01', end:'9999-12-31', label:'Todos os períodos' };
    const start = new Date(today.getFullYear(), today.getMonth(), 1); const end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return { start:localDate(start), end:localDate(end), label:new Intl.DateTimeFormat('pt-BR',{ month:'long', year:'numeric' }).format(today) };
  }
  function financeFilteredTransactions(includeAllStatuses = true) {
    const range = financePeriodRange();
    return (state.finance?.transactions || []).filter(item => {
      if (financeFilter.responsible !== 'all' && item.responsible !== financeFilter.responsible) return false;
      if (item.date < range.start || item.date >= range.end) return false;
      return includeAllStatuses || item.status === 'posted';
    }).sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  function financeStats() {
    const records = financeFilteredTransactions(true);
    const posted = records.filter(item => item.status === 'posted');
    const pending = records.filter(item => item.status === 'pending');
    const sum = (items, type) => items.filter(item => item.type === type).reduce((total, item) => total + Number(item.amount || 0), 0);
    const expensesByCategory = {};
    const byResponsible = {};
    posted.filter(item => item.type === 'expense').forEach(item => {
      const category = financeCategoryById(item.categoryId).name;
      expensesByCategory[category] = (expensesByCategory[category] || 0) + Number(item.amount || 0);
    });
    posted.forEach(item => {
      const label = financeResponsibleLabel(item.responsible);
      byResponsible[label] ||= { income:0, expense:0 };
      byResponsible[label][item.type] += Number(item.amount || 0);
    });
    return { records, posted, pending, income:sum(posted,'income'), expense:sum(posted,'expense'), pendingIncome:sum(pending,'income'), pendingExpense:sum(pending,'expense'), expensesByCategory, byResponsible };
  }
  function setFinancePanel(panel = 'overview') {
    document.querySelectorAll('[data-finance-tab]').forEach(button => button.classList.toggle('active', button.dataset.financeTab === panel));
    document.querySelectorAll('[data-finance-panel]').forEach(section => { section.hidden = section.dataset.financePanel !== panel; });
  }
  function populateFinanceSelects() {
    const categoryOptions = (state.finance?.categories || []).filter(item => !item.archived).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    const accountOptions = (state.finance?.accounts || []).filter(item => !item.archived).map(item => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join('');
    if ($('financeCategory')) $('financeCategory').innerHTML = categoryOptions;
    if ($('financeAccount')) $('financeAccount').innerHTML = accountOptions;
  }
  function financeTransactionRow(item) {
    const status = item.status === 'pending' ? 'Pendente' : 'Confirmada';
    const type = item.type === 'income' ? 'Entrada' : 'Despesa';
    const badge = item.status === 'pending' ? 'status-unpaid' : (item.type === 'income' ? 'status-paid' : 'status-partial');
    const sign = item.type === 'income' ? '+' : '-';
    return `<article class="detail-item finance-transaction ${item.status === 'pending' ? 'pending-transaction' : ''}"><div class="detail-item-main"><strong>${formatDate(item.date)} · ${escapeHtml(item.description || item.merchant || 'Sem descrição')}</strong><span>${escapeHtml(type)} · ${escapeHtml(financeResponsibleLabel(item.responsible))} · ${escapeHtml(financeCategoryById(item.categoryId).name)} · ${escapeHtml(financeAccountById(item.accountId).name)}</span>${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}<small class="status-badge ${badge}">${status}</small></div><div class="finance-row-side"><strong>${sign}${dollars(item.amount)}</strong><div class="detail-actions"><button type="button" data-edit-finance="${item.id}">Editar</button>${item.status === 'pending' ? `<button type="button" data-post-finance="${item.id}">Confirmar</button>` : ''}<button class="delete" type="button" data-delete-finance="${item.id}">Excluir</button></div></div></article>`;
  }
  function renderFinanceCards(records) {
    if (!$('financeCardsList')) return;
    const byAccount = {};
    records.forEach(item => {
      const account = financeAccountById(item.accountId);
      byAccount[account.id] ||= { name:account.name, purchases:0, credits:0, pending:0, count:0 };
      byAccount[account.id].count++;
      if (item.status === 'pending') byAccount[account.id].pending += Number(item.amount || 0);
      else if (item.type === 'income') byAccount[account.id].credits += Number(item.amount || 0);
      else byAccount[account.id].purchases += Number(item.amount || 0);
    });
    const cards = Object.values(byAccount).sort((a,b) => (b.purchases + b.pending) - (a.purchases + a.pending));
    $('financeCardsList').innerHTML = cards.length ? cards.map(card => {
      const balance = card.purchases - card.credits;
      return `<article class="finance-account-card"><div><span>Cartão / conta</span><strong>${escapeHtml(card.name)}</strong></div><div class="finance-account-numbers"><p><span>Compras</span><strong>${dollars(card.purchases)}</strong></p><p><span>Pagamentos/créditos</span><strong>${dollars(card.credits)}</strong></p><p><span>Pendentes</span><strong>${dollars(card.pending)}</strong></p><p><span>Saldo do período</span><strong>${dollars(balance)}</strong></p></div><small>${card.count} transação${card.count === 1 ? '' : 'ões'} no filtro atual</small></article>`;
    }).join('') : empty('Nenhum cartão/conta com transações neste filtro.');
  }
  function renderFinanceSettings() {
    if ($('financeCategoriesList')) $('financeCategoriesList').innerHTML = (state.finance?.categories || []).map(item => `<article class="detail-item"><div class="detail-item-main"><strong>${escapeHtml(item.name)}</strong><span>${item.archived ? 'Arquivada' : 'Ativa'}</span></div></article>`).join('') || empty('Nenhuma categoria.');
    if ($('financeAccountsList')) $('financeAccountsList').innerHTML = (state.finance?.accounts || []).map(item => `<article class="detail-item"><div class="detail-item-main"><strong>${escapeHtml(item.name)}</strong><span>${item.archived ? 'Arquivada' : 'Ativa'}</span></div></article>`).join('') || empty('Nenhuma conta/cartão.');
  }
  function renderFinance() {
    ensureFinanceState(); populateFinanceSelects();
    if ($('financeDate')) $('financeDate').value ||= localDate();
    if ($('financeResponsibleFilter')) $('financeResponsibleFilter').value = financeFilter.responsible;
    if ($('financePeriodFilter')) $('financePeriodFilter').value = financeFilter.period;
    const range = financePeriodRange(); if ($('financePeriodLabel')) $('financePeriodLabel').textContent = range.label;
    const stats = financeStats();
    if ($('financeIncomeTotal')) $('financeIncomeTotal').textContent = dollars(stats.income);
    if ($('financeExpenseTotal')) $('financeExpenseTotal').textContent = dollars(stats.expense);
    if ($('financeBalanceTotal')) $('financeBalanceTotal').textContent = dollars(stats.income - stats.expense);
    if ($('financeIncomePending')) $('financeIncomePending').textContent = `Pendentes ${dollars(stats.pendingIncome)}`;
    if ($('financeExpensePending')) $('financeExpensePending').textContent = `Pendentes ${dollars(stats.pendingExpense)}`;
    if ($('financePendingTotal')) $('financePendingTotal').textContent = `${stats.pending.length} pendente(s) separados`;
    if ($('financeOverviewReports')) $('financeOverviewReports').innerHTML = [['Entradas confirmadas', dollars(stats.income)], ['Despesas confirmadas', dollars(stats.expense)], ['Saldo do período', dollars(stats.income - stats.expense)], ['Pendentes', `Entradas ${dollars(stats.pendingIncome)} · Despesas ${dollars(stats.pendingExpense)}`]].map(([label,value]) => `<div class="report-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    if ($('financeCategoryBreakdown')) $('financeCategoryBreakdown').innerHTML = Object.entries(stats.expensesByCategory).length ? Object.entries(stats.expensesByCategory).sort((a,b) => b[1] - a[1]).map(([label,value]) => detailRow(label,dollars(value))).join('') : empty('Nenhuma despesa confirmada neste período.');
    if ($('financeResponsibleBreakdown')) $('financeResponsibleBreakdown').innerHTML = Object.entries(stats.byResponsible).length ? Object.entries(stats.byResponsible).map(([label,value]) => detailRow(label,`Entradas ${dollars(value.income)} · Despesas ${dollars(value.expense)} · Saldo ${dollars(value.income - value.expense)}`)).join('') : empty('Nenhuma transação confirmada neste período.');
    if ($('financeRecentTransactions')) $('financeRecentTransactions').innerHTML = stats.records.slice(0,6).length ? stats.records.slice(0,6).map(financeTransactionRow).join('') : empty('Nenhuma transação cadastrada ainda.');
    renderFinanceCards(stats.records);
    const purchases = stats.records.filter(item => item.type === 'expense');
    if ($('financePurchasesCount')) $('financePurchasesCount').textContent = String(purchases.length || '');
    if ($('financePurchasesList')) $('financePurchasesList').innerHTML = purchases.length ? purchases.map(financeTransactionRow).join('') : empty('Nenhuma compra/despesa encontrada.');
    if ($('financeTransactionsCount')) $('financeTransactionsCount').textContent = String(stats.records.length || '');
    if ($('financeTransactionsList')) $('financeTransactionsList').innerHTML = stats.records.length ? stats.records.map(financeTransactionRow).join('') : empty('Nenhuma transação encontrada.');
    if ($('financePendingCount')) $('financePendingCount').textContent = String(stats.pending.length || '');
    if ($('financePendingList')) $('financePendingList').innerHTML = stats.pending.length ? stats.pending.map(financeTransactionRow).join('') : empty('Nenhuma transação pendente.');
    renderFinanceSettings();
  }
  function resetFinanceForm() {
    if (!$('financeTransactionForm')) return;
    $('financeTransactionId').value = ''; $('financeFormTitle').textContent = 'Adicionar transação'; $('financeDate').value = localDate(); $('financeType').value = 'expense'; $('financeDescription').value = ''; $('financeAmount').value = ''; $('financeResponsible').value = 'user1'; $('financeStatus').value = 'posted'; $('financeSubtype').value = 'regular'; $('financeNotes').value = ''; populateFinanceSelects(); $('financeSubmitBtn').textContent = 'Salvar transação';
  }
  function editFinanceTransaction(id) {
    const item = state.finance?.transactions?.find(record => record.id === id); if (!item) return;
    setFinancePanel('add'); populateFinanceSelects();
    $('financeTransactionId').value = item.id; $('financeFormTitle').textContent = 'Editar transação'; $('financeDate').value = item.date || localDate(); $('financeType').value = item.type || 'expense'; $('financeDescription').value = item.description || item.merchant || ''; $('financeAmount').value = Number(item.amount || 0).toFixed(2).replace('.', ','); $('financeResponsible').value = item.responsible || 'user1'; $('financeCategory').value = item.categoryId || state.finance.categories[0]?.id || ''; $('financeAccount').value = item.accountId || state.finance.accounts[0]?.id || ''; $('financeStatus').value = item.status || 'posted'; $('financeSubtype').value = item.subtype || (item.type === 'income' ? 'income' : 'regular'); $('financeNotes').value = item.notes || ''; $('financeSubmitBtn').textContent = 'Salvar alteração'; $('financeTransactionForm').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function saveFinanceTransaction(event) {
    event.preventDefault(); ensureFinanceState();
    const amount = parseMoney($('financeAmount').value); if (!Number.isFinite(amount) || amount <= 0) { showToast('Informe um valor válido.'); return; }
    const id = $('financeTransactionId').value; const now = new Date().toISOString();
    const payload = { date:$('financeDate').value || localDate(), description:$('financeDescription').value.trim(), merchant:$('financeDescription').value.trim(), amount, type:$('financeType').value, responsible:$('financeResponsible').value, categoryId:$('financeCategory').value, accountId:$('financeAccount').value, status:$('financeStatus').value, subtype:$('financeSubtype').value || 'regular', notes:$('financeNotes').value.trim(), updatedAt:now };
    if (!payload.description) { showToast('Informe a descrição.'); return; }
    if (id) { const existing = state.finance.transactions.find(item => item.id === id); if (!existing) { showToast('Transação não encontrada.'); return; } Object.assign(existing, payload); }
    else state.finance.transactions.push({ ...payload, id:uid(), createdAt:now, importBatchId:'manual' });
    resetFinanceForm(); saveState(); renderFinance(); setFinancePanel('transactions'); showToast(id ? 'Transação atualizada.' : 'Transação salva.');
  }
  function deleteFinanceTransaction(id) {
    const item = state.finance?.transactions?.find(record => record.id === id);
    if (!item || !confirm(`Excluir ${item.description || 'esta transação'} no valor de ${dollars(item.amount)}?`)) return;
    state.finance.transactions = state.finance.transactions.filter(record => record.id !== id);
    saveState(); renderFinance(); showToast('Transação excluída.');
  }
  function markFinancePosted(id) { const item = state.finance?.transactions?.find(record => record.id === id); if (!item) return; item.status = 'posted'; item.updatedAt = new Date().toISOString(); saveState(); renderFinance(); showToast('Transação confirmada.'); }
  function saveFinanceCategory(event) {
    event.preventDefault(); const name = $('financeCategoryName').value.trim(); if (!name) return; ensureFinanceState();
    const id = slugify(name); if (!state.finance.categories.some(item => item.id === id)) state.finance.categories.push({ id, name, archived:false, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    $('financeCategoryName').value = ''; saveState(); renderFinance(); showToast('Categoria adicionada.');
  }
  function saveFinanceAccount(event) {
    event.preventDefault(); const name = $('financeAccountName').value.trim(); if (!name) return; ensureFinanceState();
    const id = slugify(name); if (!state.finance.accounts.some(item => item.id === id)) state.finance.accounts.push({ id, name, archived:false, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    $('financeAccountName').value = ''; saveState(); renderFinance(); showToast('Conta/cartão adicionado.');
  }
  function createFinanceImportBatch(source = 'codex', notes = '') { ensureFinanceState(); const batch = { id:`batch-${uid()}`, source, notes, createdAt:new Date().toISOString() }; state.finance.importBatches.push(batch); return batch; }
  function importFinanceTransactions(records = [], options = {}) {
    const batch = createFinanceImportBatch(options.source || 'codex-screenshot', options.notes || '');
    records.forEach(record => {
      const now = new Date().toISOString();
      state.finance.transactions.push({ id:record.id || uid(), date:record.date || localDate(), description:record.description || record.merchant || 'Importado', merchant:record.merchant || record.description || 'Importado', amount:Math.abs(Number(record.amount) || 0), type:['income','expense'].includes(record.type) ? record.type : 'expense', responsible:['user1','user2','shared'].includes(record.responsible) ? record.responsible : 'user1', categoryId:record.categoryId || state.finance.categories.find(item => item.name === record.category)?.id || 'outros', accountId:record.accountId || state.finance.accounts.find(item => item.name === record.account)?.id || state.finance.accounts[0]?.id || 'checking', status:['pending','posted'].includes(record.status) ? record.status : 'posted', subtype:record.subtype || 'regular', notes:record.notes || '', importBatchId:batch.id, externalFingerprint:record.externalFingerprint || '', createdAt:now, updatedAt:now });
    });
    return batch;
  }
  function financeEnsureOption(collection, name) {
    ensureFinanceState();
    const list = state.finance[collection];
    const found = list.find(item => item.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const id = slugify(name);
    list.push({ id, name, archived:false, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString() });
    return id;
  }
  function importFinanceTravelRewards5903User1Screens() {
    ensureFinanceState();
    const batchId = 'batch-bofa-travel-5903-user1-2026-06-09-screens-001';
    const accountId = financeEnsureOption('accounts','Travel Rewards Visa Signature - 5903');
    const category = name => financeEnsureOption('categories',name);
    const cat = {
      gas: category('Gasolina'),
      market: category('Mercado'),
      auto: category('Automóvel'),
      shopping: category('Compras'),
      credit: category('Pagamento / Crédito')
    };
    if (!state.finance.importBatches.some(batch => batch.id === batchId)) state.finance.importBatches.push({ id:batchId, source:'codex-screenshots', notes:'Cartão de crédito Usuário 1 - Travel Rewards Visa Signature - 5903', createdAt:'2026-09-11T16:00:00.000Z' });
    const rows = [
      ['2026-06-24','Afterpay 044-4123456 CA',34.64,'expense',cat.shopping,'posted','regular','Foto 1'],
      ['2026-06-26','COSTCO GAS #1001 TUSTIN CA',55.01,'expense',cat.gas,'posted','regular','Foto 1'],
      ['2026-06-27','GEICO *AUTO 800-841-3000 DC',36.17,'expense',cat.auto,'posted','regular','Foto 1'],
      ['2026-06-29','WM SUPERCENTER #2226 310-750-1983 CA',195.87,'expense',cat.market,'posted','regular','Foto 1'],
      ['2026-07-02','COSTCO GAS #0671 HAWTHORNE CA',54.09,'expense',cat.gas,'posted','regular','Foto 1'],
      ['2026-07-04','TRAVEL CREDIT',29.68,'income',cat.credit,'posted','credit','Foto 1 - crédito no cartão'],
      ['2026-07-07','COSTCO GAS #0424 SIGNAL HILL CA',61.00,'expense',cat.gas,'posted','regular','Foto 1'],
      ['2026-07-09','WAL-MART #5874 TORRANCE CA',53.25,'expense',cat.market,'posted','regular','Foto 1'],
      ['2026-07-09','WM SUPERCENTER #2226 310-750-1983 CA',316.64,'expense',cat.market,'posted','regular','Foto 2'],
      ['2026-07-10','COSTCO GAS #0671 HAWTHORNE CA',43.51,'expense',cat.gas,'posted','regular','Foto 2'],
      ['2026-07-13','COSTCO GAS #0048 VAN NUYS CA',53.05,'expense',cat.gas,'posted','regular','Foto 2'],
      ['2026-07-15','AFTERPAY 185-52896014 CA',6.78,'expense',cat.shopping,'posted','regular','Foto 2'],
      ['2026-07-15','COSTCO GAS #0671 HAWTHORNE CA',50.10,'expense',cat.gas,'posted','regular','Foto 2'],
      ['2026-07-18','STEAMGAMES.COM 4259522985425-8899642 WA',10.07,'expense',cat.shopping,'posted','regular','Foto 2'],
      ['2026-07-18','WL *STEAM PURCHASE 425-889-9642 WA',10.77,'expense',cat.shopping,'posted','regular','Foto 2'],
      ['2026-07-18','COSTCO GAS #0569 COMMERCE CA',54.02,'expense',cat.gas,'posted','regular','Foto 2'],
      ['2026-07-20','PAYMENT FROM CHK 9334 CONF#z1Oovwt4e',1676.49,'income',cat.credit,'posted','transfer','Foto 2 - pagamento do cartão'],
      ['2026-07-23','COSTCO GAS #0410 NORWALK CA',59.26,'expense',cat.gas,'posted','regular','Foto 2'],
      ['2026-07-24','COSTCO WHSE #0671 HAWTHORNE CA',529.65,'expense',cat.market,'posted','regular','Foto 3'],
      ['2026-07-25','AT&T DEVICE/EQUIP SHIPME 8003310500 TX',132.00,'expense',cat.shopping,'posted','regular','Foto 3'],
      ['2026-07-27','GEICO *AUTO 800-841-3000 DC',36.17,'expense',cat.auto,'posted','regular','Foto 3'],
      ['2026-07-27','TRADER JOE S #121 TORRANCE CA',24.06,'expense',cat.market,'posted','regular','Foto 3'],
      ['2026-07-29','AFTERPAY 185-52896014 CA',12.68,'expense',cat.shopping,'posted','regular','Foto 3'],
      ['2026-07-29','COSTCO GAS #0671 HAWTHORNE CA',68.07,'expense',cat.gas,'posted','regular','Foto 3'],
      ['2026-07-31','csgo-skins Gibraltar',5.00,'expense',cat.shopping,'posted','regular','Foto 4'],
      ['2026-07-31','COSTCO WHSE #1202 TORRANCE CA',9.88,'expense',cat.market,'posted','regular','Foto 4'],
      ['2026-07-31','COSTCO GAS #1202 TORRANCE CA',56.32,'expense',cat.gas,'posted','regular','Foto 4'],
      ['2026-08-01','COSTCO GAS #0671 HAWTHORNE CA',57.93,'expense',cat.gas,'posted','regular','Foto 4'],
      ['2026-08-06','COSTCO GAS #0671 HAWTHORNE CA',45.96,'expense',cat.gas,'posted','regular','Foto 4'],
      ['2026-08-08','COSTCO WHSE #0428 ALHAMBRA CA',8.83,'expense',cat.market,'posted','regular','Foto 4'],
      ['2026-08-08','COSTCO GAS #0428 ALHAMBRA CA',42.99,'expense',cat.gas,'posted','regular','Foto 4'],
      ['2026-08-10','WM SUPERCENTER #2226 310-750-1983 CA',93.02,'expense',cat.market,'posted','regular','Foto 5'],
      ['2026-08-12','AFTERPAY 185-52896014 CA',12.68,'expense',cat.shopping,'posted','regular','Foto 5'],
      ['2026-08-12','COSTCO GAS #0671 HAWTHORNE CA',46.00,'expense',cat.gas,'posted','regular','Foto 5'],
      ['2026-08-15','COSTCO WHSE #0671 HAWTHORNE CA',5.50,'expense',cat.market,'posted','regular','Foto 5'],
      ['2026-08-15','COSTCO GAS #0671 HAWTHORNE CA',50.03,'expense',cat.gas,'posted','regular','Foto 5'],
      ['2026-08-19','WM SUPERCENTER #2226 310-750-1983 CA',85.91,'expense',cat.market,'posted','regular','Foto 5'],
      ['2026-08-20','PAYMENT FROM CHK 7003 CONF#z874xsja5',1064.55,'income',cat.credit,'posted','transfer','Foto 5 - pagamento do cartão'],
      ['2026-08-21','COSTCO GAS #0424 SIGNAL HILL CA',57.28,'expense',cat.gas,'posted','regular','Foto 5'],
      ['2026-08-22','COSTCO WHSE #0671 HAWTHORNE CA',10.48,'expense',cat.market,'posted','regular','Foto 5'],
      ['2026-08-22','COSTCO GAS #0671 HAWTHORNE CA',68.28,'expense',cat.gas,'posted','regular','Foto 5'],
      ['2026-08-24','COSTCO GAS #1275 SANTA MARIA CA',30.07,'expense',cat.gas,'posted','regular','Foto 6'],
      ['2026-08-26','AFTERPAY 185-52896014 CA',12.67,'expense',cat.shopping,'posted','regular','Foto 6'],
      ['2026-08-27','GEICO *AUTO 800-841-3000 DC',36.17,'expense',cat.auto,'posted','regular','Foto 6'],
      ['2026-09-03','COSTCO WHSE #0130 LOS ANGELES CA',300.84,'expense',cat.market,'posted','regular','Foto 6'],
      ['2026-09-03','COSTCO GAS #0428 ALHAMBRA CA',60.02,'expense',cat.gas,'posted','regular','Foto 6'],
      ['2026-09-04','COSTCO WHSE #0671 HAWTHORNE CA',10.48,'expense',cat.market,'posted','regular','Foto 6'],
      ['2026-09-05','COSTCO GAS #0564 HAWTHORNE CA',32.24,'expense',cat.gas,'posted','regular','Foto 6'],
      ['2026-09-09','AFTERPAY 185-52896014 CA',5.90,'expense',cat.shopping,'posted','regular','Foto 6'],
      ['2026-09-09','COSTCO GAS #0569 COMMERCE CA',65.80,'expense',cat.gas,'posted','regular','Foto 6'],
      ['2026-09-11','COSTCO GAS #0671',67.19,'expense',cat.gas,'pending','regular','Foto 6 - pendente; data não aparece no print, usei a data atual do lote']
    ];
    const existing = new Set((state.finance.transactions || []).flatMap(item => [item.id, item.externalFingerprint].filter(Boolean)));
    let changed = false;
    rows.forEach(([date,description,amount,type,categoryId,status,subtype,notes]) => {
      const externalFingerprint = `bofa-5903|${date}|${description}|${amount.toFixed(2)}|${status}`;
      const id = `fin-${slugify(externalFingerprint)}`;
      if (existing.has(id) || existing.has(externalFingerprint)) return;
      state.finance.transactions.push({ id, date, description, merchant:description, amount, type, responsible:'user1', categoryId, accountId, status, subtype, notes, importBatchId:batchId, externalFingerprint, createdAt:'2026-09-11T16:00:00.000Z', updatedAt:'2026-09-11T16:00:00.000Z' });
      existing.add(id); existing.add(externalFingerprint); changed = true;
    });
    return changed;
  }
  function importFinanceUnlimited0034User1Screens() {
    ensureFinanceState();
    const batchId = 'batch-bofa-unlimited-0034-user1-2026-07-09-screens-001';
    const accountId = financeEnsureOption('accounts','Unlimited Cash Rewards Visa Signature - 0034');
    const category = name => financeEnsureOption('categories',name);
    const cat = {
      gas: category('Gasolina'),
      market: category('Mercado'),
      auto: category('Automóvel'),
      shopping: category('Compras'),
      credit: category('Pagamento / Crédito'),
      restaurant: category('Restaurante'),
      transport: category('Transporte'),
      pets: category('Pets'),
      health: category('Saúde'),
      leisure: category('Lazer')
    };
    if (!state.finance.importBatches.some(batch => batch.id === batchId)) state.finance.importBatches.push({ id:batchId, source:'codex-screenshots', notes:'Cartão de crédito Usuário 1 - Unlimited Cash Rewards Visa Signature - 0034', createdAt:'2026-09-11T17:00:00.000Z' });
    const rows = [
      ['2026-07-03','GEICO *AUTO 800-841-3000 DC',216.35,'expense',cat.auto,'posted','regular','Foto 1'],
      ['2026-07-06',"DOMINO'S 8352 310-316-8199 CA",12.12,'expense',cat.restaurant,'posted','regular','Foto 1'],
      ['2026-07-20','SQ *PYRAMID LAKE Ontario CA',15.00,'expense',cat.leisure,'posted','regular','Foto 1'],
      ['2026-07-21','OLIVE GARDEN EC 0021723 407-245-5589 CA',50.25,'expense',cat.restaurant,'posted','regular','Foto 1'],
      ['2026-07-22','csgo-skins Gibraltar',10.00,'expense',cat.shopping,'posted','regular','Foto 1'],
      ['2026-07-24','PAYMENT FROM CHK 9334 CONF#z1yjlra0',625.22,'income',cat.credit,'posted','transfer','Foto 1 - pagamento do cartão'],
      ['2026-07-27','SPOT PET SPOTPET.COM IL',124.54,'expense',cat.pets,'posted','regular','Foto 2'],
      ['2026-07-27','TEMU.COM 888-495-8368 MA',3.10,'expense',cat.shopping,'posted','regular','Foto 2'],
      ['2026-07-30','csgo-skins Gibraltar',5.00,'expense',cat.shopping,'posted','regular','Foto 2'],
      ['2026-08-03','TST*OCTOPUS JAPANESE RES Burbank CA',81.58,'expense',cat.restaurant,'posted','regular','Foto 2'],
      ['2026-08-03','DN SUPER FUEL TORRANCE CA',28.92,'expense',cat.gas,'posted','regular','Foto 2'],
      ['2026-08-03','THE ROCK INN LAKE HUGHES CA',25.24,'expense',cat.restaurant,'posted','regular','Foto 2'],
      ['2026-08-03','GEICO *AUTO 800-841-3000 DC',216.35,'expense',cat.auto,'posted','regular','Foto 2'],
      ['2026-08-04','OLIVE GARDEN ZK 0021723 MANHATTAN BEACA',70.65,'expense',cat.restaurant,'posted','regular','Foto 2'],
      ['2026-08-06','aliexpress 408-7855580 DE',12.46,'expense',cat.shopping,'posted','regular','Foto 2'],
      ['2026-08-11','LAWNDALE CAR WASH LAWNDALE CA',1.50,'expense',cat.auto,'posted','regular','Foto 3 - repetição 1'],
      ['2026-08-11','LAWNDALE CAR WASH LAWNDALE CA',1.50,'expense',cat.auto,'posted','regular','Foto 3 - repetição 2'],
      ['2026-08-11','LAWNDALE CAR WASH LAWNDALE CA',1.50,'expense',cat.auto,'posted','regular','Foto 3 - repetição 3'],
      ['2026-08-11','LAWNDALE CAR WASH LAWNDALE CA',1.50,'expense',cat.auto,'posted','regular','Foto 3 - repetição 4'],
      ['2026-08-11','LAWNDALE CAR WASH LAWNDALE CA',1.50,'expense',cat.auto,'posted','regular','Foto 2 - repetição 5'],
      ['2026-08-11','LAWNDALE CAR WASH LAWNDALE CA',21.00,'expense',cat.auto,'posted','regular','Foto 3'],
      ['2026-08-11','RALPHS #0081 WOODLAND HILLCA',17.09,'expense',cat.market,'posted','regular','Foto 3'],
      ['2026-08-14','CVS/PHARMACY #09478 TORRANCE CA',7.71,'expense',cat.health,'posted','regular','Foto 3'],
      ['2026-08-17','CHEVRON 0098574 CANYON COUNTRCA',19.38,'expense',cat.gas,'posted','regular','Foto 3'],
      ['2026-08-18','TST*JACKS PLACE Leona Valley CA',36.00,'expense',cat.restaurant,'posted','regular','Foto 3'],
      ['2026-08-18',"BJ'S RESTAURANTS MOBILE 714-500-2400 CA",130.08,'expense',cat.restaurant,'posted','regular','Foto 3'],
      ['2026-08-20','PAYMENT FROM CHK 7003 CONF#zfanssrex',303.72,'income',cat.credit,'posted','transfer','Foto 6 - pagamento do cartão'],
      ['2026-08-21','OLIVE GARDEN ZK 0021563 SANTA CLARITACA',64.11,'expense',cat.restaurant,'posted','regular','Foto 6'],
      ['2026-08-21','COSTCO WHSE #0424 SIGNAL HILL CA',10.48,'expense',cat.market,'posted','regular','Foto 6'],
      ['2026-08-22','CHEVRON 0098744 WEST HOLLYWOODCA',5.01,'expense',cat.gas,'posted','regular','Foto 6'],
      ['2026-08-24','TST*TACOS EL GAVILAN - L LOS ANGELES CA',16.77,'expense',cat.restaurant,'posted','regular','Foto 6'],
      ['2026-08-25','MR PIZZA MAN 650-9973964 CA',57.56,'expense',cat.restaurant,'posted','regular','Foto 6'],
      ['2026-08-25','SPOTHERO 844-356-8054 SPOTHERO.COM IL',18.55,'expense',cat.transport,'posted','regular','Foto 6'],
      ['2026-08-25','SPOTHERO 844-356-8054 SPOTHERO.COM IL',2.65,'expense',cat.transport,'posted','regular','Foto 6'],
      ['2026-08-25','OLIVE GARDEN ZK 0021404 SANTA MARIA CA',47.80,'expense',cat.restaurant,'posted','regular','Foto 6'],
      ['2026-08-25','WAYMO 844-261-3753 CA',12.14,'expense',cat.transport,'posted','regular','Foto 6'],
      ['2026-08-25','TST*PADOCA CAFE San FranciscoCA',7.80,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-25','TST*PADOCA CAFE San FranciscoCA',29.92,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-25','GOLDEN GATE NRA PARKING SAN FRANCISCOCA',4.00,'expense',cat.transport,'posted','regular','Foto 5'],
      ['2026-08-25','MAGNETS PIER 39 SAN FRANCISCOCA',5.43,'expense',cat.shopping,'posted','regular','Foto 5'],
      ['2026-08-26','FOGO DE CHAO - SAN FRANC SAN FRANCISCOCA',13.30,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-26','TST* EQUATOR COFFEES - ROSAN RAFAEL CA',12.00,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-26','SPOTHERO 844-356-8054 SPOTHERO.COM IL',30.21,'expense',cat.transport,'posted','regular','Foto 5'],
      ['2026-08-26','TST*CIOPPINOS ON THE WH San FranciscoCA',65.30,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-26','TST*PADOCA CAFE San FranciscoCA',34.67,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-26','WAGO SUSHI SAN FRANCISCOCA',75.70,'expense',cat.restaurant,'posted','regular','Foto 5'],
      ['2026-08-27','IMPARK00270161A SAN FRANCISCOCA',10.00,'expense',cat.transport,'posted','regular','Foto 4'],
      ['2026-08-27','CLIPPER TRANSIT FARE SAN FRANCISCOCA',8.50,'expense',cat.transport,'posted','regular','Foto 4 - repetição 1'],
      ['2026-08-27','CLIPPER TRANSIT FARE SAN FRANCISCOCA',8.50,'expense',cat.transport,'posted','regular','Foto 4 - repetição 2'],
      ['2026-08-27','TST*PADOCA CAFE San FranciscoCA',58.52,'expense',cat.restaurant,'posted','regular','Foto 4'],
      ['2026-08-28','TARGET T-3452 SOUTH LAKE TACA',21.74,'expense',cat.shopping,'posted','regular','Foto 7'],
      ['2026-08-28','SAFEWAY #1824 SOUTH LAKE TACA',159.41,'expense',cat.market,'posted','regular','Foto 4'],
      ['2026-08-28','SOUTH LAKE TAHOE ACE HAR SOUTH LAKE TACA',11.95,'expense',cat.shopping,'posted','regular','Foto 4'],
      ['2026-08-29','APPLEBEES 2160023 S LAKE TAHOE CA',79.77,'expense',cat.restaurant,'posted','regular','Foto 7'],
      ['2026-08-31',"TST* FRANNY'S FARM TABLE 530-748-3671 CA",72.11,'expense',cat.restaurant,'posted','regular','Foto 7'],
      ['2026-08-31','COSTCO GAS #1202 TORRANCE CA',7.99,'expense',cat.gas,'posted','regular','Foto 7'],
      ['2026-08-31','COSTCO GAS #1202 TORRANCE CA',50.85,'expense',cat.gas,'posted','regular','Foto 7'],
      ['2026-09-03','GEICO *AUTO 800-841-3000 DC',216.35,'expense',cat.auto,'posted','regular','Foto 7'],
      ['2026-09-03','TARGET T-0183 PACOIMA CA',9.53,'expense',cat.shopping,'posted','regular','Foto 7'],
      ['2026-09-08','OLIVE GARDEN ZK 0021723 MANHATTAN BEACA',54.58,'expense',cat.restaurant,'posted','regular','Foto 7'],
      ['2026-09-11','SPOT PET',124.54,'expense',cat.pets,'pending','regular','Foto 7 - pendente; data não aparece no print, usei a data atual do lote']
    ];
    const existing = new Set((state.finance.transactions || []).flatMap(item => [item.id, item.externalFingerprint].filter(Boolean)));
    let changed = false;
    rows.forEach(([date,description,amount,type,categoryId,status,subtype,notes], index) => {
      const repeatKey = /repetição/i.test(notes || '') ? `|${index}` : '';
      const externalFingerprint = `bofa-0034|${date}|${description}|${amount.toFixed(2)}|${status}${repeatKey}`;
      const id = `fin-${slugify(externalFingerprint)}`;
      if (existing.has(id) || existing.has(externalFingerprint)) return;
      state.finance.transactions.push({ id, date, description, merchant:description, amount, type, responsible:'user1', categoryId, accountId, status, subtype, notes, importBatchId:batchId, externalFingerprint, createdAt:'2026-09-11T17:00:00.000Z', updatedAt:'2026-09-11T17:00:00.000Z' });
      existing.add(id); existing.add(externalFingerprint); changed = true;
    });
    return changed;
  }
  window.financeBulkInsert = (records, options) => { const batch = importFinanceTransactions(records, options); saveState(); renderFinance(); return batch; };
  async function sha256(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2,'0')).join(''); }
  function closeDialogs() { document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close()); }
  function showScreen(screen) {
    applyTheme();
    ['loginScreen','homeScreen','rentalsModule','earningsModule','financeModule'].forEach(id => { const element = $(id); if (element) element.hidden = id !== screen; });
    document.body.classList.toggle('auth-mode', screen === 'loginScreen');
    document.body.classList.toggle('home-mode', screen === 'homeScreen');
    document.body.classList.toggle('module-mode', screen === 'rentalsModule' || screen === 'earningsModule' || screen === 'financeModule');
    window.scrollTo(0, 0);
    if (screen === 'rentalsModule') renderAll();
    if (screen === 'earningsModule') renderEarnings();
    if (screen === 'financeModule') renderFinance();
  }
  function renderAuth() {
    const configured = Boolean(state.auth?.passwordHash);
    $('loginTitle').textContent = configured ? 'Entrar' : 'Criar senha';
    $('loginHelper').textContent = configured ? 'Digite sua senha para acessar o app.' : 'Crie uma senha para proteger os dados deste aparelho.';
    $('loginPassword').autocomplete = configured ? 'current-password' : 'new-password';
    showScreen(configured && state.auth?.session ? 'homeScreen' : 'loginScreen');
  }
  async function handleLogin(event) {
    event.preventDefault();
    const password = $('loginPassword').value.trim();
    if (password.length < 4) { showToast('Use uma senha com pelo menos 4 caracteres.'); return; }
    state.auth ||= {};
    if (!state.auth.passwordHash) {
      state.auth.salt = uid();
      state.auth.passwordHash = await sha256(`${state.auth.salt}:${password}`);
      state.auth.session = true;
      saveState();
      $('loginPassword').value = '';
      showScreen('homeScreen');
      showToast('Senha criada com sucesso.');
      return;
    }
    const hash = await sha256(`${state.auth.salt}:${password}`);
    if (hash !== state.auth.passwordHash) { showToast('Senha incorreta.'); return; }
    state.auth.session = true;
    saveState();
    $('loginPassword').value = '';
    showScreen('homeScreen');
  }
  function logout() { state.auth ||= {}; state.auth.session = false; saveState(); closeDialogs(); renderAuth(); }
  function openModule(module) { closeDialogs(); showScreen(module === 'earnings' ? 'earningsModule' : module === 'finance' ? 'financeModule' : 'rentalsModule'); }
  function openHome() { closeDialogs(); showScreen('homeScreen'); }
  function handlePrimaryNavigation(button) {
    if (button.id === 'logoutBtn') { logout(); return true; }
    if (button.id === 'openRentalsBtn') { openModule('rentals'); return true; }
    if (button.id === 'openEarningsBtn') { openModule('earnings'); return true; }
    if (button.id === 'openFinanceBtn') { openModule('finance'); return true; }
    if (button.matches('[data-module-home]')) { openHome(); return true; }
    return false;
  }
  function bindPrimaryNavigation() {
    const bind = (selector, action) => {
      document.querySelectorAll(selector).forEach(button => {
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          action();
        });
      });
    };
    bind('#logoutBtn', logout);
    bind('#openRentalsBtn', () => openModule('rentals'));
    bind('#openEarningsBtn', () => openModule('earnings'));
    bind('#openFinanceBtn', () => openModule('finance'));
    bind('[data-module-home]', openHome);
  }
  window.appNavigate = destination => {
    if (destination === 'logout') return logout();
    if (destination === 'home') return openHome();
    if (destination === 'earnings') return openModule('earnings');
    if (destination === 'finance') return openModule('finance');
    return openModule('rentals');
  };
  function pushDeviceId() { state.settings ||= {}; if (!state.settings.pushDeviceId) { state.settings.pushDeviceId = `device-${uid()}`; saveState(); } return state.settings.pushDeviceId; }
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
  }
  async function pushConfig() {
    const response = await fetch('/api/push/config', { cache: 'no-store' });
    if (!response.ok) throw new Error('Configuração push indisponível');
    return response.json();
  }
  function dailyPushSummary() {
    const now = new Date();
    const todayKey = localDate(now);
    const today = new Date(now); today.setHours(0,0,0,0);
    const dueToday = visiblePayers().map(payer => {
      const due = dueDate(payer,startOfWeek(now)); const key = weekKey(due); const payment = paymentFor(payer.id,key);
      return { payer, due, key, payment, remaining: Math.max(0, amountForWeek(payer,due) - (Number(payment.received) || 0)) };
    }).filter(item => localDate(item.due) === todayKey && item.payment.status !== 'paid' && item.remaining > 0);
    const pending = visiblePayers().flatMap(payer => pendingItems(payer,now)).sort((a,b) => a.due - b.due || a.payer.name.localeCompare(b.payer.name));
    const todayNames = dueToday.slice(0,3).map(item => item.payer.name);
    const pendingNames = pending.slice(0,3).map(item => item.payer.name);
    const body = todayNames.length
      ? `Hoje tem ${dueToday.length} pagamento${dueToday.length === 1 ? '' : 's'}: ${todayNames.join(', ')}${dueToday.length > 3 ? '…' : ''}.`
      : pending.length
        ? `${pending.length} pagamento${pending.length === 1 ? '' : 's'} pendente${pending.length === 1 ? '' : 's'}: ${pendingNames.join(', ')}${pending.length > 3 ? '…' : ''}.`
        : 'Nenhum pagamento pendente. Tudo em dia!';
    const gainsEveningBody = todayHasEarnings(now) ? 'Ganhos de hoje já registrados. Se faltou algo, atualize antes de dormir.' : 'Não esqueça de adicionar os ganhos de hoje.';
    const morningRentalBody = todayNames.length
      ? `Hoje tem ${dueToday.length} pagamento${dueToday.length === 1 ? '' : 's'}: ${todayNames.join(', ')}${dueToday.length > 3 ? '...' : ''}.`
      : pending.length
        ? `${pending.length} pagamento${pending.length === 1 ? '' : 's'} pendente${pending.length === 1 ? '' : 's'}: ${pendingNames.join(', ')}${pending.length > 3 ? '...' : ''}.`
        : 'Hoje nao tem pagamento previsto.';
    return {
      generatedAt: new Date().toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Los_Angeles',
      pendingCount: pending.length,
      todayCount: dueToday.length,
      todayNames,
      pendingNames,
      gainsEveningBody: 'Nao esqueca de adicionar os ganhos de hoje.',
      body: morningRentalBody
    };
  }
  async function syncPushSnapshot() {
    if (!state.settings?.pushSubscribed || !('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) { state.settings.pushSubscribed = false; state.settings.notifications = false; saveState(); renderNotificationStatus(); return; }
    const summary = dailyPushSummary();
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deviceId: pushDeviceId(),
        subscription: subscription.toJSON(),
        timezone: summary.timezone,
        summary
      })
    });
    if (!response.ok) throw new Error('Não foi possível sincronizar o lembrete push.');
    state.settings.pushEndpoint = subscription.endpoint;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  function queuePushSnapshotSync() {
    clearTimeout(pushSyncTimer);
    if (!state.settings?.pushSubscribed) return;
    pushSyncTimer = setTimeout(() => syncPushSnapshot().catch(error => console.warn(error)), 900);
  }

  function deadlineFor(date) { const deadline = new Date(date); deadline.setDate(deadline.getDate() + 1); deadline.setHours(12, 0, 0, 0); return deadline; }
  function receivedMoment(payment) { if (payment.receivedAt) return new Date(payment.receivedAt); const moment = parseLocalDate(payment.receivedDate); if (moment) moment.setHours(12,0,0,0); return moment; }
  function isPaymentLate(payment,due) { const received = receivedMoment(payment); return Boolean(received && received > deadlineFor(due)); }
  function timerMarkup(mode, date) { return `<span class="payment-timer ${mode === 'overdue' ? 'overdue' : ''}" data-timer="${mode}" data-target="${localDate(date)}"></span>`; }
  function formatDuration(milliseconds, roundUp = false) {
    const rawMinutes = milliseconds / 60000; const totalMinutes = Math.max(0, roundUp ? Math.ceil(rawMinutes) : Math.floor(rawMinutes));
    const days = Math.floor(totalMinutes / 1440); const hours = Math.floor((totalMinutes % 1440) / 60); const minutes = totalMinutes % 60;
    return days ? `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}min` : `${hours}h ${String(minutes).padStart(2, '0')}min`;
  }
  function updateTimers() {
    const now = new Date();
    document.querySelectorAll('[data-timer]').forEach(element => {
      const target = parseLocalDate(element.dataset.target); if (!target) return;
      const deadline = deadlineFor(target); const overdue = element.dataset.timer === 'overdue';
      element.textContent = overdue ? `Atrasado há ${formatDuration(now - deadline)}` : (deadline > now ? `Faltam ${formatDuration(deadline - now, true)}` : 'Prazo encerrado');
    });
  }

  function directLocalRecordsFor(payer) {
    return Object.entries(state.payments).map(([key, payments]) => ({ key, payment: payments?.[payer.id] })).filter(item => item.payment);
  }

  function payerIdentity(payer) { return normalizeClientName(clientDefinitionForPayer(payer)?.clientCode || payer.name); }
  function relatedPayers(payer) { const identity = payerIdentity(payer); return state.payers.filter(item => payerIdentity(item) === identity); }
  function localRecordsFor(payer) { return relatedPayers(payer).flatMap(directLocalRecordsFor); }
  function allVisiblePayers() {
    const grouped = new Map();
    state.payers.forEach(payer => {
      const identity = payerIdentity(payer); const current = grouped.get(identity);
      if (!current || directLocalRecordsFor(payer).length > directLocalRecordsFor(current).length) grouped.set(identity,payer);
    });
    return [...grouped.values()];
  }
  function visiblePayers() { return allVisiblePayers().filter(payer => payer.active !== false); }

  function clientDefinitionForPayer(payer) {
    const payerName = normalizeClientName(payer.name); const linkedCode = normalizeClientName(payer.clientCode || '');
    return (window.PAYMENT_HISTORY_IMPORT || []).find(client => {
      const code = normalizeClientName(client.clientCode); const aliases = [client.clientCode,client.realName,...(CLIENT_ALIASES[code] || [])].map(normalizeClientName);
      return linkedCode ? code === linkedCode : aliases.some(alias => alias === payerName || (alias.length >= 4 && payerName.includes(alias)) || (payerName.length >= 4 && alias.includes(payerName)));
    }) || null;
  }

  function historicalDueForPayment(payer,paymentDate) {
    const paidOn = parseLocalDate(paymentDate); const week = startOfWeek(paidOn); const previousWeek = new Date(week); previousWeek.setDate(previousWeek.getDate()-7); const nextWeek = new Date(week); nextWeek.setDate(nextWeek.getDate()+7);
    return [dueDate(payer,previousWeek),dueDate(payer,week),dueDate(payer,nextWeek)].sort((a,b) => Math.abs(a-paidOn)-Math.abs(b-paidOn) || a-b)[0];
  }

  function importedRecordsForPayer(payer) {
    const client = clientDefinitionForPayer(payer); if (!client) return [];
    return (state.paymentHistory || []).filter(record => normalizeClientName(record.clientCode) === normalizeClientName(client.clientCode)).map(record => {
      const due = historicalDueForPayment(payer,record.paymentDate);
      const payment = { status:'paid', received:Number(record.amount), receivedDate:record.paymentDate, dueDate:localDate(due), notes:'', imported:true, type:'payment' }; payment.paidLate = isPaymentLate(payment,due); return { key:weekKey(due), payment };
    });
  }

  function importedPaymentFor(payer,key) {
    return importedRecordsForPayer(payer).find(item => item.key === key)?.payment || { status:'unpaid', received:0, notes:'' };
  }

  function recordsFor(payer) {
    const combined = new Map(); const imported = importedRecordsForPayer(payer);
    imported.forEach(item => combined.set(`${item.payment.receivedDate}|${item.payment.received}`,item));
    const cutoff = imported.map(item => item.payment.receivedDate).sort().pop() || '';
    localRecordsFor(payer).filter(item => item.payment.status === 'paid' && item.payment.receivedDate && (!cutoff || item.payment.receivedDate > cutoff)).forEach(item => combined.set(`${item.payment.receivedDate}|${Number(item.payment.received) || 0}`,item));
    return [...combined.values()];
  }

  function recomputeLateCount(payer) {
    payer.lateCount = localRecordsFor(payer).filter(item => item.payment.status === 'paid' && item.payment.paidLate === true).length;
  }

  function normalizeClientName(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toUpperCase(); }

  function importPaymentHistory() {
    if (!Array.isArray(state.paymentHistory)) state.paymentHistory = [];
    const existing = new Set(state.paymentHistory.map(record => record.id)); let changed = false;
    (window.PAYMENT_HISTORY_IMPORT || []).forEach(client => {
      client.payments.forEach(([paymentDate, amount]) => {
        const id = `history-${normalizeClientName(client.clientCode)}-${paymentDate}-${amount}`;
        if (existing.has(id)) return;
        state.paymentHistory.push({ id, clientCode: client.clientCode, realName: client.realName, paymentDate, amount, type: 'payment', source: 'historical-import-v1' });
        existing.add(id); changed = true;
      });
    });
    return changed;
  }

  function importAmazonFlexEarningsFromScreens() {
    state.earnings ||= [];
    const entries = [
      ['2026-07-01',119.50,'Bloco Amazon Flex 9:15 AM - 1:45 PM · importado do print'],
      ['2026-07-02',53.00,'Bloco Amazon Flex 2:00 PM - 4:00 PM · importado do print'],
      ['2026-07-02',59.00,'Bloco Amazon Flex 11:30 AM - 1:30 PM · Base $54 + Tips $5 · importado do print'],
      ['2026-07-03',93.00,'Bloco Amazon Flex 11:30 AM - 3:00 PM · importado do print'],
      ['2026-07-06',119.50,'Bloco Amazon Flex 8:45 AM - 1:15 PM · importado do print'],
      ['2026-07-07',106.00,'Bloco Amazon Flex 6:30 AM - 10:30 AM · importado do print'],
      ['2026-07-07',93.00,'Bloco Amazon Flex 2:00 PM - 5:30 PM · importado do print'],
      ['2026-07-07',867.00,'California PADSA health subsidy · importado do print']
    ];
    let changed = false;
    entries.forEach(([date, amount, notes]) => {
      const id = `amazon-flex-print-${date}-${String(amount).replace('.','-')}`;
      const alreadyImported = state.earnings.some(item => item.id === id);
      const sameManualEntry = state.earnings.some(item => item.date === date && item.app === 'Amazon Flex' && item.person === 'Matheus' && Number(item.amount) === amount);
      if (alreadyImported || sameManualEntry) return;
      const category = /subsidy|health|padsa|insurance/i.test(notes) ? 'subsidy' : 'work';
      state.earnings.push({ id, date, app:'Amazon Flex', person:'Matheus', amount, notes, category, createdAt:`${date}T12:00:00.000Z`, type:'earning', source:'amazon-flex-screens-2026-07' });
      changed = true;
    });
    return changed;
  }

  function importAmazonFlexSecondAccountScreens() {
    state.earnings ||= [];
    const entries = [
      ['2026-07-01',93.00,'Amazon Flex outra conta 6:00 AM - 9:30 AM · importado do print'],
      ['2026-07-02',81.00,'Amazon Flex outra conta 9:15 AM - 11:15 AM · Base $54 + Tips $27 · importado do print'],
      ['2026-07-02',61.00,'Amazon Flex outra conta 1:45 PM - 3:45 PM · Base $54 + Tips $7 · importado do print'],
      ['2026-07-03',106.00,'Amazon Flex outra conta 2:00 PM - 6:00 PM · importado do print'],
      ['2026-07-03',79.00,'Amazon Flex outra conta 9:15 AM - 11:15 AM · Base $54 + Tips $25 · importado do print'],
      ['2026-07-06',106.00,'Amazon Flex outra conta 5:30 AM - 9:30 AM · importado do print'],
      ['2026-07-06',54.00,'Amazon Flex outra conta 12:30 PM - 2:30 PM · Base $54 + Tips $0 · importado do print'],
      ['2026-07-07',79.50,'Amazon Flex outra conta 9:15 AM - 12:15 PM · importado do print']
    ];
    let changed = false;
    entries.forEach(([date, amount, notes], index) => {
      const id = `amazon-flex-second-account-2026-07-${index + 1}`;
      const alreadyImported = state.earnings.some(item => item.id === id);
      const sameManualEntry = state.earnings.some(item => item.date === date && item.app === 'Amazon Flex' && item.person === 'Matheus' && Number(item.amount) === amount);
      if (alreadyImported || sameManualEntry) return;
      state.earnings.push({ id, date, app:'Amazon Flex', person:'Matheus', amount, notes, category:'work', createdAt:`${date}T12:30:00.000Z`, type:'earning', source:'amazon-flex-second-account-2026-07' });
      changed = true;
    });
    return changed;
  }

  function normalizedEarningStart(value) {
    return String(value || '').toUpperCase().replace(/\s+/g, '').replace(/^0/, '');
  }

  function earningStartFromNotes(item) {
    const match = String(item?.notes || '').match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-/i);
    return match ? normalizedEarningStart(match[1]) : '';
  }

  function importAmazonFlexOldWorkScreens() {
    state.earnings ||= [];
    const entries = [
      ['2026-05-26','10:45 AM','12:15 PM',42.50],
      ['2026-05-27','9:15 AM','1:15 PM',106.00],
      ['2026-05-28','4:30 PM','8:30 PM',106.00],
      ['2026-05-29','9:15 AM','1:45 PM',119.50],
      ['2026-06-01','3:45 PM','7:15 PM',93.00],
      ['2026-06-02','8:45 AM','1:15 PM',119.50],
      ['2026-06-03','3:15 PM','7:45 PM',119.50],
      ['2026-06-04','7:00 AM','11:00 AM',106.00],
      ['2026-06-04','12:30 PM','4:30 PM',106.00],
      ['2026-06-05','12:15 PM','4:15 PM',106.00],
      ['2026-06-08','1:15 PM','4:45 PM',93.00],
      ['2026-06-09','10:15 AM','2:45 PM',119.50],
      ['2026-06-09','3:30 PM','6:30 PM',79.50],
      ['2026-06-10','6:15 AM','10:15 AM',106.00],
      ['2026-06-11','6:15 AM','10:15 AM',106.00],
      ['2026-06-11','11:15 AM','2:15 PM',79.50],
      ['2026-06-12','1:30 PM','6:00 PM',119.50],
      ['2026-06-17','9:30 AM','1:30 PM',110.00],
      ['2026-06-18','7:15 AM','10:45 AM',93.00],
      ['2026-06-19','6:45 AM','10:45 AM',106.00],
      ['2026-06-19','11:45 AM','2:45 PM',79.50],
      ['2026-06-20','6:15 AM','9:45 AM',93.00],
      ['2026-06-22','6:00 AM','9:00 AM',79.50],
      ['2026-06-22','9:30 AM','1:00 PM',93.00],
      ['2026-06-22','2:15 PM','5:45 PM',93.00],
      ['2026-06-23','5:45 AM','9:45 AM',106.00],
      ['2026-06-23','10:30 AM','2:30 PM',106.00],
      ['2026-06-23','1:45 PM','5:15 PM',93.00],
      ['2026-06-25','6:00 AM','9:00 AM',79.50],
      ['2026-06-25','9:15 AM','11:15 AM',61.00],
      ['2026-06-25','1:30 PM','6:00 PM',119.50],
      ['2026-06-27','8:15 AM','12:45 PM',119.50],
      ['2026-06-27','12:30 PM','4:30 PM',106.00],
      ['2026-06-29','5:30 AM','9:30 AM',106.00],
      ['2026-06-30','11:00 AM','3:00 PM',106.00],
      ['2026-07-09','6:30 AM','10:30 AM',106.00],
      ['2026-07-09','10:15 AM','3:15 PM',132.50]
    ];
    let changed = false;
    entries.forEach(([date, start, end, amount]) => {
      const startKey = normalizedEarningStart(start);
      const id = `amazon-flex-old-work-${date}-${startKey.toLowerCase()}`;
      const alreadyImported = state.earnings.some(item => item.id === id);
      const sameWorkBlock = state.earnings.some(item => item.date === date && item.app === 'Amazon Flex' && item.person === 'Matheus' && earningStartFromNotes(item) === startKey);
      if (alreadyImported || sameWorkBlock) return;
      state.earnings.push({ id, date, app:'Amazon Flex', person:'Matheus', amount, notes:`Bloco Amazon Flex ${start} - ${end} - importado dos prints antigos`, category:'work', createdAt:`${date}T12:45:00.000Z`, type:'earning', source:'amazon-flex-old-work-screens-2026' });
      changed = true;
    });
    return changed;
  }

  function normalizeDuplicateText(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function dedupeEarnings() {
    if (!Array.isArray(state.earnings)) return false;
    const seen = new Map();
    const result = [];
    let changed = false;
    state.earnings.forEach(item => {
      const app = normalizeDuplicateText(item.app || 'Outros');
      const person = normalizeDuplicateText(item.person || 'Matheus');
      const date = item.date || '';
      const amount = Number(item.amount || 0).toFixed(2);
      const start = earningStartFromNotes(item);
      const notes = normalizeDuplicateText(item.notes);
      const category = item.category || (isSubsidyText(item) ? 'subsidy' : 'work');
      const key = start
        ? `${app}|${person}|${date}|start:${start}|${category}`
        : `${app}|${person}|${date}|amount:${amount}|notes:${notes}|${category}`;
      const existingIndex = seen.get(key);
      if (existingIndex === undefined) {
        seen.set(key, result.length);
        result.push(item);
        return;
      }
      const existing = result[existingIndex];
      const existingImported = Boolean(existing.source || String(existing.id || '').includes('amazon-flex-'));
      const currentImported = Boolean(item.source || String(item.id || '').includes('amazon-flex-'));
      if (existingImported && !currentImported) result[existingIndex] = item;
      changed = true;
    });
    if (changed) state.earnings = result;
    return changed;
  }

  function isSubsidyText(item) {
    const text = `${item.notes || ''} ${item.source || ''} ${item.kind || ''}`.toLowerCase();
    return /(subsidy|health|padsa|insurance|seguro|auxilio|auxÃ­lio|adicional|evento|event|bonus|bÃ´nus|promo|reembolso|refund)/i.test(text);
  }

  function migrateState() {
    let changed = state.dataVersion !== DATA_VERSION;
    state.settings = { notifications: false, pushSubscribed: false, pushDeviceId: '', pushEndpoint: '', lastNotificationDate: '', lastBackupAt: '', themeMode: 'auto', ...(state.settings || {}) };
    if (!Array.isArray(state.earnings)) { state.earnings = []; changed = true; }
    state.earningsSettings = { weeklyGoal: 0, dailyGoal: 250, ...(state.earningsSettings || {}) };
    state.auth = { ...(state.auth || {}) };
    if (ensureFinanceState()) changed = true;
    if (importFinanceTravelRewards5903User1Screens()) changed = true;
    if (importFinanceUnlimited0034User1Screens()) changed = true;
    if (importPaymentHistory()) changed = true;
    if (importAmazonFlexEarningsFromScreens()) changed = true;
    if (importAmazonFlexSecondAccountScreens()) changed = true;
    if (importAmazonFlexOldWorkScreens()) changed = true;
    state.earnings.forEach(item => {
      if (!item.type) { item.type = 'earning'; changed = true; }
      if (!item.category) { item.category = isSubsidyText(item) ? 'subsidy' : 'work'; changed = true; }
      if (item.category === 'other') { item.category = 'subsidy'; changed = true; }
    });
    if (dedupeEarnings()) changed = true;

    state.payers.forEach(payer => {
      if (!payer.clientCode) { const client = clientDefinitionForPayer(payer); if (client) { payer.clientCode = client.clientCode; changed = true; } }
      if (!Array.isArray(payer.termsHistory) || !payer.termsHistory.length) { payer.termsHistory = [{ effectiveWeek:'1970-01-05',amount:Number(payer.amount),day:Number(payer.day),createdAt:new Date().toISOString() }]; changed = true; }
      if (payer.active === undefined) { payer.active = true; changed = true; }
      if (!Array.isArray(payer.penalties)) { payer.penalties = []; changed = true; }
      const records = directLocalRecordsFor(payer);
      records.forEach(({ key, payment }) => {
        const due = dueDate(payer, parseLocalDate(key));
        if (!payment.dueDate) { payment.dueDate = localDate(due); changed = true; }
        if (payment.status === 'paid') {
          const paidOn = payment.receivedDate || (payment.updatedAt ? localDate(new Date(payment.updatedAt)) : payment.dueDate);
          if (!payment.receivedDate) { payment.receivedDate = paidOn; changed = true; }
          const late = isPaymentLate(payment,parseLocalDate(payment.dueDate));
          if (payment.paidLate !== late) { payment.paidLate = late; changed = true; }
        }
      });

      records.forEach(({ key, payment }) => {
        if (payment.ledgerVersion || payment.status !== 'paid' || !payment.receivedDate) return;
        const paidOn = parseLocalDate(payment.receivedDate);
        const recordedDue = parseLocalDate(payment.dueDate) || dueDate(payer, parseLocalDate(key));

        if (paidOn < recordedDue) {
          const previousDue = new Date(recordedDue); previousDue.setDate(previousDue.getDate() - 7);
          const previousKey = weekKey(previousDue);
          const previousRecord = state.payments[previousKey]?.[payer.id];

          if (!previousRecord || previousRecord.status !== 'paid') {
            state.payments[previousKey] ||= {};
            state.payments[previousKey][payer.id] = {
              ...payment,
              dueDate: localDate(previousDue),
              paidLate: isPaymentLate(payment,previousDue),
              ledgerVersion: DATA_VERSION,
              migratedFromWeek: key
            };
            delete state.payments[key][payer.id];
            changed = true;
            return;
          }
        }

        payment.ledgerVersion = DATA_VERSION;
        changed = true;
      });

      if (!payer.trackingStartDate) {
        if (records.length) {
          payer.trackingStartDate = records.map(item => item.payment.dueDate || localDate(dueDate(payer, parseLocalDate(item.key)))).sort()[0];
        } else if (payer.lastPaymentDate) {
          const dayAfter = parseLocalDate(payer.lastPaymentDate); dayAfter.setDate(dayAfter.getDate() + 1); payer.trackingStartDate = localDate(dayAfter);
        } else {
          payer.trackingStartDate = localDate(payer.createdAt ? new Date(payer.createdAt) : new Date());
        }
        changed = true;
      }

      if (payer.lastPaymentDate === undefined) {
        const latestPaid = records.filter(item => item.payment.status === 'paid').sort((a, b) => (b.payment.receivedDate || '').localeCompare(a.payment.receivedDate || ''))[0];
        payer.lastPaymentDate = latestPaid?.payment.receivedDate || '';
        changed = true;
      }

      const oldCount = payer.lateCount;
      recomputeLateCount(payer);
      if (oldCount !== payer.lateCount) changed = true;
    });

    state.dataVersion = DATA_VERSION;
    if (changed) saveState();
  }

  function dueInstancesThrough(payer, throughDate) {
    const start = parseLocalDate(payer.trackingStartDate) || new Date();
    const through = new Date(throughDate); through.setHours(0, 0, 0, 0);
    const dates = []; const cursor = startOfWeek(start);
    while (cursor <= through && dates.length < 520) { const due = dueDate(payer,cursor); if (due >= start && due <= through) dates.push(due); cursor.setDate(cursor.getDate() + 7); }
    return dates;
  }

  function overdueDates(payer, now = new Date()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    return dueInstancesThrough(payer, today).filter(date => deadlineFor(date) < now && paymentFor(payer.id, weekKey(date)).status !== 'paid');
  }

  function pendingItems(payer, now = new Date()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    return dueInstancesThrough(payer, today).map(due => {
      const key = weekKey(due); const payment = paymentFor(payer.id, key);
      return { payer, due, key, payment, remaining: Math.max(0, amountForWeek(payer,due) - (Number(payment.received) || 0)) };
    }).filter(item => item.payment.status !== 'paid' && item.remaining > 0);
  }

  function waitingItemsThisWeek(now = new Date()) {
    const today = new Date(now); today.setHours(0, 0, 0, 0); const start = startOfWeek(now); const key = weekKey(start);
    return visiblePayers().map(payer => { const due = dueDate(payer, start); const payment = paymentFor(payer.id, key); return { payer, due, key, payment, remaining: Math.max(0, amountForWeek(payer,start) - (Number(payment.received) || 0)) }; }).filter(item => item.due > today && item.payment.status !== 'paid' && item.remaining > 0).sort((a, b) => a.due - b.due || a.payer.name.localeCompare(b.payer.name));
  }

  function receivedItemsThisWeek() {
    const start = startOfWeek(); const end = new Date(start); end.setDate(end.getDate() + 7); const startKey = localDate(start); const endKey = localDate(end);
    return visiblePayers().flatMap(payer => recordsFor(payer).map(({ key, payment }) => ({ payer, due: parseLocalDate(payment.dueDate) || dueDate(payer, parseLocalDate(key)), key, payment, received: Number(payment.received) || 0 }))).filter(item => item.received > 0 && item.payment.receivedDate >= startKey && item.payment.receivedDate < endKey).sort((a, b) => (b.payment.receivedDate || '').localeCompare(a.payment.receivedDate || '') || a.payer.name.localeCompare(b.payer.name));
  }

  function currentWeekPaid(payer) { return paymentFor(payer.id, weekKey()).status === 'paid'; }

  function situation(payer) {
    const now = new Date(); const overdue = overdueDates(payer,now);
    if (overdue.length) return { late: overdue.length, since: overdue[0], text: `${overdue.length} ${overdue.length === 1 ? 'semana atrasado' : 'semanas atrasado'}`, className: '' };
    const today = new Date(now); today.setHours(0,0,0,0); const grace = dueInstancesThrough(payer,today).find(due => due < today && deadlineFor(due) >= now && paymentFor(payer.id,weekKey(due)).status !== 'paid');
    if (grace) return { late:0,grace:true,since:grace,text:'Em tolerância até 12h',className:'grace' };
    if (Number(termsForWeek(payer).day) === new Date().getDay() && !currentWeekPaid(payer)) return { late: 0, since: null, text: 'Vence hoje', className: '' };
    return { late: 0, since: null, text: 'Em dia', className: 'current' };
  }

  function pendingPayers() {
    return visiblePayers().filter(payer => pendingItems(payer).length > 0);
  }

  function earningsThisWeek(now = new Date()) {
    const start = startOfWeek(now); const end = new Date(start); end.setDate(end.getDate() + 7); const startKey = localDate(start); const endKey = localDate(end);
    return (state.earnings || []).filter(item => item.date >= startKey && item.date < endKey).sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }
  function earningsThisMonth(now = new Date()) {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const startKey = localDate(start); const endKey = localDate(end);
    return (state.earnings || []).filter(item => item.date >= startKey && item.date < endKey).sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  function earningsMonthStats(now = new Date()) {
    const records = earningsThisMonth(now);
    const workRecords = records.filter(isWorkEarning);
    const excludedRecords = records.filter(item => !isWorkEarning(item));
    const total = records.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const workTotal = workRecords.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const excludedTotal = excludedRecords.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return { records, workRecords, excludedRecords, total, workTotal, excludedTotal, appTotals: groupedTotal(records,'app'), personTotals: groupedTotal(records,'person') };
  }
  function isWorkEarning(item) {
    if (item?.category === 'subsidy') return false;
    if (item?.category === 'work') return true;
    const text = `${item.notes || ''} ${item.source || ''} ${item.kind || ''}`.toLowerCase();
    return !/(subsidy|health|padsa|insurance|seguro|adicional|evento|event|bonus|bônus|promo|reembolso|refund)/i.test(text);
  }
  function earningCategoryLabel(item) {
    return isWorkEarning(item) ? 'Trabalho' : 'Subsidio / Outros';
  }
  function workScoreFor(total) {
    if (total >= 2000) return { value: 100, label: 'Trabalhando duro', className: 'hard', next: 'Meta maxima da semana batida' };
    if (total >= 1500) return { value: 80, label: 'Trabalhando firme', className: 'great', next: `${dollars(2000 - total)} para Trabalhando duro` };
    if (total >= 1000) return { value: 60, label: 'Bom esforco', className: 'good', next: `${dollars(1500 - total)} para Trabalhando firme` };
    if (total >= 500) return { value: 40, label: 'Pegando ritmo', className: 'warming', next: `${dollars(1000 - total)} para Bom esforco` };
    return { value: total > 0 ? 20 : 0, label: total > 0 ? 'Ta moleza' : 'Sem trabalho na semana', className: 'lazy', next: `${dollars(500 - total)} para Pegando ritmo` };
  }
  function groupedTotal(records, field) {
    return records.reduce((map, item) => { const key = item[field] || 'Outros'; map[key] = (map[key] || 0) + Number(item.amount || 0); return map; }, {});
  }
  function daysWithEarnings(records) { return new Set(records.map(item => item.date)).size; }
  function workdayCountThisWeek(now = new Date()) {
    const start = startOfWeek(now);
    const today = new Date(now); today.setHours(0,0,0,0);
    let count = 0;
    for (let i = 0; i < 6; i++) {
      const day = new Date(start); day.setDate(start.getDate() + i);
      if (day <= today) count++;
    }
    return Math.max(1, Math.min(6, count));
  }
  function trendClass(current, previous) {
    if (Math.abs(current - previous) < 0.01) return 'same';
    return current > previous ? 'up' : 'down';
  }
  function earningsDailyTotals(start, filter) {
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const startKey = localDate(start); const endKey = localDate(end);
    const totals = [0,0,0,0,0,0];
    (state.earnings || []).filter(item => item.date >= startKey && item.date < endKey && filter(item)).forEach(item => {
      const date = parseLocalDate(item.date); const index = date ? date.getDay() - 1 : -1;
      if (index >= 0 && index < 6) totals[index] += Number(item.amount || 0);
    });
    return totals;
  }
  function rentalDailyTotals(start) {
    const end = new Date(start); end.setDate(start.getDate() + 6);
    const startKey = localDate(start); const endKey = localDate(end);
    const totals = [0,0,0,0,0,0];
    visiblePayers().flatMap(payer => recordsFor(payer).map(({ payment }) => ({ payment, received: Number(payment.received) || 0 }))).filter(item => item.received > 0 && item.payment.receivedDate >= startKey && item.payment.receivedDate < endKey).forEach(item => {
      const date = parseLocalDate(item.payment.receivedDate); const index = date ? date.getDay() - 1 : -1;
      if (index >= 0 && index < 6) totals[index] += item.received;
    });
    return totals;
  }
  function dailyTotalsRows(totals) {
    const labels = ['Segunda','Terca','Quarta','Quinta','Sexta','Sabado'];
    return totals.map((value, index) => detailRow(labels[index], dollars(value)));
  }
  function compareLabel(current, previous) {
    const diff = current - previous;
    if (Math.abs(diff) < 0.01) return `igual a semana anterior (${dollars(previous)})`;
    return `${diff > 0 ? '+' : '-'}${dollars(Math.abs(diff))} vs semana anterior (${dollars(previous)})`;
  }
  function setEarningsPanel(panel = 'entries') {
    document.querySelectorAll('[data-earnings-tab]').forEach(button => button.classList.toggle('active', button.dataset.earningsTab === panel));
    document.querySelectorAll('[data-earnings-panel]').forEach(section => { section.hidden = section.dataset.earningsPanel !== panel; });
  }
  function chartPath(values, max, height = 82) {
    const coords = values.map((value, index) => ({ x: 10 + (index * 16), y: height - 12 - ((value / Math.max(1,max)) * (height - 28)) }));
    if (!coords.length) return '';
    return coords.slice(1).reduce((path, point) => `${path} L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`, `M ${coords[0].x.toFixed(1)} ${coords[0].y.toFixed(1)}`);
  }
  function visualChart(title, current, previous, currentLabel, previousLabel) {
    const max = Math.max(1, ...current, ...previous);
    const labels = ['S','T','Q','Q','S','S'];
    const dots = current.map((value,index) => `<span class="chart-day"><b>${labels[index]}</b><small>${dollars(value)}</small></span>`).join('');
    return `<article class="visual-chart"><div class="visual-chart-head"><strong>${escapeHtml(title)}</strong><span class="legend"><i class="current"></i>${escapeHtml(currentLabel)} <i class="previous"></i>${escapeHtml(previousLabel)}</span></div><svg viewBox="0 0 100 82" preserveAspectRatio="none"><path class="previous" d="${chartPath(previous,max)}"></path><path class="current" d="${chartPath(current,max)}"></path></svg><div class="chart-days">${dots}</div></article>`;
  }
  function distributionBars(items) {
    const total = items.reduce((sum, item) => sum + Number(item[1] || 0), 0);
    return `<article class="distribution-card">${items.map(([label,value,tone]) => `<div class="distribution-row"><span>${escapeHtml(label)}</span><strong>${dollars(value)}</strong><div class="distribution-track"><i class="${tone}" style="width:${total ? Math.max(3,(value / total) * 100) : 0}%"></i></div></div>`).join('')}</article>`;
  }
  function renderEarningsStatistics(stats) {
    const currentStart = startOfWeek();
    const previousStart = new Date(currentStart); previousStart.setDate(currentStart.getDate() - 7);
    const currentWork = earningsDailyTotals(currentStart, isWorkEarning);
    const previousWork = earningsDailyTotals(previousStart, isWorkEarning);
    const currentOther = earningsDailyTotals(currentStart, item => !isWorkEarning(item));
    const previousOther = earningsDailyTotals(previousStart, item => !isWorkEarning(item));
    const currentRentals = rentalDailyTotals(currentStart);
    const previousRentals = rentalDailyTotals(previousStart);
    const previousWorkTotal = previousWork.reduce((sum, value) => sum + value, 0);
    const previousOtherTotal = previousOther.reduce((sum, value) => sum + value, 0);
    const previousRentalTotal = previousRentals.reduce((sum, value) => sum + value, 0);
    const goalPct = stats.goal ? Math.min(100, Math.round((stats.workTotal / stats.goal) * 100)) : 0;
    const weekPct = previousWorkTotal ? Math.round((stats.workTotal / previousWorkTotal) * 100) : (stats.workTotal ? 100 : 0);
    const avgTarget = Number(stats.dailyGoal || 250);
    const avgPct = avgTarget ? Math.min(100, Math.round((stats.average / avgTarget) * 100)) : 0;
    const ring = (label, value, caption, tone = 'green') => `<article class="stat-ring-card ${tone}"><div class="stat-ring" style="--pct:${Math.max(0,Math.min(100,value))}"><span>${value}%</span></div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(caption)}</small></article>`;
    if ($('earningsReports')) $('earningsReports').innerHTML = '';
    if ($('earningsStatsSummary')) $('earningsStatsSummary').innerHTML = [
      ring('Meta', goalPct, stats.goal ? `${dollars(stats.workTotal)} de ${dollars(stats.goal)}` : 'Meta nao definida', goalPct >= 100 ? 'green' : 'amber'),
      ring('Semana', Math.min(160, weekPct), previousWorkTotal ? `${compareLabel(stats.workTotal, previousWorkTotal)}` : 'Sem base anterior', weekPct >= 100 ? 'green' : 'red'),
      ring('Media', avgPct, avgTarget ? `${dollars(stats.average)} por dia util` : 'Defina meta para medir', avgPct >= 100 ? 'green' : 'amber'),
      ring('Score', stats.workScore.value, stats.workScore.label, stats.workScore.value >= 60 ? 'green' : 'red')
    ].join('');
    if ($('earningsStatsDaily')) $('earningsStatsDaily').innerHTML = [
      visualChart('Trabalho', currentWork, previousWork, 'Semana atual', 'Semana passada'),
      visualChart('Outros / auxilios', currentOther, previousOther, 'Atual', 'Semana passada'),
      visualChart('Alugueis', currentRentals, previousRentals, 'Atual', 'Semana passada')
    ].join('');
    if ($('earningsStatsBreakdowns')) $('earningsStatsBreakdowns').innerHTML = distributionBars([
      ['Trabalho', stats.workTotal, 'green'],
      ['Outros', stats.excludedTotal, 'amber'],
      ['Alugueis', stats.rentalTotal, 'blue']
    ]);
  }
  function miniTrendHtml(current, previous) {
    const max = Math.max(1, ...current, ...previous);
    const coords = values => values.map((value, index) => ({ x: 6 + (index * 17.6), y: 36 - ((value / max) * 20) }));
    const stepPath = values => {
      const points = coords(values);
      if (!points.length) return '';
      return points.slice(1).reduce((path, point, index) => {
        const prev = points[index]; const mid = (prev.x + point.x) / 2;
        return `${path} H ${mid.toFixed(1)} V ${point.y.toFixed(1)} H ${point.x.toFixed(1)}`;
      }, `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`);
    };
    const currentCoords = coords(current);
    const totalCurrent = current.reduce((sum, value) => sum + value, 0);
    const totalPrevious = previous.reduce((sum, value) => sum + value, 0);
    const status = trendClass(totalCurrent, totalPrevious);
    const dots = current.map((value, index) => {
      const point = currentCoords[index];
      return `<circle class="trend-dot ${trendClass(value, previous[index] || 0)}" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="1.55"></circle>`;
    }).join('');
    return `<div class="mini-trend trend-${status}" aria-hidden="true"><svg viewBox="0 0 100 46" preserveAspectRatio="none"><path class="trend-previous" d="${stepPath(previous)}"></path><path class="trend-current" d="${stepPath(current)}"></path>${dots}</svg></div>`;
  }
  function setCardTrend(selector, current, previous) {
    const card = document.querySelector(selector);
    if (!card) return;
    card.querySelector('.mini-trend')?.remove();
    card.insertAdjacentHTML('afterbegin', miniTrendHtml(current, previous));
  }
  function renderEarningsTrends() {
    const currentStart = startOfWeek();
    const previousStart = new Date(currentStart); previousStart.setDate(currentStart.getDate() - 7);
    const currentWork = earningsDailyTotals(currentStart, isWorkEarning);
    const previousWork = earningsDailyTotals(previousStart, isWorkEarning);
    const currentOther = earningsDailyTotals(currentStart, item => !isWorkEarning(item));
    const previousOther = earningsDailyTotals(previousStart, item => !isWorkEarning(item));
    const currentRentals = rentalDailyTotals(currentStart);
    const previousRentals = rentalDailyTotals(previousStart);
    setCardTrend('[data-earnings-detail="week"]', currentWork, previousWork);
    setCardTrend('[data-earnings-detail="average"]', currentWork, previousWork);
    setCardTrend('[data-earnings-detail="score"]', currentWork, previousWork);
    setCardTrend('[data-earnings-detail="goal"]', currentWork, previousWork);
    setCardTrend('[data-earnings-detail="other"]', currentOther, previousOther);
    setCardTrend('[data-earnings-detail="rentals"]', currentRentals, previousRentals);
    setCardTrend('[data-earnings-detail="month"]', currentWork.map((value, index) => value + currentOther[index]), previousWork.map((value, index) => value + previousOther[index]));
  }
  function yesterdayHasEarnings(now = new Date()) { const date = new Date(now); date.setDate(date.getDate() - 1); return (state.earnings || []).some(item => item.date === localDate(date)); }
  function todayHasEarnings(now = new Date()) { return (state.earnings || []).some(item => item.date === localDate(now)); }
  function earningsStats() {
    const records = earningsThisWeek();
    const rentalRecords = receivedItemsThisWeek();
    const rentalTotal = rentalRecords.reduce((sum, item) => sum + Number(item.received || 0), 0);
    const total = records.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const workRecords = records.filter(isWorkEarning);
    const excludedRecords = records.filter(item => !isWorkEarning(item));
    const workTotal = workRecords.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const excludedTotal = excludedRecords.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const workScore = workScoreFor(workTotal);
    const goal = Number(state.earningsSettings?.weeklyGoal || 0);
    const dailyGoal = Number(state.earningsSettings?.dailyGoal || 250);
    const dayCount = workdayCountThisWeek();
    const average = dayCount ? workTotal / dayCount : 0;
    const diff = workTotal - goal;
    return { records, total, workRecords, excludedRecords, workTotal, excludedTotal, workScore, rentalRecords, rentalTotal, goal, dailyGoal, dayCount, average, diff, appTotals: groupedTotal(workRecords,'app'), personTotals: groupedTotal(workRecords,'person') };
  }
  function renderEarnings() {
    state.earnings ||= []; state.earningsSettings ||= { weeklyGoal: 0, dailyGoal: 250 };
    const start = startOfWeek(); const end = new Date(start); end.setDate(end.getDate() + 6);
    $('earningsWeekLabel').textContent = `${formatShort(start)} a ${formatShort(end)}`;
    $('earningDate').value ||= localDate();
    $('earningsGoalInput').value = state.earningsSettings.weeklyGoal ? Number(state.earningsSettings.weeklyGoal).toFixed(2).replace('.', ',') : '';
    $('earningsDailyGoalInput').value = Number(state.earningsSettings.dailyGoal || 250).toFixed(2).replace('.', ',');
    const stats = earningsStats();
    const { records, total, workTotal, excludedTotal, workScore, excludedRecords, rentalTotal, goal, dayCount, average, diff, appTotals, personTotals } = stats;
    const monthStats = earningsMonthStats();
    if ($('earningsMonthTotal')) $('earningsMonthTotal').textContent = dollars(monthStats.total);
    if ($('earningsMonthBreakdown')) $('earningsMonthBreakdown').textContent = `Trabalho ${dollars(monthStats.workTotal)} - Outros ${dollars(monthStats.excludedTotal)}`;
    $('earningsWeekTotal').textContent = dollars(workTotal); $('earningsGoalValue').textContent = dollars(goal); $('earningsDailyAverage').textContent = dollars(average); $('earningsOtherTotal').textContent = dollars(excludedTotal); $('earningsRentalTotal').textContent = dollars(rentalTotal);
    $('earningsWorkScore').textContent = `${workScore.value}/100`;
    $('earningsWorkScoreLabel').textContent = `${workScore.label} - ${dollars(workTotal)} em trabalho`;
    const scoreCard = document.querySelector('.score-summary');
    if (scoreCard) { scoreCard.classList.remove('score-lazy','score-warming','score-good','score-great','score-hard'); scoreCard.classList.add(`score-${workScore.className}`); }
    $('earningsGoalDiff').textContent = goal ? (diff >= 0 ? `${dollars(diff)} acima da meta` : `${dollars(Math.abs(diff))} para bater a meta`) : 'Defina uma meta';
    const reportRows = [
      ['Score semanal', `${workScore.label} (${workScore.value}/100) - ${dollars(workTotal)} em trabalho`],
      ['Total de trabalho', `${dollars(workTotal)} usado em total, media, meta e score`],
      ['Outros / auxilios', excludedRecords.length ? `${dollars(excludedTotal)} - ${excludedRecords.map(item => `${formatDate(item.date)}: ${dollars(item.amount)}${item.notes ? ` (${item.notes})` : ''}`).join(' - ')}` : 'Nenhum evento/subsidio nesta semana'],
      ['Total por aplicativo', Object.entries(appTotals).map(([name,value]) => `${name}: ${dollars(value)}`).join(' · ') || 'Sem lançamentos'],
      ['Total por pessoa', Object.entries(personTotals).map(([name,value]) => `${name}: ${dollars(value)}`).join(' · ') || 'Sem lançamentos'],
      ['Meta semanal', goal ? dollars(goal) : 'Não definida'],
      ['Diferença para meta', goal ? (diff >= 0 ? `+${dollars(diff)}` : `-${dollars(Math.abs(diff))}`) : 'Não definida']
    ];
    $('earningsReports').innerHTML = reportRows.map(([label,value]) => `<div class="report-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    renderEarningsStatistics(stats);
    $('earningsCount').textContent = String((state.earnings || []).length);
    setTimeout(renderEarningsTrends, 0);
    setTimeout(renderEditableEarningsHistory, 0);
    const history = (state.earnings || []).slice().sort((a,b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0,80);
    $('earningsHistory').innerHTML = history.length ? history.map(item => `<article class="detail-item"><div class="detail-item-main"><strong>${formatDate(item.date)} · ${escapeHtml(item.app)} · ${escapeHtml(item.person)}</strong><span>${dollars(item.amount)}${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span></div><button class="delete" data-delete-earning="${item.id}">Excluir</button></article>`).join('') : empty('Nenhum ganho registrado ainda.');
  }
  function renderEditableEarningsHistory() {
    const target = $('earningsHistory');
    if (!target) return;
    const history = (state.earnings || []).slice().sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0,80);
    target.innerHTML = history.length ? history.map(item => `<article class="detail-item"><div class="detail-item-main"><strong>${formatDate(item.date)} - ${escapeHtml(item.app)} - ${escapeHtml(item.person)}</strong><span>${dollars(item.amount)} - ${escapeHtml(earningCategoryLabel(item))}${item.notes ? ` - ${escapeHtml(item.notes)}` : ''}</span></div><div class="detail-actions"><button type="button" data-edit-earning="${item.id}">Editar</button><button class="delete" type="button" data-delete-earning="${item.id}">Excluir</button></div></article>`).join('') : empty('Nenhum ganho registrado ainda.');
  }
  function detailRow(label,value) { return `<article class="detail-item"><div class="detail-item-main"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div></article>`; }
  function earningsRecordRow(item) { return `<article class="detail-item"><div class="detail-item-main"><strong>${formatDate(item.date)} · ${escapeHtml(item.app)} · ${escapeHtml(item.person)}</strong><span>${dollars(item.amount)}${item.notes ? ` · ${escapeHtml(item.notes)}` : ''}</span></div></article>`; }
  function flexStyleEarningRow(item) {
    const isPayment = /payment sent/i.test(item.notes || '');
    const icon = isPayment ? '🏦' : '📦';
    const title = isPayment ? 'Payment sent' : formatFull(parseLocalDate(item.date));
    const detail = isPayment ? formatFull(parseLocalDate(item.date)) : (item.notes || 'Paid');
    const paidText = isPayment ? '' : '<small>Paid</small>';
    return `<article class="flex-earning-row ${isPayment ? 'sent' : ''}"><div class="flex-icon">${icon}</div><div class="flex-info"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span>${paidText}</div><div class="flex-amount">${dollars(item.amount)}</div></article>`;
  }
  function renderFlexWeekDetail(workRecords, excludedRecords, workTotal, excludedTotal, total) {
    const records = [...workRecords, ...excludedRecords].slice().sort((a,b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''));
    return `<div class="flex-week-shell"><div class="flex-week-summary"><span>Work</span><strong>${dollars(workTotal)}</strong><small>Other / auxilios: ${dollars(excludedTotal)} · Geral: ${dollars(total)}</small></div>${records.length ? records.map(flexStyleEarningRow).join('') : empty('Nenhum ganho registrado nesta semana.')}</div>`;
  }
  function openEarningsGoal() {
    const { workTotal, excludedTotal, goal, dailyGoal, average, dayCount, diff } = earningsStats();
    $('earningsGoalInput').value = goal ? goal.toFixed(2).replace('.', ',') : '';
    $('earningsDailyGoalInput').value = Number(dailyGoal || 250).toFixed(2).replace('.', ',');
    $('earningsGoalDetails').innerHTML = [
      ['Total de trabalho', dollars(workTotal)],
      ['Outros / auxilios', dollars(excludedTotal)],
      ['Meta diaria', dollars(dailyGoal || 250)],
      ['Meta atual', goal ? dollars(goal) : 'Não definida'],
      ['Diferença', goal ? (diff >= 0 ? `${dollars(diff)} acima da meta` : `${dollars(Math.abs(diff))} faltando`) : 'Defina uma meta'],
      ['Média diária', `${dollars(average)} em ${dayCount} dia(s) úteis, seg a sáb`]
    ].map(([label,value]) => `<div class="report-item"><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
    $('earningsGoalDialog').showModal();
  }
  function openEarningsDetail(type) {
    const { records, total, workRecords, excludedRecords, workTotal, excludedTotal, workScore, rentalRecords, rentalTotal, goal, average, dayCount, diff, appTotals, personTotals } = earningsStats();
    if (type === 'goal') { openEarningsGoal(); return; }
    $('earningsDetailTitle').textContent = type === 'average' ? 'Média diária' : 'Total da semana';
    if (type === 'score') $('earningsDetailTitle').textContent = 'Score semanal';
    if (type === 'other') $('earningsDetailTitle').textContent = 'Outros / auxilios';
    if (type === 'rentals') $('earningsDetailTitle').textContent = 'Alugueis da semana';
    if (type === 'month') $('earningsDetailTitle').textContent = 'Valor mensal';
    $('earningsDetailBody').classList.toggle('flex-week-detail', type === 'week');
    if (type === 'month') {
      const month = earningsMonthStats();
      $('earningsDetailBody').innerHTML = [
        detailRow('Total geral do mes', dollars(month.total)),
        detailRow('Total de trabalho', dollars(month.workTotal)),
        detailRow('Subsidios / outros', dollars(month.excludedTotal)),
        detailRow('Por aplicativo', Object.entries(month.appTotals).map(([name,value]) => `${name}: ${dollars(value)}`).join(' - ') || 'Sem lancamentos'),
        detailRow('Por pessoa', Object.entries(month.personTotals).map(([name,value]) => `${name}: ${dollars(value)}`).join(' - ') || 'Sem lancamentos'),
        ...(month.records.length ? month.records.map(earningsRecordRow) : [empty('Nenhum ganho registrado neste mes.')])
      ].join('');
      $('earningsDetailDialog').showModal();
      return;
    }
    if (type === 'week') {
      $('earningsDetailBody').innerHTML = renderFlexWeekDetail(workRecords, excludedRecords, workTotal, excludedTotal, total);
      $('earningsDetailDialog').showModal();
      return;
    }
    if (type === 'average') {
      $('earningsDetailTitle').textContent = 'Media diaria';
      const dailyWork = earningsDailyTotals(startOfWeek(), isWorkEarning);
      $('earningsDetailBody').innerHTML = [
        detailRow('Media diaria', `${dollars(average)} em ${dayCount} dia(s) uteis, seg a sab`),
        detailRow('Total de trabalho', dollars(workTotal)),
        detailRow('Por dia', 'Segunda a sabado, somente trabalho'),
        ...dailyTotalsRows(dailyWork),
        detailRow('Outros / auxilios', `${dollars(excludedTotal)} fora da media`),
        detailRow('Meta semanal', goal ? dollars(goal) : 'Nao definida'),
        detailRow('Diferenca para meta', goal ? (diff >= 0 ? `${dollars(diff)} acima` : `${dollars(Math.abs(diff))} faltando`) : 'Nao definida')
      ].join('');
      $('earningsDetailDialog').showModal();
      return;
    }
    const rows = type === 'score'
      ? [
          detailRow('Score', `${workScore.label} - ${workScore.value}/100`),
          detailRow('Valor que conta', `${dollars(workTotal)} em pagamentos de trabalho`),
          detailRow('Proxima etapa', workScore.next),
          detailRow('Escala', '0-499 Ta moleza - 500+ Pegando ritmo - 1000+ Bom esforco - 1500+ Trabalhando firme - 2000+ Trabalhando duro'),
          detailRow('Fora do score', excludedRecords.length ? excludedRecords.map(item => `${formatDate(item.date)}: ${dollars(item.amount)}${item.notes ? ` (${item.notes})` : ''}`).join(' - ') : 'Nenhum evento/subsidio nesta semana'),
          ...(workRecords.length ? workRecords.map(earningsRecordRow) : [empty('Nenhum pagamento de trabalho nesta semana.')])
        ]
      : type === 'other'
      ? [
          detailRow('Total separado', dollars(excludedTotal)),
          detailRow('Regra', 'Auxilios, eventos e subsidios nao entram no total semanal de trabalho, media diaria, meta ou score.'),
          ...(excludedRecords.length ? excludedRecords.map(earningsRecordRow) : [empty('Nenhum auxilio/evento nesta semana.')])
        ]
      : type === 'rentals'
      ? [
          detailRow('Total recebido em alugueis', dollars(rentalTotal)),
          detailRow('Regra', 'Valor apenas visual. Nao entra no total semanal de ganhos, media, meta ou score.'),
          ...(rentalRecords.length ? rentalRecords.map(item => detailRow(item.payer.name, `${dollars(item.received)} recebido em ${formatDate(item.payment.receivedDate)}`)) : [empty('Nenhum aluguel recebido nesta semana.')])
        ]
      : type === 'average'
      ? [
          detailRow('Média diária', `${dollars(average)} em ${dayCount} dia(s) com ganhos`),
          detailRow('Total de trabalho', dollars(workTotal)),
          detailRow('Outros / auxilios', `${dollars(excludedTotal)} fora da media`),
          detailRow('Meta semanal', goal ? dollars(goal) : 'Não definida'),
          detailRow('Diferença para meta', goal ? (diff >= 0 ? `${dollars(diff)} acima` : `${dollars(Math.abs(diff))} faltando`) : 'Não definida')
        ]
      : [
          detailRow('Total de trabalho', dollars(workTotal)),
          detailRow('Outros / auxilios', `${dollars(excludedTotal)} fora do total de trabalho`),
          detailRow('Total geral registrado', dollars(total)),
          detailRow('Por aplicativo', Object.entries(appTotals).map(([name,value]) => `${name}: ${dollars(value)}`).join(' · ') || 'Sem lançamentos'),
          detailRow('Por pessoa', Object.entries(personTotals).map(([name,value]) => `${name}: ${dollars(value)}`).join(' · ') || 'Sem lançamentos'),
          ...(workRecords.length ? workRecords.map(earningsRecordRow) : [empty('Nenhum ganho de trabalho registrado nesta semana.')])
        ];
    $('earningsDetailBody').innerHTML = rows.join('');
    $('earningsDetailDialog').showModal();
  }
  function resetEarningForm() {
    if ($('earningId')) $('earningId').value = '';
    if ($('earningCategory')) $('earningCategory').value = 'work';
    if ($('earningAmount')) $('earningAmount').value = '';
    if ($('earningNotes')) $('earningNotes').value = '';
    if ($('earningSubmitBtn')) $('earningSubmitBtn').textContent = 'Salvar ganho';
  }
  function editEarning(id) {
    const item = state.earnings?.find(earning => earning.id === id);
    if (!item) return;
    setEarningsPanel('entries');
    $('earningId').value = item.id;
    $('earningDate').value = item.date || localDate();
    $('earningApp').value = item.app || 'Outros';
    $('earningPerson').value = item.person || 'Matheus';
    $('earningCategory').value = isWorkEarning(item) ? 'work' : 'subsidy';
    $('earningAmount').value = Number(item.amount || 0).toFixed(2).replace('.', ',');
    $('earningNotes').value = item.notes || '';
    $('earningSubmitBtn').textContent = 'Salvar alteracao';
    $('earningForm').scrollIntoView({ behavior:'smooth', block:'start' });
  }
  function addEarning(event) {
    event.preventDefault();
    const amount = parseMoney($('earningAmount').value);
    if (!Number.isFinite(amount) || amount <= 0) { showToast('Informe um valor válido.'); return; }
    state.earnings ||= [];
    const id = $('earningId')?.value || '';
    const payload = { date:$('earningDate').value || localDate(), app:$('earningApp').value, person:$('earningPerson').value, amount, notes:$('earningNotes').value.trim(), category:$('earningCategory')?.value || 'work', type:'earning', updatedAt:new Date().toISOString() };
    if (id) {
      const item = state.earnings.find(earning => earning.id === id);
      if (!item) { showToast('Lancamento nao encontrado.'); return; }
      Object.assign(item, payload);
    } else {
      state.earnings.push({ ...payload, id:uid(), createdAt:new Date().toISOString() });
    }
    resetEarningForm();
    saveState(); renderEarnings(); showToast(id ? 'Ganho atualizado.' : 'Ganho registrado.');
  }
  function saveEarningsGoal(event) {
    event.preventDefault();
    const goal = parseMoney($('earningsGoalInput').value || '0');
    const dailyGoal = parseMoney($('earningsDailyGoalInput').value || '250');
    state.earningsSettings ||= {};
    state.earningsSettings.weeklyGoal = Number.isFinite(goal) && goal > 0 ? goal : 0;
    state.earningsSettings.dailyGoal = Number.isFinite(dailyGoal) && dailyGoal > 0 ? dailyGoal : 250;
    saveState(); renderEarnings(); if ($('earningsGoalDialog').open) $('earningsGoalDialog').close(); showToast('Metas salvas.');
  }

  function scoreFor(payer) {
    const manual = (payer.penalties || []).reduce((sum, penalty) => sum + Number(penalty.points || 0), 0);
    const delayPenalty = (payer.lateCount || 0) * 10;
    const value = Math.max(0, Math.min(100, 100 - manual - delayPenalty));
    const label = value >= 90 ? 'EXCELENTE' : value >= 75 ? 'ÓTIMO' : value >= 60 ? 'BOM' : value >= 40 ? 'RUIM' : 'RISCO DE PERDER A PARCERIA';
    const className = value >= 90 ? 'excellent' : value >= 75 ? 'great' : value >= 60 ? 'good' : value >= 40 ? 'bad' : 'critical';
    return { value, label, className, manual, delayPenalty };
  }

  function defaultPaymentWeek(payer) {
    const overdue = overdueDates(payer);
    return overdue.length ? weekKey(overdue[0]) : weekKey();
  }

  function card(payer, mode = 'payment') {
    const auto = situation(payer); const payment = paymentFor(payer.id); const notes = payment.notes || payer.notes;
    const currentTerms = termsForWeek(payer);
    const historyText = auto.late ? `Pendente desde ${formatFull(auto.since)} · já atrasou ${payer.lateCount || 0} ${(payer.lateCount || 0) === 1 ? 'vez' : 'vezes'}` : auto.text;
    const currentDue = dueDate(payer); const today = new Date(); today.setHours(0, 0, 0, 0);
    const timer = auto.late ? timerMarkup('overdue', auto.since) : auto.grace ? timerMarkup('countdown',auto.since) : (currentDue >= today && payment.status !== 'paid' ? timerMarkup('countdown', currentDue) : '');
    return `<article class="payment-card ${auto.late ? 'overdue' : ''} ${auto.className === 'current' ? 'paid' : ''}">
      <div><h3><button class="payer-link" data-profile="${payer.id}">${escapeHtml(payer.name)}</button></h3><div class="payment-meta"><span>${DAYS[currentTerms.day]}</span><span>Vence ${formatShort(dueDate(payer))}</span><span>${scoreFor(payer).label} · ${scoreFor(payer).value}</span></div><span class="delay-label ${auto.className}">${historyText}</span>${timer}${notes ? `<p class="payment-notes">${escapeHtml(notes)}</p>` : ''}</div>
      <div class="amount"><strong>${money(amountForWeek(payer))}</strong>${mode === 'payment' ? `<span class="status-badge status-${payment.status}">${statusLabel(payment.status)}</span>` : `<span class="payment-notes">Último:<br>${formatDate(lastReceivedForPayer(payer))}</span>`}</div>
      <div class="card-actions">${mode === 'payment' ? `<button data-payment="${payer.id}" data-week="${defaultPaymentWeek(payer)}">Registrar recebimento</button>` : `<button data-edit="${payer.id}">Editar</button><button class="delete" data-delete="${payer.id}">Excluir</button>`}</div>
    </article>`;
  }

  function scheduleCard(payer, weekStart, label) {
    const key = weekKey(weekStart); const due = dueDate(payer, weekStart); const payment = paymentFor(payer.id, key);
    const terms = termsForWeek(payer,weekStart);
    return `<article class="payment-card ${payment.status === 'paid' ? 'paid' : ''}">
      <div><h3><button class="payer-link" data-profile="${payer.id}">${escapeHtml(payer.name)}</button></h3><div class="payment-meta"><span>${DAYS[terms.day]}</span><span>${formatFull(due)}</span><span>${scoreFor(payer).label} · ${scoreFor(payer).value}</span></div><span class="schedule-label">${label}</span><br>${timerMarkup('countdown', due)}</div>
      <div class="amount"><strong>${money(amountForWeek(payer,weekStart))}</strong><span class="status-badge status-${payment.status}">${statusLabel(payment.status)}</span></div>
      <div class="card-actions"><button data-payment="${payer.id}" data-week="${key}">Registrar recebimento</button></div>
    </article>`;
  }

  function empty(message) { return `<div class="empty">${message}</div>`; }

  function renderDashboard() {
    const now = new Date(); const today = now.getDay(); const currentStart = startOfWeek(now); const nextStart = new Date(currentStart); nextStart.setDate(nextStart.getDate() + 7);
    const payers = visiblePayers();
    const todayItems = payers.filter(p => p.day === today);
    const overdueItems = payers.filter(p => overdueDates(p, now).length > 0).sort((a, b) => situation(a).since - situation(b).since);
    const upcoming = [];
    payers.forEach(payer => {
      const currentDue = dueDate(payer, currentStart);
      if (currentDue >= new Date(now.getFullYear(), now.getMonth(), now.getDate()) && paymentFor(payer.id, weekKey(currentStart)).status !== 'paid') upcoming.push({ payer, start: currentStart, due: currentDue, label: 'Esta semana' });
      if (paymentFor(payer.id, weekKey(nextStart)).status !== 'paid') upcoming.push({ payer, start: nextStart, due: dueDate(payer, nextStart), label: 'Próxima semana' });
    });
    upcoming.sort((a, b) => a.due - b.due || a.payer.name.localeCompare(b.payer.name));

    $('todayList').innerHTML = todayItems.length ? todayItems.map(p => card(p)).join('') : empty('Nenhum pagamento vence hoje.');
    $('overdueList').innerHTML = overdueItems.length ? overdueItems.map(p => card(p)).join('') : empty('Tudo em dia por aqui.');
    $('upcomingList').innerHTML = upcoming.length ? upcoming.map(item => scheduleCard(item.payer, item.start, item.label)).join('') : empty('Nenhum pagamento programado para esta ou a próxima semana.');
    $('todayCount').textContent = todayItems.length || ''; $('overdueCount').textContent = overdueItems.length || ''; $('upcomingCount').textContent = upcoming.length || '';
  }

  function renderSummary() {
    const expected = waitingItemsThisWeek().reduce((sum, item) => sum + item.remaining, 0);
    const received = receivedItemsThisWeek().reduce((sum, item) => sum + item.received, 0);
    const pending = visiblePayers().flatMap(payer => pendingItems(payer)).reduce((sum, item) => sum + item.remaining, 0);
    $('totalExpected').textContent = money(expected); $('totalReceived').textContent = money(received); $('totalPending').textContent = money(pending);
    const start = startOfWeek(); const end = new Date(start); end.setDate(end.getDate() + 6); $('weekLabel').textContent = `${formatShort(start)} — ${formatShort(end)}`;
  }

  function renderPayers() {
    const matches = payer => !payerSearchTerm || normalizeClientName(payer.name).includes(normalizeClientName(payerSearchTerm));
    const payers = visiblePayers().filter(matches); $('payerCount').textContent = payers.length || '';
    $('payersList').innerHTML = payers.length ? payers.slice().sort((a, b) => a.day - b.day).map(p => card(p, 'payer')).join('') : empty('Cadastre seu primeiro pagador no botão +.');
    const inactive = allVisiblePayers().filter(payer => payer.active === false && matches(payer)).sort((a,b) => a.name.localeCompare(b.name));
    $('inactivePayerCount').textContent = inactive.length || '';
    $('inactivePayersList').innerHTML = inactive.length ? inactive.map(inactiveCard).join('') : empty('Nenhum pagador inativo.');
  }

  function inactiveCard(payer) {
    const stats = payerStats(payer); const lastReceived = lastReceivedForPayer(payer);
    return `<article class="payment-card inactive-card"><div><h3><button class="payer-link" data-profile="${payer.id}">${escapeHtml(payer.name)}</button></h3><div class="payment-meta"><span>Inativo</span><span>${stats.total} pagamento${stats.total === 1 ? '' : 's'}</span><span>Último: ${formatDate(lastReceived)}</span></div><span class="delay-label current">Histórico preservado</span></div><div class="amount"><strong>${money(stats.totalAmount)}</strong><span class="status-badge">Total pago</span></div><div class="card-actions"><button data-profile="${payer.id}">Ver histórico</button></div></article>`;
  }

  function payerStats(payer) {
    const paid = recordsFor(payer).filter(item => item.payment.status === 'paid').sort((a,b) => (a.payment.receivedDate || '').localeCompare(b.payment.receivedDate || ''));
    const late = paid.filter(item => item.payment.paidLate).length;
    const totalAmount = paid.reduce((sum,item) => sum + (Number(item.payment.received) || 0),0);
    const onTime = paid.length-late; const percentage = paid.length ? Math.round(onTime/paid.length*100) : null;
    const reliability = percentage === null ? 'Sem histórico' : percentage === 100 ? 'Excelente' : percentage >= 95 ? 'Muito Bom' : percentage >= 85 ? 'Bom' : percentage >= 70 ? 'Atenção' : 'Risco';
    const half = Math.floor(paid.length/2); const older = paid.slice(0,half); const recent = paid.slice(half); const olderRate = older.length ? older.filter(item => !item.payment.paidLate).length/older.length : null; const recentRate = recent.length ? recent.filter(item => !item.payment.paidLate).length/recent.length : null;
    const trend = olderRate === null || recentRate === null ? 'Dados insuficientes' : recentRate > olderRate+.05 ? 'Melhorando' : recentRate < olderRate-.05 ? 'Piorando' : 'Estável';
    return { total:paid.length,totalAmount,onTime,late,delays:late,percentage,reliability,trend };
  }

  function lastReceivedForPayer(payer) {
    return recordsFor(payer).filter(item => item.payment.status === 'paid' && item.payment.receivedDate).map(item => item.payment.receivedDate).sort().pop() || payer.lastPaymentDate;
  }

  function renderHistory() {
    const payers = visiblePayers(); $('payerHistoryStats').innerHTML = payers.length ? payers.map(payer => {
      const stats = payerStats(payer);
      const punctuality = stats.percentage === null ? '—' : `${stats.percentage}%`;
      return `<article class="payer-stats-card"><div class="payer-stats-header"><h3><button class="payer-link" data-profile="${payer.id}">${escapeHtml(payer.name)}</button></h3><span class="late-count ${stats.percentage !== null && stats.percentage >= 85 ? 'zero' : ''}">${stats.reliability}</span></div><div class="stats-grid"><div class="stat"><strong>${stats.total}</strong><span>Pagamentos feitos</span></div><div class="stat"><strong>${money(stats.totalAmount)}</strong><span>Total pago</span></div><div class="stat"><strong>${stats.onTime}</strong><span>Pagos em dia</span></div><div class="stat"><strong>${stats.late}</strong><span>Atrasos</span></div><div class="stat"><strong>${punctuality}</strong><span>Pontualidade</span></div></div></article>`;
    }).join('') : empty('Cadastre pagadores para acompanhar o histórico individual.');

    const weeks = []; for (let i = 0; i < 8; i += 1) { const d = startOfWeek(); d.setDate(d.getDate() - 7 * i); weeks.push(d); }
    $('historyList').innerHTML = weeks.map((start, index) => {
      const key = weekKey(start); const end = new Date(start); end.setDate(end.getDate() + 6);
      const entries = payers.map(payer => ({ payer, payment: paymentFor(payer.id, key) }));
      const expected = entries.reduce((sum, item) => sum + amountForWeek(item.payer,start), 0);
      const received = entries.reduce((sum, item) => sum + Math.min(amountForWeek(item.payer,start), Number(item.payment.received) || 0), 0);
      const items = entries.map(item => { const paidText = item.payment.status === 'paid' ? (item.payment.paidLate ? 'Pago atrasado' : 'Pago em dia') : statusLabel(item.payment.status); return `<div class="history-item ${item.payment.paidLate || item.payment.status !== 'paid' ? 'late' : ''}"><span>${escapeHtml(item.payer.name)} · ${paidText}</span><strong>${money(item.payment.received)}</strong></div>`; }).join('') || '<div class="history-item"><span>Sem pagadores</span></div>';
      return `<details class="history-card" ${index === 0 ? 'open' : ''}><summary><div><strong>${index === 0 ? 'Semana atual' : `${formatShort(start)} — ${formatShort(end)}`}</strong></div><div class="history-totals">Recebido<strong>${money(received)} / ${money(expected)}</strong></div></summary><div class="history-items">${items}</div></details>`;
    }).join('');
  }

  function renderPendingDetails() {
    const items = visiblePayers().flatMap(payer => pendingItems(payer)).sort((a, b) => a.due - b.due || a.payer.name.localeCompare(b.payer.name));
    const now = new Date(); const today = new Date(now); today.setHours(0, 0, 0, 0);
    $('pendingDetailList').innerHTML = items.length ? items.map(item => { const overdue = deadlineFor(item.due) < now; const grace = item.due < today && !overdue; const text = overdue ? 'Venceu' : grace ? 'Em tolerância desde' : 'Vence'; return `<article class="detail-item ${overdue ? 'late' : ''}"><div class="detail-item-main"><strong><button class="payer-link" data-profile="${item.payer.id}">${escapeHtml(item.payer.name)}</button></strong><span>${text} ${formatFull(item.due)} · ${money(item.remaining)} pendente</span>${timerMarkup(overdue ? 'overdue' : 'countdown', item.due)}</div><button data-payment="${item.payer.id}" data-week="${item.key}">Atualizar</button></article>`; }).join('') : empty('Nenhum pagamento pendente. Tudo em dia!');
    updateTimers();
  }

  function openPendingDetails() {
    renderPendingDetails();
    $('pendingDialog').showModal();
  }

  function renderWaitingDetails() {
    const items = waitingItemsThisWeek();
    $('waitingDetailList').innerHTML = items.length ? items.map(item => `<article class="detail-item"><div class="detail-item-main"><strong><button class="payer-link" data-profile="${item.payer.id}">${escapeHtml(item.payer.name)}</button></strong><span>Vence ${formatFull(item.due)} · ${money(item.remaining)} esperando</span>${timerMarkup('countdown', item.due)}</div><button data-payment="${item.payer.id}" data-week="${item.key}">Atualizar</button></article>`).join('') : empty('Nenhum pagamento aguardando nesta semana.');
    updateTimers();
  }

  function openWaitingDetails() {
    renderWaitingDetails();
    $('waitingDialog').showModal();
  }

  function renderReceivedDetails() {
    const items = receivedItemsThisWeek();
    $('receivedDetailList').innerHTML = items.length ? items.map(item => { const label = item.payment.status === 'paid' ? (item.payment.paidLate ? 'Pago atrasado' : 'Pago em dia') : 'Pago parcialmente'; return `<article class="detail-item ${item.payment.paidLate ? 'late' : ''}"><div class="detail-item-main"><strong><button class="payer-link" data-profile="${item.payer.id}">${escapeHtml(item.payer.name)}</button></strong><span>${money(item.received)} · ${label}</span><small>Recebido em ${formatDate(item.payment.receivedDate)} · vencimento ${formatFull(item.due)}</small></div></article>`; }).join('') : empty('Nenhum pagamento recebido nesta semana.');
  }

  function openReceivedDetails() {
    renderReceivedDetails();
    $('receivedDialog').showModal();
  }

  function renderProfile(payer) {
    const active = payer.active !== false; const score = scoreFor(payer); const stats = payerStats(payer); const pending = active ? pendingItems(payer) : []; const pendingValue = pending.reduce((sum, item) => sum + item.remaining, 0);
    const lastReceived = recordsFor(payer).filter(item => item.payment.status === 'paid' && item.payment.receivedDate).map(item => item.payment.receivedDate).sort().pop() || payer.lastPaymentDate;
    $('profilePayerId').value = payer.id; $('profileName').textContent = payer.name; $('profileScore').textContent = score.value; $('profileScoreLabel').textContent = score.label;
    $('profileScoreCard').className = `score-card ${score.className}`;
    const today = new Date(); today.setHours(0, 0, 0, 0); const currentStart = startOfWeek(); const nextStart = new Date(currentStart); nextStart.setDate(nextStart.getDate() + 7);
    const nextOpen = active ? [currentStart, nextStart].map(start => ({ due: dueDate(payer, start), key: weekKey(start) })).filter(item => item.due >= today && paymentFor(payer.id, item.key).status !== 'paid').sort((a, b) => a.due - b.due)[0] : null;
    const clock = !active ? 'Cadastro inativo' : pending[0] ? timerMarkup(deadlineFor(pending[0].due) < new Date() ? 'overdue' : 'countdown', pending[0].due) : (nextOpen ? timerMarkup('countdown', nextOpen.due) : 'Sem prazo aberto');
    const punctuality = stats.percentage === null ? '—' : `${stats.percentage}%`;
    const currentTerms = termsForWeek(payer);
    $('profileOverview').innerHTML = `<div class="profile-fact"><span>Status</span><strong>${active ? 'Ativo' : 'Inativo'}</strong></div><div class="profile-fact"><span>Valor semanal</span><strong>${money(currentTerms.amount)}</strong></div><div class="profile-fact"><span>Vencimento</span><strong>${DAYS[currentTerms.day]}</strong></div><div class="profile-fact"><span>Último recebimento</span><strong>${formatDate(lastReceived)}</strong></div><div class="profile-fact"><span>Pendente agora</span><strong>${money(pendingValue)}</strong></div><div class="profile-fact"><span>Pagamentos feitos</span><strong>${stats.total}</strong></div><div class="profile-fact"><span>Total pago</span><strong>${money(stats.totalAmount)}</strong></div><div class="profile-fact"><span>Atrasos</span><strong>${stats.late}</strong></div><div class="profile-fact"><span>Pontualidade</span><strong>${punctuality}</strong></div><div class="profile-fact"><span>Confiabilidade</span><strong>${stats.reliability}</strong></div><div class="profile-fact"><span>Tendência</span><strong>${stats.trend}</strong></div><div class="profile-fact"><span>Relógio do prazo</span><strong>${clock}</strong></div>`;
    $('togglePayerStatusBtn').textContent = active ? 'Tornar inativo' : 'Reativar pagador'; $('togglePayerStatusBtn').classList.toggle('reactivate', !active);

    const records = recordsFor(payer).sort((a, b) => (b.payment.dueDate || b.key).localeCompare(a.payment.dueDate || a.key));
    $('profilePayments').innerHTML = records.length ? records.map(({ key, payment }) => {
      const due = parseLocalDate(payment.dueDate) || dueDate(payer, parseLocalDate(key));
      const label = payment.status === 'paid' ? (payment.paidLate ? 'Pago atrasado' : 'Pago em dia') : statusLabel(payment.status);
      const dateText = payment.receivedDate ? `Recebido em ${formatDate(payment.receivedDate)}` : 'Ainda não recebido';
      return `<article class="detail-item ${payment.paidLate ? 'late' : ''}"><div class="detail-item-main"><strong>${label} · ${money(payment.received)}</strong><span>Vencimento ${formatFull(due)} · ${dateText}</span></div></article>`;
    }).join('') : empty('Ainda não há pagamentos registrados para esta pessoa.');

    const penalties = (payer.penalties || []).slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    $('profilePenalties').innerHTML = penalties.length ? penalties.map(penalty => `<article class="detail-item late"><div class="detail-item-main"><strong>-${Number(penalty.points)} pontos · ${escapeHtml(penalty.reason)}</strong><span>${formatDate(localDate(new Date(penalty.createdAt)))}</span></div><button class="delete" data-remove-penalty="${penalty.id}" data-payer="${payer.id}">Remover</button></article>`).join('') : empty('Nenhuma punição manual registrada.');
    updateTimers();
  }

  function openProfile(id) {
    const payer = state.payers.find(item => item.id === id); if (!payer) return;
    if ($('pendingDialog').open) $('pendingDialog').close();
    if ($('waitingDialog').open) $('waitingDialog').close();
    if ($('receivedDialog').open) $('receivedDialog').close();
    renderProfile(payer);
    if (!$('profileDialog').open) $('profileDialog').showModal();
  }

  function togglePayerStatus() {
    const payer = state.payers.find(item => item.id === $('profilePayerId').value); if (!payer) return;
    const active = payer.active === false;
    relatedPayers(payer).forEach(item => { item.active = active; item.statusChangedAt = new Date().toISOString(); });
    saveState(); renderAll(); renderProfile(payer); showToast(active ? 'Pagador reativado.' : 'Pagador movido para inativos.');
  }

  function editProfilePayer() {
    const id = $('profilePayerId').value; if (!id) return;
    $('profileDialog').close(); openPayer(id);
  }

  function renderNotificationStatus() {
    const button = $('notificationBtn'); const isLocalhost = ['localhost','127.0.0.1'].includes(location.hostname); const secure = window.isSecureContext || isLocalhost;
    const isIos = /iPhone|iPad|iPod/i.test(navigator.userAgent); const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!secure) { button.disabled = true; button.textContent = 'Requer HTTPS'; $('notificationStatus').textContent = 'No celular, notificações exigem que o PWA esteja publicado em um endereço HTTPS.'; return; }
    if (isIos && !standalone) { button.disabled = true; button.textContent = 'Instale primeiro'; $('notificationStatus').textContent = 'No iPhone, adicione o app à Tela de Início e abra pelo ícone instalado.'; return; }
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    if (!supported) { button.disabled = true; button.textContent = 'Indisponível'; $('notificationStatus').textContent = 'Este navegador ou versão do sistema não oferece Web Push para este PWA.'; return; }
    button.disabled = false;
    const enabled = state.settings?.notifications && state.settings?.pushSubscribed && Notification.permission === 'granted';
    button.textContent = enabled ? 'Desativar' : 'Ativar'; button.classList.toggle('enabled', enabled);
    $('notificationStatus').textContent = enabled ? `${pendingPayers().length} pendente(s) agora. Push ativo: 9h recebimentos e 21h ganhos.` : 'Receba avisos push: 9h recebimentos e 21h ganhos.';
  }

  function renderBackupStatus() { const value = state.settings?.lastBackupAt; $('backupStatus').textContent = value ? `Último backup: ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short'}).format(new Date(value))}.` : 'Nenhum backup registrado.'; }

  function renderAll() { renderSummary(); renderDashboard(); renderPayers(); renderHistory(); renderNotificationStatus(); renderBackupStatus(); if (!$('earningsModule')?.hidden) renderEarnings(); if (!$('financeModule')?.hidden) renderFinance(); updateTimers(); }

  function openPayer(id) {
    const payer = state.payers.find(p => p.id === id);
    $('payerDialogTitle').textContent = payer ? 'Editar pagador' : 'Novo pagador'; $('payerId').value = payer?.id || ''; $('payerName').value = payer?.name || '';
    $('payerAmount').value = payer ? Number(payer.amount).toFixed(2).replace('.', ',') : ''; $('payerDay').value = payer?.day ?? new Date().getDay(); $('payerTermsEffective').value = localDate(); $('payerLastPayment').value = payer?.lastPaymentDate || ''; $('payerNotes').value = payer?.notes || ''; $('payerDialog').showModal();
  }

  function paymentOptions(payer, preferredKey) {
    const options = new Map();
    overdueDates(payer).forEach(date => options.set(weekKey(date), date));
    const currentStart = startOfWeek(); if (paymentFor(payer.id, weekKey(currentStart)).status !== 'paid') options.set(weekKey(currentStart), dueDate(payer, currentStart));
    if (preferredKey) options.set(preferredKey, dueDate(payer, parseLocalDate(preferredKey)));
    return [...options].map(([key, due]) => ({ key, due })).sort((a, b) => a.due - b.due);
  }

  function updatePaymentExpected() {
    const payer = state.payers.find(p => p.id === $('paymentPayerId').value); if (!payer) return;
    const key = $('paymentDueWeek').value; const due = dueDate(payer, parseLocalDate(key)); const record = paymentFor(payer.id, key);
    $('paymentExpected').textContent = `Valor esperado: ${money(amountForWeek(payer,parseLocalDate(key)))} · vencimento ${formatFull(due)}${record.paidLate ? ' · pago com atraso' : ''}`;
    document.querySelector(`[name="status"][value="${record.status || 'unpaid'}"]`).checked = true;
    $('paymentDate').value = record.receivedDate || localDate(); $('paymentTime').value = record.receivedTime || (record.status === 'paid' ? '12:00' : new Date().toTimeString().slice(0,5)); $('receivedAmount').value = record.received ? Number(record.received).toFixed(2).replace('.', ',') : ''; $('paymentNotes').value = record.notes || ''; toggleReceivedField();
  }

  function openPayment(id, preferredKey) {
    const payer = state.payers.find(p => p.id === id); if (!payer) return;
    $('paymentPayerId').value = id; $('paymentPayerName').textContent = payer.name;
    const options = paymentOptions(payer, preferredKey); $('paymentDueWeek').innerHTML = options.map(item => `<option value="${item.key}">${formatFull(item.due)}${item.due < new Date(new Date().setHours(0, 0, 0, 0)) ? ' — atrasado' : ''}</option>`).join('');
    $('paymentDueWeek').value = preferredKey && options.some(item => item.key === preferredKey) ? preferredKey : options[0].key;
    updatePaymentExpected(); $('paymentDialog').showModal();
  }

  function toggleReceivedField() { const status = document.querySelector('[name="status"]:checked')?.value; $('receivedAmountLabel').hidden = status === 'unpaid'; $('paymentDateLabel').hidden = status === 'unpaid'; $('paymentTimeLabel').hidden = status === 'unpaid'; }

  async function sendDailyNotification() {
    return syncPushSnapshot();
  }

  function checkDailyNotification() { queuePushSnapshotSync(); }
  function scheduleNotification() { clearTimeout(notificationTimer); queuePushSnapshotSync(); }
  async function registerPushNotifications() {
    const config = await pushConfig();
    if (!config.enabled || !config.publicKey) {
      throw new Error(config.needs?.storage ? 'Configure o armazenamento KV/Redis no Vercel antes de ativar.' : 'Configure as chaves VAPID no Vercel antes de ativar.');
    }
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(config.publicKey) });
    state.settings.notifications = true;
    state.settings.pushSubscribed = true;
    state.settings.lastNotificationDate = '';
    state.settings.pushEndpoint = subscription.endpoint;
    saveState();
    await syncPushSnapshot();
  }

  async function unregisterPushNotifications() {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    await fetch('/api/push/unsubscribe', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ deviceId:state.settings?.pushDeviceId }) }).catch(() => {});
    state.settings.notifications = false;
    state.settings.pushSubscribed = false;
    state.settings.pushEndpoint = '';
    saveState();
  }

  async function toggleNotifications() {
    state.settings ||= { notifications: false, pushSubscribed:false, lastNotificationDate: '' };
    if (!window.isSecureContext && !['localhost','127.0.0.1'].includes(location.hostname)) { showToast('Publique o PWA em HTTPS para ativar notificações.'); return; }
    if (state.settings.notifications && state.settings.pushSubscribed) { await unregisterPushNotifications(); scheduleNotification(); renderNotificationStatus(); showToast('Lembrete diário desativado.'); return; }
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) { showToast('Notificações push não são compatíveis com este navegador.'); return; }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { showToast('Permissão de notificação não concedida.'); renderNotificationStatus(); return; }
    try {
      await registerPushNotifications();
      scheduleNotification();
      renderNotificationStatus();
      showToast('Push ativado. O Vercel vai avisar às 9h.');
    } catch (error) {
      console.error(error);
      state.settings.notifications = false;
      state.settings.pushSubscribed = false;
      saveState();
      renderNotificationStatus();
      showToast(error.message || 'Não foi possível ativar o push.');
    }
  }

  $('payerForm').addEventListener('submit', event => {
    event.preventDefault(); const amount = parseMoney($('payerAmount').value); if (!Number.isFinite(amount) || amount <= 0) { showToast('Informe um valor válido.'); return; }
    const id = $('payerId').value || uid(); const existing = state.payers.find(p => p.id === id); const lastPaymentDate = $('payerLastPayment').value;
    const newName = $('payerName').value.trim(); const clientCode = existing?.clientCode || clientDefinitionForPayer(existing || { name:newName })?.clientCode || '';
    const day = Number($('payerDay').value); const trackingStartDate = existing?.trackingStartDate || (() => { if (!lastPaymentDate) return localDate(); const next = parseLocalDate(lastPaymentDate); next.setDate(next.getDate() + 1); return localDate(next); })();
    const effectiveWeek = weekKey(parseLocalDate($('payerTermsEffective').value) || new Date()); const termsHistory = (existing?.termsHistory || []).slice();
    if (!existing) termsHistory.push({ effectiveWeek:weekKey(parseLocalDate(trackingStartDate)),amount,day,createdAt:new Date().toISOString() });
    else if (Number(existing.amount) !== amount || Number(existing.day) !== day) { const index = termsHistory.findIndex(item => item.effectiveWeek === effectiveWeek); const term = { effectiveWeek,amount,day,createdAt:new Date().toISOString() }; if (index >= 0) termsHistory[index] = term; else termsHistory.push(term); }
    const payer = { id, name: newName, clientCode, amount, day, termsHistory, lastPaymentDate, notes: $('payerNotes').value.trim(), active: existing?.active !== false, createdAt: existing?.createdAt || new Date().toISOString(), trackingStartDate, lateCount: existing?.lateCount || 0 };
    if (existing) Object.assign(existing, payer); else state.payers.push(payer); saveState(); $('payerDialog').close(); renderAll(); showToast(existing ? 'Pagador atualizado.' : 'Pagador cadastrado.');
  });

  $('paymentForm').addEventListener('submit', event => {
    event.preventDefault(); const id = $('paymentPayerId').value; const payer = state.payers.find(p => p.id === id); const key = $('paymentDueWeek').value; const due = dueDate(payer, parseLocalDate(key));
    const status = document.querySelector('[name="status"]:checked')?.value || 'unpaid'; const receivedDate = status === 'unpaid' ? '' : $('paymentDate').value; const receivedTime = status === 'unpaid' ? '' : ($('paymentTime').value || '12:00'); const receivedAt = receivedDate ? `${receivedDate}T${receivedTime}:00` : ''; let received = status === 'unpaid' ? 0 : parseMoney($('receivedAmount').value);
    const expectedAmount = amountForWeek(payer,parseLocalDate(key));
    if (status !== 'unpaid' && !receivedDate) { showToast('Informe a data do recebimento.'); return; } if (status === 'paid') received = Number.isFinite(received) && received > 0 ? received : expectedAmount; if (status === 'partial' && (!Number.isFinite(received) || received <= 0)) { showToast('Informe o valor recebido.'); return; }
    const payment = { status, received: Math.min(received, expectedAmount), receivedDate, receivedTime, receivedAt, dueDate: localDate(due), paidLate:false, notes: $('paymentNotes').value.trim(), updatedAt: new Date().toISOString(), ledgerVersion: DATA_VERSION }; payment.paidLate = status === 'paid' && isPaymentLate(payment,due);
    state.payments[key] ||= {}; state.payments[key][id] = payment;
    if (status === 'paid' && (!payer.lastPaymentDate || receivedDate > payer.lastPaymentDate)) payer.lastPaymentDate = receivedDate;
    recomputeLateCount(payer); saveState(); $('paymentDialog').close(); renderAll(); showToast(status === 'paid' && state.payments[key][id].paidLate ? 'Pagamento registrado com atraso.' : 'Recebimento atualizado.');
  });

  $('penaltyForm').addEventListener('submit', event => {
    event.preventDefault();
    const payer = state.payers.find(item => item.id === $('profilePayerId').value); const reason = $('penaltyReason').value.trim(); const points = Number($('penaltyPoints').value);
    if (!payer || !reason || !Number.isFinite(points) || points < 1 || points > 50) { showToast('Informe o motivo e de 1 a 50 pontos.'); return; }
    payer.penalties ||= []; payer.penalties.push({ id: uid(), reason, points, createdAt: new Date().toISOString() });
    saveState(); renderAll(); renderProfile(payer); $('penaltyReason').value = ''; $('penaltyPoints').value = '10'; showToast('Punição adicionada ao score.');
  });

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : event.target?.parentElement;
    const button = target?.closest('button'); if (!button) return;
    if (button.dataset.themeSet) { event.preventDefault(); setThemeMode(button.dataset.themeSet); return; }
    if (handlePrimaryNavigation(button)) return;
    if (button.id === 'addPayerBtn') openPayer();
    if (button.id === 'notificationBtn') toggleNotifications();
    if (button.id === 'editProfilePayerBtn') editProfilePayer();
    if (button.id === 'togglePayerStatusBtn') togglePayerStatus();
    if (button.id === 'exportBackupBtn') exportBackup();
    if (button.id === 'exportCsvBtn') exportCsv();
    if (button.id === 'importBackupBtn') $('backupFileInput').click();
    if (button.id === 'pendingSummaryBtn') openPendingDetails();
    if (button.id === 'waitingSummaryBtn') openWaitingDetails();
    if (button.id === 'receivedSummaryBtn') openReceivedDetails();
    if (button.dataset.earningsTab) setEarningsPanel(button.dataset.earningsTab);
    if (button.dataset.earningsDetail) openEarningsDetail(button.dataset.earningsDetail);
    if (button.dataset.financeTab) setFinancePanel(button.dataset.financeTab);
    if (button.dataset.profile) openProfile(button.dataset.profile);
    if (button.dataset.edit) openPayer(button.dataset.edit);
    if (button.dataset.payment) { if ($('pendingDialog').open) $('pendingDialog').close(); if ($('waitingDialog').open) $('waitingDialog').close(); if ($('receivedDialog').open) $('receivedDialog').close(); if ($('profileDialog').open) $('profileDialog').close(); openPayment(button.dataset.payment, button.dataset.week); }
    if (button.dataset.close) $(button.dataset.close).close();
    if (button.dataset.removePenalty) { const payer = state.payers.find(item => item.id === button.dataset.payer); const penalty = payer?.penalties?.find(item => item.id === button.dataset.removePenalty); if (payer && penalty && confirm(`Remover a punição “${penalty.reason}”?`)) { payer.penalties = payer.penalties.filter(item => item.id !== penalty.id); saveState(); renderAll(); renderProfile(payer); showToast('Punição removida.'); } }
    if (button.dataset.editEarning) { editEarning(button.dataset.editEarning); }
    if (button.dataset.deleteEarning) { const earning = state.earnings?.find(item => item.id === button.dataset.deleteEarning); if (earning && confirm(`Excluir o ganho de ${formatDate(earning.date)} no valor de ${money(earning.amount)}?`)) { state.earnings = state.earnings.filter(item => item.id !== earning.id); saveState(); renderEarnings(); showToast('Ganho excluído.'); } }
    if (button.dataset.delete) { const payer = state.payers.find(p => p.id === button.dataset.delete); if (payer && confirm(`Excluir ${payer.name}? O histórico desse pagador também será removido.`)) { state.payers = state.payers.filter(p => p.id !== payer.id); Object.values(state.payments).forEach(week => delete week[payer.id]); saveState(); renderAll(); showToast('Pagador excluído.'); } }
    if (button.dataset.editFinance) { editFinanceTransaction(button.dataset.editFinance); }
    if (button.dataset.postFinance) { markFinancePosted(button.dataset.postFinance); }
    if (button.dataset.deleteFinance) { deleteFinanceTransaction(button.dataset.deleteFinance); }
    if (button.dataset.tab) { document.querySelectorAll('.tab,.panel').forEach(element => element.classList.remove('active')); button.classList.add('active'); $(`${button.dataset.tab}Panel`).classList.add('active'); }
  });

  document.querySelectorAll('[name="status"]').forEach(radio => radio.addEventListener('change', () => { const payer = state.payers.find(p => p.id === $('paymentPayerId').value); const key = $('paymentDueWeek').value; if (radio.checked && radio.value === 'paid' && !$('receivedAmount').value) $('receivedAmount').value = amountForWeek(payer,parseLocalDate(key)).toFixed(2).replace('.', ','); toggleReceivedField(); }));
  $('paymentDueWeek').addEventListener('change', updatePaymentExpected);
  $('backupFileInput').addEventListener('change', event => importBackup(event.target.files?.[0]));
  $('payerSearch').addEventListener('input', event => { payerSearchTerm = event.target.value; renderPayers(); });
  $('loginForm').addEventListener('submit', handleLogin);
  $('earningForm').addEventListener('submit', addEarning);
  $('earningsGoalForm').addEventListener('submit', saveEarningsGoal);
  $('financeTransactionForm')?.addEventListener('submit', saveFinanceTransaction);
  $('financeCategoryForm')?.addEventListener('submit', saveFinanceCategory);
  $('financeAccountForm')?.addEventListener('submit', saveFinanceAccount);
  $('financeResponsibleFilter')?.addEventListener('change', event => { financeFilter.responsible = event.target.value; renderFinance(); });
  $('financePeriodFilter')?.addEventListener('change', event => { financeFilter.period = event.target.value; renderFinance(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { renderAll(); checkDailyNotification(); } });
  $('payerDay').innerHTML = DAYS.map((day, index) => `<option value="${index}">${day}</option>`).join('');
  bindPrimaryNavigation(); migrateState(); applyTheme(); renderedDay = localDate(); renderAll(); renderAuth();
  setInterval(() => {
    const today = localDate();
    if (today !== renderedDay) {
      applyTheme();
      renderedDay = today; renderAll();
      if ($('pendingDialog').open) renderPendingDetails();
      if ($('waitingDialog').open) renderWaitingDetails();
      if ($('receivedDialog').open) renderReceivedDetails();
      if ($('profileDialog').open) { const payer = state.payers.find(item => item.id === $('profilePayerId').value); if (payer) renderProfile(payer); }
    } else {
      if ((state.settings?.themeMode || 'auto') === 'auto') applyTheme();
      updateTimers();
    }
  }, 30000);
  if ('serviceWorker' in navigator) window.addEventListener('load', async () => { try { await navigator.serviceWorker.register('./service-worker.js'); scheduleNotification(); queuePushSnapshotSync(); } catch (error) { console.error(error); } });
})();

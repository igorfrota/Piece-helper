/* Piece Helper — interface (contas) */
const api = window.piece;
const $ = (s) => document.querySelector(s);

const CHARS = ['Elesis', 'Lire', 'Arme', 'Lass', 'Ryan', 'Ronan', 'Amy', 'Jin', 'Sieghart', 'Mari', 'Dio', 'Zero', 'Ley', 'Rufus', 'Rin', 'Asin', 'Lime', 'Edel', 'Veigas', 'Uno'];
const COLORS = { esmeralda: '#10b981', ouro: '#f59e0b', ceu: '#38bdf8', rubi: '#f43f5e', violeta: '#a78bfa', rosa: '#f472b6' };
const PLAT_ICON = { steam: 'S', riot: 'R', ubisoft: 'U', battlenet: 'B' };

const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h13l-4-4M17 17H4l4 4"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v5h7M8 21v-7h8v7"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
};

const state = { info: null, settings: null, pid: 'steam', view: 'accounts', accounts: [], query: '' };

/* ---------- utilidades ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, type = 'ok', ms = 3800) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'ok' ? '' : type);
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}
async function call(promise) {
  const r = await promise;
  if (!r.ok) throw new Error(r.error);
  return r.data;
}
function ago(ts) {
  if (!ts) return '';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora mesmo';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}
function initials(s) {
  const w = String(s || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return ((w[0]?.[0] || '?') + (w[1]?.[0] || '')).toUpperCase();
}
function platIcon(p) { return p.icon ? `<img src="${p.icon}" alt="">` : (PLAT_ICON[p.id] || '?'); }
function plat() { return state.info?.platforms.find((p) => p.id === state.pid); }

/* ---------- janela ---------- */
$('#tbMin').onclick = () => api.win.min();
$('#tbMax').onclick = () => api.win.max();
$('#tbClose').onclick = () => api.win.close();

/* ---------- navegação ---------- */
function renderNav() {
  const nav = $('#navPlatforms');
  nav.innerHTML = '';
  for (const p of state.info.platforms.filter((x) => x.enabled)) {
    const b = document.createElement('button');
    b.className = 'nav-item' + (state.view === 'accounts' && state.pid === p.id ? ' active' : '');
    b.innerHTML = `<span class="ni-icon">${platIcon(p)}</span><span>${esc(p.name)}</span>${p.id !== 'steam' ? '<span class="ni-count">beta</span>' : ''}`;
    b.onclick = () => { state.pid = p.id; state.view = 'accounts'; showView(); loadAccounts(); };
    nav.appendChild(b);
  }
  $('#navSettings').classList.toggle('active', state.view === 'settings');
  $('#navVm').classList.toggle('active', state.view === 'vm');
}
$('#navSettings').onclick = () => { state.view = 'settings'; showView(); renderSettings(); };

function showView() {
  $('#viewAccounts').hidden = state.view !== 'accounts';
  $('#viewSettings').hidden = state.view !== 'settings';
  $('#viewVm').hidden = state.view !== 'vm';
  renderNav();
}
$('#navVm').onclick = () => { state.view = 'vm'; showView(); window.VMUI && VMUI.load(true); };

/* ---------- contas ---------- */
async function refreshInfo() {
  state.info = await call(api.info());
  $('#versionTag').textContent = `Piece Helper v${state.info.version} • guilda Piece화`;
  if (!state.info.platforms.find((p) => p.id === state.pid && p.enabled)) state.pid = 'steam';
}

function renderHeader() {
  const p = plat();
  const isSteam = state.pid === 'steam';
  $('#platTitle').textContent = p.name;
  $('#platIco').innerHTML = platIcon(p);
  const dot = !p.installed ? 'off' : p.running ? 'on' : '';
  const txt = !p.installed ? 'Não encontrada — ajuste o caminho em Configurações' : p.running ? 'Aberta agora' : 'Instalada';
  $('#platStatus').innerHTML = `<span class="dot ${dot}"></span>${esc(txt)}`;
  $('#btnSaveCurrent').hidden = p.kind !== 'snapshot';
  $('#optGame').closest('label').hidden = !isSteam;
  $('#optOffline').closest('label').hidden = !isSteam;
  $('#btnOpenPlat').textContent = `Abrir ${isSteam ? 'Steam' : p.name}`;
  $('#btnClosePlat').textContent = `Fechar ${isSteam ? 'Steam' : p.name}`;
  $('#platTip').hidden = !p.tip;
  $('#platTip').textContent = p.tip ? '💡 ' + p.tip : '';
  $('#emptyText').innerHTML = p.kind === 'snapshot'
    ? 'Clique em <b>Adicionar conta</b>, entre no launcher marcando "lembrar de mim" e depois clique em <b>Salvar conta atual</b>.'
    : 'Clique em <b>Adicionar conta</b>, entre na conta pelo launcher (marcando "lembrar") e ela aparece aqui.';
}

async function loadAccounts() {
  renderHeader();
  try {
    state.accounts = await call(api.list(state.pid));
  } catch (e) {
    state.accounts = [];
    toast(e.message, 'err');
  }
  renderGrid();
  loadPresence();
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  let list = state.accounts.slice();
  if (q) {
    list = list.filter((a) => [a.display, a.login, a.meta.nick, a.meta.char, a.meta.note].some((x) => String(x || '').toLowerCase().includes(q)));
  }
  list.sort((a, b) => (b.meta.fav ? 1 : 0) - (a.meta.fav ? 1 : 0) || (b.current ? 1 : 0) - (a.current ? 1 : 0) || (b.meta.lastUsed || b.lastLogin || 0) - (a.meta.lastUsed || a.lastLogin || 0));
  return list;
}

function renderGrid() {
  const grid = $('#grid');
  const list = filtered();
  grid.innerHTML = '';
  $('#empty').hidden = state.accounts.length > 0;
  const isSteam = state.pid === 'steam';
  const gameOn = $('#optGame').checked;

  for (const a of list) {
    const m = a.meta || {};
    const card = document.createElement('div');
    card.className = 'card' + (a.current ? ' current' : '');
    card.tabIndex = 0;
    card.style.setProperty('--accent', COLORS[m.color] || COLORS.esmeralda);
    const name = m.nick || a.display;
    const sub = m.nick ? `${a.display}${a.login && a.login !== a.display ? ' • ' + a.login : ''}` : (a.login && a.login !== a.display ? a.login : '');
    const avatar = a.avatar ? `<img src="${a.avatar}" alt="">` : `<div class="hex">${esc(initials(name))}</div>`;
    const tags = [
      a.current ? '<span class="tag cur">ATUAL</span>' : '',
      m.char ? `<span class="tag char">${esc(m.char)}</span>` : '',
      a.offline ? '<span class="tag off">modo offline</span>' : '',
      presenceTag(a),
    ].join('');
    const used = m.lastUsed || a.lastLogin;
    card.innerHTML = `
      <button class="fav ${m.fav ? 'on' : ''}" title="Favoritar">${ICON.star}</button>
      <div class="card-top">
        <div class="avatar">${avatar}${a.current ? '<span class="on"></span>' : ''}</div>
        <div class="who"><div class="name" title="${esc(name)}">${esc(name)}</div><div class="login">${esc(sub) || '&nbsp;'}</div></div>
      </div>
      <div class="tags">${tags}</div>
      ${m.note ? `<div class="note">${esc(m.note)}</div>` : ''}
      <div class="meta-line">${used ? 'Usada ' + ago(used) : '&nbsp;'}</div>
      <div class="card-actions">
        ${isSteam && gameOn
          ? `<button class="btn gold small go">${ICON.play}Jogar GC</button>`
          : `<button class="btn primary small go">${ICON.swap}Trocar</button>`}
        <button class="btn ghost small icon more" title="Mais opções">${ICON.dots}</button>
      </div>`;
    card.querySelector('.go').onclick = () => doSwitch(a);
    card.querySelector('.fav').onclick = async (e) => { e.stopPropagation(); await setMeta(a, { fav: !m.fav }); };
    card.querySelector('.more').onclick = (e) => { e.stopPropagation(); openCtx(e, a); };
    card.ondblclick = (e) => { if (!e.target.closest('button')) doSwitch(a); };
    card.oncontextmenu = (e) => { e.preventDefault(); openCtx(e, a); };
    card.onkeydown = (e) => { if (e.key === 'Enter' && e.target === card) doSwitch(a); };
    grid.appendChild(card);
  }
  if (state.accounts.length && !list.length) {
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1"><h3>Nada encontrado</h3><p>Tente outro termo.</p></div>';
  }
}

/* status online das contas Steam (perfil público) */
const presence = {};
function presenceTag(a) {
  const p = presence[a.id];
  if (!p || state.pid !== 'steam') return '';
  if (a.current && plat()?.running) return '';
  if (p.state === 'in-game') return `<span class="tag busy">${p.isGC ? '⚔ jogando GC' : '🎮 em jogo'}</span>`;
  if (p.state === 'online') return '<span class="tag busy on">● online</span>';
  return '';
}
function applyPresence(a, p) { presence[a.id] = p; renderGrid(); }
async function loadPresence() {
  if (state.pid !== 'steam') return;
  for (const a of state.accounts) {
    try { presence[a.id] = await call(api.presence(a.id)); } catch { /* */ }
  }
  if (state.pid === 'steam' && state.view === 'accounts') renderGrid();
}

async function setMeta(a, patch) {
  try {
    a.meta = await call(api.setMeta(state.pid, a.id, patch));
    renderGrid();
  } catch (e) { toast(e.message, 'err'); }
}

function overlay(text) {
  $('#ovText').textContent = text || '';
  $('#overlay').hidden = !text;
}

async function doSwitch(a, forceGame) {
  const isSteam = state.pid === 'steam';
  const launchGame = forceGame ?? (isSteam && $('#optGame').checked);
  const name = a.meta.nick || a.display;

  // "Jogar GC": avisa se a conta já está conectada em outro lugar
  const isOursNow = a.current && plat().running;
  if (isSteam && launchGame && !isOursNow) {
    overlay(`Verificando se ${name} está em uso…`);
    let pr = { state: 'unknown' };
    try { pr = await call(api.presence(a.id)); } catch { /* segue */ }
    overlay(null);
    applyPresence(a, pr);
    if (pr.state === 'in-game' || pr.state === 'online') {
      const what = pr.state === 'in-game'
        ? (pr.isGC ? 'está <b>jogando o Grand Chase</b> agora' : `está jogando <b>${esc(pr.game || 'um jogo')}</b> agora`)
        : 'está <b>online na Steam</b> agora';
      const ok = await confirmModal('⚠️ Já tem gente logada', `
        <p>A conta <b>${esc(name)}</b> ${what}.</p>
        <p>Já tem gente logada, deseja logar no GC assim mesmo? <b>A pessoa logada será derrubada.</b></p>`,
        'Logar assim mesmo');
      if (!ok) return;
    }
  }

  overlay(`Trocando para ${name}…`);
  try {
    await call(api.switchTo(state.pid, a.id, isSteam ? { launchGame, offline: $('#optOffline').checked } : {}));
    toast(launchGame ? `Entrando com ${name} e abrindo o Grand Chase ⚔️` : `Pronto! Entrando com ${name}.`);
  } catch (e) {
    toast(e.message, 'err', 6000);
  } finally {
    overlay(null);
    await refreshInfo();
    loadAccounts();
  }
}

/* ---------- menu de contexto ---------- */
function openCtx(e, a) {
  const ctx = $('#ctx');
  const isSteam = state.pid === 'steam';
  const snap = plat().kind === 'snapshot';
  ctx.innerHTML = `
    <button data-a="switch">${ICON.swap}Trocar</button>
    ${isSteam ? `<button data-a="game">${ICON.play}Trocar e abrir o Grand Chase</button>` : ''}
    <hr>
    <button data-a="edit">${ICON.edit}Editar apelido / personagem</button>
    <button data-a="fav">${ICON.star}${a.meta.fav ? 'Tirar dos favoritos' : 'Favoritar'}</button>
    ${snap ? `<button data-a="resave">${ICON.save}Atualizar com a sessão atual</button>` : ''}
    <button data-a="copy">${ICON.copy}Copiar login</button>
    <hr>
    <button data-a="forget" class="danger">${ICON.trash}Remover da lista</button>`;
  ctx.hidden = false;
  const r = ctx.getBoundingClientRect();
  ctx.style.left = Math.min(e.clientX, innerWidth - r.width - 10) + 'px';
  ctx.style.top = Math.min(e.clientY, innerHeight - r.height - 10) + 'px';
  ctx.onclick = async (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    ctx.hidden = true;
    const act = b.dataset.a;
    if (act === 'switch') doSwitch(a, false);
    if (act === 'game') doSwitch(a, true);
    if (act === 'edit') editModal(a);
    if (act === 'fav') setMeta(a, { fav: !a.meta.fav });
    if (act === 'copy') { navigator.clipboard.writeText(a.login || ''); toast('Login copiado.'); }
    if (act === 'resave') resave(a);
    if (act === 'forget') forgetModal(a);
  };
}
document.addEventListener('click', (e) => { if (!e.target.closest('#ctx')) $('#ctx').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { $('#ctx').hidden = true; closeModal(); } });

/* ---------- modais ---------- */
let modalOk = null;
let modalCancel = null;
function openModal(title, html, okText, onOk, danger) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = html;
  const ok = $('#modalOk');
  ok.textContent = okText || 'Salvar';
  ok.className = 'btn ' + (danger ? 'danger' : 'primary');
  modalOk = onOk;
  $('#modal').hidden = false;
  setTimeout(() => $('#modalBody input, #modalBody select')?.focus(), 30);
}
function closeModal() {
  $('#modal').hidden = true; modalOk = null;
  const c = modalCancel; modalCancel = null; if (c) c();
}
$('#modalCancel').onclick = closeModal;
$('#modal').onclick = (e) => { if (e.target.id === 'modal') closeModal(); };
$('#modalOk').onclick = async () => { if (modalOk && (await modalOk()) !== false) closeModal(); };
$('#modalBody').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') $('#modalOk').click(); });

function confirmModal(title, html, okText) {
  return new Promise((resolve) => {
    openModal(title, html, okText, async () => { modalCancel = null; resolve(true); }, true);
    modalCancel = () => resolve(false);
  });
}

function editModal(a) {
  const m = a.meta || {};
  let color = m.color || 'esmeralda';
  openModal('Editar conta', `
    <div class="field"><label>Apelido</label><input id="fNick" maxlength="40" placeholder="${esc(a.display)}" value="${esc(m.nick || '')}"></div>
    <div class="field"><label>Personagem principal</label><select id="fChar"><option value="">—</option>${CHARS.map((c) => `<option ${m.char === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Anotação</label><textarea id="fNote" maxlength="200" placeholder="Ex.: conta de farm de Solene, guarda os materiais de craft…">${esc(m.note || '')}</textarea></div>
    <div class="field"><label>Cor do card</label><div class="colors">${Object.entries(COLORS).map(([k, v]) => `<button type="button" data-c="${k}" title="${k}" style="background:${v}" class="${k === color ? 'sel' : ''}"></button>`).join('')}</div></div>`,
  'Salvar', async () => {
    await setMeta(a, { nick: $('#fNick').value.trim(), char: $('#fChar').value, note: $('#fNote').value.trim(), color });
  });
  $('#modalBody .colors').onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    color = b.dataset.c;
    $('#modalBody .colors').querySelectorAll('button').forEach((x) => x.classList.toggle('sel', x === b));
  };
}

function forgetModal(a) {
  const isSteam = state.pid === 'steam';
  const name = a.meta.nick || a.display;
  openModal('Remover conta', `<p>Remover <b>${esc(name)}</b> da lista?${isSteam ? ' A Steam será fechada e a conta sai das contas lembradas (você precisará logar de novo para usá-la).' : ' A sessão salva desta conta será apagada.'}</p>`, 'Remover', async () => {
    try {
      await call(api.forget(state.pid, a.id));
      toast(`${name} removida.`);
      loadAccounts();
    } catch (e) { toast(e.message, 'err'); return false; }
  }, true);
}

function saveModal() {
  const p = plat();
  openModal(`Salvar conta atual — ${p.name}`, `
    <p>Entre na conta no ${esc(p.name)} (marcando "lembrar de mim") e dê um nome a ela. O launcher será fechado para copiar a sessão.</p>
    <div class="field"><label>Nome da conta</label><input id="fSaveName" maxlength="40" placeholder="Ex.: Main, Smurf…"></div>`,
  'Salvar conta', async () => {
    const name = $('#fSaveName').value.trim();
    if (!name) { toast('Dê um nome para a conta.', 'warn'); return false; }
    overlay('Salvando sessão…');
    try {
      await call(api.saveCurrent(state.pid, name));
      toast(`Conta "${name}" salva!`);
      loadAccounts();
    } catch (e) { toast(e.message, 'err', 6000); return false; } finally { overlay(null); }
  });
}

async function resave(a) {
  overlay('Atualizando sessão…');
  try {
    await call(api.saveCurrent(state.pid, a.display, a.id));
    toast(`Sessão de "${a.display}" atualizada.`);
  } catch (e) { toast(e.message, 'err', 6000); } finally { overlay(null); loadAccounts(); }
}

/* ---------- ações do topo ---------- */
$('#search').oninput = (e) => { state.query = e.target.value; renderGrid(); };
$('#btnSaveCurrent').onclick = saveModal;
$('#btnAdd').onclick = () => {
  const p = plat();
  const snap = p.kind === 'snapshot';
  openModal('Adicionar conta', `<p>O ${esc(p.name)} será fechado e aberto na tela de login.</p><p>${snap
    ? 'Entre na conta nova marcando <b>"lembrar de mim"</b> e depois volte aqui e clique em <b>Salvar conta atual</b>. (A sessão que estava aberta fica guardada em backup.)'
    : 'Entre na conta nova marcando <b>"lembrar senha"</b>. Depois clique em atualizar aqui e ela aparece na lista.'}</p>`, 'Continuar', async () => {
    overlay(`Abrindo o ${p.name}…`);
    try { await call(api.addNew(state.pid)); toast('Faça o login no launcher.'); } catch (e) { toast(e.message, 'err', 6000); return false; } finally { overlay(null); }
  });
};
$('#btnRefresh').onclick = async () => { await refreshInfo(); loadAccounts(); };
$('#btnOpenPlat').onclick = async () => {
  try { await call(api.startPlatform(state.pid, { launchGame: false })); toast(`Abrindo ${plat().name}…`); } catch (e) { toast(e.message, 'err'); }
};
$('#btnClosePlat').onclick = async () => {
  overlay(`Fechando ${plat().name}…`);
  try { await call(api.closePlatform(state.pid)); toast(`${plat().name} fechado.`); } catch (e) { toast(e.message, 'err'); } finally { overlay(null); await refreshInfo(); renderHeader(); }
};
$('#optGame').onchange = renderGrid;

/* ---------- configurações ---------- */
function renderSettings() {
  const s = state.settings;
  document.querySelectorAll('[data-set]').forEach((el) => { el.checked = !!s[el.dataset.set]; });
  document.querySelectorAll('[data-enable]').forEach((el) => { el.checked = !!s.enabled?.[el.dataset.enable]; });
  for (const p of state.info.platforms) {
    const el = document.getElementById('path-' + p.id);
    if (el) el.textContent = p.path ? p.path + (p.installed ? '' : '  ⚠ não encontrado') : 'Não encontrado';
  }
  $('#dataDir').textContent = state.info.dataDir;
}
document.querySelectorAll('[data-set]').forEach((el) => {
  el.onchange = async () => {
    state.settings = await call(api.setSettings({ [el.dataset.set]: el.checked }));
    if (el.dataset.set === 'launchGameDefault') $('#optGame').checked = el.checked;
    if (el.dataset.set === 'steamOffline') $('#optOffline').checked = el.checked;
  };
});
document.querySelectorAll('[data-enable]').forEach((el) => {
  el.onchange = async () => {
    const enabled = { ...state.settings.enabled, [el.dataset.enable]: el.checked };
    state.settings = await call(api.setSettings({ enabled }));
    await refreshInfo();
    renderNav();
  };
});
document.querySelectorAll('[data-pick]').forEach((el) => {
  el.onclick = async () => {
    const id = el.dataset.pick;
    const p = el.dataset.type === 'folder' ? await call(api.pickFolder('Pasta da Steam')) : await call(api.pickExe('Escolha o executável'));
    if (!p) return;
    state.settings = await call(api.setSettings({ paths: { ...state.settings.paths, [id]: p } }));
    await refreshInfo();
    renderSettings();
  };
});
document.querySelectorAll('[data-clear]').forEach((el) => {
  el.onclick = async () => {
    const paths = { ...state.settings.paths };
    delete paths[el.dataset.clear];
    state.settings = await call(api.setSettings({ paths }));
    await refreshInfo();
    renderSettings();
  };
});
$('#btnOpenData').onclick = () => api.openPath(state.info.dataDir);

/* ---------- eventos do main ---------- */
api.on('accounts:changed', async (pid) => { await refreshInfo(); if (pid === state.pid && state.view === 'accounts') loadAccounts(); });
api.on('win:state', ({ maximized }) => { $('#tbMax').title = maximized ? 'Restaurar' : 'Maximizar'; });
window.addEventListener('focus', async () => { if (state.view === 'accounts' && $('#overlay').hidden) { await refreshInfo(); loadAccounts(); } });

/* ---------- início ---------- */
(async function init() {
  try {
    state.settings = await call(api.getSettings());
    $('#optGame').checked = !!state.settings.launchGameDefault;
    $('#optOffline').checked = !!state.settings.steamOffline;
    await refreshInfo();
    showView();
    loadAccounts();
  } catch (e) { toast(e.message, 'err', 8000); }
})();

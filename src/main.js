// Piece Helper — processo principal (Electron). Troca de contas + máquina virtual com placa de vídeo.
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const U = require('./core/util');
const { Steam } = require('./core/steam');
const { SnapshotPlatform, BattleNet } = require('./core/platforms');
const VM = require('./vm/vm');
const Doctor = require('./vm/doctor');
const Discord = require('./core/discord');
const Updater = require('./core/updater');

app.setAppUserModelId('guild.piece.helper');
if (!app.requestSingleInstanceLock()) { app.quit(); }

const ASSETS = path.join(__dirname, '..', 'assets');
const DATA = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA, 'settings.json');
VM.init(DATA, app.isPackaged ? path.dirname(process.execPath) : null);

// primeira vez: traz apelidos, cores e backups do antigo Piece Account Switcher
(function migrateFromSwitcher() {
  try {
    const old = path.join(app.getPath('appData'), 'Piece Account Switcher');
    if (fs.existsSync(SETTINGS_FILE) || !fs.existsSync(path.join(old, 'settings.json'))) return;
    fs.mkdirSync(DATA, { recursive: true });
    for (const f of ['settings.json', 'backups', 'accounts']) {
      const src = path.join(old, f);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(DATA, f), { recursive: true });
    }
  } catch { /* segue sem migrar */ }
})();

const DEFAULT_SETTINGS = {
  steamOffline: false,
  launchGameDefault: false,
  closeToTray: true,
  startMinimized: false,
  startWithWindows: true,
  discordPresence: true,
  autoUpdate: true,
  enabled: { steam: true, riot: false, ubisoft: false, battlenet: false },
  paths: {},
  active: {},
  meta: {},
};

let settingsCache = null;
function settings() {
  if (!settingsCache) {
    const s = U.readJSON(SETTINGS_FILE, {});
    settingsCache = { ...DEFAULT_SETTINGS, ...s, enabled: { ...DEFAULT_SETTINGS.enabled, ...(s.enabled || {}) } };
  }
  return settingsCache;
}
function saveSettings(patch) {
  settingsCache = { ...settings(), ...patch };
  U.writeJSON(SETTINGS_FILE, settingsCache);
  return settingsCache;
}

const store = {
  dataDir: DATA,
  backupDir: path.join(DATA, 'backups'),
  settings,
  setActive(pid, id) {
    const active = { ...(settings().active || {}) };
    active[pid] = id;
    saveSettings({ active });
  },
};

const platforms = {
  steam: new Steam(store),
  riot: new SnapshotPlatform('riot', store),
  ubisoft: new SnapshotPlatform('ubisoft', store),
  battlenet: new BattleNet(store),
};

let win = null;
let tray = null;
let quitting = false;
let busy = false;

async function guarded(fn) {
  if (busy) throw new Error('Aguarde: já existe uma troca em andamento.');
  busy = true;
  Discord.set('Trocando de conta…');
  try { return await fn(); } finally { busy = false; Discord.idle(); }
}

// "Iniciar com o Windows": registra/remove o Piece Helper na inicialização (abre escondido na bandeja)
function applyStartup() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: !!settings().startWithWindows, path: process.execPath, args: ['--hidden'] }); } catch { /* */ }
}

function getPlatform(pid) {
  const p = platforms[pid];
  if (!p) throw new Error('Plataforma desconhecida.');
  return p;
}

async function listWithMeta(pid) {
  const p = getPlatform(pid);
  const list = await p.list();
  const meta = settings().meta?.[pid] || {};
  return list.map((a) => ({ ...a, meta: meta[a.id] || {} }));
}

// ---------- Janela ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 880,
    minHeight: 560,
    frame: false,
    backgroundColor: '#0b1220',
    icon: path.join(ASSETS, 'icon.png'),
    show: false,
    title: 'Piece Helper',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => {
    const cont = process.argv.includes('--continuar');
    const hidden = !cont && (process.argv.includes('--hidden') || settings().startMinimized);
    if (!hidden) win.show();
    // voltou de um reinício pedido pelo "Verificar e corrigir": abre a máquina virtual e examina de novo
    if (cont) { Doctor.clearContinue(); setTimeout(() => win.webContents.send('app:continue', {}), 800); }
    try { if (global.__pieceBoot) global.__pieceBoot.ok(); } catch { /* a versão abriu: está boa */ }
    if (process.argv.includes('--atualizado')) setTimeout(() => win.webContents.send('update:done', { version: app.getVersion() }), 700);
  });
  win.on('close', (e) => {
    if (!quitting && settings().closeToTray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------- Bandeja ----------
async function rebuildTray() {
  if (!tray) return;
  const items = [{ label: 'Piece Helper', enabled: false }, { type: 'separator' }];
  try {
    if (settings().enabled.steam) {
      const accs = await listWithMeta('steam');
      accs.sort((a, b) => (b.meta.fav ? 1 : 0) - (a.meta.fav ? 1 : 0));
      const sub = accs.slice(0, 15).map((a) => ({
        label: `${a.meta.fav ? '★ ' : ''}${a.meta.nick || a.display}${a.current ? '  (atual)' : ''}`,
        submenu: [
          { label: 'Trocar', click: () => trayswitch('steam', a.id, false) },
          { label: 'Trocar e abrir o Grand Chase', click: () => trayswitch('steam', a.id, true) },
        ],
      }));
      items.push({ label: 'Steam', submenu: sub.length ? sub : [{ label: 'Nenhuma conta', enabled: false }] });
    }
  } catch { /* ignora */ }
  items.push({ type: 'separator' }, { label: 'Abrir', click: showWindow }, { label: 'Sair', click: () => { quitting = true; app.quit(); } });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

async function trayswitch(pid, id, launchGame) {
  try {
    await guarded(() => getPlatform(pid).switchTo(id, { launchGame }));
    touchMeta(pid, id);
    win?.webContents.send('accounts:changed', pid);
    rebuildTray();
  } catch (e) {
    dialog.showErrorBox('Piece Helper', e.message);
  }
}

function touchMeta(pid, id) {
  const meta = JSON.parse(JSON.stringify(settings().meta || {}));
  meta[pid] = meta[pid] || {};
  meta[pid][id] = { ...(meta[pid][id] || {}), lastUsed: Date.now() };
  saveSettings({ meta });
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

// Ícone real do launcher instalado no PC (lido do próprio .exe)
const iconCache = {};
async function exeIcon(exe) {
  if (!exe || !fs.existsSync(exe)) return null;
  if (iconCache[exe] !== undefined) return iconCache[exe];
  try {
    const img = await app.getFileIcon(exe, { size: 'large' });
    iconCache[exe] = img.isEmpty() ? null : img.toDataURL();
  } catch { iconCache[exe] = null; }
  return iconCache[exe];
}

handle('app:info', async () => {
  const out = [];
  for (const [id, p] of Object.entries(platforms)) {
    let st = { installed: false };
    try { st = await p.status(); } catch { /* */ }
    const exe = id === 'steam' ? (st.path ? path.join(st.path, 'steam.exe') : null) : st.path;
    const icon = st.installed ? await exeIcon(exe) : null;
    out.push({ id, name: p.name, kind: p.kind, tip: p.tip || null, enabled: !!settings().enabled[id], icon, ...st });
  }
  return { version: app.getVersion(), platforms: out, dataDir: DATA };
});

handle('acc:list', (pid) => listWithMeta(pid));
handle('steam:presence', (id) => platforms.steam.presence(id));
handle('acc:switch', async (pid, id, opts) => {
  const r = await guarded(() => getPlatform(pid).switchTo(id, opts || {}));
  touchMeta(pid, id);
  rebuildTray();
  return r;
});
handle('acc:add', async (pid) => { await guarded(() => getPlatform(pid).addNew()); rebuildTray(); });
handle('acc:save', async (pid, name, id) => {
  const p = getPlatform(pid);
  if (!p.saveCurrent) throw new Error('Esta plataforma não usa "salvar conta".');
  const r = await guarded(() => p.saveCurrent(name, id));
  return r;
});
handle('acc:forget', async (pid, id) => {
  await guarded(() => getPlatform(pid).forget(id));
  const meta = JSON.parse(JSON.stringify(settings().meta || {}));
  if (meta[pid]) delete meta[pid][id];
  saveSettings({ meta });
  rebuildTray();
});
handle('acc:close', async (pid) => guarded(() => getPlatform(pid).close()));
handle('acc:start', async (pid, opts) => {
  const p = getPlatform(pid);
  if (pid === 'steam') return p.start(opts?.launchGame ? ['-applaunch', '985810'] : []);
  return U.launch(p.exePath());
});

handle('meta:set', (pid, id, patch) => {
  const meta = JSON.parse(JSON.stringify(settings().meta || {}));
  meta[pid] = meta[pid] || {};
  meta[pid][id] = { ...(meta[pid][id] || {}), ...patch };
  saveSettings({ meta });
  rebuildTray();
  return meta[pid][id];
});

handle('settings:get', () => settings());
handle('settings:set', (patch) => {
  const s = saveSettings(patch);
  if ('startWithWindows' in patch) applyStartup();
  if ('discordPresence' in patch) Discord.setEnabled(!!patch.discordPresence);
  rebuildTray();
  return s;
});

handle('dialog:pickExe', async (title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Escolha o executável', properties: ['openFile'], filters: [{ name: 'Programas', extensions: ['exe'] }] });
  return r.canceled ? null : r.filePaths[0];
});
handle('dialog:pickFolder', async (title) => {
  const r = await dialog.showOpenDialog(win, { title: title || 'Escolha a pasta', properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
handle('shell:openPath', (p) => shell.openPath(p));

// ---------- Máquina virtual ----------
async function steamPath() { try { return await platforms.steam.steamPath(); } catch { return null; } }
handle('vm:status', () => VM.status());
handle('vm:gpuSetup', (name, gpuId) => VM.gpuSetup(name, gpuId));
handle('vm:gpuUpdate', (name) => VM.gpuUpdate(name));
handle('vm:gpuRemove', (name) => VM.gpuRemove(name));
handle('vm:tune', (name, cpus, ram) => VM.tune(name, cpus, ram));
handle('vm:tuneUndo', (name) => VM.tuneUndo(name));
handle('vm:power', (name, on) => VM.power(name, on));
handle('vm:open', (name, edit) => VM.openWindow(name, !!edit));
handle('vm:manager', () => VM.openManager());
handle('vm:installHelper', (name) => VM.installHelper(name));
handle('vm:hypervEnable', () => VM.hypervEnable());
handle('vm:isoInfo', async () => VM.isoInfo(await steamPath()));
handle('vm:pickIso', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Escolha a ISO do Windows', properties: ['openFile'], filters: [{ name: 'Imagem do Windows', extensions: ['iso'] }] });
  return r.canceled ? null : r.filePaths[0];
});
handle('vm:create', async (opts) => {
  const sp = await steamPath();
  const err = await VM.precheck(opts || {}, sp);
  if (err) throw new Error(err);
  return VM.create(opts, sp);
});
handle('vm:reboot', () => { require('child_process').spawn('shutdown', ['/r', '/t', '10', '/c', 'Piece Helper: reiniciando em 10 segundos'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); });
handle('vm:diagnose', async () => Doctor.diagnose(await steamPath()));
handle('vm:fix', async (action, arg) => Doctor.fix(String(action), arg == null ? null : String(arg), await steamPath()));
handle('vm:fixAll', async (items) => Doctor.fixAll(items, await steamPath()));
handle('vm:repair', async (name) => Doctor.fix('vmRepair', name, await steamPath()));
handle('vm:gameSync', async (name) => Doctor.fix('vmGame', name, await steamPath()));
handle('vm:recreate', async (name) => Doctor.recreate(name, await steamPath()));
handle('vm:report', async () => Doctor.report(app.getPath('desktop'), app.getVersion(), await steamPath()));
handle('shell:showItem', (p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); });
handle('shell:openUrl', (u) => { if (/^(https:\/\/|ms-windows-store:|ms-settings:)/i.test(String(u))) return shell.openExternal(String(u)); throw new Error('Endereço não permitido.'); });
handle('job:poll', (id, since) => VM.pollJob(id, since || 0));
handle('job:cancel', (id) => VM.cancelJob(id));

// abre o Piece Helper de novo como administrador (o Hyper-V exige)
handle('app:elevate', async () => {
  const args = app.isPackaged ? process.argv.slice(1) : [app.getAppPath(), ...process.argv.slice(2)];
  const list = args.filter((a) => a !== '--hidden').map((a) => "'" + a.replace(/'/g, "''") + "'").join(',');
  const cmd = `Start-Process -FilePath '${process.execPath.replace(/'/g, "''")}'${list ? ' -ArgumentList ' + list : ''} -Verb RunAs`;
  const r = await U.run('powershell.exe', ['-NoProfile', '-Command', cmd]);
  if (r.code !== 0) throw new Error('O Windows não deu permissão de administrador.');
  app.releaseSingleInstanceLock();
  quitting = true;
  setTimeout(() => app.quit(), 200);
  return true;
});

// ---------- Atualização automática ----------
let avisado = '';
async function procurarAtualizacao(manual) {
  if (!manual && settings().autoUpdate === false) return null;
  const r = await Updater.check();
  if (r.update && r.update.version !== avisado) {
    avisado = r.update.version;
    win?.webContents.send('update:available', r.update);
    if (!manual && win && !win.isVisible() && Notification.isSupported()) {
      const n = new Notification({ title: `Piece Helper ${r.update.version} disponível`, body: 'Clique para ver as novidades e atualizar.', icon: path.join(ASSETS, 'icon.png') });
      n.on('click', () => { showWindow(); win?.webContents.send('update:available', r.update); });
      n.show();
    }
  }
  return r;
}
handle('update:check', () => procurarAtualizacao(true));
handle('update:state', () => Updater.state());
handle('update:download', () => Updater.download((p) => win?.webContents.send('update:progress', p)));
handle('update:install', () => {
  // reinicia já na versão nova; fecha de verdade (nada de bandeja)
  quitting = true;
  setTimeout(() => Updater.restart(() => {
    try { Discord.stop(); } catch { /* */ }
    try { if (tray) tray.destroy(); } catch { /* */ }
  }), 350);
  return true;
});
handle('update:page', () => Updater.openPage());

ipcMain.on('win:min', () => win?.minimize());
ipcMain.on('win:max', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
ipcMain.on('win:close', () => win?.close());

// ---------- Ciclo de vida ----------
app.on('second-instance', (_e, argv) => { showWindow(); if ((argv || []).includes('--continuar')) { Doctor.clearContinue(); win?.webContents.send('app:continue', {}); } });
app.on('before-quit', () => { quitting = true; Discord.stop(); });
app.whenReady().then(() => {
  // 1.1: passa a iniciar com o Windows por padrão (uma vez; quem desligar depois continua desligado)
  if (!settings().startupDefault11) saveSettings({ startWithWindows: true, startupDefault11: true });
  applyStartup();
  Discord.setEnabled(settings().discordPresence !== false);
  createWindow();
  // procura versão nova 10 s depois de abrir e a cada 6 horas
  if (app.isPackaged) {
    setTimeout(() => { try { Updater.cleanup(); } catch { /* */ } }, 8000);
    setTimeout(() => procurarAtualizacao(false).catch(() => {}), 10000);
    setInterval(() => procurarAtualizacao(false).catch(() => {}), 6 * 3600 * 1000);
  }
  tray = new Tray(nativeImage.createFromPath(path.join(ASSETS, 'tray.png')));
  tray.setToolTip('Piece Helper');
  tray.on('click', showWindow);
  rebuildTray();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

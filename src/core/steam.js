// Troca de contas da Steam: AutoLoginUser no registro + loginusers.vdf.
const fs = require('fs');
const path = require('path');
const vdf = require('./vdf');
const U = require('./util');

const STEAM_KEY = 'HKCU\\Software\\Valve\\Steam';
const GC_APPID = '985810'; // GrandChase Classic na Steam

class Steam {
  constructor(store) {
    this.store = store; // { settings(), backupDir }
    this.id = 'steam';
    this.name = 'Steam';
    this.kind = 'steam';
  }

  async steamPath() {
    const custom = this.store.settings().paths?.steam;
    if (custom && fs.existsSync(custom)) return path.normalize(custom);
    const reg = await U.regGet(STEAM_KEY, 'SteamPath');
    if (reg && fs.existsSync(reg)) return path.normalize(reg);
    const def = 'C:\\Program Files (x86)\\Steam';
    return fs.existsSync(def) ? def : null;
  }

  async status() {
    const p = await this.steamPath();
    return { installed: !!p, path: p, running: await U.isRunning('steam.exe') };
  }

  async vdfFile() {
    const p = await this.steamPath();
    if (!p) throw new Error('Steam não encontrada. Defina a pasta da Steam em Configurações.');
    return path.join(p, 'config', 'loginusers.vdf');
  }

  async readUsers() {
    const f = await this.vdfFile();
    if (!fs.existsSync(f)) return { file: f, root: { users: {} } };
    const root = vdf.parse(fs.readFileSync(f, 'utf8'));
    if (!root.users) root.users = {};
    return { file: f, root };
  }

  async writeUsers(file, root) {
    // backup antes de mexer
    try {
      fs.mkdirSync(this.store.backupDir, { recursive: true });
      if (fs.existsSync(file)) fs.copyFileSync(file, path.join(this.store.backupDir, 'loginusers.vdf.bak'));
    } catch { /* sem backup não impede */ }
    try {
      fs.writeFileSync(file, vdf.stringify(root), 'utf8');
    } catch (e) {
      if (e.code === 'EPERM' || e.code === 'EACCES') {
        throw new Error('Sem permissão para editar a pasta da Steam. Feche a Steam ou abra o Piece Helper como administrador.');
      }
      throw e;
    }
  }

  async list() {
    const { root } = await this.readUsers();
    const p = await this.steamPath();
    const current = (await U.regGet(STEAM_KEY, 'AutoLoginUser')) || '';
    const out = [];
    for (const [steamId, u] of Object.entries(root.users)) {
      let avatar = null;
      const av = p && path.join(p, 'config', 'avatarcache', `${steamId}.png`);
      if (av && fs.existsSync(av)) {
        try { avatar = 'data:image/png;base64,' + fs.readFileSync(av).toString('base64'); } catch { /* */ }
      }
      out.push({
        id: steamId,
        login: u.AccountName || '',
        display: u.PersonaName || u.AccountName || steamId,
        avatar,
        current: !!current && current.toLowerCase() === String(u.AccountName || '').toLowerCase(),
        lastLogin: u.Timestamp ? Number(u.Timestamp) * 1000 : null,
        offline: u.WantsOfflineMode === '1',
      });
    }
    out.sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
    return out;
  }

  // Status público da conta (perfil XML da comunidade Steam, não precisa de chave de API).
  // Só funciona se o perfil não for privado e a pessoa não estiver "invisível".
  async presence(steamId) {
    const hit = this._presence?.[steamId];
    if (hit && Date.now() - hit.at < 30000) return hit.data;
    let data = { state: 'unknown' };
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 5000);
      const r = await fetch(`https://steamcommunity.com/profiles/${steamId}/?xml=1&t=${Date.now()}`, { signal: ctl.signal });
      clearTimeout(t);
      const xml = await r.text();
      const tag = (n) => {
        const m = xml.match(new RegExp(`<${n}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${n}>`));
        return m ? m[1].trim() : '';
      };
      const state = tag('onlineState'); // online | in-game | offline
      const game = tag('gameName');
      const priv = tag('privacyState');
      data = {
        state: state || 'unknown',
        game: game || null,
        isGC: /grand\s*chase/i.test(game || ''),
        private: priv && priv !== 'public',
      };
    } catch { /* sem internet ou Steam fora: segue sem aviso */ }
    this._presence = this._presence || {};
    this._presence[steamId] = { at: Date.now(), data };
    return data;
  }

  async close() {
    const p = await this.steamPath();
    if (await U.isRunning('steam.exe')) {
      // fecha "educadamente" primeiro
      try { if (p) U.launch(path.join(p, 'steam.exe'), ['-shutdown']); } catch { /* */ }
      const ok = await U.waitClosed(['steam.exe'], 9000);
      if (!ok) await U.killAll(['steam.exe']);
    }
    await U.killAll(['steamwebhelper.exe']);
    await U.waitClosed(['steam.exe', 'steamwebhelper.exe'], 5000);
  }

  async start(args = []) {
    const p = await this.steamPath();
    if (!p) throw new Error('Steam não encontrada.');
    U.launch(path.join(p, 'steam.exe'), args);
  }

  async switchTo(steamId, opts = {}) {
    const { file, root } = await this.readUsers();
    const user = root.users[steamId];
    if (!user) throw new Error('Conta não encontrada no loginusers.vdf.');
    const login = user.AccountName;
    const offline = opts.offline ?? this.store.settings().steamOffline ?? false;

    await this.close();

    for (const [id, u] of Object.entries(root.users)) {
      if (id === steamId) {
        u.MostRecent = '1';
        u.AllowAutoLogin = '1';
        u.RememberPassword = '1';
        u.WantsOfflineMode = offline ? '1' : '0';
        if (offline) u.SkipOfflineModeWarning = '1';
      } else {
        u.MostRecent = '0';
      }
    }
    await this.writeUsers(file, root);
    await U.regSet(STEAM_KEY, 'AutoLoginUser', 'REG_SZ', login);
    await U.regSet(STEAM_KEY, 'RememberPassword', 'REG_DWORD', 1);

    const args = [];
    if (opts.launchGame) args.push('-applaunch', opts.appId || GC_APPID);
    await this.start(args);
    return { login };
  }

  async addNew() {
    const { file, root } = await this.readUsers();
    await this.close();
    for (const u of Object.values(root.users)) u.MostRecent = '0';
    if (Object.keys(root.users).length) await this.writeUsers(file, root);
    await U.regSet(STEAM_KEY, 'AutoLoginUser', 'REG_SZ', '');
    await this.start();
  }

  async forget(steamId) {
    const { file, root } = await this.readUsers();
    if (!root.users[steamId]) return;
    await this.close();
    const login = root.users[steamId].AccountName;
    delete root.users[steamId];
    await this.writeUsers(file, root);
    const cur = await U.regGet(STEAM_KEY, 'AutoLoginUser');
    if (cur && login && cur.toLowerCase() === login.toLowerCase()) await U.regSet(STEAM_KEY, 'AutoLoginUser', 'REG_SZ', '');
  }
}

module.exports = { Steam, GC_APPID };

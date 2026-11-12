// Plataformas "por cópia de sessão" (Riot, Ubisoft) e Battle.net.
// Os caminhos dos arquivos de login seguem o que o TcNo Account Switcher documenta no Platforms.json.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const U = require('./util');

const DEFS = {
  riot: {
    name: 'Riot Games',
    exe: 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe',
    kill: ['LeagueClient.exe', 'LoR.exe', 'VALORANT.exe', 'RiotClientServices.exe', 'RiotClientUx.exe', 'RiotClientUxRender.exe'],
    files: [
      '%LocalAppData%\\Riot Games\\Riot Client\\Data\\Cookies',
      '%LocalAppData%\\Riot Games\\Riot Client\\Data\\Sessions',
      '%LocalAppData%\\Riot Games\\Riot Client\\Data\\RiotClientPrivateSettings.yaml',
      '%LocalAppData%\\Riot Games\\Riot Client\\Config\\RiotClientSettings.yaml',
    ],
    tip: 'Ao entrar no Riot Client, marque "Manter conectado" antes de salvar a conta.',
  },
  ubisoft: {
    name: 'Ubisoft Connect',
    exe: '%ProgramFiles(x86)%\\Ubisoft\\Ubisoft Game Launcher\\upc.exe',
    kill: ['upc.exe', 'UplayService.exe', 'UplayWebCore.exe'],
    files: [
      '%LocalAppData%\\Ubisoft Game Launcher\\ConnectSecureStorage.dat',
      '%LocalAppData%\\Ubisoft Game Launcher\\settings.yaml',
      '%LocalAppData%\\Ubisoft Game Launcher\\user.dat',
    ],
    tip: 'Ao entrar no Ubisoft Connect, marque "Lembrar de mim" antes de salvar a conta.',
  },
};

class SnapshotPlatform {
  constructor(id, store) {
    this.id = id;
    this.def = DEFS[id];
    this.name = this.def.name;
    this.kind = 'snapshot';
    this.tip = this.def.tip;
    this.store = store;
    this.root = path.join(store.dataDir, 'snapshots', id);
  }

  exePath() {
    const custom = this.store.settings().paths?.[this.id];
    return U.expandEnv(custom || this.def.exe);
  }

  async status() {
    const exe = this.exePath();
    return { installed: fs.existsSync(exe), path: exe, running: await U.isRunning(path.basename(exe)) };
  }

  sources() { return this.def.files.map((f) => U.expandEnv(f)); }

  async list() {
    if (!fs.existsSync(this.root)) return [];
    const active = this.store.settings().active?.[this.id];
    return fs.readdirSync(this.root)
      .map((dir) => {
        const meta = U.readJSON(path.join(this.root, dir, 'meta.json'), null);
        if (!meta) return null;
        return { id: dir, login: meta.name, display: meta.name, avatar: null, current: active === dir, lastLogin: meta.lastUsed || meta.savedAt };
      })
      .filter(Boolean)
      .sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
  }

  async close() {
    await U.killAll(this.def.kill);
    await U.waitClosed(this.def.kill, 8000);
  }

  copyOut(dir) {
    const filesDir = path.join(dir, 'files');
    U.rmrf(filesDir);
    let count = 0;
    this.sources().forEach((src, i) => {
      if (fs.existsSync(src)) {
        U.copyAny(src, path.join(filesDir, String(i), path.basename(src)));
        count++;
      }
    });
    return count;
  }

  async saveCurrent(name, existingId) {
    if (!name || !name.trim()) throw new Error('Dê um nome para a conta.');
    await this.close();
    const id = existingId || crypto.randomBytes(6).toString('hex');
    const dir = path.join(this.root, id);
    fs.mkdirSync(dir, { recursive: true });
    const count = this.copyOut(dir);
    if (!count) {
      if (!existingId) U.rmrf(dir);
      throw new Error(`Não encontrei a sessão do ${this.name}. Entre na conta no launcher (com "lembrar de mim") e tente de novo.`);
    }
    const old = U.readJSON(path.join(dir, 'meta.json'), {});
    U.writeJSON(path.join(dir, 'meta.json'), { ...old, name: name.trim(), savedAt: Date.now() });
    this.store.setActive(this.id, id);
    return { id };
  }

  async switchTo(id) {
    const dir = path.join(this.root, id);
    if (!fs.existsSync(path.join(dir, 'meta.json'))) throw new Error('Conta salva não encontrada.');
    await this.close();
    this.sources().forEach((src, i) => {
      U.rmrf(src);
      const saved = path.join(dir, 'files', String(i), path.basename(src));
      if (fs.existsSync(saved)) U.copyAny(saved, src);
    });
    const meta = U.readJSON(path.join(dir, 'meta.json'), {});
    meta.lastUsed = Date.now();
    U.writeJSON(path.join(dir, 'meta.json'), meta);
    this.store.setActive(this.id, id);
    U.launch(this.exePath());
    return { login: meta.name };
  }

  async addNew() {
    await this.close();
    // guarda a sessão atual num backup antes de limpar, por segurança
    const bdir = path.join(this.store.backupDir, `${this.id}-ultima-sessao`);
    this.copyOut(bdir);
    for (const src of this.sources()) U.rmrf(src);
    this.store.setActive(this.id, null);
    U.launch(this.exePath());
  }

  async forget(id) {
    U.rmrf(path.join(this.root, id));
    if (this.store.settings().active?.[this.id] === id) this.store.setActive(this.id, null);
  }
}

class BattleNet {
  constructor(store) {
    this.id = 'battlenet';
    this.name = 'Battle.net';
    this.kind = 'battlenet';
    this.store = store;
    this.tip = 'Entre em cada conta pelo menos uma vez no Battle.net (com "manter conectado") para ela aparecer aqui.';
    this.cfg = U.expandEnv('%AppData%\\Battle.net\\Battle.net.config');
    this.knownFile = path.join(store.dataDir, 'battlenet-contas.json');
  }

  exePath() {
    return U.expandEnv(this.store.settings().paths?.battlenet || '%ProgramFiles(x86)%\\Battle.net\\Battle.net.exe');
  }

  async status() {
    return { installed: fs.existsSync(this.exePath()), path: this.exePath(), running: await U.isRunning('Battle.net.exe') };
  }

  readCfg() { return U.readJSON(this.cfg, null); }

  emailsInCfg() {
    const c = this.readCfg();
    const s = c?.Client?.SavedAccountNames || '';
    return s.split(',').map((x) => x.trim()).filter(Boolean);
  }

  async list() {
    const inCfg = this.emailsInCfg();
    const known = U.readJSON(this.knownFile, []);
    const all = [...new Set([...inCfg, ...known])];
    U.writeJSON(this.knownFile, all);
    return all.map((e) => ({ id: e, login: e, display: e.split('@')[0], avatar: null, current: inCfg[0] === e, lastLogin: null }));
  }

  async close() {
    await U.killAll(['Battle.net.exe']);
    await U.waitClosed(['Battle.net.exe'], 8000);
  }

  async switchTo(email) {
    await this.close();
    const c = this.readCfg();
    if (!c) throw new Error('Battle.net.config não encontrado. Abra o Battle.net pelo menos uma vez.');
    c.Client = c.Client || {};
    const rest = this.emailsInCfg().filter((e) => e !== email);
    c.Client.SavedAccountNames = [email, ...rest].join(',');
    U.writeJSON(this.cfg, c);
    U.launch(this.exePath());
    return { login: email };
  }

  async addNew() {
    await this.close();
    const c = this.readCfg();
    if (c) {
      c.Client = c.Client || {};
      c.Client.SavedAccountNames = '';
      U.writeJSON(this.cfg, c);
    }
    U.launch(this.exePath());
  }

  async forget(email) {
    const known = U.readJSON(this.knownFile, []).filter((e) => e !== email);
    U.writeJSON(this.knownFile, known);
    const c = this.readCfg();
    if (c?.Client) {
      await this.close();
      c.Client.SavedAccountNames = this.emailsInCfg().filter((e) => e !== email).join(',');
      U.writeJSON(this.cfg, c);
    }
  }
}

module.exports = { SnapshotPlatform, BattleNet, DEFS };

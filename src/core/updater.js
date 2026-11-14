// Atualização automática, com o app aberto:
//  1. procura uma versão nova nas Releases do GitHub;
//  2. baixa o "app.asar" dela (~1 MB) para resources/versions/app-X.Y.Z.asar e confere o SHA-256;
//  3. reinicia o app (o loader.js abre a versão mais nova que estiver na pasta).
// Nada em uso é substituído, então não há script, janela preta nem arquivo travado.
const { app, net, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const ofs = require('original-fs'); // fs "de verdade": o fs normal do Electron trata arquivos .asar como pastas

const REPO = 'igorfrota/Piece-helper';
const PAGE = `https://github.com/${REPO}/releases/latest`;

let found = null;      // { version, notes, page, asar: { url, size, sha256 } | null }
let ready = null;      // versão já baixada e conferida
let downloading = null;

const parse = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}

const boot = () => global.__pieceBoot || null;
const resDir = () => path.dirname(app.getAppPath()); // ...\Piece Helper\resources
const versionsDir = () => (boot() && boot().versionsDir) || path.join(resDir(), 'versions');
// só dá para atualizar sozinho com o loader novo (1.1.4 em diante) e no app instalado
const canAuto = () => app.isPackaged && !!boot();

const view = () => (found ? { ...found, auto: !!found.asar && canAuto(), ready: ready === found.version } : null);

async function check() {
  const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Piece-Helper' },
  });
  if (!r.ok) throw new Error(`O GitHub respondeu ${r.status}.`);
  const j = await r.json();
  const version = String(j.tag_name || '').replace(/^v/i, '');
  if (!version || !newer(version, app.getVersion())) { found = null; return { current: app.getVersion(), update: null }; }
  const a = (j.assets || []).find((x) => /^app.*\.asar$/i.test(x.name));
  found = {
    version,
    notes: String(j.body || '').slice(0, 4000),
    page: j.html_url || PAGE,
    asar: a ? { url: a.browser_download_url, size: a.size, sha256: /^sha256:/i.test(a.digest || '') ? a.digest.slice(7).toLowerCase() : '' } : null,
  };
  if (ready && ready !== version) ready = null;
  return { current: app.getVersion(), update: view() };
}

async function download(onProgress) {
  if (!found || !found.asar) throw new Error('Não há atualização para baixar.');
  if (ready === found.version) return true;
  if (downloading) return downloading;
  downloading = (async () => {
    const dir = versionsDir();
    try { ofs.mkdirSync(dir, { recursive: true }); ofs.accessSync(dir, ofs.constants.W_OK); } catch {
      throw new Error('Sem permissão para atualizar nesta pasta. Baixe o .zip novo pela página de download.');
    }
    const dest = path.join(dir, `app-${found.version}.asar`);
    const tmp = dest + '.part';
    const r = await net.fetch(found.asar.url, { headers: { 'User-Agent': 'Piece-Helper' } });
    if (!r.ok || !r.body) throw new Error(`Falha ao baixar (${r.status}).`);
    const total = +r.headers.get('content-length') || found.asar.size || 0;
    const hash = crypto.createHash('sha256');
    const out = ofs.createWriteStream(tmp);
    const reader = r.body.getReader();
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const b = Buffer.from(value);
        hash.update(b); got += b.length;
        if (!out.write(b)) await new Promise((res) => out.once('drain', res));
        if (onProgress && total) onProgress({ step: 'download', pct: Math.min(99, Math.round((got / total) * 100)) });
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    } catch (e) { out.destroy(); try { ofs.unlinkSync(tmp); } catch { /* */ } throw e; }
    if (onProgress) onProgress({ step: 'verify', pct: 100 });
    const sum = hash.digest('hex');
    const fail = (msg) => { try { ofs.unlinkSync(tmp); } catch { /* */ } throw new Error(msg); };
    if (found.asar.sha256 && sum !== found.asar.sha256) fail('O arquivo baixado veio corrompido. Tente de novo.');
    if (found.asar.size && got !== found.asar.size) fail('O download veio incompleto. Tente de novo.');
    try { ofs.unlinkSync(dest); } catch { /* */ }
    ofs.renameSync(tmp, dest);
    // se esta versão já tinha sido marcada como ruim antes, dá outra chance (é um arquivo novo)
    try {
      const f = path.join(dir, 'ruins.json');
      const bad = JSON.parse(ofs.readFileSync(f, 'utf8')).filter((v) => v !== found.version);
      ofs.writeFileSync(f, JSON.stringify(bad));
    } catch { /* */ }
    if (onProgress) onProgress({ step: 'ready', pct: 100 });
    ready = found.version;
    return true;
  })();
  try { return await downloading; } finally { downloading = null; }
}

// reinicia já na versão nova (o loader escolhe a mais nova da pasta)
function restart(beforeExit) {
  if (!ready) throw new Error('A atualização ainda não foi baixada.');
  const args = process.argv.slice(1).filter((a) => a !== '--hidden' && a !== '--atualizado');
  app.relaunch({ args: [...args, '--atualizado'] });
  try { if (beforeExit) beforeExit(); } catch { /* */ }
  app.exit(0);
}

// limpeza: apaga versões antigas (fica só a atual e a anterior) e sobras do atualizador antigo
function cleanup() {
  if (!app.isPackaged) return;
  const res = resDir();
  for (const f of ['app-update.asar', 'app-old.asar', 'update-falhou.txt']) { try { ofs.unlinkSync(path.join(res, f)); } catch { /* */ } }
  const dir = versionsDir();
  let files = [];
  try { files = ofs.readdirSync(dir); } catch { return; }
  const cur = app.getVersion();
  const list = files.map((f) => ({ f, m: /^app-(\d+\.\d+\.\d+)\.asar(\.part)?$/.exec(f) })).filter((x) => x.m);
  const older = list.filter((x) => !x.m[2] && newer(cur, x.m[1])).sort((a, b) => (newer(a.m[1], b.m[1]) ? -1 : 1));
  const keepPrev = older[0] && older[0].f;
  for (const x of list) {
    if ((x.m[1] === cur && !x.m[2]) || x.f === keepPrev) continue;
    if (x.m[2] || newer(cur, x.m[1])) { try { ofs.unlinkSync(path.join(dir, x.f)); } catch { /* */ } }
  }
}

module.exports = {
  check,
  download,
  restart,
  cleanup,
  openPage: () => shell.openExternal(found ? found.page : PAGE),
  state: () => ({ current: app.getVersion(), update: view() }),
};

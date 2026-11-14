// Atualização automática: procura uma versão nova nas Releases do GitHub e, se a release tiver o arquivo
// "app.asar", baixa só ele (~1 MB), confere o SHA-256, troca o arquivo e reabre o Piece Helper.
// Se a versão nova precisar do pacote inteiro (sem app.asar na release), abre a página de download.
const { app, net, shell } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ofs = require('original-fs'); // fs "de verdade": o fs normal do Electron trata arquivos .asar como pastas

const REPO = 'igorfrota/Piece-helper';
const PAGE = `https://github.com/${REPO}/releases/latest`;

let found = null;      // { version, notes, page, asar: { url, size, sha256 } | null }
let ready = null;      // caminho do app.asar novo já baixado e conferido
let downloading = null;

const parse = (v) => String(v || '').replace(/^v/i, '').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function newer(a, b) {
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; }
  return false;
}

const resDir = () => path.dirname(app.getAppPath()); // ...\Piece Helper\resources

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
  return { current: app.getVersion(), update: { ...found, auto: !!found.asar && app.isPackaged } };
}

async function download(onProgress) {
  if (!found || !found.asar) throw new Error('Não há atualização para baixar.');
  if (ready) return ready;
  if (downloading) return downloading;
  downloading = (async () => {
    const dest = path.join(resDir(), 'app-update.asar');
    const tmp = dest + '.part';
    try { ofs.accessSync(resDir(), ofs.constants.W_OK); } catch {
      throw new Error('Sem permissão para atualizar nesta pasta. Baixe o .zip novo pela página de download.');
    }
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
        if (onProgress && total) onProgress(Math.min(99, Math.round((got / total) * 100)));
      }
      await new Promise((res, rej) => out.end((e) => (e ? rej(e) : res())));
    } catch (e) { out.destroy(); try { ofs.unlinkSync(tmp); } catch { /* */ } throw e; }
    const sum = hash.digest('hex');
    if (found.asar.sha256 && sum !== found.asar.sha256) { try { ofs.unlinkSync(tmp); } catch { /* */ } throw new Error('O arquivo baixado veio corrompido. Tente de novo.'); }
    if (found.asar.size && got !== found.asar.size) { try { ofs.unlinkSync(tmp); } catch { /* */ } throw new Error('O download veio incompleto. Tente de novo.'); }
    try { ofs.unlinkSync(dest); } catch { /* */ }
    ofs.renameSync(tmp, dest);
    if (onProgress) onProgress(100);
    ready = dest;
    return dest;
  })();
  try { return await downloading; } finally { downloading = null; }
}

// troca o app.asar depois que o Piece Helper fechar e abre de novo
function installAndRestart(quit) {
  if (!ready) throw new Error('A atualização ainda não foi baixada.');
  const res = resDir();
  const script = path.join(os.tmpdir(), `piece-helper-update-${Date.now()}.cmd`);
  const exe = process.execPath;
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `set "P=${process.pid}"`,
    'set /a N=0',
    ':wait',
    'tasklist /FI "PID eq %P%" 2>nul | find "%P%" >nul',
    'if errorlevel 1 goto go',
    'set /a N+=1',
    'if %N% GEQ 60 goto go',
    'ping -n 2 127.0.0.1 >nul',
    'goto wait',
    ':go',
    'ping -n 3 127.0.0.1 >nul',
    `copy /y "${path.join(res, 'app.asar')}" "${path.join(res, 'app-old.asar')}" >nul`,
    'set /a T=0',
    ':mv',
    `move /y "${ready}" "${path.join(res, 'app.asar')}" >nul`,
    'if not errorlevel 1 goto ok',
    'set /a T+=1',
    'if %T% GEQ 60 goto ok',
    'ping -n 2 127.0.0.1 >nul',
    'goto mv',
    ':ok',
    `start "" "${exe}" --atualizado`,
    'del "%~f0"',
  ];
  ofs.writeFileSync(script, lines.join('\r\n'), 'utf8');
  // roda o .cmd sem janela nenhuma: o wscript não abre console (o "detached" do Node abria uma janela preta)
  const vbs = script.replace(/\.cmd$/, '.vbs');
  const q = '""';
  ofs.writeFileSync(vbs, [
    `CreateObject("WScript.Shell").Run "cmd /c ${q}${script}${q}", 0, False`,
    'CreateObject("Scripting.FileSystemObject").DeleteFile WScript.ScriptFullName',
  ].join('\r\n').replace(/^/, '\ufeff'), 'utf16le'); // Unicode: funciona com acentos no caminho
  spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  quit();
}

module.exports = {
  check,
  download,
  installAndRestart,
  openPage: () => shell.openExternal(found ? found.page : PAGE),
  state: () => ({ current: app.getVersion(), update: found ? { ...found, auto: !!found.asar && app.isPackaged } : null, ready: !!ready }),
};

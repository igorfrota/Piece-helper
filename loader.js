// Inicialização do Piece Helper. Escolhe qual versão do app abrir:
//  - a que vem dentro deste pacote (src/), ou
//  - uma versão mais nova baixada pela atualização automática (resources/versions/app-X.Y.Z.asar).
// Assim a atualização nunca precisa substituir um arquivo em uso: ela só salva a versão nova ao lado
// e o app reinicia. Se uma versão nova não conseguir abrir, ela é marcada como ruim e volta a anterior.
const { app } = require('electron');
const path = require('path');
const fs = require('original-fs'); // arquivos comuns
const afs = require('fs');          // entende arquivos .asar por dentro

const own = require('./package.json').version;
const parse = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = parse(a), y = parse(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

const VERSIONS = path.join(path.dirname(app.getAppPath()), 'versions');
const BAD = path.join(VERSIONS, 'ruins.json');
const BOOT = path.join(VERSIONS, 'abrindo.json');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, v) => { try { fs.mkdirSync(VERSIONS, { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)); } catch { /* */ } };

const bundled = { version: own, entry: path.join(__dirname, 'src', 'main.js'), file: null };
const candidates = [];

if (app.isPackaged) {
  const bad = readJson(BAD, []);
  // a última tentativa de abrir uma versão baixada não terminou? marca como ruim e usa a anterior
  const boot = readJson(BOOT, null);
  if (boot && boot.version && !bad.includes(boot.version)) { bad.push(boot.version); writeJson(BAD, bad); }
  try { fs.unlinkSync(BOOT); } catch { /* */ }
  let files = [];
  try { files = fs.readdirSync(VERSIONS); } catch { /* sem pasta ainda */ }
  for (const f of files) {
    const m = /^app-(\d+\.\d+\.\d+)\.asar$/.exec(f);
    if (!m || bad.includes(m[1]) || !newer(m[1], own)) continue;
    const file = path.join(VERSIONS, f);
    if (afs.existsSync(path.join(file, 'src', 'main.js'))) candidates.push({ version: m[1], entry: path.join(file, 'src', 'main.js'), file });
  }
  candidates.sort((a, b) => (newer(a.version, b.version) ? -1 : 1));
}
candidates.push(bundled);

let pick = candidates[0];
// a versão escolhida aparece como a versão do app
const realGetVersion = app.getVersion.bind(app);
app.getVersion = () => (pick && pick.version) || realGetVersion();

global.__pieceBoot = {
  version: pick.version,
  bundled: own,
  versionsDir: VERSIONS,
  file: pick.file,
  // chamado pelo app quando a janela abriu: a versão funciona
  ok() { try { fs.unlinkSync(BOOT); } catch { /* */ } },
};

for (const c of candidates) {
  pick = c;
  global.__pieceBoot.version = c.version; global.__pieceBoot.file = c.file;
  try { if (typeof app.setVersion === 'function') app.setVersion(c.version); } catch { /* */ }
  if (c.file) writeJson(BOOT, { version: c.version, at: Date.now() });
  try {
    require(c.entry);
    break;
  } catch (e) {
    if (!c.file) throw e;
    // essa versão baixada quebrou logo de cara: marca como ruim e tenta a próxima
    const bad = readJson(BAD, []); if (!bad.includes(c.version)) { bad.push(c.version); writeJson(BAD, bad); }
    try { fs.unlinkSync(BOOT); } catch { /* */ }
  }
}

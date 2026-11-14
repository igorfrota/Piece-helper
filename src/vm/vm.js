// Piece Helper — máquina virtual (Hyper-V) com a placa de vídeo do PC (GPU-P).
// Os scripts do PowerShell ficam em ./ps (os mesmos do SOS PC). A cópia de drivers é adaptada do
// Easy-GPU-PV (MIT, github.com/jamesstringerparsec/Easy-GPU-PV) e o download do Windows usa o Fido
// (GPLv3, github.com/pbatard/Fido), baixado do GitHub oficial na hora.
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const IS_WIN = process.platform === 'win32';
const PS_DIR = path.join(__dirname, 'ps').replace('app.asar', 'app.asar.unpacked');

let DATA = path.join(os.homedir(), '.piece-helper');
let HELPER_DIR = null; // pasta do Piece Helper instalado (para copiar para dentro da VM)
const ps = (name) => fs.readFileSync(path.join(__dirname, 'ps', name + '.ps1'), 'utf8');
const dirs = () => ({ state: path.join(DATA, 'vm_gpu.json'), tmp: path.join(DATA, 'tmp'), tools: path.join(DATA, 'tools'), iso: path.join(DATA, 'iso'), logs: path.join(DATA, 'logs') });

function init(dataDir, helperDir) { DATA = dataDir; HELPER_DIR = helperDir && fs.existsSync(path.join(helperDir, 'PieceHelper.exe')) ? helperDir : null; }
const helperAvailable = () => !!HELPER_DIR;

// ---------------------------------------------------------------- utilidades
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } };
const writeJSON = (f, d) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(d, null, 2)); };
const loadState = () => readJSON(dirs().state, {}) || {};
const saveState = (s) => writeJSON(dirs().state, s);
const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const asList = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
const GB = 1073741824;

function isAdmin() {
  if (!IS_WIN) return Promise.resolve(false);
  return new Promise((r) => execFile('net', ['session'], { windowsHide: true }, (err) => r(!err)));
}

// ---------------------------------------------------------------- tarefas com saída ao vivo
const jobs = {};
class Job {
  constructor(title) { this.id = crypto.randomBytes(5).toString('hex'); this.title = title; this.lines = []; this.done = false; this.ok = null; this.progress = null; this.cancel = false; this.proc = null; this.started = Date.now(); this.steps = null; this.step = -1; this.extra = null; }
  setSteps(list) { this.steps = list; this.step = 0; }
  setStep(i) { if (this.steps) this.step = Math.max(this.step, i); }
  log(text, kind = '') {
    for (const part of String(text).split(/\r?\n/)) {
      const ms = /^##STEP (\d+)/.exec(part.trim());
      if (ms) { this.setStep(+ms[1]); continue; }
      if (part.startsWith('\r') || (this._cr && this.lines.length)) { this.lines[this.lines.length - 1] = { t: part.replace(/^\r/, ''), k: kind }; this._cr = false; continue; }
      if (part !== '' || kind) this.lines.push({ t: part, k: kind });
    }
  }
  progressLine(text) { // reescreve a última linha (barra de download)
    if (this._prog && this.lines.length) this.lines[this.lines.length - 1] = { t: text, k: '' };
    else this.lines.push({ t: text, k: '' });
    this._prog = true;
  }
  endProgress() { this._prog = false; }
  snapshot(since = 0) { return { id: this.id, title: this.title, lines: this.lines.slice(since), total: this.lines.length, done: this.done, ok: this.ok, progress: this.progress, steps: this.steps, step: this.step, extra: this.extra }; }
}
function startJob(title, fn) {
  const j = new Job(title);
  jobs[j.id] = j;
  (async () => {
    try { const r = await fn(j); j.ok = r !== false; } catch (e) { j.log('Erro: ' + (e.message || e), 'err'); j.ok = false; }
    j.done = true;
    saveLog(j);
  })();
  return j.id;
}
// guarda o histórico de cada tarefa (vai junto no relatório para o suporte); fica só nas 40 mais recentes
function saveLog(j) {
  try {
    const d = dirs().logs;
    fs.mkdirSync(d, { recursive: true });
    const t = new Date(j.started), pad = (n) => String(n).padStart(2, '0');
    const stamp = `${t.getFullYear()}${pad(t.getMonth() + 1)}${pad(t.getDate())}-${pad(t.getHours())}${pad(t.getMinutes())}${pad(t.getSeconds())}`;
    const head = [`Tarefa: ${j.title}`, `Início: ${t.toLocaleString('pt-BR')}`, `Duração: ${Math.round((Date.now() - j.started) / 1000)} s`, `Resultado: ${j.ok ? 'concluído' : 'com problema'}`,
      j.steps ? `Etapa: ${j.step + 1} de ${j.steps.length} (${j.steps[j.step] || ''})` : '', ''].filter((x) => x !== '').join('\r\n');
    fs.writeFileSync(path.join(d, `${stamp} ${j.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 60)}.log`), head + '\r\n\r\n' + j.lines.map((l) => l.t).join('\r\n'), 'utf8');
    const all = fs.readdirSync(d).filter((f) => f.endsWith('.log')).sort();
    for (const f of all.slice(0, Math.max(0, all.length - 40))) fs.unlinkSync(path.join(d, f));
  } catch { /* o log é só ajuda */ }
}
const pollJob = (id, since) => (jobs[id] ? jobs[id].snapshot(since) : { done: true, ok: false, lines: [], total: 0 });
function cancelJob(id) { const j = jobs[id]; if (!j) return false; j.cancel = true; try { j.proc && j.proc.kill(); } catch { /* */ } return true; }

// roda um dos scripts com as funções comuns (prelude) e variáveis; devolve { ok, result }
function runScript(job, body, values = {}) {
  const d = dirs();
  fs.mkdirSync(d.tmp, { recursive: true });
  const tag = crypto.randomBytes(4).toString('hex');
  const file = path.join(d.tmp, `vm_${tag}.ps1`);
  const res = path.join(d.tmp, `vm_${tag}.json`);
  let head = Object.entries(values).map(([k, v]) => `$${k} = ${q(v)}\n`).join('');
  head += `$ResultFile = ${q(res)}\n$script:GuestBuild = $null\n`;
  if (!('HelperSrc' in values)) head += `$HelperSrc = ${q(HELPER_DIR || '')}\n`;
  const script = ps('prelude') + '\n' + head + 'try {\n' + body + "\n} catch {\n  'ERRO: ' + $_.Exception.Message\n  exit 1\n}\n";
  fs.writeFileSync(file, '\uFEFF' + script, 'utf8');
  return new Promise((resolve) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true });
    job.proc = p;
    let buf = '';
    const feed = (chunk) => {
      buf += chunk.toString('utf8');
      const parts = buf.split(/\r?\n/);
      buf = parts.pop();
      for (const l of parts) job.log(l);
    };
    p.stdout.on('data', feed);
    p.stderr.on('data', feed);
    p.on('close', (code) => {
      if (buf) job.log(buf);
      job.proc = null;
      const result = readJSON(res, null);
      for (const f of [file, res]) { try { fs.unlinkSync(f); } catch { /* */ } }
      if (job.cancel) { job.log('Cancelado.', 'err'); return resolve({ ok: false, result }); }
      if (code) job.log(`(o comando terminou com código ${code})`);
      resolve({ ok: code === 0, result });
    });
    p.on('error', (e) => { job.log('Erro: ' + e.message, 'err'); resolve({ ok: false, result: null }); });
  });
}

// roda um script e lê o JSON que ele imprime
function psJson(body, timeout = 90000) {
  const d = dirs();
  fs.mkdirSync(d.tmp, { recursive: true });
  const file = path.join(d.tmp, `st_${crypto.randomBytes(4).toString('hex')}.ps1`);
  fs.writeFileSync(file, "\uFEFF[Console]::OutputEncoding=[Text.Encoding]::UTF8\n$ProgressPreference='SilentlyContinue'\n" + body, 'utf8');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout, maxBuffer: 16 << 20, encoding: 'utf8' }, (err, out) => {
      try { fs.unlinkSync(file); } catch { /* */ }
      const i = (out || '').indexOf('{');
      try { resolve(i >= 0 ? JSON.parse(out.slice(i)) : null); } catch { resolve(null); }
    });
  });
}

// ---------------------------------------------------------------- estado
const INTEGRATED = /Radeon\(TM\) Graphics$|Radeon Graphics$|Vega \d+ Graphics|Intel\(R\) (UHD|HD|Iris)|Intel\(R\) Graphics$|Intel\(R\) Arc\(TM\) Graphics$/i;
const VIRTUAL = /Parsec|Hyper-V|Basic Display|Remote Display|Virtual Display|Meta Virtual|IddSample|SudoVDA/i;

function recommend(threads, ram) {
  const gb = (ram || 0) / GB;
  const cpus = Math.max(2, Math.min(8, Math.floor((threads || 4) / 2)));
  const mem = gb <= 8.5 ? 3 : gb <= 16.5 ? 6 : gb <= 32.5 ? 10 : 12;
  return { cpus, ram_gb: mem, max_cpus: threads || 4, max_ram_gb: Math.max(2, Math.floor(gb / 2)) };
}

async function status() {
  if (!IS_WIN) return { hyperv: 'unsupported', vms: [], gpus: [], admin: false, recommend: recommend(4, 8 * GB) };
  const admin = await isAdmin();
  const d = (await psJson(ps('status'))) || {};
  const gpus = asList(d.gpus).filter((g) => g.name && !VIRTUAL.test(g.name)).map((g) => ({
    id: g.id, name: g.name, driver: g.driver, ok: g.ok, path: g.path, shareable: !!g.path, integrated: INTEGRATED.test(g.name),
  }));
  const shareable = gpus.filter((g) => g.shareable);
  const best = shareable.find((g) => !g.integrated) || shareable[0];
  let hv = 'unsupported';
  if (d.module && d.vmms) hv = 'on';
  else if (d.feature === 'Enabled') hv = 'reboot';
  else if (d.feature === 'Disabled' || d.feature === 'DisabledWithPayloadRemoved') hv = 'off';
  const st = loadState();
  const byPath = Object.fromEntries(gpus.filter((g) => g.path).map((g) => [g.path.toUpperCase(), g]));
  const vms = asList(d.vms).map((v) => {
    const rec = st[v.name] || {};
    let g = null;
    if (v.gpu) {
      g = byPath[(v.gpuPath || '').toUpperCase()] || (rec.gpu_id && gpus.find((x) => x.id === rec.gpu_id)) || (shareable.length === 1 ? shareable[0] : null);
    }
    let drivers = null;
    if (v.gpu) drivers = !rec.driver ? 'unknown' : (g && g.driver && g.driver !== rec.driver ? 'outdated' : 'ok');
    return { ...v, gpu_id: g ? g.id : null, gpu_name: g ? g.name : null, drivers, driver_copied: rec.driver || null,
      guest_build: rec.guest_build || null, tune_backup: !!(st._tune || {})[v.name] };
  });
  return { admin, hyperv: hv, edition: d.edition, build: d.build, threads: d.threads, ram: d.ram, vtx: d.vtx, hypervisor: d.hypervisor,
    vmerror: d.vmerror || (!admin && hv === 'on' && !vms.length ? 'admin' : null), vms, gpus, default_gpu: best ? best.id : null,
    recommend: recommend(d.threads, d.ram) };
}

function checkVersions(job, hostBuild, guestBuild) {
  if (!hostBuild || !guestBuild) return;
  const h11 = +hostBuild >= 22000, g11 = +guestBuild >= 22000;
  if (h11 !== g11) job.log(`Atenção: o seu PC está no Windows ${h11 ? '11' : '10'} e a VM no Windows ${g11 ? '11' : '10'}. Costuma funcionar, mas se a VM der tela azul ou ficar instável, a solução é usar o mesmo Windows nos dois.`, 'err');
}
const findVm = async (name) => { const s = await status(); return { s, v: s.vms.find((x) => x.name === name) }; };

// ---------------------------------------------------------------- placa de vídeo, processador e memória
function gpuSetup(name, gpuId) { return startJob(`Placa de vídeo na VM ${name}`, (j) => gpuSetupRun(j, name, gpuId)); }
async function gpuSetupRun(j, name, gpuId) {
  {
    const { s, v } = await findVm(name);
    if (!v) { j.log(`Não achei a VM '${name}'.`, 'err'); return false; }
    const g = s.gpus.find((x) => x.id === gpuId);
    if (!g || !g.shareable) { j.log('Essa placa não pode ser compartilhada com VMs neste PC.', 'err'); return false; }
    const st0 = loadState();
    const prev = (st0[name] || {}).prev || { checkpoint: v.checkpoint, autockpt: v.autockpt, stopAction: v.stopAction };
    j.log(`Colocando a ${g.name} na VM '${name}'.`, 'title');
    if (v.snaps) j.log(`A VM tem ${v.snaps} ponto(s) de verificação. Eles continuam lá, mas enquanto a placa estiver na VM não dá para criar novos.`);
    const { ok, result } = await runScript(j, ps('gpu_setup'), { VMName: name, GpuId: gpuId });
    if (!ok) return false;
    const st = loadState();
    st[name] = { ...(st[name] || {}), gpu_id: gpuId, gpu_name: g.name, driver: g.driver, guest_build: (result || {}).guest, prev, date: new Date().toISOString() };
    saveState(st);
    checkVersions(j, s.build, (result || {}).guest);
    j.log('Pronto! Ligue a VM e confira em Gerenciador de Dispositivos > Adaptadores de vídeo (dentro dela).', 'ok');
    j.log('Quando o driver da placa mudar no seu PC, o Piece Helper avisa e atualiza a VM com um clique.');
    return true;
  }
}

function gpuUpdate(name) { return startJob(`Atualizar drivers da VM ${name}`, (j) => gpuUpdateRun(j, name)); }
async function gpuUpdateRun(j, name) {
  {
    const { s, v } = await findVm(name);
    if (!v || !v.gpu) { j.log('Essa VM não está com a placa de vídeo.', 'err'); return false; }
    const g = s.gpus.find((x) => x.id === v.gpu_id);
    if (!g) { j.log('Não consegui descobrir qual placa está na VM. Tire a placa e coloque de novo.', 'err'); return false; }
    j.log(`Copiando os drivers atuais da ${g.name} (versão ${g.driver || '?'}) para a VM '${name}'.`, 'title');
    const { ok, result } = await runScript(j, ps('gpu_update'), { VMName: name, GpuId: g.id });
    if (!ok) return false;
    const st = loadState();
    const rec = st[name] || { prev: { checkpoint: 'Standard', autockpt: true, stopAction: 'Save' } };
    Object.assign(rec, { gpu_id: g.id, gpu_name: g.name, driver: g.driver, guest_build: (result || {}).guest, date: new Date().toISOString() });
    st[name] = rec;
    saveState(st);
    checkVersions(j, s.build, rec.guest_build);
    j.log('Drivers da VM atualizados.', 'ok');
    return true;
  }
}

function gpuRemove(name) {
  return startJob(`Tirar a placa da VM ${name}`, async (j) => {
    const prev = (loadState()[name] || {}).prev || {};
    j.log(`Tirando a placa de vídeo da VM '${name}'.`, 'title');
    const { ok } = await runScript(j, ps('gpu_remove'), { VMName: name, PrevCheckpoint: prev.checkpoint || '', PrevAuto: String(!!prev.autockpt), PrevStop: prev.stopAction || 'Save' });
    if (ok) {
      const st = loadState();
      if (st[name]) { for (const k of ['gpu_id', 'gpu_name', 'driver', 'guest_build', 'prev', 'date']) delete st[name][k]; if (!Object.keys(st[name]).length) delete st[name]; }
      saveState(st);
      j.log('Pronto. A VM voltou a funcionar sem a placa de vídeo. Os arquivos de driver copiados ficam inertes dentro dela.', 'ok');
    }
    return ok;
  });
}

function tune(name, cpus, ramGb) {
  return startJob(`Ajustar a VM ${name}`, async (j) => {
    const { s, v } = await findVm(name);
    if (!v) { j.log(`Não achei a VM '${name}'.`, 'err'); return false; }
    const rec = s.recommend;
    const c = Math.max(1, Math.min(+cpus, rec.max_cpus));
    const m = Math.max(1, Math.min(+ramGb, Math.max(rec.max_ram_gb, 2)));
    const st = loadState();
    st._tune = st._tune || {};
    if (!st._tune[name]) { st._tune[name] = { cpus: v.cpus, dyn: v.dyn, ram: v.ram }; saveState(st); }
    j.log(`VM '${name}': ${v.cpus} → ${c} processadores, memória ${(v.ram / GB).toFixed(1)} GB → ${m} GB fixos.`, 'title');
    const { ok } = await runScript(j, ps('tune'), { VMName: name, Cpus: c, RamGB: m });
    if (ok) j.log('Pronto. Enquanto a VM estiver ligada, essa memória fica reservada para ela.', 'ok');
    return ok;
  });
}

function tuneUndo(name) {
  return startJob(`Voltar a VM ${name} ao original`, async (j) => {
    const st = loadState();
    const b = (st._tune || {})[name];
    if (!b) { j.log('Não tenho o original guardado dessa VM.', 'err'); return false; }
    j.log(`Voltando a VM '${name}' para ${b.cpus} processadores e a memória de antes.`, 'title');
    const { ok } = await runScript(j, ps('tune_undo'), { VMName: name, Cpus: b.cpus, Dyn: String(!!b.dyn), Ram: b.ram });
    if (ok) { delete st._tune[name]; saveState(st); j.log('Pronto.', 'ok'); }
    return ok;
  });
}

function power(name, on) {
  return startJob(`${on ? 'Ligar' : 'Desligar'} a VM ${name}`, async (j) => {
    const { ok } = await runScript(j, on ? "Start-VM -Name $VMName\n'VM ligada.'\n" : '[void](Stop-SosVM $VMName)\n', { VMName: name });
    return ok;
  });
}

function hypervEnable() {
  return startJob('Ativar o Hyper-V', async (j) => {
    j.log('Ativando o Hyper-V (o recurso de máquinas virtuais do Windows). Pode levar alguns minutos.', 'title');
    const { ok } = await runScript(j, "Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart | Out-Null\n'Hyper-V ativado.'\n");
    if (ok) j.log('Reinicie o PC para terminar. Depois volte aqui.', 'ok');
    return ok;
  });
}

function installHelper(name) {
  return startJob(`Piece Helper na VM ${name}`, async (j) => {
    if (!HELPER_DIR) { j.log('Só dá para copiar o Piece Helper quando ele está instalado (aberto pelo PieceHelper.exe).', 'err'); return false; }
    j.log(`Instalando o Piece Helper na VM '${name}'. A VM vai ser desligada e ligada de novo.`, 'title');
    const { ok } = await runScript(j, ps('helper_install'), { VMName: name, HelperSrc: HELPER_DIR });
    if (ok) j.log('Pronto! Dentro da VM, abra o atalho "Piece Helper" na área de trabalho. As contas da Steam de lá são as que você logar na própria VM.', 'ok');
    return ok;
  });
}

function openWindow(name, edit) {
  spawn('vmconnect.exe', ['localhost', name, ...(edit ? ['/edit'] : [])], { detached: true, stdio: 'ignore' }).unref();
}
function openManager() { spawn('cmd.exe', ['/c', 'start', '', 'virtmgmt.msc'], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); }

// ---------------------------------------------------------------- criar uma VM do zero
const FIDO_URL = 'https://raw.githubusercontent.com/pbatard/Fido/master/Fido.ps1';
const STEAM_SETUP_URL = 'https://cdn.akamai.steamstatic.com/client/installer/SteamSetup.exe';
const STEAM_DIR_VM = 'C:\\Program Files (x86)\\Steam';
const LANGS = [['pt-br', 'Brazilian Portuguese'], ['pt', 'Portuguese'], ['en-us', 'English'], ['en', 'English International'],
  ['es-mx', 'Spanish (Mexico)'], ['es', 'Spanish'], ['fr-ca', 'French Canadian'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'],
  ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['tr', 'Turkish'], ['ja', 'Japanese'], ['ko', 'Korean'],
  ['zh-tw', 'Chinese (Traditional)'], ['zh', 'Chinese (Simplified)']];
const BLOAT_APPS = ['Microsoft.BingNews', 'Microsoft.BingWeather', 'Microsoft.BingSearch', 'Microsoft.GetHelp', 'Microsoft.Getstarted',
  'Microsoft.MicrosoftOfficeHub', 'Microsoft.MicrosoftSolitaireCollection', 'Microsoft.People', 'Microsoft.Todos',
  'Microsoft.WindowsFeedbackHub', 'Microsoft.WindowsMaps', 'Microsoft.ZuneMusic', 'Microsoft.ZuneVideo',
  'Microsoft.YourPhone', 'Microsoft.549981C3F5F10', 'Microsoft.PowerAutomateDesktop', 'Microsoft.Copilot',
  'Microsoft.OutlookForWindows', 'Microsoft.WindowsCommunicationsApps', 'MicrosoftCorporationII.MicrosoftFamily',
  'Clipchamp.Clipchamp', 'MicrosoftTeams', 'MSTeams', 'Microsoft.Windows.DevHome', 'Microsoft.MixedReality.Portal',
  'Microsoft.SkypeApp', 'Microsoft.Microsoft3DViewer', 'Microsoft.Wallet', 'Microsoft.Messaging', 'Microsoft.Office.OneNote'];
const LITE_WHAT = [
  'Telemetria (envio de dados de uso para a Microsoft) no mínimo e o serviço que coleta desligado',
  'Apps que se instalam sozinhos, sugestões, dicas e propagandas no menu Iniciar desligados',
  'Cortana, Copilot, Widgets/Notícias e pesquisa da web (Bing) no menu Iniciar desligados',
  'ID de propaganda desligado e OneDrive sem iniciar sozinho',
  'Apps inúteis removidos: Notícias, Clima, Paciência, Mapas, Teams, Clipchamp, Outlook, Dicas, Hub de Comentários e outros (a Loja, Calculadora, Fotos, Bloco de Notas e os apps do Xbox ficam)',
  'Indexação da pesquisa e Superfetch desligados (economizam processador e disco na VM)',
  'Efeitos visuais no modo desempenho, plano de energia Alto desempenho e hibernação desligada',
];

const hostCulture = () => (Intl.DateTimeFormat().resolvedOptions().locale || 'en-US');
function msLanguage(culture) {
  const c = (culture || '').toLowerCase();
  for (const [pre, name] of LANGS) if (c === pre || c.startsWith(pre + '-') || (pre.length === 2 && c.slice(0, 2) === pre)) return name;
  return 'English';
}
function computerName(vmName, user) {
  let n = (vmName || '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 15).replace(/^-+|-+$/g, '') || 'PIECE-VM';
  if (/^\d+$/.test(n)) n = ('VM-' + n).slice(0, 15);
  if (n.toLowerCase() === (user || '').toLowerCase()) n = n.slice(0, 12) + '-PC';
  return n;
}

function vdfValues(text, key) {
  const re = new RegExp('"' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"\\s+"([^"]*)"', 'gi');
  const out = []; let m;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
}
// jogos da Steam instalados neste PC (para copiar para a VM sem baixar de novo)
function steamGames(steamPath) {
  if (!steamPath) return [];
  const libs = [steamPath];
  try { libs.push(...vdfValues(fs.readFileSync(path.join(steamPath, 'steamapps', 'libraryfolders.vdf'), 'utf8'), 'path').map((p) => p.replace(/\\\\/g, '\\'))); } catch { /* */ }
  const out = [], seen = new Set();
  for (const lib of libs) {
    const apps = path.join(lib, 'steamapps');
    if (!fs.existsSync(apps) || seen.has(apps.toLowerCase())) continue;
    seen.add(apps.toLowerCase());
    for (const fn of fs.readdirSync(apps)) {
      if (!/^appmanifest_\d+\.acf$/.test(fn)) continue;
      try {
        const t = fs.readFileSync(path.join(apps, fn), 'utf8');
        const appid = vdfValues(t, 'appid')[0], name = vdfValues(t, 'name')[0], dir = vdfValues(t, 'installdir')[0];
        const size = parseInt(vdfValues(t, 'SizeOnDisk')[0] || '0', 10) || 0;
        const src = path.join(apps, 'common', dir);
        if (!appid || appid === '228980' || !fs.existsSync(src)) continue;
        out.push({ appid, name, dir, src, manifest: path.join(apps, fn), size });
      } catch { /* */ }
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const BAD_USER = /[\\/[\]:;|=,+*?<>"@%]/;
function validate(o, st) {
  const name = (o.name || '').trim(), user = (o.user || '').trim();
  if (!name || name.length > 60 || /[\\/:*?"<>|]/.test(name)) return 'Dê um nome para a VM, sem os caracteres \\ / : * ? " < > |.';
  if (!user || user.length > 20 || BAD_USER.test(user) || user.endsWith('.')) return 'O nome do usuário precisa ter até 20 letras, sem símbolos como \\ / [ ] : ; | = , + * ? < > " @ %.';
  if (['administrator', 'administrador', 'guest', 'convidado', 'system', 'defaultaccount'].includes(user.toLowerCase())) return 'Esse nome de usuário é reservado pelo Windows. Escolha outro.';
  if (!o.iso && !['10', '11'].includes(String(o.win))) return 'Escolha Windows 10 ou 11, ou uma ISO.';
  if (o.iso && !fs.existsSync(o.iso)) return 'Não achei o arquivo da ISO escolhida.';
  if ((st.vms || []).some((v) => v.name.toLowerCase() === name.toLowerCase())) return `Já existe uma VM chamada "${name}". Escolha outro nome.`;
  const rec = st.recommend || {};
  const cpus = parseInt(o.cpus, 10), ram = parseInt(o.ram_gb, 10), disk = parseInt(o.disk_gb, 10);
  if ([cpus, ram, disk].some(Number.isNaN)) return 'Preencha processadores, memória e disco com números.';
  if (cpus < 2 || (rec.max_cpus && cpus > rec.max_cpus)) return `Use entre 2 e ${rec.max_cpus || cpus} processadores.`;
  const maxRam = Math.max(rec.max_ram_gb || ram, 4);
  if (ram < 4 || ram > maxRam) return `Use entre 4 e ${maxRam} GB de memória (o Windows precisa de pelo menos 4).`;
  if (disk < 64 || disk > 2000) return 'Use um disco entre 64 e 2000 GB (o Windows 11 pede pelo menos 64).';
  const gamesGb = (o._games || []).reduce((a, g) => a + (g.size || 0), 0) / GB;
  if (gamesGb && disk < 40 + gamesGb * 1.15) return `Os jogos escolhidos ocupam ${gamesGb.toFixed(0)} GB. Aumente o disco da VM para pelo menos ${Math.floor(40 + gamesGb * 1.15) + 1} GB.`;
  return null;
}

function unattendXml(user, comp, lite, steam, gpu) { // (o atalho do Piece Helper é criado direto no disco da VM)
  const cmds = [];
  if (lite) cmds.push('powercfg /setactive 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c', 'powercfg /hibernate off');
  // (a correção do aviso de OpenGL da Steam é gravada direto no disco da VM: Set-SosSteamGlFix em create.ps1)
  // só instala: abrir a Steam aqui faria ela rodar como administrador e antes da rede ficar pronta
  // ("Aguardando rede", jogos sem abrir). A pessoa abre pelo atalho, do jeito normal.
  if (steam) cmds.push('C:\\SOS\\SteamSetup.exe /S');
  const first = cmds.length ? '\n      <FirstLogonCommands>' + cmds.map((c, i) =>
    `\n        <SynchronousCommand wcm:action="add"><Order>${i + 1}</Order><CommandLine>${xmlEsc(c)}</CommandLine></SynchronousCommand>`).join('') + '\n      </FirstLogonCommands>' : '';
  const arch = 'processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS"';
  const u = xmlEsc(user), c = xmlEsc(comp);
  return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State">
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" ${arch}>
      <ComputerName>${c}</ComputerName>
    </component>
  </settings>
  <settings pass="oobeSystem">
    <component name="Microsoft-Windows-International-Core" ${arch}>
      <InputLocale>__LOCALE__</InputLocale>
      <SystemLocale>__LOCALE__</SystemLocale>
      <UILanguage>__UILANG__</UILanguage>
      <UserLocale>__LOCALE__</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" ${arch}>
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <HideLocalAccountScreen>true</HideLocalAccountScreen>
        <ProtectYourPC>3</ProtectYourPC>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Name>${u}</Name>
            <DisplayName>${u}</DisplayName>
            <Group>Administrators</Group>
            <Password><Value></Value><PlainText>true</PlainText></Password>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>
      <AutoLogon>
        <Enabled>true</Enabled>
        <Username>${u}</Username>
        <Password><Value></Value><PlainText>true</PlainText></Password>
        <LogonCount>9999999</LogonCount>
      </AutoLogon>
      <TimeZone>__TZ__</TimeZone>${first}
    </component>
  </settings>
</unattend>
`;
}

// download com redirecionamentos e progresso
function download(url, dest, job, p0, p1, redirects = 0, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PieceHelper', ...headers } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 8) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).toString(), dest, job, p0, p1, redirects + 1, headers));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`O servidor respondeu ${res.statusCode}.`)); }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      const tmp = dest + '.part';
      const f = fs.createWriteStream(tmp);
      let got = 0, last = 0;
      res.on('data', (c) => {
        if (job.cancel) { req.destroy(new Error('Cancelado.')); return; }
        got += c.length;
        if (total) job.progress = p0 + (p1 - p0) * got / total;
        if (Date.now() - last > 3000) { last = Date.now(); job.progressLine(`Baixando: ${(got / GB).toFixed(2)} GB${total ? ' de ' + (total / GB).toFixed(2) + ' GB' : ''}`); }
      });
      res.pipe(f);
      f.on('finish', () => f.close(() => {
        job.endProgress();
        if (total && got < total) return reject(new Error('O download foi interrompido. Tente de novo.'));
        fs.renameSync(tmp, dest);
        resolve(dest);
      }));
      res.on('error', reject);
    });
    req.on('error', reject);
  });
}

async function getWindowsIso(job, win, isoDir) {
  const lang = msLanguage(hostCulture());
  const d = dirs();
  const dir = isoDir || d.iso;
  fs.mkdirSync(dir, { recursive: true });
  const fname = `Win${win}_${lang.replace(/[^A-Za-z]/g, '')}_x64.iso`;
  const old = path.join(d.iso, fname);
  if (dir !== d.iso && fs.existsSync(old) && fs.statSync(old).size > 3 * GB) { job.log(`Usando o Windows ${win} que já foi baixado antes (${old}).`); return old; }
  const iso = path.join(dir, fname);
  if (fs.existsSync(iso) && fs.statSync(iso).size > 3 * GB) { job.log(`Usando o Windows ${win} que já foi baixado antes (${iso}).`); return iso; }
  fs.mkdirSync(d.tools, { recursive: true });
  const fido = path.join(d.tools, 'Fido.ps1');
  job.log('Pedindo à Microsoft o link oficial do Windows…', 'title');
  if (!fs.existsSync(fido) || Date.now() - fs.statSync(fido).mtimeMs > 7 * 86400000) await download(FIDO_URL, fido, job, 0, 0);
  const out = await new Promise((r) => execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fido,
    '-Win', String(win), '-Rel', 'Latest', '-Ed', 'Pro', '-Lang', lang, '-Arch', 'x64', '-GetUrl'],
  { windowsHide: true, timeout: 180000, encoding: 'utf8' }, (e, so, se) => r((so || '') + (se || ''))));
  const m = out.match(/https:\/\/\S+?\.iso\S*/);
  if (!m) {
    job.log(out.trim().slice(-600));
    throw new Error('A Microsoft não liberou o download agora (às vezes ela bloqueia por algumas horas). Tente mais tarde, ou baixe a ISO pelo site da Microsoft e escolha "ISO que já baixei".');
  }
  job.log(`Baixando o Windows ${win} (${lang}) direto da Microsoft. São uns 6 GB; depende da sua internet.`);
  await download(m[0], iso, job, 0.02, 0.6);
  job.log('Download concluído.', 'ok');
  return iso;
}

function resolveGames(o, steamPath) {
  const want = new Set((o.steam ? o.games || [] : []).map(String));
  o._games = want.size ? steamGames(steamPath).filter((g) => want.has(g.appid)) : [];
  return o;
}

async function precheck(opts, steamPath) {
  return validate(resolveGames({ ...opts }, steamPath), await status());
}

// etapas que aparecem na tela enquanto a VM é criada
const CREATE_STEPS = ['Conferir o PC e escolher o disco', 'Baixar o Windows', 'Preparar o disco da VM', 'Copiar o Windows para a VM',
  'Ajustes, drivers, Steam e jogos', 'Criar e ligar a VM'];

// discos do PC para a tela "Onde instalar a VM": espaço, tipo (SSD/HD, NVMe, USB) e qual é o do Windows
async function drives() {
  const d = (await psJson(`
$hv = $null; try { $hv = (Get-VMHost -EA Stop).VirtualHardDiskPath } catch {}
$sys = $env:SystemDrive.Substring(0, 1)
$list = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    $L = $_.DeviceID.Substring(0, 1); $media = ''; $bus = ''
    try {
        $dn = (Get-Partition -DriveLetter $L -EA Stop | Select-Object -First 1).DiskNumber
        $pd = Get-PhysicalDisk -EA Stop | Where-Object { $_.DeviceId -eq [string]$dn } | Select-Object -First 1
        if ($pd) { $media = [string]$pd.MediaType; $bus = [string]$pd.BusType }
    } catch {}
    [ordered]@{ letter = $L; label = [string]$_.VolumeName; free = [int64]$_.FreeSpace; size = [int64]$_.Size; fs = [string]$_.FileSystem; media = $media; bus = $bus; system = ($L -eq $sys) }
})
[ordered]@{ drives = $list; hv = $hv } | ConvertTo-Json -Depth 4 -Compress
`, 60000)) || {};
  return {
    hv: d.hv || '',
    drives: asList(d.drives).filter((x) => x && x.letter).map((x) => ({
      letter: String(x.letter).toUpperCase(), label: x.label || '', free: +x.free || 0, size: +x.size || 0, fs: x.fs || '',
      ssd: /ssd/i.test(x.media || '') || /nvme/i.test(x.bus || ''), hdd: /hdd/i.test(x.media || ''), nvme: /nvme/i.test(x.bus || ''),
      usb: /usb/i.test(x.bus || ''), system: !!x.system, ok: /^(ntfs|refs)$/i.test(x.fs || ''),
    })),
  };
}

// escolhe onde guardar o disco da VM (e a ISO): o disco que a pessoa escolheu; sem escolha, o disco padrão
// do Hyper-V se couber, senão o disco com mais espaço
async function pickStorage(j, needGb, chosen) {
  if (chosen) {
    const L = String(chosen).slice(0, 1).toUpperCase();
    const info = await drives();
    const dv = info.drives.find((x) => x.letter === L);
    if (!dv) throw new Error(`O disco ${L}: não foi encontrado. Escolha outro disco na criação da VM.`);
    if (!dv.ok) throw new Error(`O disco ${L}: está em ${dv.fs || 'um formato desconhecido'}; a VM precisa de um disco NTFS.`);
    if (dv.free / GB < needGb) throw new Error(`O disco ${L}: tem ${Math.floor(dv.free / GB)} GB livres e a VM precisa de uns ${Math.ceil(needGb)} GB. Escolha outro disco ou libere espaço.`);
    const vmDir = `${L}:\\Piece Helper\\VMs`;
    j.log(`A VM vai ficar no disco ${L}: escolhido (${Math.floor(dv.free / GB)} GB livres): ${vmDir}`);
    return { vhdDir: `${vmDir}\\Discos`, vmDir, isoDir: L !== 'C' ? `${L}:\\Piece Helper\\ISO` : null };
  }
  return pickStorageAuto(j, needGb);
}

async function pickStorageAuto(j, needGb) {
  const d = (await psJson(ps('diag'), 120000)) || {};
  const drives = asList(d.drives).filter((x) => x && x.letter);
  const defDir = d.vhdDir || 'C:\\ProgramData\\Microsoft\\Windows\\Virtual Hard Disks';
  const defL = defDir.slice(0, 1).toUpperCase();
  const free = (L) => ((drives.find((x) => x.letter.toUpperCase() === L) || {}).free || 0) / GB;
  let vhdDir = '', vmDir = '', where = defL;
  if (free(defL) < needGb) {
    const best = drives.slice().sort((a, b) => b.free - a.free)[0];
    if (!best || best.free / GB < needGb) {
      throw new Error(`Falta espaço: a VM precisa de uns ${Math.ceil(needGb)} GB livres e o disco com mais espaço tem ${best ? Math.floor(best.free / GB) : 0} GB. ` +
        'Use "Verificar e corrigir" no topo da tela: o Piece Helper limpa os arquivos temporários do Windows e mostra quanto falta.');
    }
    where = best.letter.toUpperCase();
    vmDir = `${where}:\\Piece Helper\\VMs`;
    vhdDir = `${vmDir}\\Discos`;
    j.log(`O disco ${defL}: tem só ${Math.floor(free(defL))} GB livres. A VM vai ficar no disco ${where}: (${Math.floor(free(where))} GB livres): ${vhdDir}`);
  } else j.log(`Espaço: ${Math.floor(free(defL))} GB livres no disco ${defL}: (a VM precisa de uns ${Math.ceil(needGb)} GB).`);
  const isoDir = free('C') < 9 && where !== 'C' ? `${where}:\\Piece Helper\\ISO` : null;
  return { vhdDir, vmDir, isoDir, build: d.build };
}

// lê o "buildid" do jogo na Steam deste PC (para saber se o da VM ficou para trás)
function gameBuild(g) {
  try { return vdfValues(fs.readFileSync(g.manifest, 'utf8'), 'buildid')[0] || null; } catch { return null; }
}

async function createRun(j, o) {
  j.setSteps(CREATE_STEPS);
  const st = await status();
  if (st.hyperv !== 'on') { j.log('O Hyper-V não está ligado neste PC. Use "Verificar e corrigir" para ligar.', 'err'); return false; }
  const err = validate(o, st);
  if (err) { j.log(err, 'err'); return false; }
  const name = o.name.trim(), user = o.user.trim();
  let gpuId = o.gpu_id || '';
  const g = gpuId ? st.gpus.find((x) => x.id === gpuId && x.shareable) : null;
  if (gpuId && !g) { j.log('Essa placa não pode ser compartilhada com VMs neste PC. A VM vai ser criada sem ela.', 'err'); gpuId = ''; }
  j.log(`Criando a VM "${name}".`, 'title');
  let games = o._games || [];
  const gamesGb = games.reduce((a, x) => a + (x.size || 0), 0) / GB;
  const store = await pickStorage(j, 32 + gamesGb * 1.08 + (o.iso ? 0 : 0), o.drive || null);
  j.setStep(1);
  let iso = o.iso;
  if (!iso) iso = await getWindowsIso(j, parseInt(o.win, 10), store.isoDir);
  else j.log('Usando a ISO escolhida: ' + iso);
  let steam = !!o.steam, setup = '';
  if (steam) {
    try {
      const d = dirs();
      fs.mkdirSync(d.tools, { recursive: true });
      setup = path.join(d.tools, 'SteamSetup.exe');
      if (!fs.existsSync(setup) || Date.now() - fs.statSync(setup).mtimeMs > 30 * 86400000) {
        j.log('Baixando o instalador oficial da Steam…');
        await download(STEAM_SETUP_URL, setup, j, j.progress || 0.6, j.progress || 0.6);
      }
    } catch (e) {
      j.log(`Não consegui baixar o instalador da Steam (${e.message}). A VM vai ser criada sem ela.`, 'err');
      steam = false; setup = ''; games = [];
    }
  }
  j.setStep(2);
  j.progress = 0.62;
  const values = {
    VMName: name, Iso: iso, Cpus: parseInt(o.cpus, 10), RamGB: parseInt(o.ram_gb, 10), DiskGB: parseInt(o.disk_gb, 10),
    GpuId: gpuId, StartVM: o.start === false ? '0' : '1',
    Unattend: unattendXml(user, computerName(name, user), o.lite !== false, steam, !!gpuId),
    SteamSetup: setup,
    Games: games.length ? JSON.stringify(games.map((x) => ({ name: x.name, src: x.src, dir: x.dir, manifest: x.manifest, gb: Math.round(x.size / GB * 10) / 10 }))) : '',
    Lite: o.lite === false ? '0' : '1', BloatApps: BLOAT_APPS.join(','),
    HelperSrc: o.helper !== false && HELPER_DIR ? HELPER_DIR : '',
    SteamGlFix: steam && gpuId ? '1' : '0',
    VhdDir: store.vhdDir, VmDir: store.vmDir,
  };
  const { ok, result } = await runScript(j, ps('create'), values);
  if (!ok) return false;
  // guarda tudo o que precisa para reparar ou refazer a VM igualzinha depois
  const s = loadState();
  const keep = { ...o }; delete keep._games;
  s[name] = { ...(s[name] || {}), opts: keep, created: new Date().toISOString(), vhd: (result || {}).vhd || null,
    games: games.map((x) => ({ appid: x.appid, name: x.name, build: gameBuild(x) })) };
  if (gpuId && g) Object.assign(s[name], { gpu_id: gpuId, gpu_name: g.name, driver: g.driver, guest_build: (result || {}).guest,
    prev: { checkpoint: 'Production', autockpt: false, stopAction: 'ShutDown' }, date: new Date().toISOString() });
  saveState(s);
  checkVersions(j, st.build, (result || {}).guest);
  j.setStep(CREATE_STEPS.length);
  j.progress = 1;
  j.log(`Pronto! A VM "${name}" está criada. No primeiro início o Windows termina de se configurar sozinho (uns minutos) e entra direto no usuário "${user}", sem senha.`, 'ok');
  if (values.HelperSrc) j.log('O Piece Helper já está na VM: atalho "Piece Helper" na área de trabalho dela.');
  if (steam) j.log('No primeiro início, a Steam se instala sozinha (leva 1 ou 2 minutos). Depois abra pelo atalho "Steam" na área de trabalho da VM e entre com a sua conta.' + (games.length ? ' Os jogos copiados já aparecem instalados (a Steam pode conferir os arquivos uma vez).' : ''));
  j.log("Lembrete: o Windows da VM precisa da sua própria licença para ser ativado. Sem ativar ele funciona, mas fica com uma marca d'água e algumas opções de personalização bloqueadas.");
  return true;
}

function create(opts, steamPath) {
  const o = resolveGames({ ...opts }, steamPath);
  const id = startJob(`Criar a VM ${o.name}`, (j) => createRun(j, o));
  jobs[id].extra = { retry: { kind: 'create', opts } };
  return id;
}

function isoInfo(steamPath) {
  const d = dirs();
  const isos = [];
  try { for (const f of fs.readdirSync(d.iso)) if (/\.iso$/i.test(f)) isos.push({ name: f, path: path.join(d.iso, f), size: fs.statSync(path.join(d.iso, f)).size }); } catch { /* */ }
  return { isos, lang: msLanguage(hostCulture()), lite: LITE_WHAT, helper: !!HELPER_DIR, games: steamGames(steamPath).map((g) => ({ appid: g.appid, name: g.name, size: g.size })) };
}

module.exports = {
  _int: { startJob, runScript, psJson, ps, dirs, download, loadState, saveState, GB, asList, steamGames, status, findVm, gpuUpdateRun, gpuSetupRun,
    createRun, resolveGames, gameBuild, isAdmin, IS_WIN, recommend, vdfValues, jobs, helperDir: () => HELPER_DIR, dataDir: () => DATA },
  init, isAdmin, installHelper, helperAvailable, status, gpuSetup, gpuUpdate, gpuRemove, tune, tuneUndo, power, hypervEnable, openWindow, openManager,
  create, precheck, isoInfo, drives, pollJob, cancelJob, _test: { unattendXml, validate, computerName, msLanguage, vdfValues, recommend } };

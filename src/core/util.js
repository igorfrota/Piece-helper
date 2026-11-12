// Utilidades de sistema (Windows): registro, processos, arquivos.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, encoding: 'utf8', ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Variáveis de ambiente (%LocalAppData% etc.) ----------
function expandEnv(p, extra = {}) {
  return p.replace(/%([^%]+)%/g, (m, name) => {
    if (extra[name] !== undefined) return extra[name];
    const key = Object.keys(process.env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? process.env[key] : m;
  });
}

// ---------- Registro ----------
async function regGet(key, value) {
  if (!IS_WIN) return null;
  const r = await run('reg', ['query', key, '/v', value]);
  if (r.code !== 0) return null;
  const line = r.stdout.split(/\r?\n/).find((l) => l.trim().toLowerCase().startsWith(value.toLowerCase() + ' '));
  if (!line) return null;
  const m = line.trim().match(/^\S+\s+(REG_\w+)\s*(.*)$/);
  if (!m) return null;
  if (m[1] === 'REG_DWORD') return parseInt(m[2], 16);
  return m[2];
}

async function regSet(key, value, type, data) {
  if (!IS_WIN) return true;
  const r = await run('reg', ['add', key, '/v', value, '/t', type, '/d', String(data), '/f']);
  if (r.code !== 0) throw new Error(`Falha ao gravar no registro (${key}\\${value}): ${r.stderr.trim()}`);
  return true;
}

// ---------- Processos ----------
async function isRunning(exe) {
  if (!IS_WIN) return false;
  const r = await run('tasklist', ['/FI', `IMAGENAME eq ${exe}`, '/NH', '/FO', 'CSV']);
  return r.stdout.toLowerCase().includes(`"${exe.toLowerCase()}"`);
}

async function killAll(exes, { force = true } = {}) {
  if (!IS_WIN) return;
  for (const exe of exes) {
    const name = exe.toLowerCase().endsWith('.exe') ? exe : exe + '.exe';
    if (await isRunning(name)) {
      await run('taskkill', [...(force ? ['/F'] : []), '/T', '/IM', name]);
    }
  }
}

async function waitClosed(exes, timeoutMs = 10000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let any = false;
    for (const e of exes) if (await isRunning(e.toLowerCase().endsWith('.exe') ? e : e + '.exe')) { any = true; break; }
    if (!any) return true;
    await sleep(400);
  }
  return false;
}

function launch(exe, args = [], cwd) {
  if (!fs.existsSync(exe)) throw new Error(`Executável não encontrado: ${exe}`);
  const child = spawn(exe, args, { cwd: cwd || path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', () => { /* erro de execução é tratado pelo status */ });
  child.unref();
}

// ---------- Arquivos ----------
function rmrf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* ignora */ }
}

function copyAny(src, dest) {
  const st = fs.statSync(src);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (st.isDirectory()) fs.cpSync(src, dest, { recursive: true, force: true });
  else fs.copyFileSync(src, dest);
}

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { return fallback; }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 60) || 'conta';
}

module.exports = { IS_WIN, run, sleep, expandEnv, regGet, regSet, isRunning, killAll, waitClosed, launch, rmrf, copyAny, readJSON, writeJSON, safeName };

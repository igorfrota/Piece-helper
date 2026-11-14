// Mostra "Jogando Piece Helper" no perfil do Discord (Rich Presence), sem bibliotecas extras:
// conversa direto com o Discord aberto no PC pelo canal local \\.\pipe\discord-ipc-N.
const net = require('net');
const crypto = require('crypto');

const CLIENT_ID = '1571102031119261766';
const IMAGE = 'https://raw.githubusercontent.com/igorfrota/Piece-helper/main/assets/icon.png';
const DOWNLOAD = 'https://github.com/igorfrota/Piece-helper/releases/latest';

let sock = null;
let ready = false;
let enabled = false;
let retry = null;
let buf = Buffer.alloc(0);
const since = Date.now();
let current = { details: 'Gerenciando contas', state: 'Guilda Piece화' };

function frame(op, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(8);
  head.writeInt32LE(op, 0);
  head.writeInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

function pipePath(n) {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${n}`;
  const dir = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || '/tmp';
  return `${dir.replace(/\/$/, '')}/discord-ipc-${n}`;
}

function cleanup() {
  ready = false;
  if (sock) { try { sock.destroy(); } catch { /* */ } }
  sock = null;
  buf = Buffer.alloc(0);
}

function schedule() {
  clearTimeout(retry);
  if (enabled) retry = setTimeout(connect, 20000); // Discord fechado: tenta de novo daqui a pouco
}

function tryPipe(n) {
  if (n > 9) { schedule(); return; }
  const s = net.createConnection(pipePath(n));
  let ok = false;
  s.once('connect', () => {
    ok = true;
    sock = s;
    s.write(frame(0, { v: 1, client_id: CLIENT_ID }));
  });
  s.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 8) {
      const op = buf.readInt32LE(0);
      const len = buf.readInt32LE(4);
      if (buf.length < 8 + len) break;
      let msg = null;
      try { msg = JSON.parse(buf.subarray(8, 8 + len).toString('utf8')); } catch { /* */ }
      buf = buf.subarray(8 + len);
      if (op === 1 && msg && msg.evt === 'READY') { ready = true; push(); }
      else if (op === 3) s.write(frame(4, msg || {})); // ping → pong
      else if (op === 2) { cleanup(); schedule(); }    // Discord encerrou
    }
  });
  s.once('error', () => { if (!ok) { s.destroy(); tryPipe(n + 1); } });
  s.once('close', () => { if (ok) { cleanup(); schedule(); } });
}

function connect() {
  clearTimeout(retry);
  if (!enabled || sock) return;
  tryPipe(0);
}

function send(activity) {
  if (!ready || !sock) return;
  try {
    sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: crypto.randomUUID() }));
  } catch { cleanup(); schedule(); }
}

function push() {
  send({
    details: current.details,
    state: current.state,
    timestamps: { start: since },
    assets: { large_image: IMAGE, large_text: 'Piece Helper' },
    buttons: [{ label: 'Baixar o Piece Helper', url: DOWNLOAD }],
    instance: false,
  });
}

module.exports = {
  // liga/desliga (opção "Mostrar no Discord")
  setEnabled(on) {
    enabled = !!on;
    if (enabled) connect();
    else { if (ready) send(null); clearTimeout(retry); setTimeout(cleanup, 300); }
  },
  // muda o texto mostrado ("Trocando de conta…", etc.)
  set(details, state) {
    current = { details: details || current.details, state: state || current.state };
    push();
  },
  idle() { this.set('Gerenciando contas', 'Guilda Piece화'); },
  stop() { enabled = false; clearTimeout(retry); if (ready) send(null); cleanup(); },
};

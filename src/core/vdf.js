// Parser/gerador simples de VDF (formato KeyValues da Valve), usado no loginusers.vdf.
function parse(text) {
  let i = 0;
  const n = text.length;

  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n' || c === '﻿') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  }

  function token() {
    skip();
    if (i >= n) return null;
    const c = text[i];
    if (c === '{' || c === '}') { i++; return { t: c }; }
    if (c === '"') {
      i++;
      let s = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          s += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else s += text[i++];
      }
      i++;
      return { t: 's', v: s };
    }
    let s = '';
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return { t: 's', v: s };
  }

  function obj() {
    const o = {};
    for (;;) {
      const k = token();
      if (!k || k.t === '}') return o;
      if (k.t !== 's') throw new Error('VDF inválido');
      const v = token();
      if (!v) throw new Error('VDF inválido (fim inesperado)');
      if (v.t === '{') o[k.v] = obj();
      else if (v.t === 's') o[k.v] = v.v;
      else throw new Error('VDF inválido');
    }
  }
  return obj();
}

function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function stringify(o, depth = 0) {
  const tab = '\t'.repeat(depth);
  let out = '';
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object') {
      out += `${tab}"${esc(k)}"\n${tab}{\n${stringify(v, depth + 1)}${tab}}\n`;
    } else {
      out += `${tab}"${esc(k)}"\t\t"${esc(v)}"\n`;
    }
  }
  return out;
}

module.exports = { parse, stringify };

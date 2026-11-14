/* Atualização automática com o app aberto: aviso de versão nova, janela com as etapas (baixar, conferir,
   reiniciar) e confirmação depois que o app volta já atualizado. */
(function () {
  'use strict';
  const P = window.piece;
  if (!P || !P.update) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (t) => esc(t).split(/\r?\n/).map((l) => {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/_(.+?)_/g, '<i>$1</i>');
    if (/^#{1,6}\s/.test(l)) return `<h4>${l.replace(/^#+\s*/, '')}</h4>`;
    if (/^\s*[-*]\s/.test(l)) return `<li>${l.replace(/^\s*[-*]\s/, '')}</li>`;
    return l.trim() ? `<p>${l}</p>` : '';
  }).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  const ICO = {
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4"/></svg>',
  };
  let U = null;            // atualização encontrada
  let cur = '';            // versão atual
  let escondido = '';
  let fase = 'novo';       // novo | baixando | conferindo | pronto | erro
  let pct = 0, erro = '', timer = null, falta = 0;

  /* ---------- cartão no canto ---------- */
  function card() {
    let el = document.getElementById('updCard');
    const aberto = !document.getElementById('wmodal').hidden && document.querySelector('#wmodalBox .upd-flow');
    if (!U || escondido === U.version || aberto) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'updCard'; el.className = 'upd-card'; document.body.appendChild(el); }
    const txt = fase === 'pronto' ? 'Já está baixada. Reinicie para usar.' : (U.auto ? 'Atualiza em poucos segundos, com o app aberto.' : 'Uma versão nova está pronta para baixar.');
    el.innerHTML = `<div class="upd-ico">${ICO.up}</div><div class="upd-main"><b>Piece Helper ${esc(U.version)}</b><p>${txt}</p>
      <div class="upd-acts"><button class="btn small ghost" data-u="ver">Novidades</button><button class="btn small primary" data-u="go">${fase === 'pronto' ? ICO.restart + 'Reiniciar' : ICO.up + 'Atualizar'}</button></div></div>
      <button class="upd-x" data-u="fechar" title="Lembrar depois">${ICO.x}</button>`;
    el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.u;
      if (a === 'fechar') { escondido = U.version; card(); return; }
      if (a === 'ver') { abrir(false); return; }
      if (a === 'go') abrir(true);
    }));
  }

  /* ---------- janela de atualização ---------- */
  function abrir(comecar) {
    const bg = document.getElementById('wmodal'), box = document.getElementById('wmodalBox');
    box.innerHTML = '<div class="upd-flow"></div>';
    bg.hidden = false;
    bg.onclick = (e) => { if (e.target === bg && fase !== 'baixando' && fase !== 'conferindo') fechar(); };
    card();
    desenhar();
    if (comecar) iniciar();
  }
  function fechar() {
    clearInterval(timer); timer = null;
    const bg = document.getElementById('wmodal'), box = document.getElementById('wmodalBox');
    if (box.querySelector('.upd-flow')) { bg.hidden = true; box.innerHTML = ''; }
    if (fase === 'pronto') escondido = '';
    card();
  }
  function passo(id, titulo, sub, estado) {
    return `<li class="upd-step ${estado}"><span class="upd-dot">${estado === 'done' ? ICO.ok : estado === 'now' ? '<i class="upd-spin"></i>' : ''}</span>
      <div><b>${titulo}</b>${sub ? `<small>${sub}</small>` : ''}</div></li>`;
  }
  function desenhar() {
    const box = document.querySelector('#wmodalBox .upd-flow');
    if (!box || !U) return;
    const st = (k) => {
      const ordem = ['baixando', 'conferindo', 'pronto'];
      const i = ordem.indexOf(fase), j = ordem.indexOf(k);
      if (fase === 'novo' || fase === 'erro') return 'todo';
      return j < i ? 'done' : j === i ? (k === 'pronto' ? 'done' : 'now') : 'todo';
    };
    const notas = `<details class="upd-notes-wrap" ${fase === 'novo' ? 'open' : ''}><summary>Novidades da versão ${esc(U.version)}</summary><div class="upd-notes">${md(U.notes) || '<p>Melhorias e correções.</p>'}</div></details>`;
    let corpo = '', acoes = '';
    if (fase === 'novo') {
      corpo = notas;
      acoes = `<button class="btn ghost" data-a="fechar">Agora não</button>
        <button class="btn primary" data-a="go">${U.auto ? ICO.up + 'Atualizar agora' : ICO.dl + 'Baixar no site'}</button>`;
    } else if (fase === 'erro') {
      corpo = `<div class="callout warn"><div><b>Não deu para atualizar</b><p>${esc(erro)}</p></div></div>`;
      acoes = `<button class="btn ghost" data-a="site">Baixar no site</button><button class="btn primary" data-a="go">Tentar de novo</button>`;
    } else {
      corpo = `<ol class="upd-steps">
          ${passo('dl', 'Baixando a versão nova', fase === 'baixando' ? `<span class="upd-bar"><i style="width:${pct}%"></i></span><em>${pct}%</em>` : '', st('baixando'))}
          ${passo('ck', 'Conferindo o arquivo', 'Impressão digital (SHA-256) igual à do GitHub', st('conferindo'))}
          ${passo('rs', fase === 'pronto' ? 'Pronto! Falta só reiniciar' : 'Reiniciar o Piece Helper', fase === 'pronto' ? `O app fecha e abre de novo em uns 2 segundos${falta ? ` · reiniciando em <b>${falta}</b>` : ''}` : '', st('pronto'))}
        </ol>`;
      acoes = fase === 'pronto'
        ? `<button class="btn ghost" data-a="depois">Depois</button><button class="btn primary" data-a="reiniciar">${ICO.restart}Reiniciar agora</button>`
        : '<span class="fine">Pode continuar usando o app enquanto baixa.</span>';
    }
    box.innerHTML = `<div class="upd-head"><div class="upd-ico big">${fase === 'pronto' ? ICO.ok : ICO.up}</div>
        <div><h3>${fase === 'pronto' ? 'Atualização pronta' : 'Atualizar o Piece Helper'}</h3>
        <div class="upd-vers"><span>${esc(cur || '…')}</span><svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg><span class="new">${esc(U.version)}</span></div></div></div>
      ${corpo}<div class="modal-actions">${acoes}</div>`;
    box.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => acao(b.dataset.a)));
  }

  async function iniciar() {
    if (!U.auto) { P.update.page(); fechar(); return; }
    if (fase === 'pronto') { contagem(); return; }
    fase = 'baixando'; pct = 0; desenhar();
    const r = await P.update.download();
    if (!r.ok) { fase = 'erro'; erro = r.error; desenhar(); return; }
    fase = 'pronto'; desenhar(); contagem();
  }
  function contagem() {
    clearInterval(timer); falta = 5; desenhar();
    timer = setInterval(() => { falta -= 1; if (falta <= 0) { clearInterval(timer); timer = null; reiniciar(); } else desenhar(); }, 1000);
  }
  async function reiniciar() {
    clearInterval(timer); timer = null;
    const box = document.querySelector('#wmodalBox .upd-flow');
    if (box) box.innerHTML = `<div class="upd-restart"><i class="upd-spin big"></i><h3>Reiniciando…</h3><p>O Piece Helper volta já na versão ${esc(U.version)}.</p></div>`;
    const r = await P.update.install();
    if (!r.ok) { fase = 'erro'; erro = r.error; desenhar(); }
  }
  function acao(a) {
    if (a === 'go') return iniciar();
    if (a === 'reiniciar') return reiniciar();
    if (a === 'site') { P.update.page(); return; }
    if (a === 'depois') { clearInterval(timer); timer = null; falta = 0; fechar(); if (typeof toast === 'function') toast('Tudo bem: a versão nova abre sozinha da próxima vez que você abrir o Piece Helper.'); return; }
    if (a === 'fechar') fechar();
  }

  /* ---------- eventos ---------- */
  P.on('update:available', (u) => { U = u; if (u.ready) fase = 'pronto'; else if (fase !== 'baixando' && fase !== 'conferindo') fase = 'novo'; escondido = ''; card(); });
  P.on('update:progress', (p) => {
    if (!p) return;
    if (p.step === 'download') { pct = p.pct; fase = 'baixando'; const i = document.querySelector('#wmodalBox .upd-bar i'), e = document.querySelector('#wmodalBox .upd-step em'); if (i) i.style.width = pct + '%'; if (e) e.textContent = pct + '%'; if (!i) desenhar(); }
    if (p.step === 'verify') { fase = 'conferindo'; desenhar(); }
  });
  P.on('update:done', (d) => {
    const el = document.createElement('div');
    el.className = 'upd-card done';
    el.innerHTML = `<div class="upd-ico">${ICO.ok}</div><div class="upd-main"><b>Atualizado para a versão ${esc(d.version)}</b><p>Tudo certo, já está usando a versão nova.</p></div><button class="upd-x" title="Fechar">${ICO.x}</button>`;
    document.body.appendChild(el);
    const tirar = () => { el.style.transition = 'opacity .3s, transform .3s'; el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; setTimeout(() => el.remove(), 300); };
    el.querySelector('.upd-x').onclick = tirar;
    setTimeout(tirar, 7000);
  });

  /* ---------- Configurações: versão atual + "Procurar agora" ---------- */
  async function painel() {
    const btn = document.getElementById('updCheck');
    const linha = document.getElementById('updLine');
    const st = await P.update.state();
    if (st.ok) { cur = st.data.current; if (st.data.update) { U = st.data.update; if (U.ready) fase = 'pronto'; card(); } }
    if (!btn || !linha) return;
    linha.textContent = `Você está na versão ${cur}.`;
    btn.onclick = async () => {
      btn.disabled = true; linha.textContent = 'Procurando…';
      const r = await P.update.check();
      btn.disabled = false;
      if (!r.ok) { linha.textContent = `Não consegui verificar agora (${r.error}).`; return; }
      if (r.data.update) { linha.textContent = `Versão ${r.data.update.version} disponível.`; U = r.data.update; escondido = ''; if (fase !== 'baixando' && fase !== 'conferindo') fase = U.ready ? 'pronto' : 'novo'; abrir(false); }
      else linha.textContent = `Você está na versão mais nova (${r.data.current}).`;
    };
  }
  painel();
})();

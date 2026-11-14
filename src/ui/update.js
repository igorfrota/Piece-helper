/* Atualização automática: aviso de versão nova, download com barra e "Reabrir agora". */
(function () {
  'use strict';
  const P = window.piece;
  if (!P || !P.update) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const md = (t) => esc(t).split(/\r?\n/).map((l) => {
    l = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    if (/^#{1,6}\s/.test(l)) return `<h4>${l.replace(/^#+\s*/, '')}</h4>`;
    if (/^\s*[-*]\s/.test(l)) return `<li>${l.replace(/^\s*[-*]\s/, '')}</li>`;
    return l.trim() ? `<p>${l}</p>` : '';
  }).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
  const ICO = {
    up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };
  let U = null, fase = 'novo', pct = 0, erro = '', escondido = '';

  function card() {
    let el = document.getElementById('updCard');
    if (!U || escondido === U.version) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.id = 'updCard'; el.className = 'upd-card'; document.body.appendChild(el); }
    const corpo = {
      novo: `<p>Uma versão nova do Piece Helper está pronta.${U.auto ? ' Atualiza em segundos, sem baixar nada manualmente.' : ''}</p>
        <div class="upd-acts"><button class="btn small ghost" data-u="ver">Ver novidades</button><button class="btn small primary" data-u="go">${ICO.up}Atualizar</button></div>`,
      baixando: `<p>Baixando a atualização…</p><div class="upd-bar"><i style="width:${pct}%"></i></div>`,
      pronto: `<p>Atualização baixada. O Piece Helper fecha e abre de novo já na versão nova.</p>
        <div class="upd-acts"><button class="btn small ghost" data-u="depois">Depois</button><button class="btn small primary" data-u="reabrir">Reabrir agora</button></div>`,
      erro: `<p class="upd-err">${esc(erro)}</p><div class="upd-acts"><button class="btn small ghost" data-u="pagina">Baixar pelo site</button><button class="btn small primary" data-u="go">Tentar de novo</button></div>`,
    }[fase];
    el.innerHTML = `<div class="upd-ico">${ICO.up}</div><div class="upd-main"><b>Piece Helper ${esc(U.version)}</b>${corpo}</div>
      ${fase === 'baixando' ? '' : `<button class="upd-x" data-u="fechar" title="Lembrar depois">${ICO.x}</button>`}`;
    el.querySelectorAll('[data-u]').forEach((b) => (b.onclick = () => acao(b.dataset.u)));
  }

  function novidades() {
    const bg = document.getElementById('wmodal'), box = document.getElementById('wmodalBox');
    box.innerHTML = `<h3>Novidades da versão ${esc(U.version)}</h3><div class="upd-notes">${md(U.notes) || '<p>Melhorias e correções.</p>'}</div>
      <div class="modal-actions"><button class="btn ghost" data-close>Fechar</button><button class="btn primary" data-go>${ICO.up}Atualizar agora</button></div>`;
    bg.hidden = false;
    const close = () => { bg.hidden = true; box.innerHTML = ''; };
    bg.onclick = (e) => { if (e.target === bg) close(); };
    box.querySelector('[data-close]').onclick = close;
    box.querySelector('[data-go]').onclick = () => { close(); acao('go'); };
  }

  async function acao(a) {
    if (a === 'ver') return novidades();
    if (a === 'fechar' || a === 'depois') { escondido = U.version; return card(); }
    if (a === 'pagina') return P.update.page();
    if (a === 'reabrir') { const r = await P.update.install(); if (!r.ok) { fase = 'erro'; erro = r.error; card(); } return; }
    if (a === 'go') {
      if (!U.auto) { P.update.page(); return; }
      fase = 'baixando'; pct = 0; card();
      const r = await P.update.download();
      if (r.ok) { fase = 'pronto'; } else { fase = 'erro'; erro = r.error; }
      card();
    }
  }

  P.on('update:available', (u) => { U = u; if (fase !== 'baixando' && fase !== 'pronto') fase = 'novo'; escondido = ''; card(); });
  P.on('update:progress', (n) => { pct = n; const i = document.querySelector('#updCard .upd-bar i'); if (i) i.style.width = n + '%'; });
  P.on('update:done', (d) => { if (typeof toast === 'function') toast(`Piece Helper atualizado para a versão ${d.version}.`); });

  // Configurações: versão atual + "Procurar agora"
  async function painel() {
    const btn = document.getElementById('updCheck');
    const linha = document.getElementById('updLine');
    if (!btn || !linha) return;
    const st = await P.update.state();
    const v = st.ok ? st.data.current : '';
    linha.textContent = `Você está na versão ${v}.`;
    btn.onclick = async () => {
      btn.disabled = true; linha.textContent = 'Procurando…';
      const r = await P.update.check();
      btn.disabled = false;
      if (!r.ok) { linha.textContent = `Não consegui verificar agora (${r.error}).`; return; }
      if (r.data.update) { linha.textContent = `Versão ${r.data.update.version} disponível.`; U = r.data.update; escondido = ''; if (fase !== 'baixando' && fase !== 'pronto') fase = 'novo'; card(); }
      else linha.textContent = `Você está na versão mais nova (${r.data.current}).`;
    };
  }
  painel();
  P.update.state().then((r) => { if (r.ok && r.data.update) { U = r.data.update; if (r.data.ready) fase = 'pronto'; card(); } });
})();

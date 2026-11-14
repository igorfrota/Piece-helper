/* Piece Helper — máquina virtual (Hyper-V + placa de vídeo). Usa $, esc, toast e call de app.js. */
const VMUI = (() => {
  const V = window.piece.vm;
  const GB = 1073741824;
  const gb = (n, d = 0) => (n == null ? '—' : `${(n / GB).toFixed(d).replace('.', ',')} GB`);
  const SVG = {
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg>',
    warn: '<svg viewBox="0 0 24 24"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    bolt: '<svg viewBox="0 0 24 24"><path d="M13 2L4 14h7l-1 8 9-12h-7z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-2.6-6.4L21 8"/><path d="M21 3v5h-5"/></svg>',
    screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    wrench: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h6"/></svg>',
    cpu: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M10 10h4v4h-4zM9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
    ram: '<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="10" rx="2"/><path d="M6 11v2M10 11v2M14 11v2M18 11v2"/></svg>',
    gpu: '<svg viewBox="0 0 24 24"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="9" cy="12" r="3"/><path d="M15 10h4M15 14h4"/></svg>',
    dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>',
    box: '<svg viewBox="0 0 24 24"><path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    ext: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v6H4V6h6"/></svg>',
    resize: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 15v5h-5M4 4l6 6M20 20l-6-6"/></svg>',
  };
  const callout = (kind, title, text) => `<div class="callout ${kind}">${SVG[kind === 'crit' ? 'warn' : kind] || SVG.info}<div><b>${esc(title)}</b>${text ? `<p>${text}</p>` : ''}</div></div>`;
  const S = { data: null, sel: null, busy: false, doc: null, docBusy: false, docStale: true };

  /* ---------- janela grande e confirmação ---------- */
  function wmodal(html) {
    const bg = $('#wmodal'), box = $('#wmodalBox');
    box.innerHTML = html;
    bg.hidden = false;
    const close = () => { bg.hidden = true; box.innerHTML = ''; };
    bg.onclick = (e) => { if (e.target === bg) close(); };
    box.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
    return { el: box, close };
  }
  const ask = (title, html, ok = 'Continuar') => confirmModal(title, html, ok);

  /* ---------- tarefas com saída ao vivo ----------
     Cada tarefa é acompanhada em segundo plano (mesmo com a janela de detalhes fechada): o progresso aparece
     num painel fixo no topo da tela e no menu, e "Ver detalhes" reabre a janela com tudo o que já aconteceu. */
  const J = {};          // id -> { id, title, lines, done, ok, progress, started }
  let viewing = null;    // id da tarefa aberta na janela de detalhes

  function lastStep(j) {
    for (let i = j.lines.length - 1; i >= 0; i--) { const t = (j.lines[i].t || '').trim(); if (t) return t; }
    return 'Começando…';
  }
  function elapsed(j) {
    const s = Math.floor(((j.ended || Date.now()) - j.started) / 1000);
    return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  }

  function paintJobs() {
    // painel fixo na tela da máquina virtual
    let box = document.getElementById('vmJobs');
    if (!box) { box = document.createElement('div'); box.id = 'vmJobs'; $('#vmBody').before(box); }
    const list = Object.values(J).filter((j) => !j.done || Date.now() - j.ended < 10 * 60000).sort((a, b) => b.started - a.started);
    box.innerHTML = list.map((j) => {
      const pct = j.progress != null ? Math.round(j.progress * 100) : null;
      const st = j.done ? (j.ok ? '<span class="state-tag on">Concluído</span>' : '<span class="state-tag bad">Com problema</span>') : `<div class="spin"></div><span class="state-tag run">${pct != null ? pct + '%' : 'Rodando'}</span>`;
      return `<div class="jobcard ${j.done ? (j.ok ? 'ok' : 'bad') : ''}">
        <div class="jc-top">${st}<b>${esc(j.title)}</b><span class="jc-time">${elapsed(j)}</span><span class="spacer"></span>
          <button class="btn small ${j.done ? 'ghost' : 'primary'}" data-job="${j.id}">Ver detalhes</button>
          ${j.done ? `<button class="btn small ghost icon" data-jobx="${j.id}" title="Dispensar">✕</button>` : ''}</div>
        <div class="bar ${!j.done && pct == null ? 'indet' : ''}"><i style="width:${j.done ? 100 : pct || 0}%"></i></div>
        <div class="jc-step">${j.steps && j.step >= 0 && j.step < j.steps.length ? `<b>Etapa ${j.step + 1} de ${j.steps.length}:</b> ${esc(j.steps[j.step])} · ` : ''}${esc(lastStep(j))}</div></div>`;
    }).join('');
    box.querySelectorAll('[data-job]').forEach((b) => (b.onclick = () => openJob(b.dataset.job)));
    box.querySelectorAll('[data-jobx]').forEach((b) => (b.onclick = () => { J[b.dataset.jobx].ended = 0; paintJobs(); }));
    // indicador no menu
    const run = list.filter((j) => !j.done);
    let tag = document.getElementById('vmNavJob');
    if (!tag) { tag = document.createElement('span'); tag.id = 'vmNavJob'; tag.className = 'ni-count'; $('#navVm').appendChild(tag); }
    tag.hidden = !run.length;
    if (run.length) { const p = run[0].progress; tag.textContent = p != null ? `${Math.round(p * 100)}%` : '…'; }
    // janela de detalhes aberta
    if (viewing && J[viewing]) paintDetail(J[viewing]);
  }

  function paintDetail(j) {
    const el = $('#wmodalBox');
    const body = el.querySelector('#jBody');
    if (!body) return;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    while (body.childElementCount > j.lines.length) body.lastChild.remove();
    for (let i = 0; i < j.lines.length; i++) {
      const l = j.lines[i];
      let d = body.children[i];
      if (!d) { d = document.createElement('div'); body.appendChild(d); }
      if (d.textContent !== l.t) d.textContent = l.t;
      d.className = l.k || '';
    }
    if (atBottom) body.scrollTop = body.scrollHeight;
    const bar = el.querySelector('#jBar');
    if (j.progress != null || j.done) { bar.classList.remove('indet'); bar.firstChild.style.width = `${j.done ? 100 : j.progress * 100}%`; }
    el.querySelector('#jTime').textContent = elapsed(j);
    const sl = el.querySelector('#jSteps');
    if (sl && j.steps) {
      sl.hidden = false;
      sl.innerHTML = j.steps.map((t, i) => {
        const st = i < j.step || (j.done && j.ok) ? 'done' : i === j.step ? (j.done ? 'bad' : 'run') : '';
        return `<li class="${st}"><i>${st === 'done' ? SVG.ok : st === 'bad' ? SVG.x : st === 'run' ? '<span class="spin"></span>' : i + 1}</i>${esc(t)}</li>`;
      }).join('');
    }
    if (j.done) {
      el.querySelector('#jSpin')?.remove(); el.querySelector('#jCancel')?.remove();
      el.querySelector('#jStatus').innerHTML = j.ok ? '<b style="color:var(--em2)">Concluído.</b>'
        : `<b style="color:var(--danger)">Terminou com problema${j.steps && j.step < j.steps.length ? ` na etapa ${j.step + 1} (${esc(j.steps[j.step])})` : ''}. Veja as mensagens abaixo.</b>`;
      const acts = el.querySelector('#jActs');
      if (acts && !acts.dataset.done) {
        acts.dataset.done = '1';
        const x = j.extra || {};
        let h = '';
        if (!j.ok && x.retry) h += '<button class="btn primary" id="jRetry">' + SVG.refresh + 'Tentar de novo</button>';
        if (!j.ok) h += '<button class="btn ghost" id="jReport">' + SVG.doc + 'Gerar relatório para o suporte</button>';
        if (x.zip) h += '<button class="btn primary" id="jZip">Mostrar o arquivo</button><button class="btn ghost" id="jCopy">Copiar o resumo</button>';
        acts.insertAdjacentHTML('afterbegin', h);
        const b = (id, fn) => { const e = acts.querySelector(id); if (e) e.onclick = fn; };
        b('#jRetry', () => { viewing = null; $('#wmodal').hidden = true; run(V.create(x.retry.opts), j.title, null, x.retry); });
        b('#jReport', () => { viewing = null; $('#wmodal').hidden = true; makeReport(); });
        b('#jZip', () => window.piece.showItem(x.zip));
        b('#jCopy', async () => { try { await navigator.clipboard.writeText(x.summary || ''); toast('Resumo copiado. Cole no Discord junto com o arquivo.'); } catch { toast('Não consegui copiar.', 'err'); } });
      }
    }
  }

  function openJob(id) {
    const j = J[id];
    if (!j) return;
    const m = wmodal(`<div class="vm-name"><h3 style="margin:0;flex:1">${esc(j.title)}</h3><span class="jc-time" id="jTime"></span>${j.done ? '' : '<div class="spin" id="jSpin"></div>'}</div>
      <p class="fine" id="jStatus" style="margin-top:8px">Rodando… pode fechar esta janela: o progresso continua aparecendo no topo da tela de Máquina virtual e no menu.</p>
      <ol class="jsteps" id="jSteps" hidden></ol>
      <div class="console"><div class="bar indet" id="jBar"><i></i></div><div class="console-body" id="jBody"></div></div>
      <div class="modal-actions" id="jActs" style="margin-top:14px">${j.done ? '' : '<button class="btn ghost" id="jCancel">Cancelar tarefa</button>'}<button class="btn ${j.done ? 'ghost' : 'primary'}" data-close>Fechar</button></div>`);
    viewing = id;
    const close = m.close;
    m.el.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => { viewing = null; close(); }));
    $('#wmodal').onclick = (e) => { if (e.target.id === 'wmodal') { viewing = null; close(); } };
    const c = m.el.querySelector('#jCancel');
    if (c) c.onclick = async () => { if (await ask('Cancelar a tarefa?', '<p>O que já foi feito até agora pode ficar pela metade. Se for a criação de uma VM, o disco incompleto é apagado.</p>', 'Cancelar tarefa')) { await window.piece.job.cancel(id); toast('Pedido de cancelamento enviado.', 'warn'); openJob(id); } };
    paintDetail(j);
    const body = m.el.querySelector('#jBody'); body.scrollTop = body.scrollHeight;
  }

  async function track(id, title) {
    const j = J[id] = { id, title, lines: [], done: false, ok: null, progress: null, started: Date.now(), ended: null };
    paintJobs();
    let since = 0;
    for (;;) {
      const from = Math.max(0, since - 1); // a última linha pode ter sido reescrita (download)
      const r = await window.piece.job.poll(id, from);
      if (!r.ok) break;
      const snap = r.data;
      j.lines.length = Math.min(j.lines.length, from);
      j.lines.push(...snap.lines);
      since = snap.total;
      j.progress = snap.progress;
      j.steps = snap.steps; j.step = snap.step; j.extra = snap.extra;
      if (snap.done) { j.done = true; j.ok = snap.ok; j.ended = Date.now(); }
      paintJobs();
      if (snap.done) break;
      await new Promise((ok) => setTimeout(ok, 700));
    }
    if (!j.done) { j.done = true; j.ok = false; j.ended = Date.now(); paintJobs(); }
    if (j.extra && j.extra.rebooting) toast('O PC vai reiniciar em alguns segundos. O Piece Helper abre sozinho quando o Windows voltar.', 'warn', 15000);
    else if (j.ok) toast(`${title}: concluído.`); else toast(`${title}: terminou com problema. Veja em "Ver detalhes".`, 'err', 8000);
    S.docStale = true;
    await load(false);
    return j;
  }
  // relógio do painel enquanto tem tarefa rodando
  setInterval(() => { if (Object.values(J).some((j) => !j.done)) paintJobs(); }, 1000);

  async function follow(jobId, title) {
    const p = track(jobId, title);
    openJob(jobId);
    return p;
  }
  async function run(promise, title, after, retry) {
    try {
      const id = await call(promise);
      const j = await follow(id, title);
      if (j && j.ok && after) after();
    } catch (e) { toast(e.message, 'err', 6000); }
  }

  /* ---------- carregar e desenhar ---------- */
  async function load(spin) {
    const body = $('#vmBody');
    if (spin || !body.childElementCount) body.innerHTML = '<div class="loading"><div class="spin"></div>Procurando o Hyper-V e as máquinas virtuais…</div>';
    try { S.data = await call(V.status()); } catch (e) { body.innerHTML = callout('crit', 'Não consegui ler as máquinas virtuais', esc(e.message)); return; }
    const html = render(S.data);
    body.innerHTML = html.includes('id="vmDoctor"') ? html : '<div id="vmDoctor"></div>' + html;
    bind(S.data);
    paintJobs();
    paintDoctor();
    if (S.docStale && !Object.values(J).some((j) => !j.done)) diagnose();
  }

  /* ---------- Verificar e corrigir ---------- */
  async function diagnose() {
    if (S.docBusy) return;
    S.docBusy = true; S.docStale = false; paintDoctor();
    try { S.doc = await call(V.diagnose()); } catch (e) { S.doc = { error: e.message, checks: [] }; }
    S.docBusy = false; paintDoctor();
    const bad = (S.doc.checks || []).filter((c) => c.level !== 'ok');
    $('#vmDot').hidden = !bad.length;
  }
  const levelIcon = (l) => `<i class="doc-ico ${l}">${l === 'ok' ? SVG.ok : l === 'fail' ? SVG.x : SVG.warn}</i>`;
  function paintDoctor() {
    const box = document.getElementById('vmDoctor');
    if (!box) return;
    const d = S.doc;
    if (!d || (S.docBusy && !d.checks.length)) {
      box.innerHTML = `<div class="doc slim"><div class="spin"></div><b>Conferindo o PC e as VMs…</b><small>Hyper-V, placa de vídeo, drivers, espaço e internet.</small></div>`;
      return;
    }
    if (d.error) { box.innerHTML = callout('warn', 'Não consegui examinar o PC', esc(d.error)); return; }
    const bad = d.checks.filter((c) => c.level !== 'ok').sort((a, b) => (a.level === 'fail' ? 0 : 1) - (b.level === 'fail' ? 0 : 1));
    const good = d.checks.filter((c) => c.level === 'ok');
    const fixable = bad.filter((c) => c.fix && (c.fix.kind === 'job' || c.fix.kind === 'elevate') && !c.manual);
    const when = S.docBusy ? 'conferindo de novo…' : `conferido às ${new Date(d.at || Date.now()).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const again = `<button class="btn small ghost icon" id="docAgain" title="Conferir de novo" ${S.docBusy ? 'disabled' : ''}>${S.docBusy ? '<span class="spin" style="width:14px;height:14px"></span>' : SVG.refresh}</button>`;
    const goodList = `<details class="doc-good"><summary>${good.length} ${good.length === 1 ? 'item em ordem' : 'itens em ordem'}</summary><ul class="doc-list">${good.map((c) => `<li class="doc-item ok">${levelIcon('ok')}<div class="doc-txt"><b>${esc(c.title)}</b></div></li>`).join('')}</ul></details>`;
    if (!bad.length) {
      box.innerHTML = `<div class="doc slim all-ok">${levelIcon('ok')}<b>Tudo certo com o PC e as VMs</b><small>${when}</small><span class="spacer"></span>${again}</div>
        <div class="doc-okwrap">${goodList}</div>`;
    } else {
      const worst = bad.some((c) => c.level === 'fail') ? 'fail' : 'warn';
      const items = bad.map((c, i) => `<li class="doc-item ${c.level}">${levelIcon(c.level)}<div class="doc-txt"><b>${esc(c.title)}</b>${c.text ? `<p>${c.text}</p>` : ''}</div>
        ${c.fix ? `<button class="btn small" data-fix="${i}">${esc(c.fix.label)}</button>` : ''}</li>`).join('');
      box.innerHTML = `<div class="panel doc has-${worst}">
        <div class="doc-head">${levelIcon(worst)}<div><b>${bad.length === 1 ? '1 coisa para resolver' : `${bad.length} coisas para resolver`}</b><small>${when}</small></div>
          <span class="spacer"></span>${again}
          ${fixable.length > 1 ? `<button class="btn small primary" id="docAll">${SVG.wrench}Resolver tudo</button>` : ''}</div>
        <ul class="doc-list">${items}</ul>${goodList}</div>`;
    }
    box.querySelector('#docAgain').onclick = () => { S.docStale = true; load(false); };
    box.querySelectorAll('[data-fix]').forEach((b) => (b.onclick = () => doFix(bad[+b.dataset.fix])));
    const all = box.querySelector('#docAll');
    if (all) all.onclick = () => doFixAll(fixable);
  }

  // texto da confirmação de cada correção (o que vai acontecer)
  function fixWarning(c) {
    const a = c.fix.action;
    if (a === 'bios') return `<p>O PC vai reiniciar direto na BIOS. Salve o que estiver aberto.</p>${c.bios ? `<ol class="steps"><li>Na BIOS: ${c.bios.where}.</li><li>Deixe ${c.bios.opt} em <b>Enabled</b>.</li><li>Aperte <b>F10</b> e confirme para salvar e reiniciar.</li></ol>` : ''}<p>Tire uma foto destas instruções com o celular. Quando o Windows voltar, o Piece Helper abre sozinho e confere.</p>`;
    if (c.fix.reboot) return '<p>O PC vai reiniciar em 20 segundos: salve o que estiver aberto. Quando o Windows voltar, o Piece Helper abre sozinho e continua.</p>';
    if (a === 'driver') return '<p>O Piece Helper baixa o driver oficial e instala sozinho. A tela pode piscar ou ficar preta por alguns segundos durante a instalação. As VMs que usam a placa são desligadas no fim para receber o driver novo: salve o que estiver aberto nelas.</p>';
    if (a === 'cleanup') return '<p>Vai apagar: arquivos temporários do Windows, cache de atualizações já instaladas, downloads incompletos do Piece Helper e <b>esvaziar a Lixeira</b>. Seus documentos, jogos e programas não são tocados. Pode levar até 15 minutos.</p>';
    if (/^vm(Drivers|Repair|Game|Ram|Checkpoint)$/.test(a)) return `<p>A VM <b>${esc(c.vm || c.fix.arg)}</b> vai ser desligada (salve o que estiver aberto nela) e ligada de novo no fim.</p>`;
    return '';
  }
  async function doFix(c) {
    const f = c.fix;
    if (f.kind === 'elevate') { try { await call(window.piece.elevate()); } catch (e) { toast(e.message, 'err'); } return; }
    if (f.kind === 'open') { try { await call(window.piece.openUrl(f.url)); } catch (e) { toast(e.message, 'err'); } return; }
    const w = fixWarning(c);
    if (w && !(await ask(f.label + '?', w, f.label))) return;
    run(V.fix(f.action, f.arg), f.label);
  }
  async function doFixAll(list) {
    if (list.some((c) => c.fix.kind === 'elevate')) { toast('Primeiro o Piece Helper precisa abrir como administrador. Depois clique em "Resolver tudo" de novo.', 'warn', 7000); try { await call(window.piece.elevate()); } catch (e) { toast(e.message, 'err'); } return; }
    const reb = list.some((c) => c.fix.reboot);
    const html = `<p>O Piece Helper vai resolver, nesta ordem:</p><ul class="steps">${list.map((c) => `<li>${esc(c.fix.label)} <span style="color:var(--dim)">— ${esc(c.title)}</span></li>`).join('')}</ul>
      ${list.some((c) => c.fix.action === 'cleanup') ? '<p>A limpeza esvazia a Lixeira.</p>' : ''}${list.some((c) => /^vm|driver/.test(c.fix.action)) ? '<p>As VMs envolvidas são desligadas durante as correções: salve o que estiver aberto nelas.</p>' : ''}
      ${reb ? '<p><b>No fim o PC reinicia</b> e o Piece Helper abre sozinho para conferir. Salve o que estiver aberto.</p>' : ''}`;
    if (!(await ask('Resolver tudo?', html, 'Resolver tudo'))) return;
    run(V.fixAll(list.map((c) => ({ action: c.fix.action, arg: c.fix.arg }))), 'Resolver tudo');
  }
  function makeReport() { run(V.report(), 'Relatório para o suporte'); }
  function current(r) { return r.vms.find((x) => x.name === S.sel) || r.vms.find((x) => x.gpu) || r.vms[0]; }

  function render(r) {
    let h = '';
    if (!r.admin) {
      h += `<div class="callout warn">${SVG.warn}<div><b>Abra o Piece Helper como administrador</b><p>O Windows só deixa mexer em máquinas virtuais com permissão de administrador. A troca de contas continua funcionando igual.</p>
        <div class="vm-row" style="margin-top:10px"><button class="btn primary small" id="vmElevate">Abrir como administrador</button></div></div></div>`;
      if (r.hyperv !== 'on' || !r.vms.length) return h; // sem administrador o Windows nem diz se o Hyper-V está ligado
      h += '<div style="height:14px"></div>';
    }
    if (r.hyperv === 'unsupported') {
      return h + callout('warn', 'Este Windows não tem máquinas virtuais (Hyper-V)', `O Hyper-V só existe no Windows Pro, Education e Enterprise. No Windows Home não dá para criar máquinas virtuais com placa de vídeo. Dá para passar para o Pro em Configurações &gt; Sistema &gt; Ativação.${r.edition ? `<br>Seu Windows: <b>${esc(r.edition)}</b>` : ''}`);
    }
    if (r.hyperv === 'reboot') {
      return h + callout('warn', 'Falta reiniciar o PC', 'O Hyper-V já foi ativado. Reinicie o PC para terminar e depois volte aqui.') +
        '<div class="vm-row"><button class="btn primary" id="vmReboot">Reiniciar o PC</button></div>';
    }
    if (r.hyperv === 'off') {
      return h + `<div class="panel"><h2>O Hyper-V está desligado</h2><p class="fine" style="margin:0">O Hyper-V é o recurso de máquinas virtuais que já vem no seu Windows; ele só está desligado. Ativar leva alguns minutos e pede para reiniciar o PC.</p>
        ${!r.vtx && !r.hypervisor ? `<div style="margin-top:12px">${callout('warn', 'A virtualização parece desligada na BIOS', 'Procure por <b>SVM Mode</b> (AMD) ou <b>Intel Virtualization Technology / VT-x</b> na BIOS e deixe em Enabled.')}</div>` : ''}
        <div class="vm-row"><button class="btn primary" id="vmHv">Ativar o Hyper-V</button></div></div>`;
    }
    const share = r.gpus.filter((g) => g.shareable);
    const pcLine = [r.edition, r.threads ? `${r.threads} núcleos` : '', r.ram ? gb(r.ram) : '', share.map((g) => g.name).join(' + ')].filter(Boolean).map(esc).join(' · ');
    const tips = `<details class="vm-tips"><summary>${SVG.info}Bom saber</summary><ul class="steps">
      <li>Quando o driver da placa muda no PC, o Piece Helper atualiza a VM sozinho ao abrir (se ela estiver desligada) ou avisa aqui com o botão que resolve.</li>
      <li>Deu problema? Use <b>Consertar a VM</b> no menu ⋯ (não apaga nada). Se não resolver, <b>Refazer a VM do zero</b> cria de novo com as mesmas configurações.</li>
      <li>O ideal é o mesmo Windows no PC e na VM (10 com 10, 11 com 11).</li>
      <li>Com a placa na VM, não dá para criar pontos de verificação dela. Para um backup: tire a placa, crie o ponto e coloque a placa de novo.</li>
      <li>A placa é compartilhada: o PC continua usando ela normalmente. Nada é gravado na placa e dá para desfazer tudo.</li>
      <li>Alguns jogos com anti-cheat não abrem dentro de máquinas virtuais. O Piece Helper não tenta esconder a VM.</li></ul></details>`;
    if (r.vmerror && r.vmerror !== 'admin') h += callout('warn', 'O Hyper-V respondeu com erro', esc(r.vmerror)) + '<div style="height:14px"></div>';
    if (!r.vms.length) {
      return h + `<div class="vm-empty"><div class="ve-ico">${SVG.screen}</div><h2>Nenhuma máquina virtual ainda</h2>
        <p>O Piece Helper cria uma com um clique: baixa o Windows da Microsoft, instala sozinho (sem senha e sem conta da Microsoft), deixa o Windows leve, coloca a placa de vídeo e, se quiser, a Steam com o Grand Chase já copiado.</p>
        <button class="btn primary" id="vmNew">${SVG.plus}Criar uma VM</button>
        <button class="linkbtn" id="vmMgr">ou fazer pelo Gerenciador do Hyper-V</button>
        <div class="ve-pc">Este PC: ${pcLine}</div></div><div id="vmDoctor"></div>${tips}`;
    }
    const v = current(r); S.sel = v.name;
    const running = v.state === 'Running';
    const hostDrv = (r.gpus.find((g) => g.id === v.gpu_id) || {}).driver;
    const drvChip = !v.gpu ? '' : v.drivers === 'ok' ? `<span class="vchip ok" title="Drivers da placa iguais aos do PC (${esc(v.driver_copied || hostDrv || '')})">${SVG.ok}Drivers em dia</span>`
      : v.drivers === 'outdated' ? `<span class="vchip warn" title="VM ${esc(v.driver_copied)} · PC ${esc(hostDrv)}">${SVG.warn}Drivers desatualizados</span>`
        : `<span class="vchip" title="A placa foi colocada fora do Piece Helper. Use 'Atualizar drivers da VM' uma vez.">Drivers: ?</span>`;
    const tabs = r.vms.length > 1 ? `<div class="vm-tabs" role="tablist">${r.vms.map((x) => `<button role="tab" data-vmsel="${esc(x.name)}" aria-selected="${x.name === v.name}"><i class="${x.state === 'Running' ? 'on' : ''}"></i>${esc(x.name)}</button>`).join('')}</div>` : '';
    let extra = '';
    if (!v.gpu) {
      extra = !share.length ? callout('warn', 'Nenhuma placa deste PC pode ser compartilhada', 'O Windows não liberou nenhuma placa para máquinas virtuais. Atualize o driver da placa pelo site do fabricante e tente de novo.')
        : `<div class="vh-gpu"><div><b>Esta VM está sem placa de vídeo</b><small>Com a placa, os jogos dentro da VM rodam de verdade. Leva de 1 a 5 minutos.</small></div><span class="spacer"></span>
            ${share.length > 1 ? `<div class="field" style="margin:0"><select id="vmGpu">${share.map((g) => `<option value="${esc(g.id)}" ${g.id === r.default_gpu ? 'selected' : ''}>${esc(g.name)}${g.integrated ? ' (vídeo integrado)' : ''}</option>`).join('')}</select></div>` : `<input type="hidden" id="vmGpu" value="${esc(share[0].id)}">`}
            <button class="btn primary small" id="vmGpuGo">${SVG.bolt}Colocar a placa</button></div>`;
    }
    if (v.guest_build && r.build && ((+r.build >= 22000) !== (+v.guest_build >= 22000))) {
      extra += `<p class="vh-note">${SVG.info}Seu PC está no Windows ${+r.build >= 22000 ? '11' : '10'} e a VM no Windows ${+v.guest_build >= 22000 ? '11' : '10'}. Costuma funcionar; se a VM ficar instável, use o mesmo Windows nos dois.</p>`;
    }
    const hero = `<div class="vm-hero ${running ? 'is-on' : ''}">
      <div class="vh-top">
        <div class="vh-ico">${SVG.screen}<i></i></div>
        <div class="vh-main">
          <div class="vh-title"><h2>${esc(v.name)}</h2><span class="state-tag ${running ? 'on' : ''}">${running ? 'Ligada' : v.state === 'Off' ? 'Desligada' : esc(v.state)}</span></div>
          <div class="vh-specs"><span>${SVG.cpu}${esc(v.cpus)} núcleos</span><span>${SVG.ram}${gb(v.ram)}${v.dyn ? ' dinâmica' : ''}</span><span>${SVG.gpu}${v.gpu ? esc(v.gpu_name || 'Placa de vídeo') : 'Sem placa'}</span>${drvChip}</div>
        </div>
        <div class="vh-acts">
          ${running ? `<button class="btn ghost" id="vmOff">${SVG.stop}Desligar</button><button class="btn primary" id="vmOpen">${SVG.screen}Abrir janela</button>`
    : `<button class="btn primary" id="vmOn">${SVG.play}Ligar e abrir</button>`}
          <button class="btn icon more" id="vmMore" title="Mais opções" aria-haspopup="menu">${SVG.dots}</button>
        </div>
      </div>${extra ? `<div class="vh-extra">${extra}</div>` : ''}</div>`;
    const foot = `<div class="vm-foot"><span class="pc-line"><b>Este PC</b>${pcLine}</span><span class="spacer"></span><button class="btn small ghost" id="vmNew">${SVG.plus}Criar outra VM</button></div>`;
    return h + tabs + hero + '<div id="vmDoctor"></div>' + foot + tips;
  }

  /* ---------- menu ⋯ ---------- */
  function popMenu(anchor, groups) {
    document.getElementById('vmMenu')?.remove();
    const m = document.createElement('div');
    m.id = 'vmMenu'; m.className = 'menu-pop'; m.setAttribute('role', 'menu');
    m.innerHTML = groups.filter((g) => g.items.some(Boolean)).map((g) => `<div class="mg">${g.title ? `<div class="mg-t">${esc(g.title)}</div>` : ''}${g.items.filter(Boolean).map((it, i) =>
      `<button role="menuitem" class="mi ${it.danger ? 'danger' : ''}" data-mi="${esc(g.title || '')}:${i}">${it.icon || ''}<span><b>${esc(it.label)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span></button>`).join('')}</div>`).join('');
    document.body.appendChild(m);
    const flat = {};
    groups.forEach((g) => g.items.filter(Boolean).forEach((it, i) => (flat[`${g.title || ''}:${i}`] = it)));
    const r = anchor.getBoundingClientRect();
    const w = m.offsetWidth, hh = m.offsetHeight;
    m.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
    m.style.top = `${r.bottom + hh + 8 > innerHeight ? Math.max(8, r.top - hh - 6) : r.bottom + 6}px`;
    const close = () => { m.remove(); document.removeEventListener('mousedown', out, true); document.removeEventListener('keydown', key, true); };
    const out = (e) => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) close(); };
    const key = (e) => { if (e.key === 'Escape') close(); };
    setTimeout(() => { document.addEventListener('mousedown', out, true); document.addEventListener('keydown', key, true); });
    m.querySelectorAll('[data-mi]').forEach((b) => (b.onclick = () => { close(); flat[b.dataset.mi].run(); }));
    m.querySelector('.mi')?.focus();
  }

  function tuneModal(v, r) {
    const rec = r.recommend;
    const m = wmodal(`<h3>Processador e memória da VM ${esc(v.name)}</h3>
      <p class="fine" style="margin:-6px 0 16px">Agora: <b>${esc(v.cpus)} núcleos</b> e <b>${gb(v.ram)}</b> de memória ${v.dyn ? 'dinâmica' : 'fixa'}. Recomendado para o seu PC: <b>${rec.cpus} núcleos</b> e <b>${rec.ram_gb} GB</b> fixos (memória fixa evita travadinhas).</p>
      <div class="f2"><div class="field"><label>Núcleos (até ${rec.max_cpus})</label><input type="number" id="tnCpus" min="1" max="${rec.max_cpus}" value="${rec.cpus}"></div>
        <div class="field"><label>Memória em GB (até ${rec.max_ram_gb})</label><input type="number" id="tnRam" min="2" max="${rec.max_ram_gb}" value="${rec.ram_gb}"></div></div>
      ${v.state !== 'Off' ? '<div class="hint">A VM desliga, recebe o ajuste e liga de novo. Salve o que estiver aberto nela.</div>' : ''}
      <div class="modal-actions" style="margin-top:12px">${v.tune_backup ? '<button class="btn ghost" id="tnUndo">Voltar ao que era</button><span class="spacer" style="flex:1"></span>' : ''}<button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="tnGo">Aplicar</button></div>`);
    m.el.querySelector('#tnGo').onclick = () => {
      const c = +m.el.querySelector('#tnCpus').value, g = +m.el.querySelector('#tnRam').value;
      if (!c || !g) return toast('Preencha os dois números.', 'warn');
      m.close(); run(V.tune(v.name, c, g), 'Ajustar a VM');
    };
    const u = m.el.querySelector('#tnUndo');
    if (u) u.onclick = () => { m.close(); run(V.tuneUndo(v.name), 'Voltar a VM ao original'); };
  }

  function bind(r) {
    const on = (id, fn) => { const b = document.getElementById(id); if (b) b.onclick = fn; };
    on('vmElevate', async () => { try { await call(window.piece.elevate()); } catch (e) { toast(e.message, 'err'); } });
    on('vmMgr', () => V.manager());
    on('vmReboot', async () => { if (await ask('Reiniciar o PC?', '<p>O PC reinicia em 10 segundos. Salve o que estiver aberto.</p>', 'Reiniciar')) V.reboot(); });
    on('vmHv', async () => {
      if (await ask('Ativar o Hyper-V?', '<p>Leva alguns minutos e depois você precisa reiniciar o PC. Com o Hyper-V ligado, outros programas de máquina virtual (VMware, VirtualBox) podem ficar mais lentos.</p>', 'Ativar')) run(V.hypervEnable(), 'Ativar o Hyper-V');
    });
    on('vmNew', () => wizard(r));
    const v = r.vms.length ? current(r) : null;
    if (!v) return;
    document.querySelectorAll('[data-vmsel]').forEach((b) => (b.onclick = () => { S.sel = b.dataset.vmsel; load(false); }));
    const A = {
      helper: async () => { if (await ask('Instalar o Piece Helper na VM?', `<p>A VM <b>${esc(v.name)}</b> vai ser desligada (salve o que estiver aberto nela), o Piece Helper deste PC é copiado para dentro dela, com atalho na área de trabalho, e a VM liga de novo. Se já tiver um lá, ele é atualizado para esta versão.</p><p>Dentro da VM, as contas da Steam são as que você logar lá.</p>`, 'Instalar')) run(V.installHelper(v.name), 'Piece Helper na VM'); },
      res: async () => { if (await ask('Resolução da janela da VM', '<p>Feche a janela da VM que estiver aberta (isso não desliga a VM). Na janelinha que vai abrir, arraste o controle até a resolução que quiser (ex.: <b>1280 x 720</b>), marque <b>Salvar minhas configurações</b> e clique em <b>Conectar</b>.</p>', 'Abrir')) V.open(v.name, true); },
      gpuUpd: async () => { if (await ask('Atualizar os drivers da VM?', '<p>A VM vai ser desligada (salve o que estiver aberto nela) e os drivers atuais da placa são copiados de novo para dentro dela.</p>', 'Atualizar')) run(V.gpuUpdate(v.name), 'Atualizar drivers da VM'); },
      gpuRm: async () => { if (await ask('Tirar a placa da VM?', '<p>A VM vai ser desligada e volta a funcionar sem a placa de vídeo, como era antes. Os pontos de verificação voltam a ser como estavam.</p>', 'Tirar a placa')) run(V.gpuRemove(v.name), 'Tirar a placa da VM'); },
      repair: async () => { if (await ask('Consertar a VM?', `<p>Sem apagar nada da VM <b>${esc(v.name)}</b>, o Piece Helper: confere as configurações, liga as ferramentas da VM, coloca a placa de vídeo de novo, copia os drivers atuais, religa a internet, reaplica a correção da Steam (erro LoadLibrary) e atualiza o Piece Helper dentro dela.</p><p>A VM é desligada durante o conserto: salve o que estiver aberto nela.</p>`, 'Consertar')) run(V.repair(v.name), `Consertar a VM ${v.name}`); },
      game: async () => { if (await ask('Atualizar o Grand Chase da VM?', `<p>Copia a versão do Grand Chase deste PC para a VM <b>${esc(v.name)}</b> (só os arquivos que mudaram), sem baixar de novo pela Steam dela. Feche o jogo no PC antes. A VM é desligada durante a cópia.</p>`, 'Atualizar')) run(V.gameSync(v.name), `Atualizar o GC da VM ${v.name}`); },
      recreate: async () => { if (await ask(`Refazer a VM ${esc(v.name)} do zero?`, `<p><b>Apaga a VM ${esc(v.name)} e tudo o que tem dentro dela</b> (o login da Steam e o que você instalou lá) e cria de novo com as mesmas configurações: Windows, processador, memória, placa, Steam e Grand Chase.</p><p>Use quando "Consertar a VM" não resolver. O Windows já baixado é reaproveitado.</p>`, 'Apagar e refazer')) run(V.recreate(v.name), `Refazer a VM ${v.name}`); },
    };
    on('vmOpen', () => V.open(v.name, false));
    on('vmOn', () => run(V.power(v.name, true), 'Ligar a VM', () => V.open(v.name, false)));
    on('vmOff', async () => { if (await ask('Desligar a VM?', '<p>O Windows da VM vai desligar normalmente. Salve o que estiver aberto nela.</p>', 'Desligar')) run(V.power(v.name, false), 'Desligar a VM'); });
    on('vmGpuGo', async () => {
      const id = document.getElementById('vmGpu').value, g = r.gpus.find((x) => x.id === id);
      if (await ask(`Colocar a ${esc(g ? g.name : 'placa')} na VM?`, '<p>A VM vai ser desligada: salve o que estiver aberto nela. Os drivers da placa são copiados para dentro da VM e os pontos de verificação dela são desligados, porque VMs com placa de vídeo não aceitam. Leva de 1 a 5 minutos. Para desfazer, use "Tirar a placa da VM" no menu ⋯.</p>', 'Colocar a placa')) run(V.gpuSetup(v.name, id), 'Placa de vídeo na VM');
    });
    on('vmMore', (e) => popMenu(e.currentTarget, [
      { title: '', items: [
        v.state === 'Running' && { icon: SVG.resize, label: 'Resolução da janela', sub: 'Escolher o tamanho da tela da VM', run: A.res },
        { icon: SVG.sliders, label: 'Processador e memória', sub: `Agora: ${v.cpus} núcleos · ${gb(v.ram)}`, run: () => tuneModal(v, r) },
      ] },
      { title: 'Manutenção', items: [
        { icon: SVG.wrench, label: 'Consertar a VM', sub: 'Confere e arruma tudo, sem apagar nada', run: A.repair },
        { icon: SVG.refresh, label: 'Atualizar o Grand Chase da VM', sub: 'Copia do PC só o que mudou', run: A.game },
        v.gpu && { icon: SVG.gpu, label: 'Atualizar drivers da VM', sub: 'Copia de novo os drivers da placa', run: A.gpuUpd },
        { icon: SVG.box, label: 'Instalar o Piece Helper na VM', sub: 'Para trocar de conta lá dentro', run: A.helper },
      ] },
      { title: 'Mais', items: [
        { icon: SVG.doc, label: 'Gerar relatório para o suporte', sub: 'Um .zip na área de trabalho, sem senhas', run: () => makeReport() },
        { icon: SVG.ext, label: 'Gerenciador do Hyper-V', run: () => V.manager() },
        v.gpu && { icon: SVG.x, label: 'Tirar a placa da VM', run: A.gpuRm },
        { icon: SVG.trash, label: 'Refazer a VM do zero', sub: 'Apaga e cria de novo igual', danger: true, run: A.recreate },
      ] },
    ]));
  }

  /* ---------- criar uma VM do zero ---------- */
  async function wizard(r) {
    if (!r.admin) return toast('Abra o Piece Helper como administrador primeiro.', 'warn');
    let info = { isos: [], games: [], lite: [], lang: '' };
    try { info = await call(V.isoInfo()); } catch { /* segue sem lista */ }
    const rec = r.recommend, share = r.gpus.filter((g) => g.shareable);
    const hostWin = +r.build >= 22000 ? '11' : '10';
    const taken = new Set(r.vms.map((x) => x.name.toLowerCase()));
    let name = 'GC', n = 2;
    while (taken.has(name.toLowerCase())) name = `GC ${n++}`;
    const ram = Math.max(4, rec.ram_gb), cpus = Math.max(2, rec.cpus);
    const st = { win: hostWin, iso: null };
    const gc = info.games.find((g) => g.appid === '985810');
    const m = wmodal(`<h3>Criar uma máquina virtual do zero</h3>
      <p class="fine" style="margin:-6px 0 16px">O Piece Helper baixa o Windows do site da Microsoft, instala sozinho (sem nenhuma tela para clicar), cria a VM com o processador e a memória certos para o seu PC, coloca a placa de vídeo e, se você quiser, a Steam com os seus jogos. Leva de 20 a 60 minutos; a maior parte é o download.</p>
      <div class="f2">
        <div class="field"><label>Nome da VM</label><input id="wzName" maxlength="60" value="${esc(name)}"></div>
        <div class="field"><label>Usuário do Windows</label><input id="wzUser" maxlength="20" value="Jogador"></div>
      </div>
      <div class="hint">O usuário fica sem senha e sem conta da Microsoft: a VM entra direto.</div>
      <div class="field"><label>Qual Windows</label><div class="seg" role="group">
        <button type="button" data-win="11">Windows 11</button><button type="button" data-win="10">Windows 10</button><button type="button" data-win="iso">ISO que já baixei</button></div></div>
      <div class="hint" id="wzHint"></div>
      <div class="vm-row" id="wzIsoRow" hidden style="margin:-4px 0 14px"><button type="button" class="btn small ghost" id="wzIsoPick">Escolher a ISO…</button><span class="fine" id="wzIsoName" style="margin:0">Nenhuma escolhida</span></div>
      <div class="f3">
        <div class="field"><label>Processadores (até ${rec.max_cpus})</label><input type="number" id="wzCpus" min="2" max="${rec.max_cpus}" value="${cpus}"></div>
        <div class="field"><label>Memória GB (até ${Math.max(4, rec.max_ram_gb)})</label><input type="number" id="wzRam" min="4" max="${Math.max(4, rec.max_ram_gb)}" value="${ram}"></div>
        <div class="field"><label>Disco GB</label><input type="number" id="wzDisk" min="64" max="2000" value="100"></div>
      </div>
      <div class="hint">Recomendado para o seu PC: ${cpus} processadores e ${ram} GB. O disco cresce aos poucos: o número é o máximo, não o que ocupa no começo.</div>
      <div class="field"><label>Placa de vídeo</label><select id="wzGpu">${share.map((g) => `<option value="${esc(g.id)}" ${g.id === r.default_gpu ? 'selected' : ''}>${esc(g.name)}${g.integrated ? ' (vídeo integrado)' : ''}</option>`).join('')}<option value="" ${share.length ? '' : 'selected'}>Sem placa de vídeo</option></select></div>
      <label class="checkline"><input type="checkbox" id="wzSteam" checked><div><b>Instalar a Steam</b><small>Ela se instala sozinha no primeiro início da VM e abre para você entrar com a sua conta.</small></div></label>
      ${info.games.length ? `<div class="field" id="wzGamesBox" style="margin:4px 0 6px 26px"><label>Copiar jogos da Steam deste PC (não precisa baixar de novo)</label>
        <div class="chips">${info.games.map((g) => `<label><input type="checkbox" data-game="${esc(g.appid)}" ${g === gc ? 'checked' : ''}>${esc(g.name)} <small>${gb(g.size, 1)}</small></label>`).join('')}</div>
        <div class="hint" style="margin:6px 0 0">Feche o jogo antes de criar a VM. Na VM, a Steam pode conferir os arquivos uma vez.</div></div>` : ''}
      ${info.helper ? '<label class="checkline"><input type="checkbox" id="wzHelper" checked><div><b>Instalar o Piece Helper na VM</b><small>Com atalho na área de trabalho, para trocar de conta dentro da VM também.</small></div></label>' : ''}
      <label class="checkline"><input type="checkbox" id="wzLite" checked><div><b>Deixar o Windows leve</b><small>Desliga e remove o que não serve numa VM de jogo. <a href="#" id="wzLiteMore" style="color:var(--em2)">Ver o que muda</a></small></div></label>
      <div id="wzLiteList" hidden><ul class="steps" style="margin:0 0 6px 26px">${info.lite.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="hint" style="margin:0 0 8px 26px">O Windows Update e o Windows Defender continuam ligados.</div></div>
      <label class="checkline"><input type="checkbox" id="wzStart" checked><div><b>Ligar a VM quando terminar</b><small>No primeiro início o Windows termina de se configurar sozinho e entra no usuário.</small></div></label>
      <div style="margin-top:8px">${callout('info', 'Licença do Windows', "Cada VM precisa da sua própria licença para ser ativada. Sem ativar, o Windows funciona, mas fica com marca d'água e algumas opções de personalização bloqueadas.")}</div>
      <div class="modal-actions" style="margin-top:16px"><button class="btn ghost" data-close>Cancelar</button><button class="btn primary" id="wzGo">Criar a VM</button></div>`);
    const el = m.el, g$ = (s) => el.querySelector(s), gAll = (s) => [...el.querySelectorAll(s)];
    const picked = () => gAll('[data-game]').filter((x) => x.checked).map((x) => x.dataset.game);
    const fitDisk = () => {
      const size = info.games.filter((g) => picked().includes(g.appid)).reduce((a, g) => a + g.size, 0) / GB;
      const need = Math.ceil(40 + size * 1.15) + 1, d = g$('#wzDisk');
      if (size && +d.value < need) { d.value = Math.max(need, 100); toast(`Aumentei o disco da VM para ${d.value} GB para caber os jogos.`); }
    };
    const paint = () => {
      gAll('[data-win]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.win === st.win));
      g$('#wzIsoRow').hidden = st.win !== 'iso';
      if (st.win === 'iso') { g$('#wzHint').textContent = 'Use uma ISO oficial do Windows 10 ou 11 (a do site da Microsoft). O Piece Helper escolhe a edição Pro dentro dela.'; return; }
      const have = info.isos.find((x) => x.name.startsWith(`Win${st.win}_`) && x.size > 3 * GB);
      g$('#wzHint').textContent = (st.win === hostWin ? 'Mesmo Windows do seu PC: é o recomendado. ' : `Seu PC está no Windows ${hostWin}; usar o mesmo nos dois evita problemas com a placa de vídeo. `) +
        (have ? 'Já foi baixado antes, então não precisa baixar de novo.' : `Baixa uns 6 GB do site oficial da Microsoft, em ${info.lang || 'seu idioma'}.`);
    };
    gAll('[data-win]').forEach((b) => (b.onclick = () => { st.win = b.dataset.win; paint(); }));
    g$('#wzIsoPick').onclick = async () => { const p = await call(V.pickIso()); if (p) { st.iso = p; g$('#wzIsoName').textContent = p; } };
    g$('#wzLiteMore').onclick = (e) => { e.preventDefault(); g$('#wzLiteList').hidden = !g$('#wzLiteList').hidden; };
    gAll('[data-game]').forEach((x) => (x.onchange = fitDisk));
    g$('#wzSteam').onchange = () => { const box = g$('#wzGamesBox'); if (box) box.style.opacity = g$('#wzSteam').checked ? 1 : 0.45; gAll('[data-game]').forEach((x) => (x.disabled = !g$('#wzSteam').checked)); };
    paint(); fitDisk();
    g$('#wzGo').onclick = async () => {
      if (st.win === 'iso' && !st.iso) return toast('Escolha o arquivo da ISO.', 'warn');
      const steam = g$('#wzSteam').checked;
      const opts = {
        name: g$('#wzName').value.trim(), user: g$('#wzUser').value.trim(),
        win: st.win === 'iso' ? null : st.win, iso: st.win === 'iso' ? st.iso : null,
        cpus: +g$('#wzCpus').value, ram_gb: +g$('#wzRam').value, disk_gb: +g$('#wzDisk').value,
        gpu_id: g$('#wzGpu').value || null, start: g$('#wzStart').checked, lite: g$('#wzLite').checked,
        steam, games: steam ? picked() : [], helper: g$('#wzHelper') ? g$('#wzHelper').checked : false,
      };
      const b = g$('#wzGo'); b.disabled = true; b.textContent = 'Conferindo…';
      let id;
      try { id = await call(V.create(opts)); } catch (e) { b.disabled = false; b.textContent = 'Criar a VM'; return toast(e.message, 'err', 6000); }
      m.close();
      S.sel = opts.name;
      follow(id, `Criando a VM ${opts.name}`);
    };
  }

  // ao abrir o app: confere sozinho. Drivers da VM desatualizados com a VM desligada são atualizados na hora;
  // o resto aparece no menu (ponto amarelo) e na tela de Máquina virtual com o botão que resolve.
  setTimeout(async () => {
    try {
      const r = await call(V.status());
      if (!r.vms.length) return;
      await diagnose();
      const bad = (S.doc.checks || []).filter((c) => c.level !== 'ok');
      const auto = r.admin ? bad.filter((c) => /:drv$/.test(c.id) && c.level === 'fail' && (r.vms.find((v) => v.name === c.vm) || {}).state === 'Off') : [];
      for (const c of auto) { toast(`O driver da placa mudou: atualizando a VM ${c.vm} sozinho.`, 'ok', 7000); track(await call(V.fix('vmDrivers', c.vm)), `Drivers da VM ${c.vm}`); }
      const rest = bad.filter((c) => !auto.includes(c) && (c.vm || c.id === 'driver' || c.id === 'hvlaunch' || c.id === 'vmms'));
      if (rest.length) toast(`O Piece Helper achou ${rest.length === 1 ? '1 coisa' : rest.length + ' coisas'} para resolver na máquina virtual. Abra "Máquina virtual" e clique em Resolver.`, 'warn', 9000);
    } catch { /* sem Hyper-V: nada a avisar */ }
  }, 9000);

  // voltou de um reinício pedido pelo "Verificar e corrigir"
  window.piece.on('app:continue', () => {
    toast('Voltamos! Conferindo se ficou tudo certo…', 'ok', 6000);
    S.docStale = true;
    $('#navVm').click();
  });

  return { load };
})();
window.VMUI = VMUI;

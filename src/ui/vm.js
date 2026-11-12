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
  };
  const callout = (kind, title, text) => `<div class="callout ${kind}">${SVG[kind === 'crit' ? 'warn' : kind] || SVG.info}<div><b>${esc(title)}</b>${text ? `<p>${text}</p>` : ''}</div></div>`;
  const S = { data: null, sel: null, busy: false };

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
        <div class="jc-step">${esc(lastStep(j))}</div></div>`;
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
    if (j.done) {
      el.querySelector('#jSpin')?.remove(); el.querySelector('#jCancel')?.remove();
      el.querySelector('#jStatus').innerHTML = j.ok ? '<b style="color:var(--em2)">Concluído.</b>' : '<b style="color:var(--danger)">Terminou com problema. Veja as mensagens acima.</b>';
    }
  }

  function openJob(id) {
    const j = J[id];
    if (!j) return;
    const m = wmodal(`<div class="vm-name"><h3 style="margin:0;flex:1">${esc(j.title)}</h3><span class="jc-time" id="jTime"></span>${j.done ? '' : '<div class="spin" id="jSpin"></div>'}</div>
      <p class="fine" id="jStatus" style="margin-top:8px">Rodando… pode fechar esta janela: o progresso continua aparecendo no topo da tela de Máquina virtual e no menu.</p>
      <div class="console"><div class="bar indet" id="jBar"><i></i></div><div class="console-body" id="jBody"></div></div>
      <div class="modal-actions" style="margin-top:14px">${j.done ? '' : '<button class="btn ghost" id="jCancel">Cancelar tarefa</button>'}<button class="btn primary" data-close>Fechar</button></div>`);
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
      if (snap.done) { j.done = true; j.ok = snap.ok; j.ended = Date.now(); }
      paintJobs();
      if (snap.done) break;
      await new Promise((ok) => setTimeout(ok, 700));
    }
    if (!j.done) { j.done = true; j.ok = false; j.ended = Date.now(); paintJobs(); }
    if (j.ok) toast(`${title}: concluído.`); else toast(`${title}: terminou com problema. Veja em "Ver detalhes".`, 'err', 8000);
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
  async function run(promise, title, after) {
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
    $('#vmDot').hidden = !S.data.vms.some((v) => v.drivers === 'outdated');
    body.innerHTML = render(S.data);
    bind(S.data);
    paintJobs();
  }
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
    const host = `<div class="panel">
      <div class="vm-row" style="margin:0 0 6px;align-items:center"><h2 style="margin:0">Este PC</h2><span class="spacer"></span>
        <button class="btn primary small" id="vmNew">${SVG.plus}Criar uma VM do zero</button></div>
      <dl class="kv">
        <dt>Windows</dt><dd>${esc(r.edition || '—')}${r.build ? ` (build ${esc(r.build)})` : ''}</dd>
        <dt>Processador</dt><dd>${esc(r.threads || '—')} núcleos lógicos</dd>
        <dt>Memória</dt><dd>${gb(r.ram)}</dd>
        <dt>Placas para a VM</dt><dd>${share.length ? share.map((g) => esc(g.name) + (g.integrated ? ' <span style="color:var(--dim)">(vídeo integrado)</span>' : '')).join('<br>') : 'Nenhuma'}</dd>
      </dl></div>`;
    if (r.vmerror && r.vmerror !== 'admin') h += callout('warn', 'O Hyper-V respondeu com erro', esc(r.vmerror)) + '<div style="height:14px"></div>';
    if (!r.vms.length) {
      return h + host + `<div class="panel vm-sec"><h2>Nenhuma máquina virtual ainda</h2>
        <p class="fine" style="margin:0">O Piece Helper cria uma com um clique: baixa o Windows da Microsoft, instala sozinho (sem senha e sem conta da Microsoft), deixa o Windows leve, coloca a placa de vídeo e, se quiser, a Steam com o Grand Chase já copiado.</p>
        <div class="vm-row"><button class="btn primary" id="vmNew2">${SVG.plus}Criar uma VM do zero</button><button class="btn ghost" id="vmMgr">Prefiro fazer pelo Gerenciador do Hyper-V</button></div></div>`;
    }
    const v = current(r); S.sel = v.name;
    const running = v.state === 'Running';
    const hostDrv = (r.gpus.find((g) => g.id === v.gpu_id) || {}).driver;
    const drv = { ok: `Em dia (${esc(v.driver_copied || hostDrv || '')})`, outdated: `Desatualizados (VM ${esc(v.driver_copied)}, PC ${esc(hostDrv)})`, unknown: 'Não sei: a placa foi colocada fora do Piece Helper' }[v.drivers] || '—';
    const vmPanel = `<div class="panel">
      <div class="vm-row" style="margin:0 0 6px;align-items:center"><div class="vm-name"><h2>${esc(v.name)}</h2><span class="state-tag ${running ? 'on' : ''}">${running ? 'Ligada' : v.state === 'Off' ? 'Desligada' : esc(v.state)}</span></div><span class="spacer"></span>
        ${r.vms.length > 1 ? `<div class="field" style="margin:0"><select id="vmSel">${r.vms.map((x) => `<option ${x.name === v.name ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>` : ''}</div>
      <dl class="kv">
        <dt>Processadores</dt><dd>${esc(v.cpus)}</dd>
        <dt>Memória</dt><dd>${gb(v.ram)} ${v.dyn ? '(dinâmica)' : '(fixa)'}</dd>
        <dt>Placa de vídeo</dt><dd>${v.gpu ? esc(v.gpu_name || 'Sim') : 'Não'}</dd>
        ${v.gpu ? `<dt>Drivers na VM</dt><dd>${drv}</dd>` : ''}
      </dl>
      <div class="vm-row">
        ${running ? `<button class="btn primary" id="vmOpen">${SVG.screen}Abrir a janela da VM</button><button class="btn ghost" id="vmRes">Resolução da janela</button><button class="btn ghost" id="vmOff">${SVG.stop}Desligar</button>`
    : `<button class="btn primary" id="vmOn">${SVG.play}Ligar e abrir</button>`}
        <span class="spacer"></span><button class="btn ghost small" id="vmHelper">Instalar o Piece Helper na VM</button><button class="btn ghost small" id="vmMgr">Gerenciador do Hyper-V</button></div></div>`;

    let gpu;
    if (!v.gpu) {
      gpu = !share.length ? callout('warn', 'Nenhuma placa deste PC pode ser compartilhada', 'O Windows não liberou nenhuma placa para máquinas virtuais. Atualize o driver da placa pelo site do fabricante e tente de novo.')
        : `<div class="panel"><p class="fine" style="margin:0">O Piece Helper desliga a VM, copia os drivers da placa para dentro dela, ajusta o que a VM precisa e liga a placa. Os jogos dentro da VM passam a usar a placa de vídeo de verdade.</p>
          <div class="vm-row"><div class="field" style="margin:0;min-width:280px"><label>Placa de vídeo</label><select id="vmGpu">${share.map((g) => `<option value="${esc(g.id)}" ${g.id === r.default_gpu ? 'selected' : ''}>${esc(g.name)}${g.integrated ? ' (vídeo integrado)' : ''}</option>`).join('')}</select></div>
          <span class="spacer"></span><button class="btn primary" id="vmGpuGo">${SVG.bolt}Colocar a placa na VM</button></div></div>`;
    } else {
      const st = v.drivers === 'outdated' ? callout('warn', 'Os drivers da placa na VM estão desatualizados', 'Você atualizou o driver da placa no PC, mas a VM ainda está com a versão antiga. Atualize para a VM não dar erro ou tela preta.')
        : v.drivers === 'unknown' ? callout('info', 'A placa foi colocada fora do Piece Helper', 'Clique em "Atualizar drivers da VM" uma vez. Assim o app guarda a versão e passa a avisar quando precisar de novo.')
          : callout('ok', 'Tudo certo', `A VM está usando a ${esc(v.gpu_name || 'placa de vídeo')} com os drivers em dia.`);
      const mism = v.guest_build && r.build && ((+r.build >= 22000) !== (+v.guest_build >= 22000))
        ? `<div style="margin-top:10px">${callout('info', `Seu PC está no Windows ${+r.build >= 22000 ? '11' : '10'} e a VM no Windows ${+v.guest_build >= 22000 ? '11' : '10'}`, 'Costuma funcionar. Se a VM der tela azul ou ficar instável, use o mesmo Windows nos dois.')}</div>` : '';
      gpu = st + mism + `<div class="vm-row"><button class="btn ${v.drivers !== 'ok' ? 'primary' : 'ghost'}" id="vmGpuUpd">${SVG.refresh}Atualizar drivers da VM</button><span class="spacer"></span><button class="btn ghost" id="vmGpuRm">Tirar a placa da VM</button></div>`;
    }
    const rec = r.recommend;
    const tune = `<div class="panel"><p class="fine" style="margin:0">Recomendado para o seu PC: <b>${rec.cpus} processadores</b> e <b>${rec.ram_gb} GB</b> de memória fixa. Mais processadores deixam a VM mais rápida e memória fixa evita travadinhas.</p>
      <div class="vm-row">
        <div class="field" style="margin:0"><label>Processadores (até ${rec.max_cpus})</label><input type="number" id="vmCpus" min="1" max="${rec.max_cpus}" value="${rec.cpus}" style="width:150px"></div>
        <div class="field" style="margin:0"><label>Memória em GB (até ${rec.max_ram_gb})</label><input type="number" id="vmRam" min="2" max="${rec.max_ram_gb}" value="${rec.ram_gb}" style="width:150px"></div>
        <span class="spacer"></span>${v.tune_backup ? '<button class="btn ghost" id="vmTuneUndo">Voltar ao que era</button>' : ''}<button class="btn primary" id="vmTune">Aplicar</button></div>
      <p class="fine">Agora: ${esc(v.cpus)} processadores e ${gb(v.ram)} de memória ${v.dyn ? 'dinâmica' : 'fixa'}.</p></div>`;
    const notes = `<div class="panel vm-sec"><h2>Bom saber</h2><ul class="steps">
      <li>Sempre que atualizar o driver da placa de vídeo no PC, atualize também os drivers da VM aqui. Um ponto amarelo no menu avisa.</li>
      <li>O ideal é o mesmo Windows no PC e na VM (10 com 10, 11 com 11).</li>
      <li>Com a placa na VM, não dá para criar pontos de verificação dela. Para um backup: tire a placa, crie o ponto e coloque a placa de novo.</li>
      <li>A placa é compartilhada: o PC continua usando ela normalmente. Nada é gravado na placa e dá para desfazer tudo.</li>
      <li>Alguns jogos com anti-cheat não abrem dentro de máquinas virtuais. O Piece Helper não tenta esconder a VM.</li></ul></div>`;
    return h + `<div class="vm-grid">${host}${vmPanel}</div>` +
      `<div class="vm-sec"><h2>Placa de vídeo na VM</h2>${gpu}</div>` +
      `<div class="vm-sec"><h2>Processador e memória</h2>${tune}</div>` + notes;
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
    on('vmNew2', () => wizard(r));
    const v = r.vms.length ? current(r) : null;
    if (!v) return;
    const sel = document.getElementById('vmSel');
    if (sel) sel.onchange = () => { S.sel = sel.value; $('#vmBody').innerHTML = render(r); bind(r); };
    on('vmOpen', () => V.open(v.name, false));
    on('vmHelper', async () => {
      if (await ask('Instalar o Piece Helper na VM?', `<p>A VM <b>${esc(v.name)}</b> vai ser desligada (salve o que estiver aberto nela), o Piece Helper deste PC é copiado para dentro dela, com atalho na área de trabalho, e a VM liga de novo. Se já tiver um lá, ele é atualizado para esta versão.</p><p>Dentro da VM, as contas da Steam são as que você logar lá.</p>`, 'Instalar')) run(V.installHelper(v.name), 'Piece Helper na VM');
    });
    on('vmRes', async () => {
      if (await ask('Resolução da janela da VM', '<p>Feche a janela da VM que estiver aberta (isso não desliga a VM). Na janelinha que vai abrir, arraste o controle até a resolução que quiser (ex.: <b>1280 x 720</b>), marque <b>Salvar minhas configurações</b> e clique em <b>Conectar</b>.</p>', 'Abrir')) V.open(v.name, true);
    });
    on('vmOn', () => run(V.power(v.name, true), 'Ligar a VM', () => V.open(v.name, false)));
    on('vmOff', async () => { if (await ask('Desligar a VM?', '<p>O Windows da VM vai desligar normalmente. Salve o que estiver aberto nela.</p>', 'Desligar')) run(V.power(v.name, false), 'Desligar a VM'); });
    on('vmGpuGo', async () => {
      const id = document.getElementById('vmGpu').value, g = r.gpus.find((x) => x.id === id);
      if (await ask(`Colocar a ${esc(g ? g.name : 'placa')} na VM?`, '<p>A VM vai ser desligada: salve o que estiver aberto nela. Os drivers da placa são copiados para dentro da VM e os pontos de verificação dela são desligados, porque VMs com placa de vídeo não aceitam. Leva de 1 a 5 minutos. Para desfazer, use "Tirar a placa da VM".</p>', 'Colocar a placa')) run(V.gpuSetup(v.name, id), 'Placa de vídeo na VM');
    });
    on('vmGpuUpd', async () => { if (await ask('Atualizar os drivers da VM?', '<p>A VM vai ser desligada (salve o que estiver aberto nela) e os drivers atuais da placa são copiados de novo para dentro dela.</p>', 'Atualizar')) run(V.gpuUpdate(v.name), 'Atualizar drivers da VM'); });
    on('vmGpuRm', async () => { if (await ask('Tirar a placa da VM?', '<p>A VM vai ser desligada e volta a funcionar sem a placa de vídeo, como era antes. Os pontos de verificação voltam a ser como estavam.</p>', 'Tirar a placa')) run(V.gpuRemove(v.name), 'Tirar a placa da VM'); });
    on('vmTune', async () => {
      const c = +document.getElementById('vmCpus').value, m = +document.getElementById('vmRam').value;
      if (!c || !m) return toast('Preencha os dois números.', 'warn');
      if (v.state !== 'Off' && !(await ask('A VM vai reiniciar', '<p>Para mudar processador e memória, a VM precisa desligar. O Piece Helper desliga, aplica e liga de novo. Salve o que estiver aberto nela.</p>', 'Aplicar'))) return;
      run(V.tune(v.name, c, m), 'Ajustar a VM');
    });
    on('vmTuneUndo', () => run(V.tuneUndo(v.name), 'Voltar a VM ao original'));
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

  $('#vmRefresh').onclick = () => load(true);
  // aviso no menu quando o driver da placa foi atualizado no PC e a VM ficou para trás
  setTimeout(async () => {
    try {
      const r = await call(V.status());
      if (r.vms.some((v) => v.drivers === 'outdated')) { $('#vmDot').hidden = false; toast('Os drivers da placa de vídeo na máquina virtual estão desatualizados. Veja em Máquina virtual.', 'warn', 8000); }
    } catch { /* sem Hyper-V: nada a avisar */ }
  }, 12000);

  return { load };
})();
window.VMUI = VMUI;

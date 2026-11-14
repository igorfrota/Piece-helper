// Piece Helper — "Verificar e corrigir": examina o PC e as máquinas virtuais e RESOLVE o que encontrar.
// Cada problema vem com a correção (botão "Resolver"); "Resolver tudo" faz todas em sequência.
// Driver da placa: NVIDIA pelo serviço oficial de drivers da NVIDIA (mesma consulta do site deles; tabela de
// placas do projeto nvidia-data, MIT), AMD pelo pacote oficial do site da AMD e Intel pelo Windows Update.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFile, spawn } = require('child_process');
const VM = require('./vm');

const I = VM._int;
const GB = I.GB;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const GC_APPID = '985810';
const TASK = 'Piece Helper - continuar';

const NV_DATA = 'https://raw.githubusercontent.com/ZenitH-AT/nvidia-data/main/gpu-data.json';
const NV_LOOKUP = 'https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&pfid=%P&osID=%O&dch=1';
const AMD_PAGE = 'https://www.amd.com/en/support/download/drivers.html';
const AMD_PKG = (v) => `https://drivers.amd.com/drivers/whql-amd-software-adrenalin-edition-${v}-win11-c.exe`;
const AMD_CHOCO = "https://community.chocolatey.org/api/v2/FindPackagesById()?id='amd-software-adrenalin-edition'";
const PAGES = {
  nvidia: 'https://www.nvidia.com/pt-br/drivers/',
  amd: 'https://www.amd.com/pt/support/download/drivers.html',
  intel: 'https://www.intel.com.br/content/www/br/pt/support/detect.html',
};

// ---------------------------------------------------------------- internet
function fetchText(url, headers = {}, timeout = 15000, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, ...headers }, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 6) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), headers, timeout, redirects + 1));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, body, url }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}
async function online() {
  for (const u of ['https://www.msftconnecttest.com/connecttest.txt', 'https://store.steampowered.com/', 'https://www.google.com/generate_204']) {
    try { const r = await fetchText(u, {}, 8000); if (r.status < 500) return true; } catch { /* tenta o próximo */ }
  }
  return false;
}

// ---------------------------------------------------------------- versão mais nova do driver
const cmpVer = (a, b) => {
  const x = String(a || '').split(/[.\-]/).map((n) => parseInt(n, 10) || 0), y = String(b || '').split(/[.\-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
};
const vendorOf = (g) => ({ '10DE': 'nvidia', '1002': 'amd', '8086': 'intel' }[(g.ven || '').toUpperCase()] || null);
// "32.0.15.6094" -> "560.94" (o número que a NVIDIA mostra)
function nvCurrent(drv) {
  const s = String(drv || '').replace(/\./g, '');
  if (s.length < 5) return null;
  const t = s.slice(-5);
  return `${t.slice(0, 3)}.${t.slice(3)}`;
}
function nvClean(name) {
  return String(name || '').replace(/^NVIDIA\s+/i, '').replace(/\s+\([A-Z]+\)$/, '').replace(/\s+\d+\s?GB$/i, '')
    .replace(/\s+COLLECTORS EDITION$/i, '').replace(/\s+with Max-Q Design$/i, '').replace(/Super\b/, 'SUPER').trim();
}
let latestCache = { at: 0, key: '', val: null };
async function latestDriver(g, d) {
  const vendor = vendorOf(g);
  const key = `${g.id}|${g.driver}|${g.radeon}`;
  if (latestCache.key === key && Date.now() - latestCache.at < 30 * 60000) return latestCache.val;
  let val = { vendor, current: g.driver, latest: null, url: null, page: PAGES[vendor] || null, size: null };
  try {
    if (vendor === 'nvidia') {
      val.current = nvCurrent(g.driver);
      let data = null;
      try { data = JSON.parse((await fetchText(NV_DATA)).body); } catch { /* usa a tabela de reserva */ }
      const name = nvClean(g.name);
      const laptop = d.laptop || /Laptop|Max-Q|\bM\b|[0-9]M$/.test(name);
      let pfid = data && ((laptop ? data.notebook[name] : data.desktop[name]) || data.desktop[name] || data.notebook[name]);
      // placas novas que ainda não estão na tabela: o driver Game Ready é o mesmo para as GeForce GTX 16 / RTX 20 em diante
      if (!pfid && /RTX\s*[2-9]0\d\d|GTX\s*16\d\d/i.test(name)) pfid = laptop ? '1007' : '1023';
      if (pfid) {
        const url = NV_LOOKUP.replace('%P', pfid).replace('%O', +d.build >= 22000 ? '135' : '57');
        const r = JSON.parse((await fetchText(url)).body);
        const info = r && (+r.Success === 1) && r.IDS && r.IDS[0] && r.IDS[0].downloadInfo;
        if (info) Object.assign(val, { latest: info.Version, url: info.DownloadURL, size: info.DownloadURLFileSize || null });
      }
    } else if (vendor === 'amd') {
      val.current = g.radeon || null;
      let minimal = null;
      try {
        const r = await fetchText(AMD_PAGE, { Accept: 'text/html' });
        const m = r.body.match(/https:\/\/drivers\.amd\.com\/drivers\/installer\/[^"'\s<>]*?adrenalin-edition-(\d+\.\d+\.\d+)-minimalsetup[^"'\s<>]*?\.exe/i);
        if (m) { val.latest = m[1]; minimal = m[0]; }
      } catch { /* tenta a lista de reserva */ }
      if (!val.latest) {
        try {
          const r = await fetchText(AMD_CHOCO, { Accept: 'application/atom+xml' });
          const vs = [...r.body.matchAll(/<d:Version>([\d.]+)<\/d:Version>/g)].map((x) => x[1]).sort(cmpVer);
          if (vs.length) val.latest = vs[vs.length - 1];
        } catch { /* sem versão online */ }
      }
      if (val.latest) { val.url = AMD_PKG(val.latest); val.minimal = minimal; }
    }
  } catch { /* sem internet ou o site mudou: segue sem a versão mais nova */ }
  val.outdated = !!(val.latest && (!val.current || cmpVer(val.current, val.latest) < 0));
  latestCache = { at: Date.now(), key, val };
  return val;
}

// ---------------------------------------------------------------- exame
const INTEGRATED = /Radeon\(TM\) Graphics$|Radeon Graphics$|Vega \d+ Graphics|Intel\(R\) (UHD|HD|Iris)|Intel\(R\) Graphics$|Intel\(R\) Arc\(TM\) Graphics$/i;
const VIRTUAL = /Parsec|Hyper-V|Basic Display|Remote Display|Virtual Display|Meta Virtual|IddSample|SudoVDA|Microsoft Basic/i;

function biosHelp(d) {
  const amd = /AMD|Ryzen/i.test(d.cpu || '');
  const opt = amd ? '<b>SVM Mode</b> (às vezes "AMD-V" ou "Virtualization")' : '<b>Intel Virtualization Technology</b> (ou "VT-x")';
  const mk = `${d.boardMaker || ''} ${d.maker || ''}`;
  let where = 'Procure nos menus <b>Advanced</b> ou <b>CPU Configuration</b>';
  let key = '<b>Del</b> ou <b>F2</b>';
  if (/ASUS/i.test(mk)) { where = 'Aperte <b>F7</b> (modo avançado) e vá em <b>Advanced &gt; CPU Configuration</b>'; key = '<b>Del</b>'; }
  else if (/Micro-Star|MSI/i.test(mk)) { where = amd ? 'Vá em <b>OC &gt; Advanced CPU Configuration</b>' : 'Vá em <b>OC &gt; CPU Features</b>'; key = '<b>Del</b>'; }
  else if (/Gigabyte|AORUS/i.test(mk)) { where = amd ? 'Vá em <b>Tweaker &gt; Advanced CPU Settings</b>' : 'Vá em <b>Settings &gt; Miscellaneous</b>'; key = '<b>Del</b>'; }
  else if (/ASRock/i.test(mk)) { where = 'Vá em <b>Advanced &gt; CPU Configuration</b>'; key = '<b>F2</b> ou <b>Del</b>'; }
  else if (/Dell/i.test(mk)) { where = 'Vá em <b>Virtualization Support</b>'; key = '<b>F2</b>'; }
  else if (/HP|Hewlett/i.test(mk)) { where = 'Vá em <b>Advanced &gt; System Options</b> (ou Configuration)'; key = '<b>F10</b>'; }
  else if (/Lenovo/i.test(mk)) { where = 'Vá em <b>Configuration</b> ou <b>Security &gt; Virtualization</b>'; key = '<b>F1</b> ou <b>F2</b>'; }
  else if (/Acer/i.test(mk)) { where = 'Vá em <b>Advanced</b> ou <b>Main</b>'; key = '<b>F2</b>'; }
  return { opt, where, key, board: (d.board || '').trim() };
}

async function diagnose(steamPath) {
  if (!I.IS_WIN) return { checks: [], summary: { fail: 0, warn: 0 }, vmsChecked: false };
  const [admin, d0, net] = await Promise.all([I.isAdmin(), I.psJson(I.ps('diag'), 150000), online()]);
  const d = d0 || {};
  const st = I.loadState();
  const checks = [];
  const add = (c) => checks.push(c);
  const gpus = I.asList(d.gpus).filter((g) => g && g.name && !VIRTUAL.test(g.name));
  const dedicated = gpus.filter((g) => !INTEGRATED.test(g.name));
  const main = dedicated[0] || gpus[0] || null;
  const hvOn = !!(d.module && d.vmms);

  // 1. administrador
  if (!admin) add({ id: 'admin', level: 'fail', title: 'O Piece Helper está sem permissão de administrador',
    text: 'Sem isso o Windows não deixa mexer em máquinas virtuais nem instalar drivers.', fix: { kind: 'elevate', label: 'Abrir como administrador' } });

  // 2. edição do Windows
  const home = /Core|Home/i.test(d.editionId || '') || (/Home/i.test(d.edition || '') && !/Pro/i.test(d.edition || ''));
  if (home) add({ id: 'edition', level: 'fail', title: 'O Windows Home não tem máquinas virtuais',
    text: `Seu Windows: <b>${d.edition || 'Home'}</b>. O Hyper-V só existe no Windows Pro. Para passar para o Pro é preciso comprar a atualização (a troca é feita pela própria Microsoft, sem formatar e sem perder nada). A troca de contas do Piece Helper funciona no Home normalmente.`,
    fix: { kind: 'open', url: 'ms-windows-store://pdp/?productid=DG7GMGF0D7FV', label: 'Abrir a atualização para o Pro' }, manual: true });
  else add({ id: 'edition', level: 'ok', title: `Windows com máquinas virtuais (${d.edition || 'Pro'})` });

  // 3. virtualização na BIOS
  if (!d.vtx && !d.hypervisor) {
    const b = biosHelp(d);
    add({ id: 'bios', level: 'fail', title: 'A virtualização está desligada na BIOS',
      text: `Essa opção fica na BIOS da placa-mãe${b.board ? ` (${b.board})` : ''} e nenhum programa consegue ligar por dentro do Windows. O Piece Helper reinicia o PC <b>direto na BIOS</b>${d.uefi ? '' : ` (se não entrar sozinho, aperte ${b.key} repetidamente quando o PC ligar)`}. Lá: ${b.where}, deixe ${b.opt} em <b>Enabled</b> e aperte <b>F10</b> para salvar. Quando o Windows voltar, o Piece Helper abre sozinho e continua de onde parou.`,
      fix: { kind: 'job', action: 'bios', label: 'Reiniciar direto na BIOS', reboot: true }, bios: b });
  } else add({ id: 'bios', level: 'ok', title: 'Virtualização ligada na BIOS' });

  // 4. Hyper-V
  if (!home) {
    if (d.feature === 'Disabled' || d.feature === 'DisabledWithPayloadRemoved') {
      add({ id: 'hyperv', level: 'fail', title: 'O Hyper-V está desligado', text: 'É o recurso de máquinas virtuais que já vem no Windows. O Piece Helper liga, reinicia o PC e abre sozinho depois para continuar.',
        fix: { kind: 'job', action: 'hyperv', label: 'Ligar o Hyper-V e reiniciar', reboot: true } });
    } else if (d.feature === 'Enabled' && !hvOn) {
      add({ id: 'hyperv', level: 'fail', title: 'O Hyper-V foi ligado, mas falta reiniciar', fix: { kind: 'job', action: 'reboot', label: 'Reiniciar agora', reboot: true } });
    } else if (hvOn) {
      add({ id: 'hyperv', level: 'ok', title: 'Hyper-V ligado' });
      if (/^off$/i.test(d.launch || '') || (d.vtx && !d.hypervisor && d.feature === 'Enabled')) {
        add({ id: 'hvlaunch', level: 'fail', title: 'O Hyper-V está instalado, mas não liga quando o PC inicia',
          text: 'Algum programa (geralmente BlueStacks, VMware antigo ou um "otimizador") desligou o Hyper-V na inicialização. O Piece Helper religa e reinicia o PC.',
          fix: { kind: 'job', action: 'hvlaunch', label: 'Religar e reiniciar', reboot: true } });
      }
      if (d.vmms && d.vmms !== 'Running') {
        add({ id: 'vmms', level: 'fail', title: 'O serviço de máquinas virtuais está parado', fix: { kind: 'job', action: 'vmms', label: 'Ligar o serviço' } });
      }
    }
  }
  if (d.rebootPending && !checks.some((c) => c.fix && c.fix.reboot)) {
    add({ id: 'reboot', level: 'warn', title: 'O Windows está esperando reiniciar', text: 'Uma atualização do Windows ou de driver pediu para reiniciar. Algumas correções só funcionam depois disso.',
      fix: { kind: 'job', action: 'reboot', label: 'Reiniciar agora', reboot: true } });
  }

  // 5. placa de vídeo e driver
  if (!main) {
    add({ id: 'gpu', level: 'fail', title: 'Não achei placa de vídeo neste PC', text: 'O Windows não mostrou nenhuma placa. Instalar o driver pelo Windows Update costuma resolver.',
      fix: { kind: 'job', action: 'driverWu', label: 'Procurar driver no Windows Update' } });
  } else {
    const lat = net ? await latestDriver(main, d) : { vendor: vendorOf(main), outdated: false };
    const broken = main.status !== 'OK' || (main.problem && +main.problem !== 0);
    const share = !!main.path;
    const curTxt = lat.vendor === 'amd' ? (lat.current || main.driver) : lat.vendor === 'nvidia' ? (lat.current || main.driver) : main.driver;
    if (broken) {
      add({ id: 'driver', level: 'fail', title: `A ${main.name} está com erro no Windows`, gpu: main.id,
        text: `O Gerenciador de Dispositivos mostra a placa com problema (código ${main.problem || '?'}). O Piece Helper baixa e reinstala o driver oficial${lat.vendor ? ' da ' + lat.vendor.toUpperCase() : ''}.`,
        fix: { kind: 'job', action: 'driver', arg: main.id, label: 'Reinstalar o driver' } });
    } else if (lat.outdated) {
      add({ id: 'driver', level: 'warn', title: `Driver da ${main.name} desatualizado`, gpu: main.id,
        text: `Instalado: <b>${curTxt || '?'}</b> · mais novo: <b>${lat.latest}</b>. O Piece Helper baixa o driver oficial${lat.vendor === 'amd' ? ' da AMD (uns 1,7 GB)' : lat.vendor === 'nvidia' ? ' da NVIDIA (uns 700 MB)' : ''}, instala sozinho e depois atualiza as VMs. A tela pode piscar durante a instalação.`,
        fix: { kind: 'job', action: 'driver', arg: main.id, label: 'Baixar e instalar' } });
    } else if (!share && hvOn) {
      add({ id: 'driver', level: 'fail', title: `O Windows não liberou a ${main.name} para máquinas virtuais`, gpu: main.id,
        text: 'Quase sempre é o driver: reinstalar o driver oficial resolve. Se depois disso continuar, a placa não aceita ser compartilhada (acontece em notebooks com NVIDIA e em placas antigas).',
        fix: { kind: 'job', action: 'driver', arg: main.id, label: 'Reinstalar o driver' } });
    } else {
      add({ id: 'driver', level: 'ok', title: `${main.name}: driver ${lat.latest ? 'em dia' : 'instalado'}${curTxt ? ` (${curTxt})` : ''}` });
    }
  }

  // 6. memória
  const ramGb = (d.ram || 0) / GB;
  const rec = I.recommend(d.threads, d.ram);
  if (ramGb && ramGb < 11.5) add({ id: 'ram', level: 'warn', title: `O PC tem ${Math.round(ramGb)} GB de memória`,
    text: `Dá para usar a VM, mas no limite: o Piece Helper já deixa a VM com ${rec.ram_gb} GB para sobrar memória para o PC. Feche o navegador enquanto joga nas duas contas.` });

  // 7. espaço em disco
  const drives = I.asList(d.drives).filter((x) => x && x.letter);
  const gc = I.steamGames(steamPath).find((g) => g.appid === GC_APPID);
  const needGb = Math.ceil(32 + (gc ? gc.size / GB * 1.08 : 0));
  const defL = (d.vhdDir || 'C').slice(0, 1).toUpperCase();
  const freeOf = (L) => ((drives.find((x) => x.letter.toUpperCase() === L) || {}).free || 0) / GB;
  const best = drives.slice().sort((a, b) => b.free - a.free)[0];
  if (freeOf(defL) < needGb) {
    if (best && best.free / GB >= needGb && best.letter.toUpperCase() !== defL) {
      add({ id: 'disk', level: 'warn', title: `Pouco espaço no disco ${defL}: (${Math.floor(freeOf(defL))} GB livres)`,
        text: `Uma VM nova precisa de uns ${needGb} GB${gc ? ' (Windows + Grand Chase)' : ''}. O disco ${best.letter}: tem ${Math.floor(best.free / GB)} GB livres: o Piece Helper passa a guardar as VMs lá.`,
        fix: { kind: 'job', action: 'vmFolder', arg: best.letter, label: `Guardar as VMs no disco ${best.letter}:` } });
    } else {
      add({ id: 'disk', level: 'fail', title: `Falta espaço para uma VM nova (${Math.floor(freeOf(defL))} GB livres; precisa de uns ${needGb} GB)`,
        text: 'O Piece Helper apaga os arquivos temporários do Windows, o cache de atualizações e os downloads incompletos, e mostra quanto liberou. Se ainda faltar, desinstale algum jogo ou programa que não usa.',
        fix: { kind: 'job', action: 'cleanup', label: 'Liberar espaço' } });
    }
  }

  // 8. internet
  if (!net) add({ id: 'net', level: 'fail', title: 'Sem internet (ou um bloqueio no caminho)',
    text: 'Sem internet não dá para baixar o Windows nem drivers. O Piece Helper limpa o cache de nomes (DNS) e o proxy do Windows, que é o que mais trava downloads.',
    fix: { kind: 'job', action: 'net', label: 'Consertar a conexão' } });

  // 9. as máquinas virtuais
  const vms = I.asList(d.vms).filter((v) => v && v.name);
  for (const v of vms) {
    const rv = st[v.name] || {};
    const pre = `vm:${v.name}`;
    const label = `VM ${v.name}`;
    if (rv.gpu_id && !v.gpu) {
      add({ id: `${pre}:gpu`, vm: v.name, level: 'fail', title: `${label}: a placa de vídeo saiu da VM`,
        text: 'Acontece depois de trocar a placa, reinstalar o driver ou de uma atualização grande do Windows. O Piece Helper coloca a placa de novo e copia os drivers.',
        fix: { kind: 'job', action: 'vmRepair', arg: v.name, label: 'Consertar a VM' } });
    }
    if (v.gpu) {
      const host = gpus.find((g) => g.path && v.gpuPath && g.path.toUpperCase() === v.gpuPath.toUpperCase()) || gpus.find((g) => g.id === rv.gpu_id) || main;
      if (!rv.driver) {
        add({ id: `${pre}:drv`, vm: v.name, level: 'warn', title: `${label}: não sei se os drivers da placa estão em dia`, text: 'A placa foi colocada fora do Piece Helper. Atualizar uma vez resolve e daí em diante o app acompanha sozinho.',
          fix: { kind: 'job', action: 'vmDrivers', arg: v.name, label: 'Atualizar os drivers da VM' } });
      } else if (host && host.driver && host.driver !== rv.driver) {
        add({ id: `${pre}:drv`, vm: v.name, level: 'fail', title: `${label}: drivers da placa desatualizados`,
          text: `O driver do PC mudou (${rv.driver} → ${host.driver}) e a VM ficou com o antigo: é a causa mais comum de tela preta e do jogo não abrir na VM.`,
          fix: { kind: 'job', action: 'vmDrivers', arg: v.name, label: 'Atualizar os drivers da VM' } });
      }
      if (v.checkpoint !== 'Disabled' || v.autockpt || v.snaps) {
        add({ id: `${pre}:ckpt`, vm: v.name, level: 'warn', title: `${label}: pontos de verificação ligados`,
          text: `VMs com placa de vídeo não ligam com pontos de verificação${v.snaps ? ` (essa tem ${v.snaps})` : ''}. O Piece Helper desliga${v.snaps ? ' e junta os existentes ao disco, sem perder nada' : ''}.`,
          fix: { kind: 'job', action: 'vmCheckpoint', arg: v.name, label: 'Desligar os pontos de verificação' } });
      }
    }
    if ((v.toolsOff && v.toolsOff.length) || d.enhanced === false) add({ id: `${pre}:tools`, vm: v.name, level: 'warn', title: `${label}: ferramentas da VM desligadas`,
      text: 'No Hyper-V as "VM Tools" já vêm no Windows, mas parte delas fica desligada. O Piece Helper liga todas: copiar e colar, tela que se ajusta ao tamanho da janela, som, enviar arquivos, horário certo e desligamento pelo PC.',
      fix: { kind: 'job', action: 'vmTools', arg: v.name, label: 'Ligar as ferramentas da VM' } });
    if (!v.net) add({ id: `${pre}:net`, vm: v.name, level: 'warn', title: `${label}: sem internet`, text: 'A VM não está ligada a nenhuma rede. O Piece Helper liga ela na rede padrão do Hyper-V.',
      fix: { kind: 'job', action: 'vmNet', arg: v.name, label: 'Ligar a internet da VM' } });
    // Grand Chase da VM mais velho que o do PC
    const gvm = (rv.games || []).find((x) => x.appid === GC_APPID);
    if (gc && gvm && gvm.build && I.gameBuild(gc) && gvm.build !== I.gameBuild(gc)) {
      add({ id: `${pre}:game`, vm: v.name, level: 'warn', title: `${label}: o Grand Chase do PC é mais novo que o da VM`,
        text: 'O jogo atualizou no PC. O Piece Helper copia só os arquivos que mudaram para a VM, sem baixar tudo de novo pela Steam dela.',
        fix: { kind: 'job', action: 'vmGame', arg: v.name, label: 'Atualizar o GC da VM' } });
    }
    const ramV = (v.ram || 0) / GB;
    if (ramGb && ramGb < 11.5 && ramV > rec.ram_gb + 0.5) {
      add({ id: `${pre}:ram`, vm: v.name, level: 'warn', title: `${label}: memória demais para este PC`, text: `A VM pega ${Math.round(ramV)} GB e o PC tem ${Math.round(ramGb)} GB: o PC fica lento. O Piece Helper ajusta para ${rec.ram_gb} GB.`,
        fix: { kind: 'job', action: 'vmRam', arg: v.name, label: `Ajustar para ${rec.ram_gb} GB` } });
    }
  }
  if (hvOn && vms.length && !checks.some((c) => c.vm && c.level !== 'ok')) add({ id: 'vms', level: 'ok', title: vms.length === 1 ? `VM ${vms[0].name} em ordem` : `As ${vms.length} VMs estão em ordem` });

  const summary = { fail: checks.filter((c) => c.level === 'fail').length, warn: checks.filter((c) => c.level === 'warn').length };
  return { checks, summary, admin, at: Date.now(), pc: { edition: d.edition, build: d.build, cpu: d.cpu, ram: d.ram, board: d.board, gpus: gpus.map((g) => ({ name: g.name, driver: g.driver, radeon: g.radeon })) } };
}

// ---------------------------------------------------------------- correções
// abre o Piece Helper sozinho (como administrador) quando o Windows voltar do reinício, para continuar
async function scheduleContinue(j) {
  const exe = process.execPath;
  if (!/PieceHelper\.exe$/i.test(exe)) { j.log('(versão de teste: depois de reiniciar, abra o Piece Helper de novo)'); return; }
  const r = await I.runScript(j, `$u = $env:USERDOMAIN + '\\' + $env:USERNAME
$a = New-ScheduledTaskAction -Execute $Exe -Argument '--continuar'
$t = New-ScheduledTaskTrigger -AtLogOn -User $u
$p = New-ScheduledTaskPrincipal -UserId $u -RunLevel Highest -LogonType Interactive
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $Task -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null
'Quando o Windows voltar, o Piece Helper abre sozinho para continuar.'`, { Exe: exe, Task: TASK });
  if (!r.ok) j.log('Não consegui agendar a volta automática: depois de reiniciar, abra o Piece Helper de novo.', 'err');
}
function clearContinue() {
  if (!I.IS_WIN) return;
  execFile('schtasks.exe', ['/Delete', '/TN', TASK, '/F'], { windowsHide: true }, () => {});
}
async function rebootNow(j, firmware) {
  await scheduleContinue(j);
  const args = firmware ? ['/r', '/fw', '/t', '20', '/c', 'Piece Helper: reiniciando direto na BIOS em 20 segundos'] : ['/r', '/t', '20', '/c', 'Piece Helper: reiniciando em 20 segundos para terminar a correção'];
  const ok = await new Promise((r) => execFile('shutdown.exe', args, { windowsHide: true }, (e) => r(!e)));
  if (!ok && firmware) {
    j.log('Este PC não aceita reiniciar direto na BIOS pelo Windows. Ele vai reiniciar normal: aperte a tecla da BIOS (geralmente Del ou F2) repetidamente assim que ligar.', 'err');
    await new Promise((r) => execFile('shutdown.exe', ['/r', '/t', '30', '/c', 'Piece Helper: reiniciando em 30 segundos. Aperte Del ou F2 quando ligar para entrar na BIOS.'], { windowsHide: true }, () => r()));
  }
  j.log('O PC vai reiniciar em alguns segundos. Salve o que estiver aberto.', 'ok');
  j.extra = { ...(j.extra || {}), rebooting: true };
  return true;
}

const fileOf = (u) => decodeURIComponent(new URL(u).pathname.split('/').pop() || 'driver.exe').replace(/[^\w.\-]/g, '_');

// baixa e instala o driver oficial da placa do PC; depois copia o driver novo para as VMs
async function hostDriver(j, gpuId, opts = {}) {
  const d = (await I.psJson(I.ps('diag'), 150000)) || {};
  const g = I.asList(d.gpus).find((x) => x && x.id === gpuId) || I.asList(d.gpus).find((x) => x && x.name && !INTEGRATED.test(x.name) && !VIRTUAL.test(x.name));
  if (!g) { j.log('Não achei a placa de vídeo.', 'err'); return false; }
  const vendor = vendorOf(g);
  j.log(`Driver da ${g.name}`, 'title');
  latestCache.key = '';
  const lat = await latestDriver(g, d);
  let changed = false;
  if ((vendor === 'nvidia' || vendor === 'amd') && lat.url) {
    j.log(`Instalado: ${lat.current || g.driver || '?'} · mais novo: ${lat.latest}`);
    const dir = path.join(I.dirs().tools, 'drivers');
    fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* em uso */ } } // tira os downloads antigos
    const file = path.join(dir, fileOf(lat.url));
    j.log(`Baixando o driver oficial da ${vendor === 'amd' ? 'AMD' : 'NVIDIA'}…`);
    try {
      await I.download(lat.url, file, j, 0.02, 0.6, 0, vendor === 'amd' ? { Referer: AMD_PAGE } : {});
      // o site às vezes devolve uma página de erro no lugar do instalador
      if (fs.statSync(file).size < 50 * 1048576) { fs.unlinkSync(file); throw new Error('o site devolveu uma página em vez do instalador'); }
    } catch (e) {
      j.log(`O download pelo link direto falhou (${e.message}).`, 'err');
      if (vendor === 'amd' && lat.minimal) {
        j.log('Baixando o instalador automático da AMD (ele detecta a placa e baixa o driver certo)…');
        const mf = path.join(dir, fileOf(lat.minimal));
        try { await I.download(lat.minimal, mf, j, 0.02, 0.2, 0, { Referer: AMD_PAGE }); } catch (e2) { j.log(`Também falhou (${e2.message}).`, 'err'); }
        if (fs.existsSync(mf)) {
          j.progress = 0.3;
          const r = await I.runScript(j, I.ps('driver_install'), { Installer: mf, Vendor: 'amd', Mode: 'gui', GpuId: g.id, OldVersion: g.driver || '' });
          changed = !!(r.result && r.result.changed);
        }
      }
    }
    if (!changed && fs.existsSync(file)) {
      j.progress = 0.62;
      const r = await I.runScript(j, I.ps('driver_install'), { Installer: file, Vendor: vendor, Mode: 'silent', GpuId: g.id, OldVersion: g.driver || '' });
      changed = !!(r.result && r.result.changed);
      if (!changed) {
        j.log('A instalação sem telas não trocou o driver. Abrindo o instalador oficial para terminar com você.', 'err');
        const r2 = await I.runScript(j, I.ps('driver_install'), { Installer: file, Vendor: vendor, Mode: 'gui', GpuId: g.id, OldVersion: g.driver || '' });
        changed = !!(r2.result && r2.result.changed);
      }
    }
  }
  if (!changed) {
    // Intel, ou o site do fabricante não respondeu: Windows Update
    j.progress = 0.85;
    const r = await I.runScript(j, I.ps('driver_wu'), {});
    if (r.result && r.result.installed) {
      const after = (await I.psJson(I.ps('diag'), 150000)) || {};
      const g2 = I.asList(after.gpus).find((x) => x && x.id === g.id);
      changed = !!(g2 && g2.driver && g2.driver !== g.driver);
      if (r.result.reboot) j.log('O Windows pediu para reiniciar para terminar a instalação do driver.');
    }
  }
  if (!changed) {
    if (opts.quietIfSame && lat.latest && !lat.outdated) { j.log('O driver já é o mais novo.', 'ok'); return true; }
    j.log(`Não consegui instalar o driver sozinho. Abri a página oficial ${vendor ? 'da ' + vendor.toUpperCase() : 'do fabricante'}: baixe o driver da sua placa lá e instale; depois volte em "Verificar e corrigir" que o Piece Helper atualiza as VMs.`, 'err');
    if (PAGES[vendor]) spawn('cmd.exe', ['/c', 'start', '', PAGES[vendor]], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return false;
  }
  j.log('Driver da placa atualizado no PC.', 'ok');
  latestCache.key = '';
  // copia o driver novo para as VMs que usam a placa
  const s = await I.status();
  for (const v of s.vms.filter((x) => x.gpu)) {
    j.log(`Atualizando os drivers dentro da VM ${v.name}…`, 'title');
    await I.gpuUpdateRun(j, v.name);
  }
  j.progress = 1;
  return true;
}

async function cleanup(j) {
  const d = I.dirs();
  const partials = [];
  for (const dir of [d.iso, d.tools, path.join(d.tools, 'drivers')]) {
    try { for (const f of fs.readdirSync(dir)) if (/\.part$/i.test(f)) partials.push(path.join(dir, f)); } catch { /* */ }
  }
  j.log('Liberando espaço em disco', 'title');
  const r = await I.runScript(j, I.ps('cleanup'), { Recycle: '1', Deep: '1', Partials: partials.join('|') });
  const freed = Object.values((r.result || {}).freed || {}).reduce((a, b) => a + Math.max(0, +b || 0), 0);
  j.log(`Pronto: ${(freed / GB).toFixed(1).replace('.', ',')} GB liberados no total.`, 'ok');
  return r.ok;
}

const VM_SCRIPTS = {
  vmms: "Set-Service vmms -StartupType Automatic\nStart-Service vmms\n'Servico de maquinas virtuais ligado.'\n",
  hyperv: "Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart | Out-Null\n'Hyper-V ligado. Falta reiniciar.'\n",
  hvlaunch: "& bcdedit.exe /set hypervisorlaunchtype auto | Out-Null\nif ($LASTEXITCODE -ne 0) { throw 'O Windows nao deixou mudar a inicializacao do Hyper-V.' }\n'Hyper-V vai ligar junto com o Windows de novo.'\n",
  net: "ipconfig /flushdns | Out-Null\nnetsh winhttp reset proxy | Out-Null\n'Cache de nomes (DNS) limpo e proxy do Windows zerado.'\n",
  vmCheckpoint: "Set-VM -Name $VMName -CheckpointType Disabled -AutomaticCheckpointsEnabled $false\n$s = @(Get-VMSnapshot -VMName $VMName -EA SilentlyContinue)\nif ($s.Count) { 'Juntando ' + $s.Count + ' ponto(s) de verificacao ao disco...'; $s | Remove-VMSnapshot; $t = 0; while (((Get-VM -Name $VMName).Status -match 'Merg|Mescl') -and $t -lt 1800) { Start-Sleep 3; $t += 3 } }\n'Pontos de verificacao desligados.'\n",
  vmNet: "$sw = Get-VMSwitch -Name 'Default Switch' -EA SilentlyContinue\nif (-not $sw) { $sw = Get-VMSwitch | Select-Object -First 1 }\nif (-not $sw) { throw 'Nao achei a rede padrao do Hyper-V (Default Switch). Reinicie o PC e tente de novo.' }\n$na = @(Get-VMNetworkAdapter -VMName $VMName)\nif (-not $na.Count) { Add-VMNetworkAdapter -VMName $VMName -SwitchName $sw.Name } else { Connect-VMNetworkAdapter -VMName $VMName -Name $na[0].Name -SwitchName $sw.Name }\n'Internet da VM ligada na rede ' + $sw.Name + '.'\n",
  vmTools: "Get-VMIntegrationService -VMName $VMName | Where-Object { -not $_.Enabled } | ForEach-Object { Enable-VMIntegrationService -VMName $VMName -Name $_.Name; 'Ligado: ' + $_.Name }\nSet-VMHost -EnableEnhancedSessionMode $true\n'Ferramentas da VM ligadas. Copiar e colar e a tela ajustavel funcionam na proxima vez que abrir a janela da VM.'\n",
  vmFolder: "$root = $Letter + ':\\Piece Helper\\VMs'\nNew-Item -ItemType Directory -Force -Path ($root + '\\Discos') | Out-Null\nSet-VMHost -VirtualMachinePath $root -VirtualHardDiskPath ($root + '\\Discos')\n'As VMs novas vao ficar em ' + $root\n",
};

async function vmRepair(j, name, steamPath) {
  const st = I.loadState(), rv = st[name] || {};
  const s = await I.status();
  const v = s.vms.find((x) => x.name === name);
  if (!v) { j.log(`Não achei a VM ${name}.`, 'err'); return false; }
  let gpuId = rv.gpu_id || v.gpu_id || '';
  const g = s.gpus.find((x) => x.id === gpuId && x.shareable) || (gpuId || v.gpu ? s.gpus.find((x) => x.id === s.default_gpu) : null);
  gpuId = g ? g.id : '';
  j.log(`Consertando a VM ${name} (sem apagar nada)`, 'title');
  const steam = (rv.opts ? rv.opts.steam : true) && !!gpuId;
  const r = await I.runScript(j, I.ps('vm_repair'), { VMName: name, GpuId: gpuId, SteamGlFix: steam ? '1' : '0', HelperSrc: I.helperDir() || '' });
  if (!r.ok) return false;
  const st2 = I.loadState();
  st2[name] = { ...(st2[name] || {}) };
  if (g) Object.assign(st2[name], { gpu_id: g.id, gpu_name: g.name, driver: g.driver, guest_build: (r.result || {}).guest, date: new Date().toISOString(),
    prev: st2[name].prev || { checkpoint: 'Production', autockpt: false, stopAction: 'ShutDown' } });
  I.saveState(st2);
  j.log('VM consertada.', 'ok');
  return true;
}

async function vmGame(j, name, steamPath) {
  const games = I.steamGames(steamPath);
  const st = I.loadState(), rv = st[name] || {};
  const want = new Set((rv.games && rv.games.length ? rv.games.map((x) => x.appid) : [GC_APPID]));
  const list = games.filter((g) => want.has(g.appid));
  if (!list.length) { j.log('Não achei o Grand Chase na Steam deste PC.', 'err'); return false; }
  j.log(`Atualizando ${list.map((g) => g.name).join(', ')} na VM ${name}`, 'title');
  const r = await I.runScript(j, I.ps('game_sync'), { VMName: name, Games: JSON.stringify(list.map((x) => ({ name: x.name, src: x.src, dir: x.dir, manifest: x.manifest, gb: Math.round(x.size / GB * 10) / 10 }))) });
  if (!r.ok) return false;
  const st2 = I.loadState();
  st2[name] = { ...(st2[name] || {}), games: list.map((x) => ({ appid: x.appid, name: x.name, build: I.gameBuild(x) })) };
  I.saveState(st2);
  j.log('Pronto. Na VM, a Steam pode conferir os arquivos uma vez antes de abrir o jogo.', 'ok');
  return true;
}

async function vmRam(j, name) {
  const s = await I.status();
  const v = s.vms.find((x) => x.name === name);
  if (!v) return false;
  const rec = s.recommend;
  j.log(`VM ${name}: memória ${(v.ram / GB).toFixed(0)} GB → ${rec.ram_gb} GB`, 'title');
  return (await I.runScript(j, I.ps('tune'), { VMName: name, Cpus: v.cpus, RamGB: rec.ram_gb })).ok;
}

// roda uma correção dentro de uma tarefa que já existe
async function runFix(j, action, arg, steamPath) {
  switch (action) {
    case 'bios': return rebootNow(j, true);
    case 'reboot': return rebootNow(j, false);
    case 'hyperv': { const r = await I.runScript(j, VM_SCRIPTS.hyperv); if (!r.ok) return false; return rebootNow(j, false); }
    case 'hvlaunch': { const r = await I.runScript(j, VM_SCRIPTS.hvlaunch); if (!r.ok) return false; return rebootNow(j, false); }
    case 'vmms': case 'net': return (await I.runScript(j, VM_SCRIPTS[action])).ok;
    case 'vmFolder': return (await I.runScript(j, VM_SCRIPTS.vmFolder, { Letter: arg })).ok;
    case 'cleanup': return cleanup(j);
    case 'driver': return hostDriver(j, arg);
    case 'driverWu': return (await I.runScript(j, I.ps('driver_wu'), {})).ok;
    case 'vmDrivers': j.log(`Atualizando os drivers da placa na VM ${arg}`, 'title'); return I.gpuUpdateRun(j, arg);
    case 'vmCheckpoint': case 'vmNet': case 'vmTools': return (await I.runScript(j, VM_SCRIPTS[action], { VMName: arg })).ok;
    case 'vmRepair': return vmRepair(j, arg, steamPath);
    case 'vmGame': return vmGame(j, arg, steamPath);
    case 'vmRam': return vmRam(j, arg);
    default: j.log(`Correção desconhecida: ${action}`, 'err'); return false;
  }
}
const FIX_TITLES = { bios: 'Entrar na BIOS', reboot: 'Reiniciar o PC', hyperv: 'Ligar o Hyper-V', hvlaunch: 'Religar o Hyper-V', vmms: 'Ligar o serviço de VMs', net: 'Consertar a conexão',
  vmFolder: 'Mudar onde as VMs ficam', cleanup: 'Liberar espaço', driver: 'Driver da placa de vídeo', driverWu: 'Driver pelo Windows Update', vmDrivers: 'Drivers da VM',
  vmCheckpoint: 'Pontos de verificação da VM', vmNet: 'Internet da VM', vmTools: 'Ferramentas da VM', vmRepair: 'Consertar a VM', vmGame: 'Atualizar o GC da VM', vmRam: 'Memória da VM' };

function fix(action, arg, steamPath) {
  return I.startJob(FIX_TITLES[action] + (arg && /^vm/.test(action) ? ` (${arg})` : ''), (j) => runFix(j, action, arg, steamPath));
}

// "Resolver tudo": tudo o que não precisa reiniciar primeiro; o que reinicia fica por último (e o app volta sozinho)
const ORDER = ['vmms', 'net', 'cleanup', 'vmFolder', 'driver', 'driverWu', 'vmRepair', 'vmDrivers', 'vmCheckpoint', 'vmNet', 'vmTools', 'vmRam', 'vmGame', 'hvlaunch', 'hyperv', 'reboot', 'bios'];
function fixAll(items, steamPath) {
  const list = (items || []).filter((x) => x && x.action && ORDER.includes(x.action))
    .sort((a, b) => ORDER.indexOf(a.action) - ORDER.indexOf(b.action));
  // se o driver do PC vai ser atualizado, ele já atualiza as VMs no fim
  const final = list.filter((x, i) => !(x.action === 'vmDrivers' && list.some((y) => y.action === 'driver')) && list.findIndex((y) => y.action === x.action && y.arg === x.arg) === i);
  const reboots = final.filter((x) => ['hvlaunch', 'hyperv', 'reboot', 'bios'].includes(x.action));
  const steps = final.filter((x) => !reboots.includes(x)).concat(reboots.length ? [reboots.find((x) => x.action === 'bios') || reboots[0]] : []);
  // ligar o Hyper-V e religar também reiniciam: junta num reinício só
  const pre = reboots.filter((x) => x.action === 'hyperv' || x.action === 'hvlaunch');
  return I.startJob('Resolver tudo', async (j) => {
    j.setSteps(steps.map((x) => FIX_TITLES[x.action] + (x.arg && /^vm/.test(x.action) ? ` (${x.arg})` : '')));
    let bad = 0;
    for (let i = 0; i < steps.length; i++) {
      if (j.cancel) return false;
      j.setStep(i);
      const x = steps[i];
      j.log(`— ${i + 1}/${steps.length}: ${FIX_TITLES[x.action]}`, 'title');
      let ok;
      if (reboots.includes(x)) {
        for (const p of pre) { const r = await I.runScript(j, VM_SCRIPTS[p.action]); if (!r.ok) bad++; }
        ok = await rebootNow(j, x.action === 'bios');
      } else ok = await runFix(j, x.action, x.arg, steamPath);
      if (!ok) { bad++; j.log('Essa correção não deu certo; seguindo com as outras.', 'err'); }
    }
    j.setStep(steps.length);
    if (!bad) j.log('Tudo resolvido.', 'ok'); else j.log(`${bad} correção(ões) não deram certo. Veja as mensagens acima ou gere o relatório para o suporte.`, 'err');
    return bad === 0;
  });
}

// ---------------------------------------------------------------- refazer a VM igualzinha
function recreate(name, steamPath) {
  const rv = I.loadState()[name] || {};
  if (!rv.opts) throw new Error('Essa VM não foi criada pelo Piece Helper 1.1 ou mais novo, então não tenho as configurações dela guardadas. Use "Consertar a VM" ou crie uma nova.');
  const opts = { ...rv.opts, name };
  return I.startJob(`Refazer a VM ${name}`, async (j) => {
    j.extra = { retry: { kind: 'create', opts } };
    j.log(`Apagando a VM ${name} e o disco dela para criar de novo com as mesmas configurações`, 'title');
    const r = await I.runScript(j, `$vm = Get-VM -Name $VMName -EA SilentlyContinue
if ($vm) {
  $disks = @(Get-VMHardDiskDrive -VMName $VMName | Where-Object { $_.Path } | ForEach-Object { $_.Path })
  if ($vm.State -ne 'Off') { Stop-VM -Name $VMName -TurnOff -Force }
  Get-VMSnapshot -VMName $VMName -EA SilentlyContinue | Remove-VMSnapshot
  Remove-VM -Name $VMName -Force
  foreach ($d in $disks) { for ($i = 0; $i -lt 5 -and (Test-Path $d); $i++) { Dismount-VHD -Path $d -EA SilentlyContinue; Remove-Item $d -Force -EA SilentlyContinue; Start-Sleep 1 } ; if (Test-Path $d) { throw ('Nao consegui apagar o disco ' + $d + '. Reinicie o PC e tente de novo.') } }
  'VM antiga apagada.'
}`, { VMName: name });
    if (!r.ok) return false;
    const st = I.loadState(); const keep = st[name]; delete st[name]; I.saveState(st);
    const ok = await I.createRun(j, I.resolveGames({ ...opts }, steamPath));
    if (!ok && keep) { const s2 = I.loadState(); s2[name] = s2[name] || { opts: keep.opts }; I.saveState(s2); }
    return ok;
  });
}

// ---------------------------------------------------------------- relatório para o suporte
async function report(desktopDir, appVersion, steamPath) {
  return I.startJob('Relatório para o suporte', async (j) => {
    j.log('Montando o relatório (sem senhas e sem o seu nome de usuário)', 'title');
    const dg = await diagnose(steamPath);
    const s = await I.status();
    const out = path.join(I.dirs().tmp, `relatorio_${Date.now()}`);
    fs.mkdirSync(path.join(out, 'historico'), { recursive: true });
    const L = [];
    const t = new Date();
    L.push(`Relatório do Piece Helper ${appVersion} — ${t.toLocaleString('pt-BR')}`, '');
    const pc = dg.pc || {};
    L.push(`Windows: ${pc.edition || '?'} (build ${pc.build || '?'})`, `Processador: ${pc.cpu || '?'}`, `Memória: ${pc.ram ? Math.round(pc.ram / GB) + ' GB' : '?'}`, `Placa-mãe: ${pc.board || '?'}`);
    for (const g of pc.gpus || []) L.push(`Placa de vídeo: ${g.name} — driver ${g.driver || '?'}${g.radeon ? ` (Adrenalin ${g.radeon})` : ''}`);
    L.push('', 'Verificação:');
    for (const c of dg.checks) L.push(`  [${{ ok: 'OK', warn: 'ATENÇÃO', fail: 'PROBLEMA' }[c.level] || c.level}] ${c.title}`);
    L.push('', 'Máquinas virtuais:');
    if (!s.vms.length) L.push('  nenhuma');
    for (const v of s.vms) L.push(`  ${v.name}: ${v.state}, ${v.cpus} processadores, ${Math.round(v.ram / GB)} GB, placa: ${v.gpu ? (v.gpu_name || 'sim') : 'não'}, drivers: ${v.drivers || '-'}`);
    const st = I.loadState();
    L.push('', 'Configurações guardadas das VMs:');
    for (const [k, v] of Object.entries(st)) if (!k.startsWith('_')) L.push(`  ${k}: ${JSON.stringify({ ...v, opts: v.opts ? { ...v.opts, iso: v.opts.iso ? '(iso própria)' : null } : undefined })}`);
    fs.writeFileSync(path.join(out, 'resumo.txt'), '\uFEFF' + L.join('\r\n'), 'utf8');
    fs.writeFileSync(path.join(out, 'verificacao.json'), JSON.stringify(dg, null, 2), 'utf8');
    try { for (const f of fs.readdirSync(I.dirs().logs).slice(-25)) fs.copyFileSync(path.join(I.dirs().logs, f), path.join(out, 'historico', f)); } catch { /* sem histórico */ }
    const stamp = `${t.getFullYear()}${String(t.getMonth() + 1).padStart(2, '0')}${String(t.getDate()).padStart(2, '0')}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}`;
    const zip = path.join(desktopDir, `Relatorio Piece Helper ${stamp}.zip`);
    const r = await I.runScript(j, I.ps('report'), { OutDir: out, Zip: zip });
    if (!r.ok) return false;
    j.extra = { ...(j.extra || {}), zip, summary: L.slice(0, 40).join('\n') };
    j.log('Relatório salvo na sua área de trabalho. Mande esse arquivo .zip para a staff no Discord.', 'ok');
    return true;
  });
}

module.exports = { diagnose, fix, fixAll, recreate, report, clearContinue, _test: { nvCurrent, nvClean, cmpVer, biosHelp } };

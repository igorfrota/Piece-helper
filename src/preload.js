const { contextBridge, ipcRenderer } = require('electron');

const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('piece', {
  info: () => call('app:info'),
  list: (pid) => call('acc:list', pid),
  presence: (steamId) => call('steam:presence', steamId),
  switchTo: (pid, id, opts) => call('acc:switch', pid, id, opts),
  addNew: (pid) => call('acc:add', pid),
  saveCurrent: (pid, name, id) => call('acc:save', pid, name, id),
  forget: (pid, id) => call('acc:forget', pid, id),
  closePlatform: (pid) => call('acc:close', pid),
  startPlatform: (pid, opts) => call('acc:start', pid, opts),
  setMeta: (pid, id, patch) => call('meta:set', pid, id, patch),
  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  pickExe: (title) => call('dialog:pickExe', title),
  pickFolder: (title) => call('dialog:pickFolder', title),
  openPath: (p) => call('shell:openPath', p),
  elevate: () => call('app:elevate'),
  vm: {
    status: () => call('vm:status'),
    gpuSetup: (name, gpuId) => call('vm:gpuSetup', name, gpuId),
    gpuUpdate: (name) => call('vm:gpuUpdate', name),
    gpuRemove: (name) => call('vm:gpuRemove', name),
    tune: (name, cpus, ram) => call('vm:tune', name, cpus, ram),
    tuneUndo: (name) => call('vm:tuneUndo', name),
    power: (name, on) => call('vm:power', name, on),
    open: (name, edit) => call('vm:open', name, edit),
    manager: () => call('vm:manager'),
    installHelper: (name) => call('vm:installHelper', name),
    hypervEnable: () => call('vm:hypervEnable'),
    reboot: () => call('vm:reboot'),
    isoInfo: () => call('vm:isoInfo'),
    pickIso: () => call('vm:pickIso'),
    create: (opts) => call('vm:create', opts),
  },
  job: { poll: (id, since) => call('job:poll', id, since), cancel: (id) => call('job:cancel', id) },
  win: {
    min: () => ipcRenderer.send('win:min'),
    max: () => ipcRenderer.send('win:max'),
    close: () => ipcRenderer.send('win:close'),
  },
  on: (ch, fn) => {
    const ok = ['accounts:changed', 'win:state'];
    if (ok.includes(ch)) ipcRenderer.on(ch, (_e, d) => fn(d));
  },
});

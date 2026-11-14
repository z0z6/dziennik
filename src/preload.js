'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const call = async (channel, ...args) => {
  const r = await ipcRenderer.invoke(channel, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.data;
};

contextBridge.exposeInMainWorld('api', {
  info: () => call('app:info'),
  windowControl: (a) => call('window:control', a),
  getSettings: () => call('settings:get'),
  setSettings: (patch) => call('settings:set', patch),
  documentInfo: () => call('document:info'),
  pickTemplate: () => call('document:pickTemplate'),
  resetTemplate: () => call('document:resetTemplate'),
  importHistory: () => call('history:import'),
  setApiKey: (k) => call('apikey:set', k),
  testAi: () => call('ai:test'),
  browseClaude: () => call('ai:browseClaude'),
  getMonth: (key) => call('month:get', key),
  updateDay: (date, patch) => call('day:update', date, patch),
  setDayOff: (date, value) => call('dayoff:set', date, value),
  analyzeAttendance: (key, images) => call('attendance:analyze', key, images),
  applyAttendance: (key, proposed) => call('attendance:apply', key, proposed),
  generateTopics: (dates) => call('topics:generate', dates),
  exportDocx: (opts) => call('export:docx', opts),
  showFile: (p) => call('shell:showFile', p),
  openFile: (p) => call('shell:openFile', p),
  openExternal: (u) => call('shell:openExternal', u),
  agentStatus: () => call('agent:status'),
  agentRun: () => call('agent:run'),
  occasions: (from, to) => call('occasions:list', from, to),
  on: (channel, fn) => {
    const allowed = ['agent:status', 'topics:progress', 'data:changed', 'window:state'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});

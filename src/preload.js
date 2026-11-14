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
  claudeStatus: () => call('claude:status'),
  claudeInstall: () => call('claude:install'),
  claudeLogin: () => call('claude:login'),
  claudeCode: (code) => call('claude:code', code),
  claudeCancel: () => call('claude:cancel'),
  claudeLogout: () => call('claude:logout'),
  browseClaude: () => call('ai:browseClaude'),
  getMonth: (key) => call('month:get', key),
  updateDay: (date, patch) => call('day:update', date, patch),
  setDayOff: (date, value) => call('dayoff:set', date, value),
  analyzeAttendance: (key, images) => call('attendance:analyze', key, images),
  applyAttendance: (key, proposed) => call('attendance:apply', key, proposed),
  generateTopics: (dates) => call('topics:generate', dates),
  analyzeParticipants: (key, images) => call('participants:analyze', key, images),
  applyParticipants: (key, rows) => call('participants:apply', key, rows),
  participantsMatrix: (key) => call('participants:matrix', key),
  participantsRoster: () => call('participants:roster'),
  setPresence: (date, id, present) => call('participants:setPresence', date, id, present),
  updatePerson: (id, patch) => call('participants:updatePerson', id, patch),
  addPerson: (name) => call('participants:addPerson', name),
  removePerson: (id) => call('participants:removePerson', id),
  presentOn: (date) => call('participants:presentOn', date),
  assignGroups: (dates, opts) => call('groups:assign', dates, opts),
  setGroup: (date, ids) => call('groups:set', date, ids),
  exportDocx: (opts) => call('export:docx', opts),
  showFile: (p) => call('shell:showFile', p),
  openFile: (p) => call('shell:openFile', p),
  openExternal: (u) => call('shell:openExternal', u),
  agentStatus: () => call('agent:status'),
  agentRun: () => call('agent:run'),
  occasions: (from, to) => call('occasions:list', from, to),
  on: (channel, fn) => {
    const allowed = ['agent:status', 'topics:progress', 'participants:progress', 'data:changed', 'window:state', 'claude:log', 'claude:login'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  }
});

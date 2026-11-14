'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Notification, Tray, Menu, nativeImage, nativeTheme, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');

const { Store } = require('./store');
const { Calendar, monthKey } = require('./calendar');
const { Journal, labelFor } = require('./journal');
const { Participants } = require('./participants');
const { Agent } = require('./agent');
const { TopicsService } = require('./topics-service');
const { ClaudeCodeProvider, ApiProvider, findClaude } = require('./ai/providers');
const { analyzeAttendance, analyzeParticipantsAttendance } = require('./ai/tasks');
const { Template } = require('./template-docx');

app.setName('Dziennik WTZ');
app.commandLine.appendSwitch('lang', 'pl'); // 24-godzinny zegar i polskie daty w polach formularzy
if (process.platform === 'win32') app.setAppUserModelId('pl.z0z6.dziennikwtz');

// Wersja portable (Windows): dane obok pliku .exe
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR;
const dataDir = process.env.DZIENNIK_DATA_DIR || (portableDir ? path.join(portableDir, 'Dziennik WTZ - dane') : path.join(app.getPath('userData'), 'dane'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let win = null;
let tray = null;
let quitting = false;
let store, calendar, journal, agent, topics, participants;

const secretsFile = () => path.join(dataDir, 'klucz.bin');

function getApiKey() {
  try {
    const raw = fs.readFileSync(secretsFile());
    if (raw.slice(0, 4).toString() === 'b64:') return Buffer.from(raw.slice(4).toString(), 'base64').toString('utf8');
    return safeStorage.decryptString(raw);
  } catch (_) { return null; }
}

function setApiKey(key) {
  if (!key) { try { fs.unlinkSync(secretsFile()); } catch (_) { /* brak */ } return; }
  if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(secretsFile(), safeStorage.encryptString(key));
  else fs.writeFileSync(secretsFile(), 'b64:' + Buffer.from(key, 'utf8').toString('base64'));
}

function getProvider() {
  const s = store.settings;
  return s.ai.provider === 'api' ? new ApiProvider(s, getApiKey) : new ClaudeCodeProvider(s);
}

function emit(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function notify(title, body) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconPath() });
  n.on('click', () => showWindow());
  n.show();
}

function iconPath() { return path.join(__dirname, '..', 'assets', 'icon.png'); }
function builtInTemplate() { return path.join(__dirname, '..', 'assets', 'wzor-dziennika.docx'); }
function templatePath() {
  const p = store.settings.document.templatePath;
  return p && fs.existsSync(p) ? p : builtInTemplate();
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1000,
    minHeight: 660,
    show: false,
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1e1e' : '#f5f5f7',
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    }
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  if (process.env.DZIENNIK_SHOTS) win.webContents.on('console-message', (...a) => { const e = a[0]; console.log('[renderer]', e && e.message ? e.message : a.slice(1).join(' ')); });
  if (process.env.DZIENNIK_SHOTS) win.webContents.once('did-finish-load', () => devScreenshots(process.env.DZIENNIK_SHOTS));
  win.on('close', (e) => {
    if (!quitting && store.settings.agent.runInBackground && tray) {
      e.preventDefault();
      win.hide();
      if (!store.data.notified.trayHint) {
        store.data.notified.trayHint = true; store.save();
        notify('Dziennik WTZ działa w tle', 'Agent dalej pilnuje kalendarza. Aplikację zamkniesz z menu ikony w zasobniku.');
      }
    }
  });
  win.on('maximize', () => emit('window:state', { maximized: true }));
  win.on('unmaximize', () => emit('window:state', { maximized: false }));
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

// Tryb deweloperski: zrzuty ekranu wszystkich widoków (DZIENNIK_SHOTS=katalog)
async function devScreenshots(dir) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  fs.mkdirSync(dir, { recursive: true });
  const steps = (process.env.DZIENNIK_STEPS || 'dashboard').split(',');
  await wait(1500);
  for (const step of steps) {
    const [name, js] = step.split('=');
    if (js) await win.webContents.executeJavaScript(decodeURIComponent(js)).catch((e) => console.error(e));
    await wait(900);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
  }
  quitting = true;
  app.quit();
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(iconPath()).resize({ width: 22, height: 22 });
    tray = new Tray(img);
    tray.setToolTip('Dziennik WTZ');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Otwórz Dziennik WTZ', click: showWindow },
      { label: 'Uruchom agenta teraz', click: () => agent.tick(true) },
      { type: 'separator' },
      { label: 'Zakończ', click: () => { quitting = true; app.quit(); } }
    ]));
    tray.on('click', showWindow);
  } catch (_) { tray = null; }
}

// ─────────────────────────── IPC ───────────────────────────

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (err) { return { ok: false, error: err.message || String(err) }; }
  });
}

function registerIpc() {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    dataDir,
    portable: !!portableDir,
    today: new Date().toISOString(),
    currentMonth: monthKey(new Date())
  }));

  handle('window:control', (action) => {
    if (!win) return;
    if (action === 'close') win.close();
    else if (action === 'minimize') win.minimize();
    else if (action === 'maximize') (win.isMaximized() ? win.unmaximize() : win.maximize());
    return win.isMaximized();
  });

  handle('settings:get', () => ({ settings: store.settings, hasApiKey: !!getApiKey(), claudePath: findClaude(store.settings.ai.claudePath) }));
  handle('settings:set', (patch) => {
    const s = store.updateSettings(patch);
    if (patch && patch.agent) agent.start();
    if (patch && patch.ui && patch.ui.theme) nativeTheme.themeSource = patch.ui.theme;
    return s;
  });
  handle('apikey:set', (key) => { setApiKey((key || '').trim()); return !!getApiKey(); });
  handle('ai:test', async () => getProvider().test());
  handle('ai:browseClaude', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Wskaż program Claude Code', properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    store.updateSettings({ ai: { claudePath: r.filePaths[0] } });
    return r.filePaths[0];
  });

  handle('month:get', (key) => journal.monthView(key || monthKey(new Date())));
  handle('day:update', (date, patch) => { const r = journal.updateDay(date, patch); emit('data:changed', { month: date.slice(0, 7) }); return r; });
  handle('dayoff:set', (date, value) => {
    if (value) store.data.daysOff[date] = value; else delete store.data.daysOff[date];
    store.save();
    return store.data.daysOff;
  });

  handle('attendance:analyze', async (key, images) => {
    if (!images || !images.length) throw new Error('Nie wybrano zdjęcia.');
    const result = await analyzeAttendance(getProvider(), { images, monthKey: key, expectedName: store.settings.profile.name });
    const review = journal.reviewAttendance(key, result);
    store.log('attendance', `Przeanalizowano zdjęcie listy obecności (${images.length} ${images.length === 1 ? 'strona' : 'strony'}) za ${labelFor(key)}.`);
    return { ...review, raw: { month: result.month, employeeName: result.employeeName } };
  });
  handle('attendance:apply', (key, proposed) => {
    journal.applyAttendance(key, proposed, { days: proposed.filter((p) => p.present).length });
    journal.autoAssignMonth(key);
    const r = journal.monthView(key);
    emit('data:changed', { month: key });
    return r;
  });

  // ── uczestnicy ──
  handle('participants:analyze', async (key, images) => {
    if (!images || !images.length) throw new Error('Nie wybrano zdjęcia.');
    // każde zdjęcie osobno (zwykle 1 zdjęcie = karta 1 uczestnika), maks. 3 równolegle; wyniki łączone
    const results = new Array(images.length);
    let next = 0, done = 0;
    const provider = getProvider();
    const worker = async () => {
      while (next < images.length) {
        const i = next++;
        try { results[i] = await analyzeParticipantsAttendance(provider, { images: [images[i]], monthKey: key }); } catch (e) { results[i] = { error: e.message }; }
        done++;
        emit('participants:progress', { done, total: images.length });
      }
    };
    await Promise.all([worker(), worker(), worker()].slice(0, Math.min(3, images.length)));
    const errors = results.map((r, i) => (r && r.error ? `Zdjęcie ${i + 1}: ${r.error}` : null)).filter(Boolean);
    const ok = results.filter((r) => r && !r.error);
    if (!ok.length) throw new Error(errors[0] || 'Nie udało się odczytać zdjęć.');
    const merged = [];
    const { normalize } = require('./participants');
    for (const r of ok) {
      for (const p of r.participants) {
        const same = merged.find((m) => normalize(m.name) === normalize(p.name));
        if (!same) { merged.push({ ...p }); continue; }
        for (const [k, days] of Object.entries(p.months)) same.months[k] = [...new Set([...(same.months[k] || []), ...days])].sort((a, b) => a - b);
        for (const [k, days] of Object.entries(p.uncertain || {})) same.uncertain[k] = [...new Set([...(same.uncertain[k] || []), ...days])];
      }
    }
    const out = {
      legend: [...new Set(ok.map((r) => r.legend).filter(Boolean))].slice(0, 2).join(' | '),
      breaks: [...new Set(ok.flatMap((r) => r.breaks || []))],
      warnings: [...errors, ...ok.flatMap((r) => r.warnings || [])],
      participants: merged.map((p) => {
        const m = participants.match(p.name);
        return { ...p, matched: m ? { id: m.id, name: `${m.firstName} ${m.lastName}`.trim() } : null };
      })
    };
    store.log('participants', `Odczytano listy obecności uczestników: ${merged.length} osób z ${images.length} zdjęć.`);
    return out;
  });
  handle('participants:apply', (key, rows) => {
    const r = participants.applyMonths(rows);
    let assigned = 0; const warnings = [];
    for (const k of r.months) { const a = journal.autoAssignMonth(k); if (a) { assigned += a.assigned; warnings.push(...a.warnings); } }
    emit('data:changed', { month: key });
    return { ...r, assigned, warnings };
  });
  handle('participants:matrix', (key) => participants.monthMatrix(key));
  handle('participants:roster', () => participants.roster);
  handle('participants:setPresence', (date, id, present) => { participants.setPresence(date, id, present); return true; });
  handle('participants:updatePerson', (id, patch) => participants.updatePerson(id, patch));
  handle('participants:addPerson', (name) => { const p = participants.upsert(name); store.save(); return p; });
  handle('participants:removePerson', (id) => { participants.removePerson(id); return true; });
  handle('participants:presentOn', (date) => participants.presentOn(date));
  handle('groups:assign', (dates, opts) => { const r = journal.assignGroups(dates, opts || {}); emit('data:changed', {}); return r; });
  handle('groups:set', (date, ids) => { const r = journal.updateDay(date, { group: ids, groupWarning: '' }); emit('data:changed', {}); return r; });

  handle('topics:generate', async (dates) => {
    const r = await topics.generate(dates);
    emit('data:changed', {});
    return r;
  });

  handle('document:info', async () => {
    const p = templatePath();
    const tpl = await Template.load(fs.readFileSync(p));
    const labels = ['date', 'participant', 'topic', 'signature', 'notes', 'time', 'hours', 'other'];
    return {
      builtIn: p === builtInTemplate(),
      path: p,
      roles: tpl.roles.filter((r) => labels.includes(r)),
      lastJournalPath: store.settings.document.lastJournalPath || ''
    };
  });
  handle('document:pickTemplate', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Wybierz wzór dziennika (.docx)', filters: [{ name: 'Dokument Word', extensions: ['docx'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    await Template.load(fs.readFileSync(r.filePaths[0])); // walidacja
    store.updateSettings({ document: { templatePath: r.filePaths[0] } });
    return r.filePaths[0];
  });
  handle('document:resetTemplate', () => { store.updateSettings({ document: { templatePath: '' } }); return true; });

  handle('history:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Wskaż dotychczasowy dziennik (.docx)', filters: [{ name: 'Dokument Word', extensions: ['docx'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const tpl = await Template.load(fs.readFileSync(r.filePaths[0]));
    const rows = tpl.readEntries();
    if (!rows.length) throw new Error('W pliku nie znaleziono wpisów z datami.');
    const seen = {}; const duplicates = [];
    for (const r of rows) { if (seen[r.date]) duplicates.push(r.date); seen[r.date] = true; }
    const res = journal.importHistory(rows);
    if (!store.settings.document.lastJournalPath) store.updateSettings({ document: { lastJournalPath: r.filePaths[0] } });
    emit('data:changed', {});
    return { ...res, from: rows[0].date, to: rows[rows.length - 1].date, duplicates };
  });

  handle('export:docx', async (opts) => {
    const { mode = 'append', from, to, replaceExisting = true, existing } = opts || {};
    const entries = journal.entriesInRange(from, to);
    if (!entries.length) throw new Error('Brak wpisów w wybranym okresie – najpierw wyślij listę obecności lub dodaj dni ręcznie.');
    const missing = entries.filter((e) => !e.absent && !(e.topic && (e.topic.items || []).length));
    let sourcePath;
    if (mode === 'append') {
      const last = store.settings.document.lastJournalPath;
      const pick = await dialog.showOpenDialog(win, {
        title: 'Wybierz dziennik, do którego dopisać wpisy',
        defaultPath: last && fs.existsSync(last) ? last : app.getPath('documents'),
        filters: [{ name: 'Dokument Word', extensions: ['docx'] }],
        properties: ['openFile']
      });
      if (pick.canceled || !pick.filePaths[0]) return null;
      sourcePath = pick.filePaths[0];
    } else {
      sourcePath = templatePath();
    }
    const tpl = await Template.load(fs.readFileSync(sourcePath));
    const { buffer, stats } = await tpl.build({ entries, fmt: store.settings.document.format, mode, replaceExisting, existing });
    const defName = mode === 'append' ? sourcePath : path.join(app.getPath('documents'), `Dziennik psychologa ${from}${from !== to ? '_' + to : ''}.docx`);
    const save = await dialog.showSaveDialog(win, { title: 'Zapisz dziennik', defaultPath: defName, filters: [{ name: 'Dokument Word', extensions: ['docx'] }] });
    if (save.canceled || !save.filePath) return null;
    let backup = null;
    if (fs.existsSync(save.filePath)) {
      const st = new Date();
      const stamp = `${st.getFullYear()}-${String(st.getMonth() + 1).padStart(2, '0')}-${String(st.getDate()).padStart(2, '0')} ${String(st.getHours()).padStart(2, '0')}${String(st.getMinutes()).padStart(2, '0')}`;
      backup = save.filePath.replace(/\.docx$/i, '') + ` (kopia ${stamp}).docx`;
      fs.copyFileSync(save.filePath, backup);
    }
    fs.writeFileSync(save.filePath, buffer);
    if (mode === 'append') store.updateSettings({ document: { lastJournalPath: save.filePath } });
    const months = [...new Set(entries.map((e) => e.date.slice(0, 7)))];
    for (const k of months) store.month(k).exportedAt = new Date().toISOString();
    store.save();
    store.log('export', `Zapisano dziennik (${mode === 'append' ? 'dopisano' : 'nowy'}): +${stats.added}, zastąpiono ${stats.replaced}, uzupełniono uczestników ${stats.filled || 0}, pominięto ${stats.skipped} – ${path.basename(save.filePath)}`);
    return { path: save.filePath, stats, backup, missingTopics: missing.map((e) => e.date) };
  });
  handle('shell:showFile', (p) => shell.showItemInFolder(p));
  handle('shell:openFile', (p) => shell.openPath(p));
  handle('shell:openExternal', (url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

  handle('agent:status', () => agent.status());
  handle('agent:run', async () => { await agent.tick(true); return agent.status(); });
  handle('occasions:list', (from, to) => calendar.occasionsInRange(new Date(from), new Date(to)));
}

app.on('second-instance', () => showWindow());

app.whenReady().then(() => {
  store = new Store(dataDir);
  nativeTheme.themeSource = store.settings.ui.theme || 'system';
  calendar = new Calendar(store);
  participants = new Participants(store);
  journal = new Journal(store, calendar, participants);
  topics = new TopicsService({ store, calendar, journal, getProvider, emit });
  agent = new Agent({ store, calendar, journal, getProvider, notify, emit, topicsService: topics });
  registerIpc();
  createWindow();
  createTray();
  agent.start();
  app.on('activate', showWindow);
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => {
  if (!store || !store.settings.agent.runInBackground || !tray) app.quit();
});

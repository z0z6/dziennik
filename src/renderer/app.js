'use strict';
/* global UI, icon */
const { h, iconEl, toast, sheet, toggle, segmented, select, spinner, group, row, busy } = UI;
// window.api – most z procesem głównym (preload.js)

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_SHORT = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const WD = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
const WD_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb'];

const state = {
  info: null,
  settings: null,
  hasApiKey: false,
  claudePath: null,
  view: 'dashboard',
  month: null,
  monthData: null,
  agent: null,
  attendance: { images: [], review: null, analyzing: false, month: null },
  generating: null, // { done, total }
  journalFilter: 'entries',
  editing: {}, // date -> true
  settingsTab: 'general',
  docInfo: null
};

// ───────────────────────── narzędzia ─────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const shiftMonth = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
const fmtH = (n) => (Math.round(Number(n || 0) * 100) / 100).toString().replace('.', ',');
const todayIso = () => iso(new Date());
const plural = (n, a, b, c) => { if (n === 1) return a; const d = n % 10, t = n % 100; return d >= 2 && d <= 4 && !(t >= 12 && t <= 14) ? b : c; };
const longDate = (s) => { const d = parseIso(s); return `${WD[d.getDay()]}, ${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`; };
const monthBounds = (key) => { const [y, m] = key.split('-').map(Number); return { from: `${key}-01`, to: `${key}-${pad(new Date(y, m, 0).getDate())}` }; };

function errToast(e) { toast(e.message || String(e), 'error', 7000); }

function bulletsEl(items) {
  return h('ul', { class: 'bullets' }, items.map((it) => {
    const m = String(it).match(/^(\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2})\s*\|\s*([\s\S]*)$/);
    return m ? h('li', null, h('span', { class: 'slot' }, m[1]), ' ', m[2]) : h('li', null, it);
  }));
}

// ───────────────────────── start ─────────────────────────
async function init() {
  state.info = await api.info();
  document.body.classList.add('platform-' + state.info.platform);
  state.month = state.info.currentMonth;
  state.attendance.month = state.info.currentMonth;
  await loadSettings();
  await Promise.all([loadMonth(), loadAgent()]);

  document.querySelectorAll('#traffic .tl').forEach((b) => b.addEventListener('click', () => api.windowControl(b.dataset.act)));
  document.querySelector('.titlebar').addEventListener('dblclick', (e) => { if (!e.target.closest('.traffic')) api.windowControl('maximize'); });
  window.addEventListener('blur', () => document.body.classList.add('window-blur'));
  window.addEventListener('focus', () => document.body.classList.remove('window-blur'));
  document.getElementById('content').addEventListener('scroll', (e) => e.target.classList.toggle('scrolled', e.target.scrollTop > 4));

  api.on('agent:status', (s) => { state.agent = s; renderSidebar(); if (state.view === 'dashboard') render(); });
  api.on('topics:progress', (p) => { state.generating = p.done < p.total ? p : null; if (state.view === 'journal') render(); });
  api.on('data:changed', async () => { await loadMonth(); if (state.view !== 'attendance') render(); else renderSidebar(); });
  render();
}

async function loadSettings() {
  const r = await api.getSettings();
  state.settings = r.settings;
  state.hasApiKey = r.hasApiKey;
  state.claudePath = r.claudePath;
}
async function loadMonth() { state.monthData = await api.getMonth(state.month); }
async function loadAgent() { state.agent = await api.agentStatus(); }

async function saveSettings(patch, quiet) {
  try {
    state.settings = await api.setSettings(patch);
    if (!quiet) toast('Zapisano ustawienia', 'success', 1600);
  } catch (e) { errToast(e); }
}

function go(view, opts = {}) {
  state.view = view;
  if (opts.month) { state.month = opts.month; loadMonth().then(render); }
  render();
  document.getElementById('content').scrollTop = 0;
}

// ───────────────────────── pasek boczny ─────────────────────────
function renderSidebar() {
  const sb = document.getElementById('sidebar');
  const st = state.monthData ? state.monthData.stats : null;
  const missing = st ? st.presentDays - st.withTopic : 0;
  const items = [
    ['dashboard', 'home', 'Pulpit'],
    ['attendance', 'camera', 'Lista obecności'],
    ['journal', 'book', 'Dziennik', missing > 0 ? missing : null],
    ['calendar', 'calendar', 'Kalendarz']
  ];
  const ag = state.agent || {};
  const dotCls = !ag.enabled ? 'off' : ag.running ? 'busy' : ag.lastError ? 'err' : '';
  const agText = !ag.enabled ? 'Agent wyłączony' : ag.running ? 'Agent pracuje…' : ag.lastError ? 'Agent: problem' : 'Agent aktywny';
  const agSub = ag.lastError ? ag.lastError.slice(0, 60) : ag.lastRun ? 'Ostatnio ' + new Date(ag.lastRun).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) : 'Czeka na pierwsze uruchomienie';
  sb.replaceChildren(
    h('div', { class: 'brand' },
      h('div', { class: 'brand-logo', html: icon('book', 20) }),
      h('div', null, h('div', { class: 'brand-name' }, 'Dziennik WTZ'), h('div', { class: 'brand-sub' }, 'Psycholog'))),
    h('div', { class: 'nav-section' }, 'Praca'),
    ...items.map(([v, ic, label, badge]) => h('div', { class: 'nav-item' + (state.view === v ? ' active' : ''), onclick: () => go(v) },
      h('span', { html: icon(ic, 17) }), label, badge ? h('span', { class: 'nav-badge' }, badge) : null)),
    h('div', { class: 'nav-section' }, 'Aplikacja'),
    h('div', { class: 'nav-item' + (state.view === 'settings' ? ' active' : ''), onclick: () => go('settings') }, h('span', { html: icon('gear', 17) }), 'Ustawienia'),
    h('div', { class: 'sidebar-spacer' }),
    h('div', { class: 'agent-pill', title: 'Kliknij, aby uruchomić agenta teraz', onclick: runAgent },
      h('span', { class: 'agent-dot ' + dotCls }),
      h('div', { style: { minWidth: 0 } }, h('div', { class: 't1' }, agText), h('div', { class: 't2' }, agSub)))
  );
}

async function runAgent() {
  try {
    toast('Agent sprawdza kalendarz i dni okolicznościowe…', 'info', 2500);
    state.agent = await api.agentRun();
    renderSidebar();
    if (state.view === 'dashboard' || state.view === 'calendar') render();
    if (state.agent.lastError) toast(state.agent.lastError, 'error', 7000); else toast('Agent zakończył pracę', 'success', 2000);
  } catch (e) { errToast(e); }
}

// ───────────────────────── render ─────────────────────────
function render() {
  renderSidebar();
  const c = document.getElementById('content');
  const views = { dashboard: viewDashboard, attendance: viewAttendance, journal: viewJournal, calendar: viewCalendar, settings: viewSettings };
  const el = views[state.view]();
  el.classList.add('fade-in');
  c.replaceChildren(el);
  document.getElementById('window-title').textContent = { dashboard: 'Pulpit', attendance: 'Lista obecności', journal: 'Dziennik', calendar: 'Kalendarz', settings: 'Ustawienia' }[state.view] + ' — Dziennik WTZ';
}

function monthNav(onChange) {
  return h('div', { class: 'segmented', style: { alignItems: 'center' } },
    h('button', { title: 'Poprzedni miesiąc', onclick: () => onChange(-1), html: icon('chevronL', 14) }),
    h('button', { class: 'active', style: { minWidth: '140px', justifyContent: 'center' }, onclick: () => onChange(0) }, monthLabel(state.month)),
    h('button', { title: 'Następny miesiąc', onclick: () => onChange(1), html: icon('chevronR', 14) }));
}

async function changeMonth(n) {
  state.month = n === 0 ? state.info.currentMonth : shiftMonth(state.month, n);
  await loadMonth();
  render();
}

// ───────────────────────── PULPIT ─────────────────────────
function viewDashboard() {
  const st = state.monthData.stats;
  const name = (state.settings.profile.name || '').split(' ')[0];
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Dobry wieczór' : hour < 18 ? 'Dzień dobry' : 'Dobry wieczór';
  const missing = st.presentDays - st.withTopic;
  const ag = state.agent || { alerts: [], upcoming: [] };
  const pct = st.presentDays ? Math.round((st.withTopic / st.presentDays) * 100) : 0;
  const alertIcon = { flag: 'flag', calendar: 'calendar', sparkles: 'sparkles', camera: 'camera', doc: 'doc' };

  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Pulpit'), h('div', { class: 'spacer' }), monthNav(changeMonth)),
    h('div', { class: 'page' },
      h('div', { class: 'hello' }, h('h1', null, `${greet}${name ? ', ' + name : ''}`), h('p', null, longDate(todayIso()).replace(/^./, (c) => c.toUpperCase()))),
      h('div', { class: 'grid grid-3', style: { marginBottom: '16px' } },
        h('div', { class: 'hero blue', onclick: () => go('attendance') },
          h('div', { class: 'hero-ic', html: icon('camera', 22) }),
          h('div', null, h('h3', null, 'Wyślij listę obecności'), h('p', null, st.attendanceUploaded ? `Lista za ${state.monthData.label} jest już wczytana – możesz wysłać nową.` : 'Zrób zdjęcie podpisanej listy – agent odczyta dni i godziny.'))),
        h('div', { class: 'hero purple', onclick: () => go('journal') },
          h('div', { class: 'hero-ic', html: icon('sparkles', 22) }),
          h('div', null, h('h3', null, 'Tematy zajęć'), h('p', null, missing > 0 ? `${missing} ${plural(missing, 'dzień czeka', 'dni czekają', 'dni czeka')} na temat – wygeneruj 3 propozycje.` : st.presentDays ? 'Wszystkie dni mają tematy. Świetna robota!' : 'Po wczytaniu listy agent zaproponuje tematy.'))),
        h('div', { class: 'hero green', onclick: openExport },
          h('div', { class: 'hero-ic', html: icon('doc', 22) }),
          h('div', null, h('h3', null, 'Eksportuj dziennik'), h('p', null, st.exportedAt ? 'Ostatni eksport: ' + new Date(st.exportedAt).toLocaleDateString('pl-PL') : 'Dopisz miesiąc do dziennika .docx w Twoim formacie.')))),
      h('div', { class: 'grid grid-4', style: { marginBottom: '16px' } },
        statCard('Dni obecności', st.presentDays, `z ${st.workdays} roboczych`, 'checkCircle'),
        statCard('Godziny pracy', fmtH(st.hours), 'h', 'clock'),
        h('div', { class: 'card stat' },
          h('div', { class: 'label', html: icon('book', 14) + ' Wpisy z tematem' }),
          h('div', { class: 'value' }, `${st.withTopic}`, h('small', null, `/ ${st.presentDays}`)),
          h('div', { class: 'progress' }, h('div', { style: { width: pct + '%' } }))),
        statCard('Urlopy i dni wolne', st.absentDays, plural(st.absentDays, 'dzień', 'dni', 'dni'), 'flag')),
      h('div', { class: 'grid grid-2' },
        h('div', { class: 'card card-pad' },
          h('div', { class: 'card-title' }, h('span', { html: icon('bolt', 16) }), 'Agent', h('span', { class: 'spacer' }),
            h('button', { class: 'btn sm', onclick: runAgent }, iconEl('refresh', 13), 'Sprawdź teraz')),
          ag.alerts.length ? ag.alerts.map((a) => h('div', { class: 'alert ' + a.level },
            h('div', { class: 'a-ic', html: icon(alertIcon[a.icon] || 'info', 15) }),
            h('div', { class: 'a-text' }, a.text),
            a.action ? h('div', { class: 'a-act' }, h('button', { class: 'btn plain sm', onclick: () => go(a.action.view, a.action) }, 'Pokaż')) : null))
            : h('div', { class: 'empty' }, iconEl('checkCircle', 28), h('p', { style: { marginTop: '8px' } }, 'Wszystko w porządku – brak zadań do zrobienia.'))),
        h('div', { class: 'card card-pad' },
          h('div', { class: 'card-title' }, h('span', { html: icon('calendar', 16) }), 'Nadchodzące'),
          ag.upcoming.length ? ag.upcoming.map((u) => {
            const d = parseIso(u.date);
            return h('div', { class: 'up-item' },
              h('div', { class: 'date-badge' }, h('div', { class: 'm' }, MONTHS_SHORT[d.getMonth()]), h('div', { class: 'd' }, d.getDate())),
              h('div', { style: { minWidth: 0 } }, h('div', { style: { fontWeight: 550 } }, u.name),
                h('div', { class: 'kind' }, h('span', { class: 'dot ' + u.kind }), { holiday: 'Święto – dzień wolny', occasion: 'Dzień okolicznościowy', dayoff: 'Twój dzień wolny' }[u.kind], ' · ', WD[d.getDay()])));
          }) : h('div', { class: 'empty' }, 'Brak wydarzeń w najbliższym czasie.')))));
}

function statCard(label, value, unit, ic) {
  return h('div', { class: 'card stat' },
    h('div', { class: 'label', html: icon(ic, 14) + ' ' + label }),
    h('div', { class: 'value' }, String(value), h('small', null, unit)));
}

// ───────────────────────── LISTA OBECNOŚCI ─────────────────────────
const fileInput = h('input', { type: 'file', accept: 'image/*', multiple: true, style: { display: 'none' } });
document.body.appendChild(fileInput);
fileInput.addEventListener('change', () => { addImages([...fileInput.files]); fileInput.value = ''; });

async function prepareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name}: to nie jest zdjęcie.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(`${file.name}: nie mogę otworzyć tego formatu (HEIC zapisz jako JPG).`)); i.src = url; });
    const max = 2200;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    return { name: file.name, dataUrl, data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
  } finally { URL.revokeObjectURL(url); }
}

async function addImages(files) {
  for (const f of files) {
    try { state.attendance.images.push(await prepareImage(f)); } catch (e) { errToast(e); }
  }
  state.attendance.review = null;
  render();
}

function viewAttendance() {
  const a = state.attendance;
  const monthSel = h('div', { class: 'segmented' },
    h('button', { onclick: () => { a.month = shiftMonth(a.month, -1); render(); }, html: icon('chevronL', 14) }),
    h('button', { class: 'active', style: { minWidth: '140px', justifyContent: 'center' } }, monthLabel(a.month)),
    h('button', { onclick: () => { a.month = shiftMonth(a.month, 1); render(); }, html: icon('chevronR', 14) }));

  const dz = h('div', { class: 'dropzone', onclick: () => fileInput.click() },
    h('div', { class: 'dz-ic', html: icon('camera', 30) }),
    h('h2', null, 'Wyślij listę obecności'),
    h('p', null, 'Przeciągnij tutaj zdjęcie podpisanej listy albo kliknij, aby je wybrać. Lista ma kilka stron? Dodaj wszystkie.'),
    h('div', { style: { marginTop: '16px' } }, h('button', { class: 'btn primary lg', onclick: (e) => { e.stopPropagation(); fileInput.click(); } }, iconEl('upload', 16), 'Wybierz zdjęcie')));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => addImages([...e.dataTransfer.files]));

  const thumbs = a.images.length ? h('div', { class: 'thumbs' },
    a.images.map((img, i) => h('div', { class: 'thumb' },
      h('img', { src: img.dataUrl, alt: img.name, onclick: () => previewImage(img) }),
      h('button', { class: 'rm', title: 'Usuń', onclick: () => { a.images.splice(i, 1); a.review = null; render(); }, html: icon('x', 12) }),
      h('span', { class: 'pg' }, `Strona ${i + 1}`))),
    h('div', { class: 'thumb add', onclick: () => fileInput.click() }, iconEl('plus', 22), h('span', { class: 'small' }, 'Dodaj stronę'))) : null;

  const analyzeBtn = h('button', { class: 'btn primary lg', disabled: !a.images.length || a.analyzing }, iconEl('sparkles', 16), 'Analizuj z Claude');
  analyzeBtn.addEventListener('click', analyzeAttendance);

  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Lista obecności'), h('div', { class: 'spacer' }), h('span', { class: 'muted' }, 'Miesiąc listy:'), monthSel),
    h('div', { class: 'page' },
      a.images.length ? null : dz,
      a.images.length ? h('div', { class: 'card card-pad' },
        h('div', { class: 'card-title' }, h('span', { html: icon('photo', 16) }), `Zdjęcia listy – ${monthLabel(a.month)}`, h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', onclick: () => { a.images = []; a.review = null; render(); } }, 'Wyczyść')),
        thumbs,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '18px' } }, analyzeBtn,
          h('span', { class: 'muted small' }, providerLabel() + ' odczyta podpisy, godziny i oznaczenia (U, L4…), a agent sprawdzi je z kalendarzem świąt.'))) : null,
      a.analyzing ? h('div', { class: 'card analyzing', style: { marginTop: '16px' } }, spinner(22),
        h('div', { style: { flex: 1 } }, h('div', { style: { fontWeight: 600, marginBottom: '8px' } }, 'Agent odczytuje listę obecności…'),
          h('div', { class: 'shimmer', style: { width: '80%', marginBottom: '6px' } }), h('div', { class: 'shimmer', style: { width: '55%' } }))) : null,
      a.review ? reviewPanel() : null,
      attendanceHistory()));
}

function previewImage(img) {
  sheet({ title: img.name, wide: true, body: h('img', { src: img.dataUrl, style: { width: '100%', borderRadius: '8px' } }) });
}

function providerLabel() { return state.settings.ai.provider === 'api' ? 'Claude (API)' : 'Claude (Twoje konto)'; }

async function analyzeAttendance() {
  const a = state.attendance;
  a.analyzing = true; a.review = null; render();
  try {
    const r = await api.analyzeAttendance(a.month, a.images.map(({ data, mediaType }) => ({ data, mediaType })));
    a.review = r;
    if (r.raw && r.raw.month && r.raw.month !== a.month) toast(`Na zdjęciu rozpoznano miesiąc ${monthLabel(r.raw.month)}.`, 'info', 6000);
  } catch (e) { errToast(e); }
  a.analyzing = false;
  render();
}

function reviewPanel() {
  const a = state.attendance;
  const rv = a.review;
  const rows = rv.proposed;
  const statusSel = (p) => select([
    { value: 'present', label: 'Obecność' },
    { value: 'absent', label: 'Nieobecność' },
    { value: 'skip', label: 'Pomiń' }
  ], p.skip ? 'skip' : p.present ? 'present' : 'absent', (v) => {
    p.skip = v === 'skip'; p.present = v === 'present';
    if (v === 'absent' && !p.absenceLabel) p.absenceLabel = 'Urlop wypoczynkowy';
    render();
  }, { style: { width: '128px' } });
  const timeIn = (p, k) => h('input', { type: 'time', class: 'input w-time', value: p[k] || '', disabled: p.skip || null, onchange: (e) => { p[k] = e.target.value; } });
  const presentN = rows.filter((p) => p.present && !p.skip).length;

  return h('div', { class: 'grid', style: { gridTemplateColumns: '1fr 300px', marginTop: '16px', alignItems: 'start' } },
    h('div', { class: 'card', style: { overflow: 'hidden' } },
      h('div', { class: 'card-pad', style: { paddingBottom: '6px' } }, h('div', { class: 'card-title', style: { marginBottom: '2px' } },
        h('span', { html: icon('table', 16) }), 'Odczytane dni', h('span', { class: 'spacer' }), h('span', { class: 'chip green' }, `${presentN} ${plural(presentN, 'dzień', 'dni', 'dni')} obecności`))),
      h('table', { class: 'tbl' },
        h('thead', null, h('tr', null, ['Data', 'Status', 'Od', 'Do', 'Pewność', 'Uwagi'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((p) => {
          const d = parseIso(p.date);
          const conf = Math.round((p.confidence || 0) * 100);
          return h('tr', { class: p.skip ? 'off' : '' },
            h('td', null, h('div', { style: { fontWeight: 600 } }, `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`), h('div', { class: 'muted small' }, WD[d.getDay()])),
            h('td', null, statusSel(p), !p.present && !p.skip ? h('input', { class: 'input', style: { width: '150px', marginTop: '4px', display: 'block' }, value: p.absenceLabel || '', placeholder: 'np. Urlop wypoczynkowy', onchange: (e) => { p.absenceLabel = e.target.value; } }) : null),
            h('td', null, timeIn(p, 'start')),
            h('td', null, timeIn(p, 'end')),
            h('td', null, h('span', { class: 'conf' }, h('div', { style: { width: conf + '%', background: conf >= 80 ? 'var(--green)' : conf >= 60 ? 'var(--orange)' : 'var(--red)' } })), h('span', { class: 'muted small', style: { marginLeft: '6px' } }, conf + '%')),
            h('td', { class: 'muted small', style: { maxWidth: '200px' } }, p.mark ? h('span', { class: 'chip teal', style: { marginRight: '4px' } }, p.mark) : null, p.note || ''));
        }))),
      h('div', { class: 'card-pad', style: { display: 'flex', gap: '10px', borderTop: '1px solid var(--sep)' } },
        h('button', { class: 'btn primary lg', onclick: (e) => applyAttendance(e.currentTarget) }, iconEl('check', 16), 'Zapisz w dzienniku'),
        h('button', { class: 'btn lg', onclick: () => { a.review = null; render(); } }, 'Odrzuć'))),
    h('div', { class: 'card card-pad' },
      h('div', { class: 'card-title' }, h('span', { html: icon('bolt', 16) }), 'Uwagi agenta'),
      rv.issues.length ? rv.issues.map((i) => h('div', { class: 'issue ' + i.level }, h('span', { html: icon(i.level === 'warn' ? 'warn' : 'info', 15) }), h('span', null, i.text)))
        : h('div', { class: 'empty' }, iconEl('checkCircle', 26), h('p', { style: { marginTop: '6px' } }, 'Brak zastrzeżeń.'))));
}

async function applyAttendance(btn) {
  const a = state.attendance;
  const list = a.review.proposed.filter((p) => !p.skip).map((p) => ({ ...p, mark: p.present ? null : (p.mark || 'X') }));
  await busy(btn, async () => {
    try {
      await api.applyAttendance(a.month, list);
      toast('Zapisano obecności w dzienniku', 'success');
      state.month = a.month;
      await loadMonth();
      const need = state.monthData.days.filter((d) => d.entry && d.entry.present && !(d.entry.topic && (d.entry.topic.items || []).length)).map((d) => d.date);
      a.review = null; a.images = [];
      go('journal');
      if (need.length) {
        sheet({
          title: 'Wygenerować tematy?',
          subtitle: `${need.length} ${plural(need.length, 'dzień obecności nie ma', 'dni obecności nie ma', 'dni obecności nie ma')} jeszcze tematu.`,
          body: h('p', { class: 'muted' }, 'Agent przygotuje po 3 propozycje planu dnia, uwzględniając święta, dni okolicznościowe i tematy, które już realizowałeś.'),
          actions: [{ label: 'Później' }, { label: 'Generuj propozycje', kind: 'primary', onClick: () => { generateTopics(need); } }]
        });
      }
    } catch (e) { errToast(e); }
  }, 'Zapisuję…');
}

function attendanceHistory() {
  const att = (state.monthData && state.monthData.key === state.attendance.month) ? state.monthData.attendance : [];
  if (!att.length) return h('div');
  return h('div', { class: 'card card-pad', style: { marginTop: '16px' } },
    h('div', { class: 'card-title' }, h('span', { html: icon('clock', 16) }), 'Wczytane listy w tym miesiącu'),
    att.slice().reverse().map((x) => h('div', { class: 'up-item' }, iconEl('checkCircle', 16), h('span', null, new Date(x.at).toLocaleString('pl-PL')), h('span', { class: 'muted' }, ` · ${x.days || 0} dni obecności`))));
}

// ───────────────────────── DZIENNIK ─────────────────────────
function viewJournal() {
  const md = state.monthData;
  const st = md.stats;
  const missing = md.days.filter((d) => d.entry && d.entry.present && !(d.entry.topic && (d.entry.topic.items || []).length));
  const days = state.journalFilter === 'entries' ? md.days.filter((d) => d.entry && (d.entry.present || d.entry.absent)) : md.days;
  const genBtn = h('button', { class: 'btn', disabled: !missing.length || !!state.generating, onclick: () => generateTopics(missing.map((d) => d.date)) }, iconEl('sparkles', 14), missing.length ? `Generuj propozycje (${missing.length})` : 'Generuj propozycje');

  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Dziennik'), h('div', { class: 'spacer' }), monthNav(changeMonth), genBtn,
      h('button', { class: 'btn primary', onclick: openExport }, iconEl('doc', 14), 'Eksportuj DOCX')),
    h('div', { class: 'page' },
      h('div', { class: 'filterbar' },
        segmented([{ value: 'entries', label: 'Dni z wpisami' }, { value: 'all', label: 'Cały miesiąc' }], state.journalFilter, (v) => { state.journalFilter = v; render(); }),
        h('span', { class: 'muted' }, `${st.presentDays} ${plural(st.presentDays, 'dzień', 'dni', 'dni')} obecności · ${fmtH(st.hours)} h · ${st.withTopic}/${st.presentDays} z tematem`)),
      state.generating ? h('div', { class: 'progress-banner' }, spinner(16), `Agent przygotowuje propozycje tematów… (${state.generating.done}/${state.generating.total} dni)`) : null,
      days.length ? days.map(dayCard) : h('div', { class: 'card empty', style: { padding: '50px' } },
        h('div', { html: icon('camera', 34), style: { display: 'flex', justifyContent: 'center', color: 'var(--accent)' } }),
        h('h3', { style: { marginTop: '12px' } }, 'Brak wpisów w tym miesiącu'),
        h('p', { style: { marginTop: '6px' } }, 'Wyślij zdjęcie listy obecności albo przełącz na „Cały miesiąc” i dodaj dni ręcznie.'),
        h('div', { style: { marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'center' } },
          h('button', { class: 'btn primary', onclick: () => go('attendance') }, iconEl('camera', 14), 'Wyślij listę obecności'),
          h('button', { class: 'btn', onclick: () => { state.journalFilter = 'all'; render(); } }, 'Cały miesiąc')))));
}

function dayCard(d) {
  const e = d.entry;
  const dt = parseIso(d.date);
  const chips = [];
  if (d.holiday) chips.push(h('span', { class: 'chip red' }, iconEl('flag', 11), d.holiday.name));
  if (d.dayOff) chips.push(h('span', { class: 'chip orange' }, d.dayOff.label || 'Dzień wolny'));
  for (const o of d.occasions.slice(0, 2)) chips.push(h('span', { class: 'chip purple', title: o.why || '' }, iconEl('sparkles', 11), o.name));
  const dateBox = h('div', { class: 'day-date' + (d.date === todayIso() ? ' today' : '') }, h('div', { class: 'dn' }, dt.getDate()), h('div', { class: 'wd' }, d.weekday));

  if (!e || (!e.present && !e.absent)) {
    return h('div', { class: 'card day', style: { opacity: d.workday ? 1 : 0.7 } }, dateBox,
      h('div', { class: 'day-main' },
        h('div', { class: 'day-head' }, h('span', { class: 'chip' }, d.workday ? 'Brak wpisu' : d.holiday ? 'Święto' : 'Dzień wolny'), ...chips, h('span', { class: 'spacer' }),
          h('button', { class: 'btn sm', onclick: () => updateDay(d.date, { present: true }) }, iconEl('plus', 12), 'Obecność'),
          h('button', { class: 'btn sm', onclick: () => updateDay(d.date, { absent: true }) }, 'Urlop / wolne'))));
  }

  const timeIn = (k) => h('input', { type: 'time', class: 'input w-time', value: e[k] || '', onchange: (ev) => updateDay(d.date, { [k]: ev.target.value }) });
  const head = h('div', { class: 'day-head' },
    e.present ? h('span', { class: 'chip green' }, iconEl('check', 11), 'Obecność') : h('span', { class: 'chip teal' }, 'Nieobecność'),
    h('span', { class: 'timebox' }, timeIn('start'), '–', timeIn('end')),
    h('span', { class: 'chip blue' }, `${fmtH(e.hours)} h`),
    ...chips,
    e.source === 'lista' && e.confidence != null && e.confidence < 0.6 ? h('span', { class: 'chip orange' }, iconEl('warn', 11), 'sprawdź odczyt') : null,
    h('span', { class: 'spacer' }),
    h('button', { class: 'icon-btn', title: 'Dopisek przy dniu tygodnia (np. „odpracowano za 01.05.26”)', onclick: () => editWeekdayNote(d), html: icon('flag', 15) }),
    h('button', { class: 'icon-btn', title: 'Usuń wpis', onclick: () => confirmDelete(d), html: icon('trash', 15) }));

  if (e.absent) {
    return h('div', { class: 'card day absent-day' }, dateBox, h('div', { class: 'day-main' }, head,
      h('div', { class: 'topic-box', style: { display: 'flex', gap: '10px', alignItems: 'center' } },
        h('span', { class: 'muted' }, 'Wpis w dzienniku:'),
        h('input', { class: 'input', style: { flex: 1 }, value: e.absenceLabel || '', onchange: (ev) => updateDay(d.date, { absenceLabel: ev.target.value }) }),
        h('button', { class: 'btn sm', onclick: () => updateDay(d.date, { present: true }) }, 'Zmień na obecność')),
      e.weekdayNote ? h('p', { class: 'muted small', style: { marginTop: '6px' } }, `Dopisek: ( ${e.weekdayNote} )`) : null));
  }

  const items = (e.topic && e.topic.items) || [];
  const editing = state.editing[d.date];
  let topicArea;
  if (editing) {
    const ta = h('textarea', { class: 'input', rows: Math.max(4, items.length + 2), value: items.join('\n'), placeholder: 'Jeden punkt w jednej linii, np.\n12:00–12:45 | Poniedziałkowy krąg: …' });
    topicArea = h('div', null, ta,
      h('div', { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
        h('button', { class: 'btn primary sm', onclick: async () => {
          const list = ta.value.split('\n').map((s) => s.trim()).filter(Boolean);
          delete state.editing[d.date];
          await updateDay(d.date, { topic: list.length ? { ...(e.topic || {}), items: list } : null });
        } }, 'Zapisz'),
        h('button', { class: 'btn sm', onclick: () => { delete state.editing[d.date]; render(); } }, 'Anuluj'),
        h('span', { class: 'muted small', style: { alignSelf: 'center' } }, 'Każda linia to osobny punkt w kolumnie „Temat zajęć”.')));
  } else if (items.length) {
    topicArea = h('div', { class: 'topic-box' },
      h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: '8px' } },
        h('div', { style: { flex: 1 } }, e.topic.title ? h('div', { style: { fontWeight: 650, marginBottom: '6px' } }, e.topic.title) : null, bulletsEl(items)),
        h('button', { class: 'btn plain sm', onclick: () => { state.editing[d.date] = true; render(); } }, 'Edytuj')));
  } else {
    topicArea = h('div', { class: 'topic-box topic-empty' }, iconEl('sparkles', 16), h('span', { style: { flex: 1 } }, (e.proposals || []).length ? 'Wybierz jedną z propozycji poniżej albo wpisz własny plan.' : 'Brak tematu. Poproś agenta o 3 propozycje albo wpisz własny.'),
      h('button', { class: 'btn sm', onclick: () => { state.editing[d.date] = true; render(); } }, 'Wpisz ręcznie'),
      !(e.proposals || []).length ? h('button', { class: 'btn primary sm', disabled: !!state.generating, onclick: () => generateTopics([d.date]) }, iconEl('sparkles', 12), 'Zaproponuj') : null);
  }

  const props = e.proposals || [];
  const proposalsEl = props.length && !editing ? h('div', null,
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' } },
      h('span', { class: 'muted small', style: { fontWeight: 600 } }, items.length ? 'Inne propozycje agenta' : 'Propozycje agenta'), h('span', { style: { flex: 1 } }),
      h('button', { class: 'btn plain sm', disabled: !!state.generating, onclick: () => generateTopics([d.date]) }, iconEl('refresh', 12), 'Nowe propozycje'),
      items.length ? h('button', { class: 'btn plain sm', onclick: () => updateDay(d.date, { proposals: [] }) }, 'Ukryj') : null),
    h('div', { class: 'proposals' }, props.map((p) => {
      const chosen = items.length && JSON.stringify(items) === JSON.stringify(p.items);
      return h('div', { class: 'proposal', style: chosen ? { borderColor: 'var(--green)' } : null },
        h('h4', null, p.title || 'Propozycja'),
        bulletsEl(p.items),
        h('div', { class: 'p-foot' },
          p.occasion ? h('span', { class: 'chip purple', title: p.occasion, style: { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' } }, iconEl('sparkles', 10), p.occasion) : p.category ? h('span', { class: 'chip' }, p.category) : null),
        h('div', { class: 'p-foot', style: { marginTop: '0' } },
          h('span', { class: 'spacer' }),
          chosen ? h('span', { class: 'chip green' }, iconEl('check', 10), 'Wybrany') : h('button', { class: 'btn primary sm', onclick: () => updateDay(d.date, { topic: { title: p.title, items: p.items, occasion: p.occasion, category: p.category } }) }, 'Wybierz')));
    }))) : null;

  return h('div', { class: 'card day' }, dateBox, h('div', { class: 'day-main' }, head,
    e.weekdayNote ? h('p', { class: 'muted small', style: { margin: '-4px 0 8px' } }, `Dopisek przy dniu tygodnia: ( ${e.weekdayNote} )`) : null,
    topicArea, proposalsEl));
}

async function updateDay(date, patch) {
  try {
    await api.updateDay(date, patch);
    await loadMonth();
    render();
  } catch (e) { errToast(e); }
}

function editWeekdayNote(d) {
  const inp = h('input', { class: 'input full', value: (d.entry && d.entry.weekdayNote) || '', placeholder: 'np. odpracowano za 01.05.26' });
  sheet({
    title: 'Dopisek przy dniu tygodnia',
    subtitle: `${longDate(d.date)} – pojawi się w kolumnie „Data” pod nazwą dnia, w nawiasie.`,
    body: h('div', { class: 'field' }, inp),
    actions: [{ label: 'Anuluj' }, { label: 'Zapisz', kind: 'primary', onClick: () => updateDay(d.date, { weekdayNote: inp.value.trim() }) }]
  });
  setTimeout(() => inp.focus(), 50);
}

function confirmDelete(d) {
  sheet({
    title: 'Usunąć wpis?',
    subtitle: longDate(d.date),
    body: h('p', { class: 'muted' }, 'Wpis zniknie z dziennika aplikacji (obecność, temat i propozycje). Nie wpływa to na pliki .docx, które już zapisałeś.'),
    actions: [{ label: 'Anuluj' }, { label: 'Usuń', kind: 'danger', onClick: () => updateDay(d.date, { present: false, absent: false, topic: null, proposals: [] }) }]
  });
}

async function generateTopics(dates) {
  if (!dates.length) return;
  state.generating = { done: 0, total: dates.length };
  if (state.view === 'journal') render();
  try {
    const r = await api.generateTopics(dates);
    const n = Object.keys(r).length;
    toast(n ? `Gotowe: propozycje dla ${n} ${plural(n, 'dnia', 'dni', 'dni')}` : 'Model nie zwrócił propozycji – spróbuj ponownie.', n ? 'success' : 'error');
  } catch (e) { errToast(e); }
  state.generating = null;
  await loadMonth();
  render();
}

// ───────────────────────── EKSPORT ─────────────────────────
async function openExport() {
  const b = monthBounds(state.month);
  const opts = { mode: 'append', from: b.from, to: b.to, replaceExisting: true };
  let info = null;
  try { info = await api.documentInfo(); } catch (_) { /* ignore */ }
  const md = state.monthData;
  const missing = md.days.filter((d) => d.entry && d.entry.present && !(d.entry.topic && (d.entry.topic.items || []).length)).length;
  const modeHint = h('div', { class: 'note-box' });
  const setHint = () => {
    modeHint.replaceChildren(iconEl('info', 16), h('div', null, opts.mode === 'append'
      ? ['Wybierzesz swój dotychczasowy dziennik (.docx). Nowe wiersze zostaną wstawione do tabeli w kolejności dat – formatowanie i pozostałe części dokumentu zostają bez zmian. Przed nadpisaniem pliku powstanie kopia zapasowa.',
        info && info.lastJournalPath ? h('div', { class: 'path', style: { marginTop: '6px' } }, 'Ostatnio: ' + info.lastJournalPath) : null]
      : 'Powstanie nowy dokument na podstawie wzoru' + (info && !info.builtIn ? ' (własny plik wzoru)' : ' (Twój dziennik 2026)') + ' – z tabelą zawierającą tylko wybrany okres.'));
  };
  setHint();
  const from = h('input', { type: 'date', class: 'input', value: opts.from, onchange: (e) => { opts.from = e.target.value; } });
  const to = h('input', { type: 'date', class: 'input', value: opts.to, onchange: (e) => { opts.to = e.target.value; } });
  sheet({
    title: 'Eksport dziennika do DOCX',
    subtitle: 'Dokument zachowa dokładnie formatowanie Twojego wzoru.',
    body: h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Tryb'), segmented([
        { value: 'append', label: 'Dopisz do mojego dziennika' }, { value: 'new', label: 'Nowy dokument z wzoru' }
      ], opts.mode, (v) => { opts.mode = v; setHint(); })),
      modeHint,
      h('div', { class: 'field' }, h('label', null, 'Okres'), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, from, '–', to,
        h('button', { class: 'btn plain sm', onclick: () => { const m = monthBounds(state.month); from.value = opts.from = m.from; to.value = opts.to = m.to; } }, monthLabel(state.month)))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: opts.replaceExisting, onchange: (e) => { opts.replaceExisting = e.target.checked; } }), 'Zastąp wiersze z tymi samymi datami (jeśli już są w dzienniku)'),
      missing ? h('div', { class: 'note-box warn', style: { marginTop: '10px' } }, iconEl('warn', 16), h('div', null, `${missing} ${plural(missing, 'dzień obecności nie ma', 'dni obecności nie ma', 'dni obecności nie ma')} tematu – w dokumencie te wiersze będą miały pustą kolumnę „Temat zajęć”.`)) : null),
    actions: [{ label: 'Anuluj' }, { label: 'Eksportuj', kind: 'primary', onClick: () => doExport(opts) }]
  });
}

async function doExport(opts) {
  try {
    const r = await api.exportDocx(opts);
    if (!r) return;
    await loadMonth();
    render();
    sheet({
      title: 'Dziennik zapisany',
      subtitle: r.path,
      body: h('div', null,
        h('p', null, `Dodano ${r.stats.added}, zastąpiono ${r.stats.replaced}, pominięto ${r.stats.skipped} ${plural(r.stats.skipped, 'wiersz', 'wiersze', 'wierszy')}.`),
        r.backup ? h('p', { class: 'muted small', style: { marginTop: '8px' } }, 'Kopia zapasowa poprzedniej wersji: ', h('span', { class: 'path' }, r.backup)) : null),
      actions: [{ label: 'Pokaż w folderze', onClick: () => api.showFile(r.path) }, { label: 'Otwórz dokument', kind: 'primary', onClick: () => api.openFile(r.path) }]
    });
  } catch (e) { errToast(e); }
}

// ───────────────────────── KALENDARZ ─────────────────────────
function viewCalendar() {
  const md = state.monthData;
  const first = parseIso(md.days[0].date);
  const lead = (first.getDay() + 6) % 7;
  const cells = [];
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) cells.push(h('div', { class: 'cal-h' }, WD_SHORT[wd]));
  for (let i = 0; i < lead; i++) cells.push(h('div', { class: 'cal-c other' }));
  for (const d of md.days) {
    const e = d.entry;
    const tags = [];
    if (d.holiday) tags.push(h('div', { class: 'cal-tag holiday', title: d.holiday.name }, d.holiday.name));
    if (d.dayOff) tags.push(h('div', { class: 'cal-tag dayoff' }, d.dayOff.label || 'Dzień wolny'));
    if (e && e.present) tags.push(h('div', { class: 'cal-tag present' }, `✓ ${e.start || ''}–${e.end || ''}`));
    if (e && e.absent) tags.push(h('div', { class: 'cal-tag absent', title: e.absenceLabel }, e.absenceLabel || 'Nieobecność'));
    for (const o of d.occasions.slice(0, 2)) tags.push(h('div', { class: 'cal-tag occasion', title: o.name + (o.why ? ' – ' + o.why : '') }, o.name));
    const dt = parseIso(d.date);
    cells.push(h('div', { class: 'cal-c' + (d.weekend ? ' weekend' : '') + (d.date === todayIso() ? ' today' : ''), onclick: () => openDay(d) },
      h('div', { class: 'cal-n' }, h('span', null, dt.getDate()), d.scheduled && d.scheduled.enabled && !d.holiday ? h('span', { class: 'dot', style: { background: 'var(--accent)', opacity: 0.5 }, title: 'Dzień pracy wg harmonogramu' }) : null),
      tags));
  }
  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Kalendarz'), h('div', { class: 'spacer' }), monthNav(changeMonth),
      h('button', { class: 'btn', onclick: openRangeOff }, iconEl('calendar', 14), 'Oznacz okres wolny')),
    h('div', { class: 'page' },
      h('div', { class: 'cal' }, cells),
      h('div', { class: 'legend' },
        h('span', null, h('span', { class: 'dot holiday' }), 'Święto ustawowe'),
        h('span', null, h('span', { class: 'dot occasion' }), 'Dzień okolicznościowy'),
        h('span', null, h('span', { class: 'dot dayoff' }), 'Twój dzień wolny'),
        h('span', null, h('span', { class: 'dot present' }), 'Obecność'),
        h('span', null, h('span', { class: 'dot absent' }), 'Urlop / nieobecność'),
        h('span', null, h('span', { class: 'dot', style: { background: 'var(--accent)', opacity: 0.5 } }), 'Dzień pracy wg harmonogramu'))));
}

const DAYOFF_TYPES = [
  { value: 'wolne', label: 'Dzień wolny od pracy' },
  { value: 'za-swieto', label: 'Dzień wolny za święto w sobotę' },
  { value: 'urlop', label: 'Urlop (planowany)' },
  { value: 'przerwa', label: 'Przerwa w działalności WTZ' },
  { value: 'inne', label: 'Inne' }
];

function openDay(d) {
  const off = d.dayOff || {};
  let type = off.type || 'wolne';
  const label = h('input', { class: 'input full', value: off.label || '', placeholder: 'Opis (opcjonalnie)' });
  const holidaysSat = (state.agent && state.agent.alerts || []).filter((a) => /przypada w sobotę/.test(a.text));
  sheet({
    title: longDate(d.date).replace(/^./, (c) => c.toUpperCase()),
    subtitle: d.holiday ? `Święto: ${d.holiday.name}` : d.workday ? 'Dzień pracy według harmonogramu' : 'Dzień bez zajęć według harmonogramu',
    body: h('div', null,
      d.occasions.length ? h('div', { class: 'field' }, h('label', null, 'Dni okolicznościowe'), d.occasions.map((o) => h('div', { class: 'issue info' }, h('span', { html: icon('sparkles', 14) }), h('span', null, o.name, o.why ? h('span', { class: 'muted' }, ' – ' + o.why) : null)))) : null,
      h('div', { class: 'field' }, h('label', null, 'Oznacz jako dzień wolny'), select(DAYOFF_TYPES, type, (v) => { type = v; }, { style: { width: '100%' } })),
      h('div', { class: 'field' }, label),
      holidaysSat.length ? h('p', { class: 'muted small' }, 'Wskazówka: dla święta w sobotę wybierz „Dzień wolny za święto w sobotę”.') : null),
    actions: [
      d.dayOff ? { label: 'Usuń oznaczenie', kind: 'danger', onClick: () => setDayOff(d.date, null) } : null,
      { label: 'Anuluj' },
      { label: 'Zapisz', kind: 'primary', onClick: () => setDayOff(d.date, { type, label: label.value.trim() || DAYOFF_TYPES.find((t) => t.value === type).label }) }
    ].filter(Boolean)
  });
}

async function setDayOff(date, value) {
  try { await api.setDayOff(date, value); await Promise.all([loadMonth(), loadAgent()]); render(); } catch (e) { errToast(e); }
}

function openRangeOff() {
  const b = monthBounds(state.month);
  const from = h('input', { type: 'date', class: 'input', value: b.from });
  const to = h('input', { type: 'date', class: 'input', value: b.from });
  let type = 'przerwa';
  const label = h('input', { class: 'input full', placeholder: 'np. Przerwa wakacyjna w WTZ' });
  sheet({
    title: 'Oznacz okres wolny',
    subtitle: 'Np. przerwa wakacyjna lub urlop – agent nie będzie oczekiwał podpisów w tych dniach.',
    body: h('div', null,
      h('div', { class: 'field' }, h('label', null, 'Okres'), h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, from, '–', to)),
      h('div', { class: 'field' }, h('label', null, 'Rodzaj'), select(DAYOFF_TYPES, type, (v) => { type = v; }, { style: { width: '100%' } })),
      h('div', { class: 'field' }, label)),
    actions: [{ label: 'Anuluj' }, { label: 'Zapisz', kind: 'primary', onClick: async () => {
      let d = parseIso(from.value); const end = parseIso(to.value);
      if (end < d) { toast('Data końcowa jest wcześniejsza niż początkowa.', 'error'); return false; }
      const lbl = label.value.trim() || DAYOFF_TYPES.find((t) => t.value === type).label;
      while (d <= end) { await api.setDayOff(iso(d), { type, label: lbl }); d.setDate(d.getDate() + 1); }
      await Promise.all([loadMonth(), loadAgent()]); render();
      toast('Zapisano okres wolny', 'success');
      return true;
    } }]
  });
}

// ───────────────────────── USTAWIENIA ─────────────────────────
function viewSettings() {
  const tabs = [
    { value: 'general', label: 'Ogólne', icon: 'person' },
    { value: 'ai', label: 'Claude', icon: 'cpu' },
    { value: 'schedule', label: 'Harmonogram', icon: 'clock' },
    { value: 'topics', label: 'Tematy', icon: 'sparkles' },
    { value: 'document', label: 'Dokument', icon: 'doc' },
    { value: 'agent', label: 'Agent', icon: 'bolt' }
  ];
  const body = { general: settingsGeneral, ai: settingsAi, schedule: settingsSchedule, topics: settingsTopics, document: settingsDocument, agent: settingsAgent }[state.settingsTab]();
  return h('div', null,
    h('div', { class: 'toolbar' }, h('h1', null, 'Ustawienia')),
    h('div', { class: 'page' },
      h('div', { class: 'settings-tabs' }, segmented(tabs, state.settingsTab, (v) => { state.settingsTab = v; render(); })),
      body));
}

function textInput(value, onSave, attrs = {}) {
  return h('input', { class: 'input', style: { width: attrs.width || '280px' }, value: value || '', placeholder: attrs.placeholder || '', type: attrs.type || 'text', onchange: (e) => onSave(e.target.value) });
}

function settingsGeneral() {
  const s = state.settings;
  return h('div', null,
    group('Profil', [
      row('Imię i nazwisko', textInput(s.profile.name, (v) => saveSettings({ profile: { name: v } }), { placeholder: 'np. Jan Kowalski' }), { icon: 'person', color: 'var(--accent)' }),
      row('Placówka', textInput(s.profile.institution, (v) => saveSettings({ profile: { institution: v } })), { icon: 'home', color: 'var(--indigo)' }),
      row('Miejscowość', textInput(s.profile.city, (v) => saveSettings({ profile: { city: v } })), { icon: 'globe', color: 'var(--teal)' })
    ], 'Imię i nazwisko pomaga agentowi sprawdzić, czy zdjęcie przedstawia Twoją listę obecności.'),
    group('Wygląd', [
      row('Motyw', segmented([{ value: 'system', label: 'Systemowy' }, { value: 'light', label: 'Jasny' }, { value: 'dark', label: 'Ciemny' }], s.ui.theme, (v) => saveSettings({ ui: { theme: v } }, true)), { icon: 'paint', color: 'var(--pink)' })
    ]),
    group('Dane', [
      row('Folder danych aplikacji', h('span', { class: 'path', style: { maxWidth: '380px' } }, state.info.dataDir), { icon: 'folder', color: 'var(--orange)', hint: state.info.portable ? 'Wersja przenośna – dane leżą obok pliku .exe.' : 'Kopia tego folderu = kopia całego dziennika.' }),
      row('Wersja', h('span', { class: 'muted' }, state.info.version), { icon: 'info', color: 'var(--text-3)' })
    ]));
}

function settingsAi() {
  const s = state.settings;
  const status = h('div', { class: 'status-line' });
  const isCC = s.ai.provider === 'claude-code';
  const ccStatus = state.claudePath ? h('div', { class: 'status-line ok' }, iconEl('checkCircle', 14), 'Znaleziono: ', h('span', { class: 'path' }, state.claudePath))
    : h('div', { class: 'status-line bad' }, iconEl('warn', 14), 'Nie znaleziono Claude Code na tym komputerze');
  const testBtn = h('button', { class: 'btn' }, iconEl('bolt', 14), 'Testuj połączenie');
  testBtn.addEventListener('click', () => busy(testBtn, async () => {
    status.className = 'status-line';
    status.replaceChildren(spinner(12), ' Łączę…');
    try { const r = await api.testAi(); status.className = 'status-line ok'; status.replaceChildren(iconEl('checkCircle', 14), r); } catch (e) { status.className = 'status-line bad'; status.replaceChildren(iconEl('warn', 14), e.message); }
  }, 'Testuję…'));
  const keyInput = h('input', { class: 'input', type: 'password', style: { width: '300px' }, placeholder: state.hasApiKey ? '•••••••• (zapisany)' : 'sk-ant-…' });

  return h('div', null,
    group('Sposób połączenia z Claude', [
      row('Dostawca', segmented([{ value: 'claude-code', label: 'Moje konto Claude' }, { value: 'api', label: 'Klucz API' }], s.ai.provider, async (v) => { await saveSettings({ ai: { provider: v } }, true); render(); }), { icon: 'cpu', color: 'var(--accent)' })
    ], isCC
      ? 'Aplikacja korzysta z Twojego planu Claude (Pro/Max) przez oficjalny program Claude Code zainstalowany na tym komputerze. To jedyny sposób dozwolony przez Anthropic – zewnętrzne aplikacje nie mogą logować się kontem Claude.ai bezpośrednio.'
      : 'Klucz API z platform.claude.com – rozliczany osobno, za faktyczne zużycie. Klucz jest przechowywany zaszyfrowany na tym komputerze.'),
    isCC ? group('Claude Code', [
      row('Program', h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' } }, ccStatus,
        h('div', { style: { display: 'flex', gap: '6px' } },
          h('button', { class: 'btn sm', onclick: async () => { try { const p = await api.browseClaude(); if (p) { await loadSettings(); render(); } } catch (e) { errToast(e); } } }, 'Wskaż ręcznie…'),
          h('button', { class: 'btn sm', onclick: () => api.openExternal('https://claude.com/product/claude-code') }, 'Jak zainstalować?'))), { icon: 'cpu', color: 'var(--orange)', hint: 'Po instalacji uruchom raz w terminalu „claude” i zaloguj się swoim kontem.' }),
      row('Model', select([{ value: 'sonnet', label: 'Sonnet (zalecany)' }, { value: 'opus', label: 'Opus (najmocniejszy)' }, { value: 'haiku', label: 'Haiku (najszybszy)' }], s.ai.model, (v) => saveSettings({ ai: { model: v } })), { icon: 'sparkles', color: 'var(--purple)' })
    ]) : group('Klucz API', [
      row('Klucz', h('div', { style: { display: 'flex', gap: '6px' } }, keyInput,
        h('button', { class: 'btn', onclick: async () => { try { state.hasApiKey = await api.setApiKey(keyInput.value); keyInput.value = ''; toast(state.hasApiKey ? 'Zapisano klucz' : 'Usunięto klucz', 'success'); render(); } catch (e) { errToast(e); } } }, 'Zapisz')), { icon: 'key', color: 'var(--green)' }),
      row('Model', select([{ value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (zalecany)' }, { value: 'claude-opus-5-5', label: 'Claude Opus 5.5' }, { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' }], s.ai.apiModel, (v) => saveSettings({ ai: { apiModel: v } })), { icon: 'sparkles', color: 'var(--purple)' }),
      row('Pobierz klucz', h('button', { class: 'btn sm', onclick: () => api.openExternal('https://platform.claude.com/settings/keys') }, 'platform.claude.com'), { icon: 'globe', color: 'var(--teal)' })
    ]),
    group('Internet', [
      row('Wyszukiwanie w internecie przy tematach', toggle(s.ai.useWebSearch, (v) => saveSettings({ ai: { useWebSearch: v } }, true)), { icon: 'globe', color: 'var(--teal)', hint: 'Agent sprawdza aktualne dni okolicznościowe, kampanie i zmiany w uprawnieniach osób z niepełnosprawnościami.' })
    ]),
    h('div', { class: 'group', style: { display: 'flex', alignItems: 'center', gap: '12px' } }, testBtn, status));
}

function settingsSchedule() {
  const s = state.settings;
  const order = [1, 2, 3, 4, 5, 6, 0];
  return h('div', null,
    group('Stałe godziny pracy', order.map((wd) => {
      const day = s.schedule.days[wd];
      return row(WD[wd].replace(/^./, (c) => c.toUpperCase()),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
          h('input', { type: 'time', class: 'input w-time', value: day.start, disabled: !day.enabled || null, onchange: (e) => saveSettings({ schedule: { days: { [wd]: { start: e.target.value } } } }, true) }), '–',
          h('input', { type: 'time', class: 'input w-time', value: day.end, disabled: !day.enabled || null, onchange: (e) => saveSettings({ schedule: { days: { [wd]: { end: e.target.value } } } }, true) }),
          toggle(day.enabled, async (v) => { await saveSettings({ schedule: { days: { [wd]: { enabled: v } } } }, true); render(); })));
    }), 'Godziny z harmonogramu trafiają do dziennika, gdy na liście obecności jest tylko podpis bez godzin, oraz przy urlopach i dniach wolnych.'),
    group('Liczenie godzin', [
      row('Zaokrąglanie', select([{ value: '0', label: 'Bez zaokrąglania' }, { value: '0.25', label: 'Do 15 minut' }, { value: '0.5', label: 'Do pół godziny' }, { value: '1', label: 'Do pełnej godziny' }], String(s.schedule.hoursRounding), (v) => saveSettings({ schedule: { hoursRounding: Number(v) } })), { icon: 'clock', color: 'var(--accent)' })
    ]));
}

function settingsTopics() {
  const s = state.settings;
  const cats = [
    ['occasions', 'Święta i dni okolicznościowe', 'flag', 'var(--red)'],
    ['psychoeducation', 'Psychoedukacja, emocje, stres', 'sparkles', 'var(--purple)'],
    ['social', 'Umiejętności społeczne i komunikacja', 'people', 'var(--accent)'],
    ['independence', 'Samodzielność i przygotowanie do pracy', 'bolt', 'var(--orange)'],
    ['rights', 'Prawa, ulgi, pomoc społeczna', 'book', 'var(--green)'],
    ['relaxation', 'Relaksacja i uważność', 'moon', 'var(--indigo)'],
    ['cognitive', 'Trening funkcji poznawczych', 'cpu', 'var(--teal)']
  ];
  const profile = h('textarea', { class: 'input', rows: 3, value: s.topics.participantsProfile, onchange: (e) => saveSettings({ topics: { participantsProfile: e.target.value } }) });
  const extra = h('textarea', { class: 'input', rows: 3, value: s.topics.extraInstructions, placeholder: 'np. W piątki zawsze podsumowanie tygodnia. Raz w tygodniu moduł o ulgach i uprawnieniach.', onchange: (e) => saveSettings({ topics: { extraInstructions: e.target.value } }) });
  return h('div', null,
    group('Obszary tematyczne', cats.map(([k, label, ic, color]) => row(label, toggle(s.topics.categories[k], (v) => saveSettings({ topics: { categories: { [k]: v } } }, true)), { icon: ic, color }))),
    group('Styl wpisu', [
      row('Punkty w kolumnie „Temat zajęć”', segmented([{ value: 'slots', label: 'Z godzinami (12:00–12:45 | …)' }, { value: 'bullets', label: 'Bez godzin' }], s.document.format.entryStyle, (v) => saveSettings({ document: { format: { entryStyle: v } } }, true)), { icon: 'clock', color: 'var(--accent)' })
    ]),
    group('Uczestnicy', [row('Opis grupy uczestników', profile, { stack: true, hint: 'Agent dopasowuje do tego poziom trudności i metody.' })]),
    group('Własne wskazówki dla agenta', [row('Dodatkowe instrukcje', extra, { stack: true })]),
    group('Różnorodność', [
      row('Nie powtarzaj tematów z ostatnich', select([{ value: '30', label: '30 dni' }, { value: '90', label: '3 miesięcy' }, { value: '180', label: '6 miesięcy' }, { value: '365', label: '12 miesięcy' }], String(s.topics.avoidRepeatDays), (v) => saveSettings({ topics: { avoidRepeatDays: Number(v) } })), { icon: 'refresh', color: 'var(--purple)' }),
      row('Historia z dotychczasowego dziennika', h('button', { class: 'btn', onclick: importHistory }, iconEl('upload', 14), 'Importuj z pliku .docx'), { icon: 'book', color: 'var(--green)', hint: 'Wczytuje Twoje wcześniejsze wpisy, żeby agent znał zrealizowane tematy i Twój styl.' })
    ]));
}

async function importHistory() {
  try {
    const r = await api.importHistory();
    if (!r) return;
    toast(`Zaimportowano ${r.added} wpisów (${r.from} – ${r.to})${r.skipped ? `, pominięto ${r.skipped}` : ''}`, 'success', 5000);
    await loadMonth();
  } catch (e) { errToast(e); }
}

function settingsDocument() {
  const s = state.settings;
  const f = s.document.format;
  const infoEl = h('div', { class: 'muted small' }, 'Wczytuję…');
  api.documentInfo().then((i) => {
    state.docInfo = i;
    const names = { date: 'Data', participant: 'Imię i nazwisko uczestnika', topic: 'Temat zajęć', signature: 'Podpis', notes: 'Uwagi (godziny)', time: 'Godziny', hours: 'Liczba godzin', other: 'inna' };
    infoEl.replaceChildren(i.builtIn ? 'Wbudowany wzór – Twój „Psycholog 2026 – dziennik”' : h('span', { class: 'path' }, i.path), h('br'), 'Rozpoznane kolumny: ' + i.roles.map((r) => names[r]).join(' · '));
  }).catch((e) => { infoEl.textContent = e.message; });
  const labels = s.document.absenceLabels;
  return h('div', null,
    group('Wzór dokumentu', [
      row('Aktualny wzór', infoEl, { icon: 'doc', color: 'var(--accent)' }),
      row('Zmień wzór', h('div', { style: { display: 'flex', gap: '6px' } },
        h('button', { class: 'btn', onclick: async () => { try { const p = await api.pickTemplate(); if (p) { await loadSettings(); toast('Ustawiono nowy wzór', 'success'); render(); } } catch (e) { errToast(e); } } }, 'Wybierz plik .docx…'),
        h('button', { class: 'btn', onclick: async () => { await api.resetTemplate(); await loadSettings(); render(); } }, 'Przywróć wbudowany')), { icon: 'folder', color: 'var(--orange)' })
    ], 'Aplikacja bierze pierwszą tabelę ze wzoru: wiersz nagłówka oraz pierwszy wiersz z wpisem jako wzorzec formatowania (czcionka, rozmiary, punktory). Pozostałe części dokumentu zostają bez zmian.'),
    group('Format wartości', [
      row('Data', select([{ value: 'DD.MM.RR', label: '07.01.26' }, { value: 'DD.MM.RRRR', label: '07.01.2026' }], f.dateFormat, (v) => saveSettings({ document: { format: { dateFormat: v } } })), { icon: 'calendar', color: 'var(--red)' }),
      row('Godziny w „Uwagach”', select([{ value: 'dot', label: '8.00-11.00' }, { value: 'colon', label: '08:00-11:00' }], f.timeStyle, (v) => saveSettings({ document: { format: { timeStyle: v } } })), { icon: 'clock', color: 'var(--accent)' }),
      row('Liczba godzin', textInput(f.hoursTemplate, (v) => saveSettings({ document: { format: { hoursTemplate: v } } }), { width: '140px' }), { icon: 'clock', color: 'var(--teal)', hint: '{h} zostanie zastąpione liczbą, np. „( 3,5 h )”.' }),
      row('Urlopy i dni wolne w tabeli', toggle(f.includeAbsences, (v) => saveSettings({ document: { format: { includeAbsences: v } } }, true)), { icon: 'flag', color: 'var(--orange)', hint: 'Tak jak w Twoim dzienniku: wiersz z opisem (np. „Urlop wypoczynkowy”) i godzinami z harmonogramu.' })
    ]),
    group('Opisy nieobecności (oznaczenia z listy obecności)', Object.keys(labels).map((k) => row(k, textInput(labels[k], (v) => saveSettings({ document: { absenceLabels: { [k]: v } } }, true), { width: '300px' })))));
}

function settingsAgent() {
  const a = state.settings.agent;
  return h('div', null,
    group('Agent w tle', [
      row('Agent włączony', toggle(a.enabled, (v) => saveSettings({ agent: { enabled: v } }, true)), { icon: 'bolt', color: 'var(--green)', hint: 'Co 30 minut sprawdza kalendarz, święta, dni wolne i braki w dzienniku.' }),
      row('Działaj w tle po zamknięciu okna', toggle(a.runInBackground, (v) => saveSettings({ agent: { runInBackground: v } }, true)), { icon: 'moon', color: 'var(--indigo)', hint: 'Aplikacja zostaje w zasobniku systemowym (obok zegara).' }),
      row('Powiadomienia systemowe', toggle(a.notifications, (v) => saveSettings({ agent: { notifications: v } }, true)), { icon: 'bell', color: 'var(--red)' }),
      row('Szukaj dni okolicznościowych w internecie', toggle(a.lookupOccasionsOnline, (v) => saveSettings({ agent: { lookupOccasionsOnline: v } }, true)), { icon: 'globe', color: 'var(--teal)', hint: 'Raz na kilka tygodni – uzupełnia wbudowaną bazę świąt związanych z WTZ.' }),
      row('Automatycznie przygotowuj propozycje tematów', toggle(a.autoPrepareTopics, (v) => saveSettings({ agent: { autoPrepareTopics: v } }, true)), { icon: 'sparkles', color: 'var(--purple)', hint: 'Dla dni obecności bez tematu. Zużywa limity Twojego planu / tokeny.' }),
      row('Przypomnienie o liście obecności od dnia', select(Array.from({ length: 10 }, (_, i) => ({ value: String(22 + i), label: `${22 + i}. dnia miesiąca` })), String(a.remindAttendanceDay), (v) => saveSettings({ agent: { remindAttendanceDay: Number(v) } })), { icon: 'camera', color: 'var(--accent)' })
    ]),
    group('Dziennik agenta', [h('div', { style: { padding: '6px 14px', maxHeight: '320px', overflowY: 'auto' } },
      (state.agent && state.agent.log.length) ? state.agent.log.map((l) => h('div', { class: 'issue ' + (l.type === 'error' ? 'warn' : 'info') },
        h('span', { html: icon(l.type === 'error' ? 'warn' : 'info', 14) }),
        h('span', null, h('span', { class: 'muted small' }, new Date(l.at).toLocaleString('pl-PL') + ' · '), l.message))) : h('div', { class: 'empty' }, 'Brak wpisów.'))]));
}

init().catch((e) => { document.body.innerHTML = '<pre style="padding:20px">Błąd uruchomienia: ' + e.message + '</pre>'; });

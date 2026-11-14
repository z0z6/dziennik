'use strict';
// Prosty, trwały magazyn danych w pliku JSON (zapis atomowy).
const fs = require('fs');
const path = require('path');
const { DEFAULT_FORMAT } = require('./template-docx');

const DEFAULT_SETTINGS = {
  profile: {
    name: '',
    position: 'Psycholog',
    institution: 'Warsztat Terapii Zajęciowej',
    city: ''
  },
  ai: {
    provider: 'claude-code', // 'claude-code' | 'api'
    model: 'sonnet', // aliasy dla Claude Code: sonnet / opus / haiku
    apiModel: 'claude-sonnet-5-5',
    claudePath: '', // pusta = autodetekcja
    useWebSearch: true
  },
  schedule: {
    // Domyślne godziny pracy (używane, gdy na liście obecności nie ma wpisanych godzin)
    // 1 = poniedziałek ... 5 = piątek
    days: {
      1: { enabled: true, start: '12:00', end: '15:30' },
      2: { enabled: false, start: '08:00', end: '11:00' },
      3: { enabled: true, start: '08:00', end: '11:00' },
      4: { enabled: false, start: '08:00', end: '11:00' },
      5: { enabled: true, start: '12:00', end: '15:30' },
      6: { enabled: false, start: '08:00', end: '11:00' },
      0: { enabled: false, start: '08:00', end: '11:00' }
    },
    hoursRounding: 0.5
  },
  topics: {
    defaultForm: 'grupowa',
    defaultParticipants: '',
    categories: {
      occasions: true, // święta i dni okolicznościowe
      psychoeducation: true, // psychoedukacja, emocje, stres
      social: true, // umiejętności społeczne, komunikacja
      independence: true, // samodzielność, aktywizacja, przygotowanie do pracy
      rights: true, // prawa osób z niepełnosprawnościami, pomoc społeczna
      relaxation: true, // relaksacja, trening uważności
      cognitive: true // trening funkcji poznawczych
    },
    participantsProfile: 'dorośli uczestnicy WTZ: osoby z niepełnosprawnością intelektualną (w tym w stopniu umiarkowanym), z zespołem Downa, z zespołem Aspergera, ze schizofrenią oraz z niepełnosprawnością ruchową',
    extraInstructions: '',
    avoidRepeatDays: 90
  },
  participants: {
    min: 4,
    max: 8,
    autoAssign: true
  },
  agent: {
    enabled: true,
    runInBackground: true,
    notifications: true,
    lookupOccasionsOnline: true,
    autoPrepareTopics: false,
    remindAttendanceDay: 28
  },
  document: {
    templatePath: '', // pusty = wbudowany wzór (na podstawie dziennika użytkownika)
    lastJournalPath: '', // ostatnio aktualizowany dziennik (tryb „dopisz”)
    format: DEFAULT_FORMAT,
    absenceLabels: {
      U: 'Urlop wypoczynkowy', UW: 'Urlop wypoczynkowy', UZ: 'Urlop na żądanie', L4: 'Zwolnienie lekarskie', CH: 'Zwolnienie lekarskie',
      D: 'Delegacja', S: 'Szkolenie', O: 'Opieka nad członkiem rodziny', W: 'Dzień wolny od pracy', NN: 'Nieobecność'
    }
  },
  ui: { theme: 'system' }
};

const DEFAULT_DATA = {
  version: 1,
  settings: DEFAULT_SETTINGS,
  months: {}, // 'RRRR-MM' -> { days: { 'RRRR-MM-DD': entry }, attendance: [...] }
  daysOff: {}, // 'RRRR-MM-DD' -> { type, label }
  occasionsCache: {}, // 'RRRR-MM' -> { fetchedAt, items: [{date,name,why}] }
  participants: { roster: [], attendance: {}, uploads: [] },
  agentLog: [],
  notified: {}
};

function deepMerge(base, extra) {
  if (Array.isArray(base)) return Array.isArray(extra) ? extra : base;
  if (base && typeof base === 'object') {
    const out = { ...base };
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const k of Object.keys(extra)) {
        out[k] = k in base ? deepMerge(base[k], extra[k]) : extra[k];
      }
    }
    return out;
  }
  return extra === undefined ? base : extra;
}

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'dziennik-dane.json');
    this.data = this._load();
    this.listeners = new Set();
  }

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return deepMerge(DEFAULT_DATA, raw);
    } catch (e) {
      if (fs.existsSync(this.file)) {
        try { fs.copyFileSync(this.file, this.file + '.uszkodzony-' + Date.now()); } catch (_) { /* ignore */ }
      }
      return JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  }

  save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
    for (const fn of this.listeners) { try { fn(); } catch (_) { /* ignore */ } }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  get settings() { return this.data.settings; }

  updateSettings(patch) {
    this.data.settings = deepMerge(this.data.settings, patch);
    this.save();
    return this.data.settings;
  }

  month(key) {
    if (!this.data.months[key]) this.data.months[key] = { days: {}, attendance: [] };
    return this.data.months[key];
  }

  log(type, message, extra) {
    this.data.agentLog.unshift({ at: new Date().toISOString(), type, message, ...(extra || {}) });
    this.data.agentLog = this.data.agentLog.slice(0, 200);
    this.save();
  }

  recentTopics(beforeDate, days) {
    const limit = new Date(beforeDate);
    limit.setDate(limit.getDate() - (days || 90));
    const out = [];
    for (const m of Object.values(this.data.months)) {
      for (const [date, e] of Object.entries(m.days || {})) {
        if (e.topic && (e.topic.items || []).length && new Date(date) >= limit) out.push({ date, items: e.topic.items });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
}

module.exports = { Store, DEFAULT_SETTINGS };

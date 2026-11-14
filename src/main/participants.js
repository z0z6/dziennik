'use strict';
// Uczestnicy WTZ: lista osób, ich obecności (z list obecności uczestników) oraz losowanie
// składu na zajęcia psychologa (domyślnie 4–8 osób, wyłącznie spośród obecnych danego dnia).

const { pad } = require('./calendar');

function normalize(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}

// „Jan Kowalski” / „KOWALSKI Jan” / „Kowalski J.” → { firstName, lastName }
function splitName(raw, order = 'auto') {
  const s = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!s) return { firstName: '', lastName: '' };
  const parts = s.split(' ');
  if (parts.length === 1) return { firstName: '', lastName: cap(parts[0]) };
  let first, last;
  const isInitial = (p) => /^[A-ZĄĆĘŁŃÓŚŹŻ]\.?$/i.test(p);
  if (order === 'last-first' || (order === 'auto' && (isInitial(parts[parts.length - 1]) || (parts[0] === parts[0].toUpperCase() && parts[0].length > 2 && parts[1] !== parts[1].toUpperCase())))) {
    last = parts[0]; first = parts.slice(1).join(' ');
  } else {
    first = parts.slice(0, -1).join(' '); last = parts[parts.length - 1];
  }
  return { firstName: cap(first.replace(/\.$/, '')), lastName: cap(last) };
}

function cap(s) {
  return String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

// Format do dziennika: pierwsza litera imienia + pełne nazwisko, np. „J. Kowalski”
function shortName(p) {
  const init = p.firstName ? p.firstName.trim().charAt(0).toUpperCase() + '. ' : '';
  return (init + (p.lastName || '').trim()).trim();
}

// Deterministyczny generator liczb losowych (to samo ziarno → ten sam wynik)
function rng(seedStr) {
  let h = 2166136261;
  for (const ch of String(seedStr)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6D2B79F5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Participants {
  constructor(store) {
    this.store = store;
    if (!store.data.participants) store.data.participants = { roster: [], attendance: {}, uploads: [] };
  }

  get data() { return this.store.data.participants; }
  get roster() { return this.data.roster; }

  byId(id) { return this.roster.find((p) => p.id === id) || null; }

  // Znajdź osobę po nazwisku (odporne na wielkość liter, polskie znaki, kolejność, inicjały)
  match(raw) {
    const { firstName, lastName } = splitName(raw);
    const ln = normalize(lastName), fn = normalize(firstName);
    const cands = this.roster.filter((p) => normalize(p.lastName) === ln);
    if (cands.length === 1 && (!fn || !cands[0].firstName || normalize(cands[0].firstName)[0] === fn[0])) return cands[0];
    const exact = cands.find((p) => normalize(p.firstName) === fn);
    if (exact) return exact;
    const byInitial = cands.filter((p) => fn && normalize(p.firstName)[0] === fn[0]);
    if (byInitial.length === 1) return byInitial[0];
    // odwrócona kolejność
    const rev = this.roster.find((p) => normalize(p.lastName) === fn && normalize(p.firstName) === ln);
    return rev || null;
  }

  upsert(raw) {
    const found = this.match(raw);
    if (found) {
      const { firstName } = splitName(raw);
      if (firstName && firstName.length > (found.firstName || '').length && !/\.$/.test(firstName)) found.firstName = firstName;
      return found;
    }
    const { firstName, lastName } = splitName(raw);
    const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const p = { id, firstName, lastName, active: true };
    this.roster.push(p);
    this.roster.sort((a, b) => a.lastName.localeCompare(b.lastName, 'pl') || a.firstName.localeCompare(b.firstName, 'pl'));
    return p;
  }

  updatePerson(id, patch) {
    const p = this.byId(id);
    if (!p) throw new Error('Nie znaleziono uczestnika.');
    Object.assign(p, patch);
    this.store.save();
    return p;
  }

  removePerson(id) {
    this.data.roster = this.roster.filter((p) => p.id !== id);
    for (const d of Object.keys(this.data.attendance)) this.data.attendance[d] = this.data.attendance[d].filter((x) => x !== id);
    this.store.save();
  }

  presentOn(date) {
    return (this.data.attendance[date] || []).map((id) => this.byId(id)).filter(Boolean);
  }

  // Zapis wyniku odczytu listy: [{ name, days: [1,2,...] }] dla miesiąca
  applyMonth(monthKey, rows, { replace = true } = {}) {
    const [y, m] = monthKey.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const touched = new Set();
    const ids = rows.map((r) => this.upsert(r.name).id);
    if (replace) {
      // czyścimy tylko osoby z tego zdjęcia w tym miesiącu (inne listy/strony zostają)
      for (let d = 1; d <= last; d++) {
        const k = `${monthKey}-${pad(d)}`;
        if (this.data.attendance[k]) this.data.attendance[k] = this.data.attendance[k].filter((id) => !ids.includes(id));
      }
    }
    rows.forEach((r, i) => {
      for (const d of r.days || []) {
        if (d < 1 || d > last) continue;
        const k = `${monthKey}-${pad(d)}`;
        const arr = this.data.attendance[k] || (this.data.attendance[k] = []);
        if (!arr.includes(ids[i])) arr.push(ids[i]);
        touched.add(k);
      }
    });
    for (const k of Object.keys(this.data.attendance)) if (!this.data.attendance[k].length) delete this.data.attendance[k];
    this.data.uploads.push({ at: new Date().toISOString(), month: monthKey, people: rows.length });
    this.store.save();
    return { people: rows.length, days: touched.size };
  }

  // Wiele miesięcy naraz: [{ name, months: { 'RRRR-MM': [dni] } }]
  applyMonths(rows) {
    const byMonth = {};
    for (const r of rows) {
      for (const [k, days] of Object.entries(r.months || {})) {
        (byMonth[k] || (byMonth[k] = [])).push({ name: r.name, days });
      }
    }
    let people = new Set(), days = 0;
    for (const [k, list] of Object.entries(byMonth)) {
      const res = this.applyMonth(k, list);
      days += res.days;
      list.forEach((x) => people.add(x.name));
    }
    return { people: people.size, days, months: Object.keys(byMonth).sort() };
  }

  monthMatrix(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    const days = Array.from({ length: last }, (_, i) => `${monthKey}-${pad(i + 1)}`);
    const people = this.roster.filter((p) => days.some((d) => (this.data.attendance[d] || []).includes(p.id)) || p.active);
    return {
      days,
      people: people.map((p) => ({ ...p, short: shortName(p), present: days.filter((d) => (this.data.attendance[d] || []).includes(p.id)).map((d) => Number(d.slice(8))) }))
    };
  }

  setPresence(date, id, present) {
    const arr = this.data.attendance[date] || (this.data.attendance[date] = []);
    const i = arr.indexOf(id);
    if (present && i < 0) arr.push(id);
    if (!present && i >= 0) arr.splice(i, 1);
    if (!arr.length) delete this.data.attendance[date];
    this.store.save();
  }

  // Losowanie składu zajęć: min–max osób spośród obecnych; deterministyczne dla daty (+ numer losowania)
  pick(date, { min = 4, max = 8, round = 0 } = {}) {
    const present = this.presentOn(date).filter((p) => p.active !== false);
    if (!present.length) return { ids: [], warning: 'Brak danych o obecności uczestników w tym dniu.' };
    const r = rng(`${date}#${round}`);
    const pool = [...present];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const lo = Math.min(min, pool.length), hi = Math.min(max, pool.length);
    const n = lo + Math.floor(r() * (hi - lo + 1));
    const chosen = pool.slice(0, n).sort((a, b) => a.lastName.localeCompare(b.lastName, 'pl'));
    return { ids: chosen.map((p) => p.id), warning: present.length < min ? `Tego dnia obecnych było tylko ${present.length} uczestników (mniej niż ${min}).` : null };
  }

  namesFor(ids) {
    return (ids || []).map((id) => this.byId(id)).filter(Boolean).map(shortName);
  }
}

module.exports = { Participants, shortName, splitName, normalize, rng };

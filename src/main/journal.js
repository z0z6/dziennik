'use strict';
// Logika dziennika: łączenie kalendarza, obecności i tematów w wpisy miesiąca.

const { hoursBetween, roundHours, pad, MONTHS } = require('./calendar');

const MARKS = {
  U: 'urlop', UW: 'urlop wypoczynkowy', UZ: 'urlop na żądanie', L4: 'zwolnienie lekarskie', CH: 'zwolnienie lekarskie',
  D: 'delegacja', DS: 'delegacja', S: 'szkolenie', O: 'opieka', OP: 'opieka', W: 'dzień wolny', WS: 'dzień wolny',
  DW: 'dzień wolny', Ś: 'święto', NN: 'nieobecność'
};

function markLabel(mark, labels) {
  if (!mark) return '';
  const k = mark.replace(/[^A-ZĄĆĘŁŃÓŚŹŻ0-9]/g, '');
  const custom = labels || {};
  const base = custom[mark] || custom[k] || MARKS[mark] || MARKS[k] || mark;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

class Journal {
  constructor(store, calendar, participants) {
    this.store = store;
    this.calendar = calendar;
    this.participants = participants || null;
  }

  // Losuje skład uczestników zajęć (tylko obecni danego dnia, min–max wg ustawień)
  assignGroups(dates, { force = false, reroll = false } = {}) {
    if (!this.participants) return { assigned: 0, warnings: [] };
    const cfg = this.store.settings.participants || { min: 4, max: 8 };
    const warnings = [];
    let assigned = 0;
    for (const date of dates) {
      const m = this.store.month(date.slice(0, 7));
      const e = m.days[date];
      if (!e || !e.present) continue;
      if (e.group && e.group.length && !force && !reroll) continue;
      const round = reroll ? (e.groupRound || 0) + 1 : (e.groupRound || 0);
      const r = this.participants.pick(date, { min: cfg.min, max: cfg.max, round });
      if (!r.ids.length) { if (r.warning) warnings.push(`${date}: ${r.warning}`); continue; }
      e.group = r.ids;
      e.groupRound = round;
      e.groupWarning = r.warning || '';
      if (r.warning) warnings.push(`${date}: ${r.warning}`);
      assigned++;
    }
    this.store.save();
    return { assigned, warnings };
  }

  autoAssignMonth(key) {
    if (!(this.store.settings.participants || {}).autoAssign) return null;
    const dates = Object.keys(this.store.month(key).days);
    return this.assignGroups(dates);
  }

  monthView(key) {
    const m = this.store.month(key);
    const days = this.calendar.monthDays(key).map((info) => {
      const entry = m.days[info.date] || null;
      const present = this.participants ? this.participants.presentOn(info.date) : [];
      return {
        ...info,
        entry,
        participantsPresent: present.length,
        groupNames: entry && entry.group && this.participants ? this.participants.namesFor(entry.group) : []
      };
    });
    const present = days.filter((d) => d.entry && d.entry.present);
    const stats = {
      workdays: days.filter((d) => d.workday).length,
      presentDays: present.length,
      hours: present.reduce((s, d) => s + (Number(d.entry.hours) || 0), 0),
      absentDays: days.filter((d) => d.entry && d.entry.absent).length,
      withTopic: present.filter((d) => d.entry.topic && (d.entry.topic.items || []).length).length,
      withProposals: present.filter((d) => (d.entry.proposals || []).length).length,
      attendanceUploaded: (m.attendance || []).length > 0,
      exportedAt: m.exportedAt || null
    };
    return { key, label: labelFor(key), days, stats, attendance: m.attendance || [] };
  }

  defaultTimes(dateStr) {
    const info = this.calendar.dayInfo(dateStr);
    const s = info.scheduled && info.scheduled.start ? info.scheduled : this.store.settings.schedule.days[1];
    return { start: s.start, end: s.end };
  }

  computeHours(start, end) {
    return roundHours(hoursBetween(start, end), this.store.settings.schedule.hoursRounding);
  }

  // Wynik z AI → proponowane wpisy + uwagi agenta (bez zapisu)
  reviewAttendance(key, result) {
    const [y, mo] = key.split('-').map(Number);
    const last = new Date(y, mo, 0).getDate();
    const issues = [];
    if (result.month && result.month !== key) {
      issues.push({ level: 'warn', text: `Na zdjęciu rozpoznano miesiąc ${result.month}, a wybrany jest ${key}. Sprawdź, czy to właściwa lista.` });
    }
    for (const w of result.warnings || []) issues.push({ level: 'info', text: w });

    const proposed = [];
    for (const d of result.days) {
      if (d.day > last) continue;
      const date = `${key}-${pad(d.day)}`;
      const info = this.calendar.dayInfo(date);
      const isAbsence = !!d.mark && !(d.start && d.end);
      const present = !isAbsence && (d.present || d.signed || (d.start && d.end));
      const def = this.defaultTimes(date);
      const times = (present || isAbsence) ? { start: d.start || def.start, end: d.end || def.end } : { start: null, end: null };
      const usedDefault = present && (!d.start || !d.end);
      proposed.push({
        date,
        present: !!present,
        start: times.start,
        end: times.end,
        hours: (present || isAbsence) ? this.computeHours(times.start, times.end) : 0,
        mark: d.mark,
        absenceLabel: isAbsence ? markLabel(d.mark, this.store.settings.document.absenceLabels) : '',
        confidence: d.confidence,
        note: [d.note, usedDefault ? 'godziny z harmonogramu' : ''].filter(Boolean).join('; ')
      });
      if (present && info.holiday) issues.push({ level: 'warn', date, text: `${date}: obecność w święto (${info.holiday.name}). Sprawdź, czy to nie pomyłka odczytu.` });
      else if (present && info.weekend) issues.push({ level: 'warn', date, text: `${date}: obecność w weekend (${info.weekday}).` });
      else if (present && !info.scheduled.enabled) issues.push({ level: 'info', date, text: `${date} (${info.weekday}): obecność poza stałym harmonogramem – np. dzień odpracowania. Możesz dodać dopisek przy dniu tygodnia.` });
      if (present && info.dayOff) issues.push({ level: 'warn', date, text: `${date}: w kalendarzu oznaczony jako ${info.dayOff.label || info.dayOff.type}, a na liście jest podpis.` });
      if (d.confidence < 0.6) issues.push({ level: 'warn', date, text: `${date}: niepewny odczyt (${Math.round(d.confidence * 100)}%)${d.note ? ' – ' + d.note : ''}.` });
    }
    // dni robocze bez podpisu
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    for (const info of this.calendar.monthDays(key)) {
      if (!info.workday || info.date > todayStr) continue;
      if (!proposed.some((p) => p.date === info.date)) {
        issues.push({ level: 'info', date: info.date, text: `${info.date} (${info.weekday}): dzień roboczy bez podpisu na liście.` });
      }
    }
    return { proposed: proposed.sort((a, b) => a.date.localeCompare(b.date)), issues };
  }

  applyAttendance(key, proposed, meta) {
    const m = this.store.month(key);
    // usuń poprzednie wpisy z listy obecności (zachowując tematy)
    const keepTopics = {};
    for (const [date, e] of Object.entries(m.days)) {
      if (e.topic || (e.proposals && e.proposals.length)) keepTopics[date] = { topic: e.topic, proposals: e.proposals, weekdayNote: e.weekdayNote, group: e.group, groupRound: e.groupRound };
      if (e.source === 'lista') delete m.days[date];
    }
    for (const p of proposed) {
      const prev = m.days[p.date] || {};
      m.days[p.date] = {
        ...prev,
        ...(keepTopics[p.date] || {}),
        present: !!p.present,
        absent: !p.present && !!p.mark,
        absenceLabel: p.absenceLabel || '',
        mark: p.mark || null,
        start: p.start,
        end: p.end,
        hours: (p.present || p.mark) && p.start && p.end ? this.computeHours(p.start, p.end) : 0,
        confidence: p.confidence,
        note: p.note || '',
        source: 'lista'
      };
    }
    m.attendance = [...(m.attendance || []), { at: new Date().toISOString(), ...(meta || {}) }];
    this.store.save();
    this.store.log('attendance', `Wczytano listę obecności za ${labelFor(key)}: ${proposed.filter((p) => p.present).length} dni obecności.`);
    return this.monthView(key);
  }

  updateDay(date, patch) {
    const key = date.slice(0, 7);
    const m = this.store.month(key);
    const prev = m.days[date] || { present: false, source: 'ręcznie' };
    const next = { ...prev, ...patch };
    if (patch.present === true) { next.absent = false; next.absenceLabel = ''; next.mark = null; }
    if (patch.absent === true) { next.present = false; if (!next.absenceLabel) next.absenceLabel = 'Urlop wypoczynkowy'; }
    if ((next.present || next.absent) && (!next.start || !next.end)) Object.assign(next, this.defaultTimes(date));
    next.hours = (next.present || next.absent) ? this.computeHours(next.start, next.end) : 0;
    m.days[date] = next;
    if (!next.present && !next.topic && !next.absent && !(next.proposals || []).length) delete m.days[date];
    this.store.save();
    return m.days[date] || null;
  }

  entriesForExport(key) {
    const m = this.store.month(key);
    return Object.entries(m.days)
      .filter(([, e]) => e.present || e.absent)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, e]) => ({
        date,
        start: e.start,
        end: e.end,
        hours: e.hours,
        topic: e.topic,
        weekdayNote: e.weekdayNote || '',
        participantNames: e.present && e.group && this.participants ? this.participants.namesFor(e.group) : [],
        absent: !e.present,
        absenceLabel: e.absenceLabel || markLabel(e.mark, this.store.settings.document.absenceLabels)
      }));
  }

  entriesInRange(from, to) {
    const out = [];
    for (const key of Object.keys(this.store.data.months).sort()) {
      for (const e of this.entriesForExport(key)) if (e.date >= from && e.date <= to) out.push(e);
    }
    return out;
  }

  // Import wpisów z istniejącego dziennika .docx (historia – żeby AI nie powtarzało tematów)
  importHistory(rows, { overwrite = false } = {}) {
    let added = 0, skipped = 0;
    for (const r of rows) {
      const m = this.store.month(r.date.slice(0, 7));
      const prev = m.days[r.date];
      if (prev && prev.source !== 'import' && !overwrite) { skipped++; continue; }
      m.days[r.date] = {
        present: !r.absent,
        absent: r.absent,
        absenceLabel: r.absenceLabel || '',
        start: r.start,
        end: r.end,
        hours: r.hours || this.computeHours(r.start, r.end),
        topic: r.absent ? null : { title: '', items: r.items },
        weekdayNote: r.weekdayNote || '',
        group: !r.absent && this.participants && (r.participantNames || []).length ? r.participantNames.map((n) => this.participants.upsert(n).id) : undefined,
        source: 'import'
      };
      added++;
    }
    this.store.save();
    this.store.log('import', `Zaimportowano ${added} wpisów z dziennika${skipped ? ` (pominięto ${skipped} istniejących)` : ''}.`);
    return { added, skipped };
  }
}

function labelFor(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

module.exports = { Journal, markLabel, labelFor };

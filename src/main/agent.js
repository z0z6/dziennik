'use strict';
// Agent działający w tle: pilnuje świąt i dni wolnych, przypomina o liście obecności,
// pobiera z internetu dni okolicznościowe i (opcjonalnie) przygotowuje propozycje tematów.

const { iso, addDays, monthKey } = require('./calendar');
const { lookupOccasions } = require('./ai/tasks');
const { labelFor } = require('./journal');

const TICK_MS = 30 * 60 * 1000;

class Agent {
  constructor({ store, calendar, journal, getProvider, notify, emit, topicsService }) {
    Object.assign(this, { store, calendar, journal, getProvider, notify, emit, topicsService });
    this.timer = null;
    this.running = false;
    this.lastRun = null;
    this.lastError = null;
  }

  start() {
    this.stop();
    setTimeout(() => this.tick(), 4000);
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  get cfg() { return this.store.settings.agent; }

  // Alerty widoczne na pulpicie (liczone na bieżąco)
  alerts(now = new Date()) {
    const out = [];
    const today = iso(now);
    const key = monthKey(now);
    const view = this.journal.monthView(key);

    const tomorrow = this.calendar.dayInfo(iso(addDays(now, 1)));
    if (tomorrow.holiday) out.push({ level: 'info', icon: 'flag', text: `Jutro święto: ${tomorrow.holiday.name} – dzień wolny od pracy.` });

    for (const h of this.calendar.holidaysInRange(new Date(now.getFullYear(), now.getMonth(), 1), new Date(now.getFullYear(), now.getMonth() + 1, 0))) {
      if (h.saturday && !Object.values(this.store.data.daysOff).some((d) => d.forHoliday === h.date)) {
        out.push({ level: 'warn', icon: 'calendar', text: `${h.name} (${h.date}) przypada w sobotę – przysługuje inny dzień wolny. Oznacz go w Kalendarzu.`, action: { view: 'calendar' } });
      }
    }

    const soon = this.calendar.occasionsInRange(now, addDays(now, 7));
    for (const o of soon.slice(0, 4)) {
      out.push({ level: 'tip', icon: 'sparkles', text: `${o.date === today ? 'Dziś' : o.date.slice(8, 10) + '.' + o.date.slice(5, 7)}: ${o.name} – dobra okazja do tematu zajęć.` });
    }

    if (now.getDate() >= (this.cfg.remindAttendanceDay || 28) && !view.stats.attendanceUploaded) {
      out.push({ level: 'warn', icon: 'camera', text: `Koniec miesiąca – wyślij zdjęcie listy obecności za ${view.label}.`, action: { view: 'attendance' } });
    }

    const missing = view.stats.presentDays - view.stats.withTopic;
    if (missing > 0) out.push({ level: 'warn', icon: 'doc', text: `${missing} ${plural(missing, 'dzień', 'dni', 'dni')} obecności bez wybranego tematu (${view.label}).`, action: { view: 'journal' } });

    const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    const prev = this.journal.monthView(prevKey);
    if (prev.stats.presentDays > 0 && !prev.stats.exportedAt) {
      out.push({ level: 'warn', icon: 'doc', text: `Dziennik za ${prev.label} nie został jeszcze wyeksportowany do DOCX.`, action: { view: 'journal', month: prevKey } });
    }
    return out;
  }

  status() {
    const now = new Date();
    const upcoming = [
      ...this.calendar.holidaysInRange(now, addDays(now, 45)).map((h) => ({ ...h, kind: 'holiday' })),
      ...this.calendar.occasionsInRange(now, addDays(now, 30)).map((o) => ({ ...o, kind: 'occasion' })),
      ...Object.entries(this.store.data.daysOff).filter(([d]) => d >= iso(now)).map(([date, v]) => ({ date, name: v.label || v.type, kind: 'dayoff' }))
    ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
    return {
      enabled: this.cfg.enabled,
      running: this.running,
      lastRun: this.lastRun,
      lastError: this.lastError,
      alerts: this.alerts(now),
      upcoming,
      log: this.store.data.agentLog.slice(0, 30)
    };
  }

  notifyOnce(id, title, body) {
    if (!this.cfg.notifications) return;
    if (this.store.data.notified[id]) return;
    this.store.data.notified[id] = new Date().toISOString();
    this.store.save();
    this.notify(title, body);
  }

  async tick(force = false) {
    if (this.running) return;
    if (!this.cfg.enabled && !force) return;
    this.running = true;
    this.emit('agent:status', this.status());
    try {
      const now = new Date();
      // 1. powiadomienia
      const tomorrow = this.calendar.dayInfo(iso(addDays(now, 1)));
      if (tomorrow.holiday) this.notifyOnce(`hol-${tomorrow.date}`, 'Jutro święto', `${tomorrow.holiday.name} – dzień wolny od pracy.`);
      for (const o of this.calendar.occasionsInRange(addDays(now, 3), addDays(now, 3))) {
        this.notifyOnce(`occ-${o.date}-${o.name}`, 'Za 3 dni: ' + o.name, 'Zajrzyj do Dziennika – agent może zaproponować temat nawiązujący do tej okazji.');
      }
      const view = this.journal.monthView(monthKey(now));
      if (now.getDate() >= (this.cfg.remindAttendanceDay || 28) && !view.stats.attendanceUploaded) {
        this.notifyOnce(`att-${view.key}`, 'Lista obecności', `Pamiętaj, aby wysłać zdjęcie listy obecności za ${view.label}.`);
      }

      // 2. dni okolicznościowe z internetu (bieżący miesiąc + następny pod koniec miesiąca)
      if (this.cfg.lookupOccasionsOnline) {
        const keys = [monthKey(now)];
        if (now.getDate() >= 20) keys.push(monthKey(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
        for (const k of keys) {
          const c = this.store.data.occasionsCache[k];
          const stale = !c || (Date.now() - new Date(c.fetchedAt).getTime() > 20 * 24 * 3600 * 1000);
          if (!stale && !force) continue;
          if (c && c.failedAt && Date.now() - new Date(c.failedAt).getTime() < 6 * 3600 * 1000 && !force) continue;
          try {
            const provider = this.getProvider();
            const items = await lookupOccasions(provider, k);
            this.store.data.occasionsCache[k] = { fetchedAt: new Date().toISOString(), items };
            this.store.log('occasions', `Pobrano z internetu ${items.length} dni okolicznościowych na ${labelFor(k)}.`);
          } catch (e) {
            this.store.data.occasionsCache[k] = { ...(c || { items: [] }), fetchedAt: c ? c.fetchedAt : new Date(0).toISOString(), failedAt: new Date().toISOString() };
            this.store.save();
            throw e;
          }
        }
      }

      // 3. automatyczne propozycje tematów
      if (this.cfg.autoPrepareTopics && this.topicsService) {
        const key = monthKey(now);
        const m = this.store.month(key);
        const dates = Object.entries(m.days).filter(([, e]) => e.present && !e.topic && !(e.proposals || []).length).map(([d]) => d);
        if (dates.length) {
          await this.topicsService.generate(dates);
          this.store.log('topics', `Agent przygotował propozycje tematów dla ${dates.length} dni.`);
        }
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message;
      this.store.log('error', 'Agent: ' + e.message);
    } finally {
      this.running = false;
      this.lastRun = new Date().toISOString();
      this.emit('agent:status', this.status());
    }
  }
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, h = n % 100;
  if (d >= 2 && d <= 4 && !(h >= 12 && h <= 14)) return few;
  return many;
}

module.exports = { Agent, plural };

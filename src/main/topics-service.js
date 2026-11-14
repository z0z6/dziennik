'use strict';
const { generateTopics } = require('./ai/tasks');

class TopicsService {
  constructor({ store, calendar, journal, getProvider, emit }) {
    Object.assign(this, { store, calendar, journal, getProvider, emit });
  }

  async generate(dates, { chunkSize = 6 } = {}) {
    const sorted = [...new Set(dates)].sort();
    const result = {};
    const settings = this.store.settings;
    for (let i = 0; i < sorted.length; i += chunkSize) {
      const chunk = sorted.slice(i, i + chunkSize);
      this.emit('topics:progress', { done: i, total: sorted.length, current: chunk });
      const days = chunk.map((date) => {
        const e = this.store.month(date.slice(0, 7)).days[date];
        const t = e && e.start && e.end ? e : this.journal.defaultTimes(date);
        return { date, start: t.start, end: t.end, near: this.calendar.occasionsNear(date) };
      });
      const recent = this.store.recentTopics(chunk[0], settings.topics.avoidRepeatDays);
      // propozycje z bieżącej partii, by kolejne partie się nie powtarzały
      for (const [d, props] of Object.entries(result)) for (const p of props) recent.push({ date: d, items: p.items });
      const out = await generateTopics(this.getProvider(), settings, { days, recent });
      for (const date of chunk) {
        const props = out[date] || [];
        if (!props.length) continue;
        result[date] = props;
        const m = this.store.month(date.slice(0, 7));
        const e = m.days[date] || { present: false, source: 'ręcznie' };
        e.proposals = props;
        e.proposalsAt = new Date().toISOString();
        m.days[date] = e;
      }
      this.store.save();
    }
    this.emit('topics:progress', { done: sorted.length, total: sorted.length, current: [] });
    return result;
  }
}

module.exports = { TopicsService };

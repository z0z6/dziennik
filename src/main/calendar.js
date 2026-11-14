'use strict';
// Kalendarz: święta ustawowe w Polsce, dni okolicznościowe związane z tematyką WTZ,
// dni wolne użytkownika oraz harmonogram pracy.

const MONTHS = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec', 'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];
const MONTHS_GEN = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia'];
const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const monthKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;

function easter(year) {
  // Algorytm Meeusa/Jonesa/Butchera (kalendarz gregoriański)
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function nthWeekday(year, month, weekday, n) {
  // n-ty dzień tygodnia w miesiącu (month 1-12, weekday 0=nd)
  const first = new Date(year, month - 1, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
}

function publicHolidays(year) {
  const e = easter(year);
  const list = [
    [new Date(year, 0, 1), 'Nowy Rok'],
    [new Date(year, 0, 6), 'Święto Trzech Króli'],
    [e, 'Wielkanoc'],
    [addDays(e, 1), 'Poniedziałek Wielkanocny'],
    [new Date(year, 4, 1), 'Święto Pracy'],
    [new Date(year, 4, 3), 'Święto Narodowe Trzeciego Maja'],
    [addDays(e, 49), 'Zielone Świątki (Zesłanie Ducha Świętego)'],
    [addDays(e, 60), 'Boże Ciało'],
    [new Date(year, 7, 15), 'Wniebowzięcie NMP / Święto Wojska Polskiego'],
    [new Date(year, 10, 1), 'Wszystkich Świętych'],
    [new Date(year, 10, 11), 'Narodowe Święto Niepodległości'],
    [new Date(year, 11, 25), 'Boże Narodzenie (pierwszy dzień)'],
    [new Date(year, 11, 26), 'Boże Narodzenie (drugi dzień)']
  ];
  if (year >= 2025) list.push([new Date(year, 11, 24), 'Wigilia Bożego Narodzenia']);
  return list.map(([d, name]) => ({ date: iso(d), name, type: 'holiday', saturday: d.getDay() === 6 }));
}

// Dni okolicznościowe przydatne w pracy psychologa w WTZ (stała baza; agent uzupełnia ją z internetu).
const FIXED_OCCASIONS = [
  ['01-04', 'Światowy Dzień Braille\'a', 'niepełnosprawność'],
  ['01-21', 'Dzień Babci', 'rodzina'],
  ['01-22', 'Dzień Dziadka', 'rodzina'],
  ['02-11', 'Światowy Dzień Chorego', 'zdrowie'],
  ['02-14', 'Walentynki – Dzień Przyjaźni i Życzliwości', 'relacje'],
  ['02-18', 'Międzynarodowy Dzień Zespołu Aspergera', 'niepełnosprawność'],
  ['02-20', 'Światowy Dzień Sprawiedliwości Społecznej', 'pomoc społeczna'],
  ['02-21', 'Międzynarodowy Dzień Języka Ojczystego', 'komunikacja'],
  ['02-23', 'Ogólnopolski Dzień Walki z Depresją', 'zdrowie psychiczne'],
  ['03-03', 'Światowy Dzień Słuchu', 'niepełnosprawność'],
  ['03-08', 'Dzień Kobiet', 'relacje'],
  ['03-20', 'Międzynarodowy Dzień Szczęścia', 'emocje'],
  ['03-21', 'Światowy Dzień Zespołu Downa / pierwszy dzień wiosny', 'niepełnosprawność'],
  ['03-26', 'Purple Day – Światowy Dzień Wiedzy o Padaczce', 'zdrowie'],
  ['03-30', 'Światowy Dzień Choroby Afektywnej Dwubiegunowej', 'zdrowie psychiczne'],
  ['04-02', 'Światowy Dzień Świadomości Autyzmu', 'niepełnosprawność'],
  ['04-07', 'Światowy Dzień Zdrowia', 'zdrowie'],
  ['04-22', 'Dzień Ziemi', 'ekologia'],
  ['04-23', 'Światowy Dzień Książki', 'kultura'],
  ['05-05', 'Europejski Dzień Walki z Dyskryminacją Osób z Niepełnosprawnościami', 'prawa'],
  ['05-15', 'Międzynarodowy Dzień Rodzin', 'rodzina'],
  ['05-26', 'Dzień Matki', 'rodzina'],
  ['06-01', 'Dzień Dziecka', 'rodzina'],
  ['06-05', 'Światowy Dzień Środowiska', 'ekologia'],
  ['06-23', 'Dzień Ojca', 'rodzina'],
  ['07-22', 'Światowy Dzień Mózgu', 'poznawcze'],
  ['07-30', 'Międzynarodowy Dzień Przyjaźni', 'relacje'],
  ['09-10', 'Światowy Dzień Zapobiegania Samobójstwom', 'zdrowie psychiczne'],
  ['09-21', 'Światowy Dzień Choroby Alzheimera', 'zdrowie'],
  ['09-23', 'Międzynarodowy Dzień Języków Migowych', 'niepełnosprawność'],
  ['09-30', 'Dzień Chłopaka', 'relacje'],
  ['10-01', 'Międzynarodowy Dzień Osób Starszych', 'pomoc społeczna'],
  ['10-06', 'Światowy Dzień Mózgowego Porażenia Dziecięcego', 'niepełnosprawność'],
  ['10-10', 'Światowy Dzień Zdrowia Psychicznego', 'zdrowie psychiczne'],
  ['10-14', 'Dzień Edukacji Narodowej', 'edukacja'],
  ['10-15', 'Międzynarodowy Dzień Białej Laski', 'niepełnosprawność'],
  ['10-27', 'Światowy Dzień Terapii Zajęciowej', 'WTZ'],
  ['11-13', 'Światowy Dzień Życzliwości (World Kindness Day)', 'relacje'],
  ['11-16', 'Międzynarodowy Dzień Tolerancji', 'prawa'],
  ['11-21', 'Dzień Pracownika Socjalnego / Światowy Dzień Życzliwości i Pozdrowień', 'pomoc społeczna'],
  ['11-25', 'Dzień Pluszowego Misia', 'emocje'],
  ['11-30', 'Andrzejki', 'tradycja'],
  ['12-03', 'Międzynarodowy Dzień Osób z Niepełnosprawnościami', 'prawa'],
  ['12-05', 'Międzynarodowy Dzień Wolontariusza', 'pomoc społeczna'],
  ['12-06', 'Mikołajki', 'tradycja'],
  ['12-10', 'Dzień Praw Człowieka', 'prawa']
];

function occasions(year) {
  const out = FIXED_OCCASIONS.map(([md, name, area]) => ({ date: `${year}-${md}`, name, area, type: 'occasion', source: 'baza' }));
  const e = easter(year);
  out.push({ date: iso(addDays(e, -52)), name: 'Tłusty czwartek', area: 'tradycja', type: 'occasion', source: 'baza' });
  out.push({ date: iso(nthWeekday(year, 3, 2, 3)), name: 'Światowy Dzień Pracy Socjalnej', area: 'pomoc społeczna', type: 'occasion', source: 'baza' });
  out.push({ date: iso(nthWeekday(year, 10, 5, 1)), name: 'Światowy Dzień Uśmiechu', area: 'emocje', type: 'occasion', source: 'baza' });
  const lastFeb = new Date(year, 2, 0);
  out.push({ date: iso(lastFeb), name: 'Dzień Chorób Rzadkich', area: 'zdrowie', type: 'occasion', source: 'baza' });
  return out;
}

class Calendar {
  constructor(store) { this.store = store; }

  holidaysInRange(from, to) {
    const out = [];
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) out.push(...publicHolidays(y));
    const a = iso(from), b = iso(to);
    return out.filter((h) => h.date >= a && h.date <= b);
  }

  occasionsInRange(from, to) {
    const a = iso(from), b = iso(to);
    const out = [];
    for (let y = from.getFullYear(); y <= to.getFullYear(); y++) out.push(...occasions(y));
    // uzupełnienia pobrane przez agenta z internetu
    for (const cache of Object.values(this.store.data.occasionsCache || {})) {
      for (const it of cache.items || []) {
        if (!out.some((o) => o.date === it.date && o.name.toLowerCase() === String(it.name).toLowerCase())) {
          out.push({ ...it, type: 'occasion', source: 'internet' });
        }
      }
    }
    return out.filter((o) => o.date >= a && o.date <= b).sort((x, y) => x.date.localeCompare(y.date));
  }

  dayInfo(dateStr) {
    const d = parseIso(dateStr);
    const holiday = publicHolidays(d.getFullYear()).find((h) => h.date === dateStr) || null;
    const occ = this.occasionsInRange(d, d);
    const off = this.store.data.daysOff[dateStr] || null;
    const sched = this.store.settings.schedule.days[d.getDay()] || { enabled: false };
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const workday = !holiday && !off && sched.enabled;
    return { date: dateStr, weekday: WEEKDAYS[d.getDay()], dow: d.getDay(), weekend, holiday, occasions: occ, dayOff: off, scheduled: sched, workday };
  }

  monthDays(key) {
    const [y, m] = key.split('-').map(Number);
    const days = [];
    const last = new Date(y, m, 0).getDate();
    for (let d = 1; d <= last; d++) days.push(this.dayInfo(`${key}-${pad(d)}`));
    return days;
  }

  // Okazje w oknie ±window dni wokół daty – kontekst dla generatora tematów
  occasionsNear(dateStr, before = 3, after = 7) {
    const d = parseIso(dateStr);
    const occ = this.occasionsInRange(addDays(d, -before), addDays(d, after));
    const hol = this.holidaysInRange(addDays(d, -before), addDays(d, after));
    return [...hol.map((h) => ({ date: h.date, name: h.name, area: 'święto państwowe' })), ...occ];
  }
}

function hoursBetween(start, end) {
  if (!start || !end) return 0;
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  const diff = (h2 * 60 + m2) - (h1 * 60 + m1);
  return diff > 0 ? diff / 60 : 0;
}

function roundHours(h, step) {
  if (!step) return h;
  return Math.round(h / step) * step;
}

function formatDate(dateStr, fmt) {
  const [y, m, d] = dateStr.split('-');
  return (fmt || 'DD.MM.RRRR').replace('RRRR', y).replace('MM', m).replace('DD', d);
}

module.exports = {
  Calendar, publicHolidays, occasions, easter, iso, parseIso, addDays, monthKey, pad,
  hoursBetween, roundHours, formatDate, MONTHS, MONTHS_GEN, WEEKDAYS
};

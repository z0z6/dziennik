'use strict';
// Zadania AI: analiza zdjęcia listy obecności, generowanie tematów zajęć, wyszukiwanie dni okolicznościowych.

const { extractJson } = require('./providers');
const { MONTHS, MONTHS_GEN, WEEKDAYS, parseIso, pad } = require('../calendar');

const CATEGORY_TEXT = {
  occasions: 'święta państwowe i dni okolicznościowe (zwłaszcza związane z niepełnosprawnością, zdrowiem psychicznym, pomocą społeczną i życzliwością)',
  psychoeducation: 'psychoedukacja: emocje, radzenie sobie ze stresem, poczucie własnej wartości, zdrowie psychiczne',
  social: 'umiejętności społeczne i komunikacja: asertywność, rozwiązywanie konfliktów, współpraca w grupie, savoir-vivre',
  independence: 'samodzielność i aktywizacja: przygotowanie do podjęcia pracy, zaradność życiowa, bezpieczeństwo, gospodarowanie pieniędzmi',
  rights: 'prawa osób z niepełnosprawnościami, samorzeczność, pomoc społeczna i instytucje wsparcia',
  relaxation: 'relaksacja i uważność: trening oddechowy, relaksacja Jacobsona, muzykoterapia, techniki wyciszenia',
  cognitive: 'trening funkcji poznawczych: pamięć, uwaga, koncentracja, myślenie przyczynowo-skutkowe'
};

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// ───────────────────────────── Lista obecności ─────────────────────────────

const ATTENDANCE_SYSTEM = `Jesteś asystentem, który dokładnie odczytuje zdjęcia papierowych list obecności pracownika (Polska, Warsztat Terapii Zajęciowej).
Lista ma zwykle wiersze dla kolejnych dni miesiąca (1–31) oraz kolumny takie jak: data/dzień, godzina przyjścia, godzina wyjścia, podpis, uwagi.
Oznaczenia w uwagach lub zamiast podpisu: U/UW – urlop, L4/CH/Ch – choroba, D/DS – delegacja, Ś – święto, W/WS/DW – dzień wolny, NN – nieobecność nieusprawiedliwiona, O/OP – opieka, S – szkolenie.
Zasady:
- Obecność = w wierszu dnia jest podpis (parafka) lub wpisane godziny pracy. Pusty wiersz = brak obecności.
- Godziny podawaj w formacie HH:MM (24h). Jeśli nie da się ich odczytać lub ich nie wpisano – zwróć null.
- Nie zgaduj: jeśli coś jest nieczytelne, ustaw niższe "confidence" i opisz to w "note".
- Jeśli na zdjęciu widać miesiąc/rok lub nazwisko – odczytaj je.`;

function attendancePrompt(monthKey, expectedName) {
  return `Odczytaj listę obecności za miesiąc: ${monthLabel(monthKey)} (${monthKey}).${expectedName ? ` Pracownik: ${expectedName}.` : ''}
Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json o strukturze:
{
  "month": "RRRR-MM lub null jeśli nie widać",
  "employeeName": "imię i nazwisko lub null",
  "days": [
    { "day": 3, "present": true, "signed": true, "start": "08:00", "end": "12:00", "mark": null, "confidence": 0.95, "note": "" }
  ],
  "warnings": ["krótkie uwagi o jakości zdjęcia lub wątpliwościach"]
}
W "days" umieść każdy dzień, w którego wierszu cokolwiek jest wpisane (podpis, godziny lub oznaczenie). "mark" to oznaczenie nieobecności (np. "U", "L4") albo null.`;
}

async function analyzeAttendance(provider, { images, monthKey, expectedName }) {
  const res = await provider.run({
    system: ATTENDANCE_SYSTEM,
    prompt: attendancePrompt(monthKey, expectedName),
    images,
    webSearch: false,
    maxTokens: 6000
  });
  const json = extractJson(res.text);
  const days = Array.isArray(json.days) ? json.days : [];
  const clean = days
    .map((d) => ({
      day: Number(d.day),
      present: Boolean(d.present),
      signed: Boolean(d.signed),
      start: validTime(d.start),
      end: validTime(d.end),
      mark: d.mark ? String(d.mark).toUpperCase().trim() : null,
      confidence: typeof d.confidence === 'number' ? Math.max(0, Math.min(1, d.confidence)) : 0.7,
      note: d.note ? String(d.note) : ''
    }))
    .filter((d) => d.day >= 1 && d.day <= 31);
  return {
    month: typeof json.month === 'string' && /^\d{4}-\d{2}$/.test(json.month) ? json.month : null,
    employeeName: json.employeeName || null,
    days: clean,
    warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : [],
    usage: res.usage || null
  };
}

function validTime(t) {
  if (!t || typeof t !== 'string') return null;
  const m = t.trim().replace('.', ':').match(/^(\d{1,2}):?(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return `${pad(h)}:${pad(mi)}`;
}

// ───────────────────────────── Tematy zajęć ─────────────────────────────

const STYLE_EXAMPLES = {
  slots: `Przykład wpisu (poniedziałek 12:00–15:30):
- 12:00–12:45 | Poniedziałkowy krąg: Dzielenie się pozytywnymi wydarzeniami z ostatnich dni, aktywizacja osób wycofanych.
- 12:45–14:00 | Rynek pracy chronionej: Kim jest pracodawca i czego od nas oczekuje? (punktualność, dbanie o czystość na stanowisku – proste case study z piktogramami).
- 14:00–15:00 | Wsparcie indywidualne (uczestnik z niepełnosprawnością intelektualną w stopniu umiarkowanym – trening komunikowania potrzeb).
- 15:00–15:30 | Konsultacje z instruktorami terapii zajęciowej odnośnie bieżącego funkcjonowania uczestników w pracowniach.
Przykład wpisu (środa 08:00–11:00):
- 08:00–08:45 | Poranne ćwiczenia pamięci i spostrzegawczości (łamigłówki, układanki tematyczne).
- 08:45–10:00 | Prawa i ulgi: Ulgi w komunikacji miejskiej i PKP (praktyczne ćwiczenie: jak pokazać legitymację konduktorowi i kupić bilet ze zniżką).
- 10:00–11:00 | Indywidualna sesja terapeutyczna (uczestnik z zespołem Downa – stymulacja rozwoju emocjonalnego i ekspresji słownej).`,
  bullets: `Przykład wpisu:
- Zajęcia grupowe: Omówienie noworocznych postanowień w kontekście rehabilitacji społecznej (proste cele osobiste, np. "więcej rozmów z innymi").
- Wprowadzenie do ulg dla osób niepełnosprawnych (np. zniżki na transport – przykłady z kartkami i rysunkami).
- Ćwiczenia relaksacyjne.`
};

function topicsSystem(settings) {
  const t = settings.topics;
  const style = (settings.document && settings.document.format && settings.document.format.entryStyle) || 'slots';
  const cats = Object.entries(t.categories).filter(([, on]) => on).map(([k]) => '- ' + CATEGORY_TEXT[k]).join('\n');
  return `Jesteś doświadczonym psychologiem pracującym w Warsztacie Terapii Zajęciowej (WTZ) w Polsce i pomagasz prowadzić „Dziennik psychologa”.
Uczestnicy: ${t.participantsProfile}.
Każdy wpis w dzienniku to plan jednego dnia pracy psychologa: 3–4 punkty w kolumnie „Temat zajęć (opis wykonywanych zajęć, czynności przeprowadzonych)”.
${style === 'slots'
    ? 'Każdy punkt zaczyna się od przedziału czasu „HH:MM–HH:MM | ” (z półpauzą), przedziały następują po sobie bez przerw i dokładnie wypełniają godziny pracy danego dnia.'
    : 'Punkty nie zawierają godzin.'}
Typowe elementy: zajęcia grupowe (psychoedukacja, trening umiejętności społecznych, relaksacja, trening funkcji poznawczych), moduł edukacyjny o prawach, ulgach i uprawnieniach osób z niepełnosprawnościami, rynku pracy chronionej, zatrudnieniu wspomaganym, instytucjach pomocy społecznej (MOPS, PCPR), indywidualne sesje lub rozmowy wspierające (z ogólnym opisem uczestnika, np. „uczestnik ze schizofrenią”, bez nazwisk), a na końcu dnia czasem praca administracyjna lub konsultacje z kadrą WTZ.
Zasady:
- Pisz konkretnie, zwięźle i w stylu dziennika: „Nazwa bloku: opis (szczegóły metod / przykłady)”. Jeden punkt to maks. ok. 250 znaków.
- Treści dostosowane do możliwości poznawczych uczestników (proste wyjaśnienia, piktogramy, scenki, gry). Język szanujący godność.
- Nie powtarzaj tematów zrealizowanych wcześniej (lista zostanie podana) – możesz kontynuować cykle, ale z nowym zagadnieniem.
- Trzy propozycje dla jednego dnia muszą się wyraźnie różnić głównym tematem. Jeśli w pobliżu daty (do ok. 7 dni) przypada święto lub dzień okolicznościowy związany z tematyką WTZ, niepełnosprawnością, zdrowiem psychicznym, pomocą społeczną lub tradycją – co najmniej jedna propozycja ma do niego nawiązywać.
- Poniedziałek może otwierać tydzień (krąg, plany), piątek go podsumowywać.
Dozwolone obszary tematyczne:
${cats}
${STYLE_EXAMPLES[style]}
${t.extraInstructions ? `\nDodatkowe wskazówki użytkownika: ${t.extraInstructions}` : ''}`;
}

function shortTopic(items) {
  return (items || []).map((s) => String(s).replace(/^\s*\d{1,2}:\d{2}\s*[–-]\s*\d{1,2}:\d{2}\s*\|\s*/, '').split(/[:(]/)[0].trim().slice(0, 70)).filter(Boolean).join('; ');
}

function topicsPrompt({ days, recent, webSearch, style }) {
  const lines = days.map((d) => {
    const dt = parseIso(d.date);
    const near = (d.near || []).map((o) => `${o.date}: ${o.name}`).join('; ');
    return `- ${d.date} (${WEEKDAYS[dt.getDay()]}, ${dt.getDate()} ${MONTHS_GEN[dt.getMonth()]}), godziny pracy ${d.start}–${d.end}${near ? ` | okazje w pobliżu: ${near}` : ''}`;
  }).join('\n');
  const rec = recent.length ? recent.slice(-50).map((r) => `- ${r.date}: ${r.items ? shortTopic(r.items) : r.title}`).join('\n') : '(brak)';
  const itemShape = style === 'slots' ? '{ "time": "HH:MM–HH:MM", "text": "Nazwa bloku: opis" }' : '{ "text": "Nazwa bloku: opis" }';
  return `${webSearch ? 'Najpierw krótko sprawdź w internecie (maks. kilka wyszukiwań), czy w tym okresie w Polsce przypadają aktualne dni okolicznościowe, kampanie społeczne, zmiany w uprawnieniach osób z niepełnosprawnościami lub wydarzenia związane z WTZ, których nie ma na liście poniżej. Wykorzystaj je w propozycjach.\n\n' : ''}Przygotuj po 3 alternatywne propozycje wpisu (planu dnia) dla każdego z dni:
${lines}

Tematy zrealizowane wcześniej (nie powtarzaj ich):
${rec}

Zwróć WYŁĄCZNIE JSON w bloku \`\`\`json:
{
  "days": [
    {
      "date": "RRRR-MM-DD",
      "proposals": [
        { "title": "główny temat dnia (krótko)", "category": "obszar", "occasion": "nawiązanie do święta/dnia okolicznościowego lub pusty tekst", "items": [ ${itemShape} ] }
      ]
    }
  ]
}`;
}

function toMinutes(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function fromMinutes(n) { return `${pad(Math.floor(n / 60))}:${pad(n % 60)}`; }

// Uporządkowanie przedziałów czasu: muszą zaczynać się o start i kończyć o end
function normalizeSlots(items, start, end) {
  const parsed = items.map((it) => {
    const m = String(it.time || '').match(/(\d{1,2})[:.](\d{2})\s*[–-]\s*(\d{1,2})[:.](\d{2})/);
    return { s: m ? Number(m[1]) * 60 + Number(m[2]) : null, e: m ? Number(m[3]) * 60 + Number(m[4]) : null, text: String(it.text || '').trim() };
  }).filter((x) => x.text);
  if (!parsed.length || !start || !end) return parsed.map((x) => x.text);
  const S = toMinutes(start), E = toMinutes(end);
  const valid = parsed.every((x, i) => x.s != null && x.e > x.s && (i === 0 || x.s === parsed[i - 1].e)) && parsed[0].s === S && parsed[parsed.length - 1].e === E;
  if (!valid) {
    // rozłóż proporcjonalnie, zaokrąglając do 15 min
    const n = parsed.length;
    const durs = parsed.map((x) => (x.s != null && x.e > x.s ? x.e - x.s : (E - S) / n));
    const total = durs.reduce((a, b) => a + b, 0);
    let cur = S;
    parsed.forEach((x, i) => {
      x.s = cur;
      x.e = i === n - 1 ? E : Math.min(E, cur + Math.max(15, Math.round(((durs[i] / total) * (E - S)) / 15) * 15));
      cur = x.e;
    });
  }
  return parsed.map((x) => `${fromMinutes(x.s)}–${fromMinutes(x.e)} | ${x.text}`);
}

async function generateTopics(provider, settings, { days, recent }) {
  const useWeb = settings.ai.useWebSearch;
  const style = (settings.document && settings.document.format && settings.document.format.entryStyle) || 'slots';
  const res = await provider.run({
    system: topicsSystem(settings),
    prompt: topicsPrompt({ days, recent, webSearch: useWeb, style }),
    webSearch: useWeb,
    maxTokens: 16000
  });
  const json = extractJson(res.text);
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const out = {};
  for (const d of json.days || []) {
    if (!d || !d.date || !byDate[d.date]) continue;
    const day = byDate[d.date];
    out[d.date] = (d.proposals || []).slice(0, 3).map((p) => {
      const rawItems = (p.items || []).map((it) => (typeof it === 'string' ? { text: it } : it));
      const items = style === 'slots' ? normalizeSlots(rawItems, day.start, day.end) : rawItems.map((it) => String(it.text || '').trim()).filter(Boolean);
      return {
        title: String(p.title || '').trim(),
        category: String(p.category || '').trim(),
        occasion: String(p.occasion || '').trim(),
        items
      };
    }).filter((p) => p.items.length);
  }
  return out;
}

// ───────────────────────────── Dni okolicznościowe z internetu ─────────────────────────────

async function lookupOccasions(provider, monthKey) {
  const res = await provider.run({
    system: 'Jesteś asystentem psychologa w Warsztacie Terapii Zajęciowej w Polsce. Wyszukujesz rzetelne informacje w internecie.',
    prompt: `Wyszukaj w internecie dni okolicznościowe, święta i kampanie społeczne obchodzone w Polsce lub na świecie w miesiącu ${monthLabel(monthKey)}, które są przydatne jako inspiracja do zajęć z psychologiem w WTZ: związane z niepełnosprawnością, zdrowiem psychicznym, pomocą społeczną, relacjami, emocjami, tolerancją, zdrowiem lub tradycjami.
Podaj tylko pozycje z potwierdzoną datą w tym miesiącu (dla dat ruchomych – data w roku ${monthKey.slice(0, 4)}).
Zwróć WYŁĄCZNIE JSON w bloku \`\`\`json: { "items": [ { "date": "RRRR-MM-DD", "name": "nazwa", "why": "dlaczego pasuje do zajęć w WTZ (krótko)" } ] }`,
    webSearch: true,
    maxTokens: 4000
  });
  const json = extractJson(res.text);
  return (json.items || [])
    .filter((i) => i && typeof i.date === 'string' && i.date.startsWith(monthKey) && i.name)
    .map((i) => ({ date: i.date.slice(0, 10), name: String(i.name).trim(), why: String(i.why || '').trim(), area: 'internet' }));
}


// ───────────────────────────── Lista obecności uczestników ─────────────────────────────

const PARTICIPANTS_SYSTEM = `Jesteś asystentem, który bardzo dokładnie odczytuje zdjęcia papierowych list obecności UCZESTNIKÓW Warsztatu Terapii Zajęciowej (Polska).
Spotykane są dwa układy:
A) „Wykaz obecności uczestnika” – karta JEDNEJ osoby na cały rok: wiersze 1–31 to dni miesiąca, kolumny I–XII to miesiące. Imię i nazwisko jest w nagłówku karty. Zdjęcie może być obrócone o 90°.
B) Lista miesięczna grupy – wiersze to uczestnicy, kolumny to dni miesiąca 1–31.
Oznaczenia (ustal je z samej listy, jeśli jest legenda):
- obecność: „+”, „✓”, „ob”, podpis/parafka;
- brak obecności: „—” (kreska: weekend, święto, dzień bez zajęć lub nieobecność), „U”/„u” (urlop), „ch”/„L4” (choroba), „nb”, puste pole;
- przekreślenie kilku komórek dużym „X” = przerwa w działalności warsztatu (brak obecności).
Sprawdzaj numery wierszy i nagłówki kolumn, żeby poprawnie przypisać dni do miesięcy. Nie zgaduj – nieczytelne pola wpisz do "uncertain".
Imiona i nazwiska przepisuj dokładnie, z polskimi znakami, w kolejności „Imię Nazwisko”.`;

async function analyzeParticipantsAttendance(provider, { images, monthKey }) {
  const year = monthKey.slice(0, 4);
  const res = await provider.run({
    system: PARTICIPANTS_SYSTEM,
    prompt: `Odczytaj listy obecności uczestników ze zdjęć (rok ${year}${monthKey ? `, wybrany miesiąc: ${monthLabel(monthKey)}` : ''}). Dla kart rocznych (układ A) odczytaj WSZYSTKIE wypełnione miesiące.
Zwróć WYŁĄCZNIE obiekt JSON w bloku \`\`\`json:
{
  "layout": "A lub B",
  "legend": "jakie oznaczenia rozpoznałeś",
  "participants": [
    { "name": "Imię Nazwisko", "months": { "${year}-01": [7, 8, 9], "${year}-02": [2, 3] }, "uncertain": { "${year}-01": [12] } }
  ],
  "breaks": ["${year}-07-20 – ${year}-08-17 (przekreślone)"],
  "warnings": ["krótkie uwagi"]
}
W "months" podaj numery dni, w których uczestnik był OBECNY (oznaczenie „+” lub podpis). Klucze miesięcy w formacie RRRR-MM.`,
    images,
    webSearch: false,
    maxTokens: 16000
  });
  const json = extractJson(res.text);
  const toDays = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((d) => d >= 1 && d <= 31))].sort((x, y) => x - y);
  const toMonths = (o) => {
    const out = {};
    for (const [k, v] of Object.entries(o && typeof o === 'object' ? o : {})) if (/^\d{4}-\d{2}$/.test(k)) out[k] = toDays(v);
    return out;
  };
  return {
    layout: json.layout || '',
    legend: json.legend ? String(json.legend) : '',
    participants: (json.participants || []).filter((p) => p && p.name).map((p) => {
      // zgodność wstecz: { days: [...] } dla listy miesięcznej
      const months = p.months ? toMonths(p.months) : { [monthKey]: toDays(p.days) };
      return { name: String(p.name).trim(), months, uncertain: toMonths(p.uncertain) };
    }),
    breaks: Array.isArray(json.breaks) ? json.breaks.map(String) : [],
    warnings: Array.isArray(json.warnings) ? json.warnings.map(String) : []
  };
}

module.exports = { analyzeParticipantsAttendance, analyzeAttendance, generateTopics, lookupOccasions, validTime, topicsSystem, topicsPrompt, normalizeSlots, shortTopic };

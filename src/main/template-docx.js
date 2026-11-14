'use strict';
// Generowanie dziennika na bazie wzoru .docx użytkownika.
// Zasada: niczego nie przebudowujemy – bierzemy pierwszą tabelę z wzoru, jej wiersz nagłówka
// i pierwszy wiersz z wpisem jako prototyp formatowania (czcionki, rozmiary, punktory, wysokość),
// a następnie wstawiamy nowe wiersze o identycznej strukturze. Reszta dokumentu zostaje bez zmian.

const JSZip = require('jszip');
const { WEEKDAYS, parseIso, hoursBetween } = require('./calendar');

const DEFAULT_FORMAT = {
  dateFormat: 'DD.MM.RR',
  timeStyle: 'dot', // 'dot' → 8.00-11.00 | 'colon' → 08:00-11:00
  hoursTemplate: '( {h} h )',
  entryStyle: 'slots', // 'slots' → „12:00–12:45 | …” | 'bullets' → punkty bez godzin
  includeAbsences: true,
  absenceShowsHours: true
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// ─────────────── parsowanie XML (świadome zagnieżdżeń) ───────────────

function findBlocks(xml, tag, from = 0, to = xml.length) {
  // zwraca bloki najwyższego poziomu <w:tag ...>...</w:tag> w zakresie
  const open = new RegExp(`<w:${tag}(?=[\\s>/])[^>]*?(/?)>|</w:${tag}>`, 'g');
  open.lastIndex = from;
  const out = [];
  let depth = 0;
  let start = -1;
  let m;
  while ((m = open.exec(xml)) && m.index < to) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) out.push({ start, end: m.index + m[0].length });
    } else if (m[1] === '/') {
      if (depth === 0) out.push({ start: m.index, end: m.index + m[0].length });
    } else {
      if (depth === 0) start = m.index;
      depth++;
    }
  }
  return out;
}

function firstTable(xml) {
  const body = xml.indexOf('<w:body>');
  const t = findBlocks(xml, 'tbl', body)[0];
  if (!t) throw new Error('We wzorze nie znaleziono tabeli dziennika.');
  return t;
}

function childBlocks(xml, block, tag) {
  return findBlocks(xml, tag, block.start + 1, block.end - 1).map((b) => ({ ...b, xml: xml.slice(b.start, b.end) }));
}

function inner(xml, tag) {
  const b = findBlocks(xml, tag)[0];
  return b ? xml.slice(b.start, b.end) : '';
}

function paraText(pXml) {
  const parts = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g;
  let m;
  while ((m = re.exec(pXml))) parts.push(m[1] != null ? unesc(m[1]) : (m[0] === '<w:tab/>' ? '\t' : '\n'));
  return parts.join('');
}

function cellParas(cellXml) {
  return findBlocks(cellXml, 'p').map((b) => cellXml.slice(b.start, b.end));
}

function cellLines(cellXml) {
  return cellParas(cellXml).map(paraText).map((s) => s.trim()).filter(Boolean);
}

// ─────────────── formatowanie wartości ───────────────

function fmtDate(dateStr, fmt) {
  const [y, m, d] = dateStr.split('-');
  return (fmt || 'DD.MM.RR').replace('RRRR', y).replace('RR', y.slice(2)).replace('MM', m).replace('DD', d);
}

function fmtTime(t, style) {
  if (!t) return '';
  const [h, m] = t.split(':');
  return style === 'colon' ? `${h}:${m}` : `${Number(h)}.${m}`;
}

function fmtHoursNum(h) {
  const n = Math.round(Number(h) * 100) / 100;
  return String(n).replace('.', ',');
}

function rowValues(entry, fmt) {
  const d = parseIso(entry.date);
  const weekday = WEEKDAYS[d.getDay()] + (entry.weekdayNote ? ` ( ${entry.weekdayNote} )` : '');
  const showHours = !entry.absent || fmt.absenceShowsHours;
  const timeLine = showHours && entry.start && entry.end ? `${fmtTime(entry.start, fmt.timeStyle)}-${fmtTime(entry.end, fmt.timeStyle)}` : '';
  const hours = entry.hours != null && entry.hours !== '' ? entry.hours : hoursBetween(entry.start, entry.end);
  const hoursLine = showHours && hours ? (fmt.hoursTemplate || '( {h} h )').replace('{h}', fmtHoursNum(hours)) : '';
  let items;
  if (entry.absent) items = [entry.absenceLabel || 'Dzień wolny'];
  else items = ((entry.topic && entry.topic.items) || []).map((s) => String(s).trim()).filter(Boolean);
  return {
    date: [fmtDate(entry.date, fmt.dateFormat), weekday],
    topic: items,
    notes: [timeLine, hoursLine].filter(Boolean),
    time: timeLine ? [timeLine] : [],
    hours: hoursLine ? [hoursLine] : [],
    participant: entry.participantName ? [entry.participantName] : [],
    signature: [],
    other: []
  };
}

// ─────────────── role kolumn na podstawie nagłówka ───────────────

function roleFor(label) {
  const l = label.toLowerCase();
  if (/^data|\bdata\b|dzień/.test(l)) return 'date';
  if (/temat|opis|zaj[eę]/.test(l)) return 'topic';
  if (/podpis/.test(l)) return 'signature';
  if (/imi[eę]|nazwisk|uczestnik/.test(l)) return 'participant';
  if (/uwagi/.test(l)) return 'notes';
  if (/liczba godzin|godzin/.test(l)) return 'hours';
  if (/godz|czas/.test(l)) return 'time';
  return 'other';
}

// ─────────────── budowanie XML wiersza ───────────────

function runRPr(pXml) {
  const r = findBlocks(pXml, 'r')[0];
  if (r) {
    const rp = inner(pXml.slice(r.start, r.end), 'rPr');
    if (rp) return rp;
  }
  const ppr = inner(pXml, 'pPr');
  return ppr ? inner(ppr, 'rPr') : '';
}

function buildPara(proto, text) {
  const pPr = inner(proto, 'pPr');
  const rPr = runRPr(proto);
  const pOpen = (proto.match(/^<w:p(?=[\s>])[^>]*>/) || ['<w:p>'])[0];
  const runs = text ? `<w:r>${rPr}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>` : `<w:r>${rPr}</w:r>`;
  return `${pOpen}${pPr}${runs}</w:p>`;
}

class Template {
  constructor(zip, xml) {
    this.zip = zip;
    this.xml = xml;
    this.tbl = firstTable(xml);
    const rows = childBlocks(xml, this.tbl, 'tr');
    if (rows.length < 2) throw new Error('Wzór musi zawierać nagłówek tabeli i co najmniej jeden wiersz z wpisem (prototyp formatowania).');
    this.rows = rows;
    this.header = rows[0];
    const headerCells = childBlocks(this.header.xml, { start: 0, end: this.header.xml.length }, 'tc');
    this.roles = headerCells.map((c) => roleFor(cellLines(c.xml).join(' ')));
    // prototyp: pierwszy wiersz z datą i punktorem w kolumnie tematu (jeśli jest), inaczej pierwszy wiersz danych
    const dataRows = rows.slice(1);
    const hasBullet = (r) => {
      const cells = childBlocks(r.xml, { start: 0, end: r.xml.length }, 'tc');
      const ti = this.roles.indexOf('topic');
      return ti >= 0 && cells[ti] && /<w:numPr>/.test(cells[ti].xml);
    };
    const proto = dataRows.find((r) => hasBullet(r) && parseRowDate(r.xml)) || dataRows[0];
    this.protoRow = proto.xml;
    this.protoCells = childBlocks(proto.xml, { start: 0, end: proto.xml.length }, 'tc').map((c) => c.xml);
    this.trOpen = (proto.xml.match(/^<w:tr(?=[\s>])[^>]*>/) || ['<w:tr>'])[0];
    this.trPr = inner(proto.xml, 'trPr');
  }

  static async load(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const f = zip.file('word/document.xml');
    if (!f) throw new Error('To nie jest prawidłowy plik .docx.');
    return new Template(zip, await f.async('string'));
  }

  renderRow(entry, fmt) {
    const vals = rowValues(entry, fmt);
    const cells = this.protoCells.map((cellXml, i) => {
      const role = this.roles[i] || 'other';
      const tcPr = inner(cellXml, 'tcPr');
      const paras = cellParas(cellXml);
      const lines = vals[role] || [];
      let body;
      if (role === 'topic') {
        const bulletProto = paras.find((p) => /<w:numPr>/.test(p)) || paras[0];
        body = lines.length ? lines.map((ln) => buildPara(bulletProto, ln)).join('') : buildPara(paras.find((p) => !/<w:numPr>/.test(p)) || paras[0], '');
      } else if (lines.length) {
        body = lines.map((ln, j) => buildPara(paras[Math.min(j, paras.length - 1)], ln)).join('');
      } else {
        body = buildPara(paras[0] || '<w:p></w:p>', '');
      }
      return `<w:tc>${tcPr}${body}</w:tc>`;
    });
    return `${this.trOpen}${this.trPr}${cells.join('')}</w:tr>`;
  }

  existingRows() {
    return this.rows.slice(1).map((r) => ({ ...r, date: parseRowDate(r.xml) }));
  }

  async build({ entries, fmt, mode = 'new', replaceExisting = true }) {
    const f = { ...DEFAULT_FORMAT, ...(fmt || {}) };
    const list = entries.filter((e) => f.includeAbsences || !e.absent).sort((a, b) => a.date.localeCompare(b.date));
    const stats = { added: 0, replaced: 0, skipped: 0 };
    let rowsOut; // tablica { date, xml }
    if (mode === 'append') {
      rowsOut = this.existingRows().map((r) => ({ date: r.date, xml: r.xml }));
      for (const e of list) {
        const xml = this.renderRow(e, f);
        const idx = rowsOut.findIndex((r) => r.date === e.date);
        if (idx >= 0) {
          if (replaceExisting) { rowsOut[idx] = { date: e.date, xml }; stats.replaced++; } else stats.skipped++;
          continue;
        }
        // wstaw po ostatnim wierszu o wcześniejszej dacie
        let pos = rowsOut.length;
        for (let i = rowsOut.length - 1; i >= 0; i--) {
          if (rowsOut[i].date && rowsOut[i].date > e.date) pos = i; else if (rowsOut[i].date) break;
        }
        rowsOut.splice(pos, 0, { date: e.date, xml });
        stats.added++;
      }
    } else {
      rowsOut = list.map((e) => ({ date: e.date, xml: this.renderRow(e, f) }));
      stats.added = rowsOut.length;
    }
    const tblXml = this.xml.slice(this.tbl.start, this.tbl.end);
    const firstRowStart = this.rows[0].start - this.tbl.start;
    const lastRowEnd = this.rows[this.rows.length - 1].end - this.tbl.start;
    const newTbl = tblXml.slice(0, firstRowStart) + this.header.xml + rowsOut.map((r) => r.xml).join('') + tblXml.slice(lastRowEnd);
    const newXml = this.xml.slice(0, this.tbl.start) + newTbl + this.xml.slice(this.tbl.end);
    // nowe archiwum bez wpisów katalogów (Word potrafi odrzucić plik z nimi w usługach chmurowych);
    // [Content_Types].xml zostaje na początku archiwum
    const outZip = new JSZip();
    const names = Object.keys(this.zip.files).filter((k) => !this.zip.files[k].dir);
    names.sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
    for (const name of names) {
      const data = name === 'word/document.xml' ? newXml : await this.zip.files[name].async('uint8array');
      outZip.file(name, data, { createFolders: false });
    }
    const buffer = await outZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    return { buffer, stats };
  }

  // Odczyt wpisów z istniejącego dziennika (historia)
  readEntries() {
    const out = [];
    for (const r of this.rows.slice(1)) {
      const date = parseRowDate(r.xml);
      if (!date) continue;
      const cells = childBlocks(r.xml, { start: 0, end: r.xml.length }, 'tc').map((c) => cellLines(c.xml));
      const get = (role) => { const i = this.roles.indexOf(role); return i >= 0 ? cells[i] || [] : []; };
      const items = get('topic');
      const notes = [...get('notes'), ...get('time'), ...get('hours')].join(' ');
      const tm = notes.match(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/);
      const start = tm ? `${tm[1].padStart(2, '0')}:${tm[2]}` : null;
      const end = tm ? `${tm[3].padStart(2, '0')}:${tm[4]}` : null;
      const hm = notes.match(/\(\s*([\d,.]+)\s*h/);
      const hours = hm ? Number(hm[1].replace(',', '.')) : hoursBetween(start, end);
      const joined = items.join(' ').toLowerCase();
      const absent = items.length <= 1 && /urlop|dzień wolny|dzien wolny|zwolnienie|l4|wolne/.test(joined);
      const dateLines = get('date');
      const wd = dateLines[1] || '';
      const noteMatch = wd.match(/\(\s*([\s\S]*?)\s*\)/);
      out.push({
        date, start, end, hours, absent,
        absenceLabel: absent ? items[0] : '',
        items: absent ? [] : items,
        weekdayNote: noteMatch ? noteMatch[1].replace(/\s+/g, ' ').replace(/-\s+/g, '') : ''
      });
    }
    return out;
  }
}

function parseRowDate(rowXml) {
  const tc = findBlocks(rowXml, 'tc')[0];
  if (!tc) return null;
  const txt = cellLines(rowXml.slice(tc.start, tc.end)).join(' ');
  const m = txt.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

module.exports = { Template, DEFAULT_FORMAT, rowValues, fmtDate, fmtTime, parseRowDate, roleFor };

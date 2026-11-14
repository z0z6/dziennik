'use strict';
// Testy logiki bez Electrona: node test/run-tests.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { publicHolidays, easter, Calendar, hoursBetween, roundHours } = require('../src/main/calendar');
const { Store } = require('../src/main/store');
const { Journal } = require('../src/main/journal');
const { Template } = require('../src/main/template-docx');
const { extractJson } = require('../src/main/ai/providers');
const { validTime } = require('../src/main/ai/tasks');

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log('✓', name); }, (e) => { console.error('✗', name, '\n ', e.stack); process.exitCode = 1; });

(async () => {
  await t('Wielkanoc', () => {
    assert.strictEqual(easter(2026).toDateString(), new Date(2026, 3, 5).toDateString());
    assert.strictEqual(easter(2027).toDateString(), new Date(2027, 2, 28).toDateString());
  });
  await t('Święta 2026 (z Wigilią)', () => {
    const h = publicHolidays(2026).map((x) => x.date);
    for (const d of ['2026-01-01', '2026-04-06', '2026-06-04', '2026-11-11', '2026-12-24']) assert(h.includes(d), d);
    assert.strictEqual(h.length, 14);
  });
  await t('Godziny', () => {
    assert.strictEqual(hoursBetween('08:00', '12:30'), 4.5);
    assert.strictEqual(roundHours(4.4, 0.5), 4.5);
    assert.strictEqual(validTime('7.30'), '07:30');
    assert.strictEqual(validTime('25:00'), null);
  });
  await t('extractJson', () => {
    assert.deepStrictEqual(extractJson('Tekst\n```json\n{"a":1}\n```'), { a: 1 });
    assert.deepStrictEqual(extractJson('prefix {"b":[1,2]} suffix'), { b: [1, 2] });
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dz-test-'));
  const store = new Store(dir);
  store.updateSettings({ profile: { name: 'Jan Kowalski', city: 'Kraków' } });
  const cal = new Calendar(store);
  const j = new Journal(store, cal);

  await t('Przegląd listy obecności + ostrzeżenia', () => {
    const r = j.reviewAttendance('2026-11', {
      month: '2026-11',
      days: [
        { day: 2, present: true, signed: true, start: null, end: null, mark: null, confidence: 0.9 },
        { day: 3, present: true, signed: true, start: '08:00', end: '13:00', mark: null, confidence: 0.95 },
        { day: 4, present: false, signed: false, start: null, end: null, mark: 'U', confidence: 0.9 },
        { day: 11, present: true, signed: true, start: '08:00', end: '12:00', mark: null, confidence: 0.4 }
      ],
      warnings: []
    });
    assert.strictEqual(r.proposed[0].start, '12:00');
    assert.strictEqual(r.proposed[1].hours, 5);
    assert.strictEqual(r.proposed[2].present, false);
    assert(r.issues.some((i) => /święto/.test(i.text)));
    assert(r.issues.some((i) => /niepewny/.test(i.text)));
    j.applyAttendance('2026-11', r.proposed);
    j.updateDay('2026-11-03', { topic: { title: 'Emocje', items: ['08:00–09:00 | Rozpoznawanie i nazywanie emocji – praca z kartami emocji.', '09:00–13:00 | Trening relaksacyjny & „oddech” <test>.'] } });
    j.updateDay('2026-11-02', { topic: { title: 'Życzliwość', items: ['12:00–13:30 | Życzliwość na co dzień: jak okazywać szacunek innym.', '13:30–15:30 | Indywidualne rozmowy wspierające.'] } });
  });

  const tplPath = path.join(__dirname, '..', 'src', 'assets', 'wzor-dziennika.docx');
  await t('Eksport DOCX z wbudowanego wzoru', async () => {
    const entries = j.entriesForExport('2026-11');
    assert.strictEqual(entries.length, 4); // 3 obecności + urlop
    const tpl = await Template.load(fs.readFileSync(tplPath));
    assert.deepStrictEqual(tpl.roles, ['date', 'participant', 'topic', 'signature', 'notes']);
    const { buffer, stats } = await tpl.build({ entries, fmt: store.settings.document.format, mode: 'new' });
    assert.strictEqual(stats.added, 4);
    fs.writeFileSync(path.join(__dirname, 'out-nowy.docx'), buffer);
    const back = (await Template.load(buffer)).readEntries();
    assert.strictEqual(back.length, 4);
    assert.strictEqual(back[0].date, '2026-11-02');
    assert.strictEqual(back[0].start, '12:00');
    assert.strictEqual(back[2].absent, true);
    assert(back[1].items[1].includes('& „oddech” <test>'));
  });

  const orig = process.env.WZOR;
  if (orig && fs.existsSync(orig)) {
    await t('Import historii i dopisywanie do oryginalnego dziennika', async () => {
      const tpl = await Template.load(fs.readFileSync(orig));
      const rows = tpl.readEntries();
      assert(rows.length > 50, 'wpisy: ' + rows.length);
      const res = j.importHistory(rows);
      assert(res.added > 50);
      const thursday = rows.find((r) => r.weekdayNote);
      assert(thursday, 'dopisek przy dniu tygodnia');
      const entries = j.entriesInRange('2026-11-01', '2026-11-30');
      const tpl2 = await Template.load(fs.readFileSync(orig));
      const { buffer, stats } = await tpl2.build({ entries, fmt: store.settings.document.format, mode: 'append' });
      assert.strictEqual(stats.added, 4);
      fs.writeFileSync(path.join(__dirname, 'out-dopisany.docx'), buffer);
      const again = await Template.load(buffer);
      assert.strictEqual(again.readEntries().length, rows.length + 4);
    });
  }

  console.log(`\n${passed} testów zaliczonych`);
})();

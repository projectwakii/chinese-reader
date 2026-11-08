import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { Storage, SECRET_SETTINGS } from '../src/storage.js';
import { schedule, newCard, dueCards, localDate, previewIntervals } from '../src/srs.js';
import { toAnkiTsv, ANKI_COLUMNS } from '../src/anki.js';

// Frozen local clock: 2026-03-10 09:30 local time
const T0 = new Date(2026, 2, 10, 9, 30, 0);
const at = (days, hour = 9) => new Date(2026, 2, 10 + days, hour, 30, 0);

function freshStorage(idb = new IDBFactory(), now = () => T0) {
  return new Storage({ indexedDB: idb, name: 'test-db', now });
}

test('selection save persists to storage and survives a second load', async () => {
  const idb = new IDBFactory();
  const s1 = freshStorage(idb);
  await s1.saveWord({ word: '学习', pinyin: 'xué xí', pinyinSource: 'mmah-charwise', context: { zh: '我爱学习中文。', en: 'I love studying Chinese.' } });
  s1.close();

  const s2 = freshStorage(idb); // new connection = app reload
  const card = await s2.getWord('学习');
  assert.equal(card.word, '学习');
  assert.equal(card.pinyin, 'xué xí');
  assert.equal(card.context.zh, '我爱学习中文。');
  assert.equal(card.context.en, 'I love studying Chinese.');
  assert.equal(card.createdAt, T0.toISOString());
  assert.equal(card.easiness, 2.5);
  assert.equal(card.repetitions, 0);
  assert.equal(card.dueAt, '2026-03-10');
  assert.equal(card.lastResult, null);
  assert.deepEqual(card.savedExamples, []);
  // saving again merges a new context instead of duplicating
  await s2.saveWord({ word: '学习', context: { zh: '学习要每天坚持。' } });
  assert.equal((await s2.listWords()).length, 1);
  assert.equal((await s2.getWord('学习')).contexts.length, 2);
});

test('notes persistence: updating notes on a word persists across reload', async () => {
  const idb = new IDBFactory();
  let now = T0;
  const s1 = new Storage({ indexedDB: idb, name: 'notes', now: () => now });
  await s1.saveWord({ word: '书' });
  now = at(1);
  await s1.updateNotes('书', '书 = book; 读书 = to study');
  s1.close();
  const s2 = new Storage({ indexedDB: idb, name: 'notes' });
  const card = await s2.getWord('书');
  assert.equal(card.notes, '书 = book; 读书 = to study');
  assert.equal(card.updatedAt, at(1).toISOString());
  assert.equal(card.createdAt, T0.toISOString());
});

test('SM-2: Good, Good, Good, then Again with frozen clock', () => {
  let card = newCard(T0);
  assert.equal(card.dueAt, '2026-03-10');

  card = { ...card, ...schedule(card, 'good', T0) };
  assert.equal(card.repetitions, 1);
  assert.equal(card.intervalDays, 1);
  assert.equal(card.easiness, 2.5);
  assert.equal(card.dueAt, '2026-03-11');
  assert.equal(card.lastResult, 'good');

  card = { ...card, ...schedule(card, 'good', at(1)) };
  assert.equal(card.intervalDays, 6);
  assert.equal(card.dueAt, '2026-03-17');

  card = { ...card, ...schedule(card, 'good', at(7)) };
  assert.equal(card.intervalDays, 15); // round(6 * 2.5)
  assert.equal(card.dueAt, '2026-04-01');

  card = { ...card, ...schedule(card, 'again', at(22)) };
  assert.equal(card.repetitions, 0);
  assert.equal(card.intervalDays, 1);
  assert.equal(card.easiness, 1.96); // 2.5 - 0.54
  assert.equal(card.dueAt, '2026-04-02');
  assert.equal(card.lastResult, 'again');
});

test('SM-2: Hard lowers ease, Easy raises it; EF floor 1.3', () => {
  const c = newCard(T0);
  const hard = schedule(c, 'hard', T0);
  assert.equal(hard.easiness, 2.36);
  assert.equal(hard.dueAt, '2026-03-11');
  const easy = schedule(c, 'easy', T0);
  assert.equal(easy.easiness, 2.6);
  let low = { ...c, easiness: 1.4 };
  low = { ...low, ...schedule(low, 'again', T0) };
  assert.equal(low.easiness, 1.3);
  const p = previewIntervals({ ...c, repetitions: 2, intervalDays: 6 }, T0);
  assert.deepEqual(p, { again: 1, hard: 12, good: 15, easy: 20 });
});

test('review grading persists real due dates and only due cards are listed', async () => {
  const s = freshStorage();
  await s.saveWord({ word: '你' });
  await s.saveWord({ word: '好' });
  assert.equal(dueCards(await s.listWords(), T0).length, 2);
  const card = await s.getWord('你');
  await s.updateWord('你', schedule(card, 'good', T0));
  await s.logReview({ word: '你', grade: 'good' });
  const due = dueCards(await s.listWords(), T0);
  assert.deepEqual(due.map((c) => c.word), ['好']);
  assert.equal((await s.getWord('你')).dueAt, '2026-03-11');
  assert.equal(dueCards(await s.listWords(), at(1)).length, 2);
  assert.equal(localDate(at(1)), '2026-03-11');
  assert.equal((await s.all('reviewLog')).length, 1);
});

test('backup export/import round-trips all user data and omits secrets', async () => {
  const s = freshStorage();
  await s.saveDocument({ id: 'd1', title: 'T', type: 'txt', chapters: [], createdAt: T0.toISOString() }, [{ id: 'd1:0', docId: 'd1', idx: 0, para: 0, chapter: 0, zh: '你好。' }]);
  await s.putTranslation('你好。', 'Hello.', 'MyMemory (Translated)');
  await s.saveWord({ word: '你好' });
  await s.addExample('你好', { zh: '你好吗？', en: 'How are you?', note: 'n', source: 'tatoeba' });
  await s.setSetting('myMemoryEmail', 'me@example.com');
  await s.setSetting('genApiKey', 'sk-secret');
  const backup = await s.exportAll();
  assert.ok(!JSON.stringify(backup).includes('sk-secret'));
  assert.ok(SECRET_SETTINGS.includes('genApiKey'));

  const t = new Storage({ indexedDB: new IDBFactory(), name: 'restore' });
  const counts = await t.importAll(JSON.parse(JSON.stringify(backup)));
  assert.equal(counts.docs, 1);
  assert.equal((await t.getSentences('d1'))[0].zh, '你好。');
  assert.equal((await t.getTranslation('你好。')).en, 'Hello.');
  assert.equal((await t.getWord('你好')).savedExamples[0].en, 'How are you?');
  assert.equal(await t.getSetting('myMemoryEmail'), 'me@example.com');
  assert.equal(await t.getSetting('genApiKey'), undefined);
  await assert.rejects(() => t.importAll({ foo: 1 }), /Not a Chinese Reader backup/);
});

test('Anki TSV has the required columns and escapes tabs/newlines', () => {
  const tsv = toAnkiTsv([
    { word: '学习', pinyin: 'xué xí', pinyinSource: 'mmah-charwise', definition: 'study', notes: 'line1\nline2\twith tab', context: { zh: '我爱学习。', en: 'I love studying.' }, savedExamples: [{ zh: '我们一起学习吧。', en: "Let's study together.", source: 'generated', note: 'verb' }] },
  ]);
  const lines = tsv.trim().split('\n');
  assert.equal(lines[2], `#columns:${ANKI_COLUMNS.join('\t')}`);
  assert.deepEqual(ANKI_COLUMNS, ['Front', 'Back', 'Notes', 'Context', 'Examples']);
  const cols = lines[3].split('\t');
  assert.equal(cols.length, 5);
  assert.equal(cols[0], '学习');
  assert.match(cols[1], /xué xí/);
  assert.equal(cols[2], 'line1<br>line2 with tab');
  assert.match(cols[3], /我爱学习。<br><i>I love studying.<\/i>/);
  assert.match(cols[4], /我们一起学习吧。 — Let's study together\./);
});

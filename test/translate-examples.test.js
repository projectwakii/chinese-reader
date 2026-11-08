import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDBFactory } from 'fake-indexeddb';
import { Storage } from '../src/storage.js';
import { Translator, chunkForQuery, myMemoryTranslate, MYMEMORY_URL } from '../src/translate.js';
import { findTatoebaExamples, parseTatoeba, TATOEBA_LABEL, TATOEBA_ATTRIBUTION } from '../src/examples/tatoeba.js';
import { generateExamples, classifyHeadword, buildTemplateSentences, GENERATED_LABEL, LLM_LABEL, sourceLabel } from '../src/examples/generate.js';
import { HanziDictionary } from '../src/hanzi/dict.js';
import { headwordDefinition } from '../src/ui/word.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dict = HanziDictionary.fromText(readFileSync(join(root, 'data/dictionary-mmah.txt'), 'utf8'));

const json = (obj, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => obj });

/** Mock MyMemory: returns "EN[<query>]" so we can prove the real request path was used. */
function mockMyMemory(calls, { failOn = () => false } = {}) {
  return async (url) => {
    calls.push(url);
    const u = new URL(url);
    assert.equal(u.origin + u.pathname, MYMEMORY_URL);
    assert.equal(u.searchParams.get('langpair'), 'zh-CN|en');
    const q = u.searchParams.get('q');
    if (failOn(q)) return json({ responseStatus: 429, responseDetails: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY', responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE TRANSLATIONS FOR TODAY' } });
    return json({ responseStatus: 200, responseData: { translatedText: `EN[${q}]` } });
  };
}

test('Translator calls MyMemory, caches in IndexedDB, and never invents English on failure', async () => {
  const calls = [];
  const storage = new Storage({ indexedDB: new IDBFactory(), name: 't' });
  const fetch = mockMyMemory(calls, { failOn: (q) => q.includes('失败') });
  const tr = new Translator({ storage, fetch, delayMs: 0, getSettings: () => storage.getSettings() });

  const a = await tr.translate('我爱学习。');
  assert.deepEqual([a.ok, a.en, a.cached], [true, 'EN[我爱学习。]', false]);
  const b = await tr.translate('我爱学习。');
  assert.equal(b.cached, true);
  assert.equal(calls.length, 1, 'second read served from cache');
  // survives reload: fresh translator, same DB
  const tr2 = new Translator({ storage, fetch, delayMs: 0 });
  assert.equal((await tr2.translate('我爱学习。')).cached, true);
  assert.equal(calls.length, 1);

  const f = await tr.translate('这个会失败。');
  assert.equal(f.ok, false);
  assert.equal(f.code, 'QUOTA');
  assert.equal(f.en, undefined);
  assert.equal(await storage.getTranslation('这个会失败。'), undefined, 'failures are not cached');

  await storage.setSetting('myMemoryEmail', 'me@example.com');
  await tr.translate('新句子。');
  assert.match(calls.at(-1), /&de=me%40example\.com/);
});

test('long sentences are chunked under the MyMemory query limit', async () => {
  const long = '这是一个很长的句子，'.repeat(40) + '结束。';
  const chunks = chunkForQuery(long);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(''), long);
  for (const c of chunks) assert.ok(new TextEncoder().encode(c).length <= 450);
  const calls = [];
  const tr = new Translator({ fetch: mockMyMemory(calls), delayMs: 0 });
  const r = await tr.translate(long);
  assert.ok(r.ok);
  assert.equal(calls.length, chunks.length);
});

test('provider echoing the source text is treated as unavailable', async () => {
  await assert.rejects(() => myMemoryTranslate('你好', { fetch: async () => json({ responseStatus: 200, responseData: { translatedText: '你好' } }) }), /unchanged/);
});

test('custom endpoint is used when configured', async () => {
  const calls = [];
  const tr = new Translator({
    delayMs: 0,
    getSettings: () => ({ customTranslateUrl: 'https://example.test/tr' }),
    fetch: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return json({ translation: 'Hi.' });
    },
  });
  const r = await tr.translate('你好。');
  assert.equal(r.en, 'Hi.');
  assert.deepEqual(calls[0].body, { text: '你好。', from: 'zh', to: 'en' });
});

test('Tatoeba client: correct URL, parses Chinese + first English, labels source', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    return json({
      paging: {},
      results: [
        { id: 1, text: '我在学习中文。', lang: 'cmn', translations: [[{ id: 2, text: 'I am studying Chinese.', lang: 'eng' }], []] },
        { id: 3, text: '没有这个词的句子。', lang: 'cmn', translations: [[{ text: 'Unrelated.', lang: 'eng' }]] },
        { id: 4, text: '学习很重要。', lang: 'cmn', translations: [[], [{ text: 'Studying is important.', lang: 'eng' }]] },
      ],
    });
  };
  const r = await findTatoebaExamples('学习', { fetch });
  assert.equal(calls[0], 'https://tatoeba.org/en/api_v0/search?from=cmn&to=eng&query=%E5%AD%A6%E4%B9%A0&orphans=no&unapproved=no');
  assert.ok(r.ok);
  assert.deepEqual(r.examples.map((e) => [e.zh, e.en]), [
    ['我在学习中文。', 'I am studying Chinese.'],
    ['学习很重要。', 'Studying is important.'],
  ]);
  for (const e of r.examples) {
    assert.equal(e.source, 'tatoeba');
    assert.equal(e.sourceLabel, TATOEBA_LABEL);
    assert.equal(e.attribution, TATOEBA_ATTRIBUTION);
  }
  assert.equal(TATOEBA_ATTRIBUTION, 'Examples: Tatoeba (CC-BY)');
  const fail = await findTatoebaExamples('学习', { fetch: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(fail.ok, false);
  assert.deepEqual(parseTatoeba({}, 'x'), []);
});

test('classification from licensed definition text', () => {
  // MMAH: 学 = "learning, knowledge, science; to study, ..." -> first gloss is noun-like
  assert.equal(classifyHeadword(dict.entry('学').definition).kind, 'noun');
  assert.equal(classifyHeadword(dict.entry('好').definition).kind, 'adjective');
  assert.equal(classifyHeadword('money').kind, 'noun');
  assert.equal(classifyHeadword('careful, cautious').kind, 'adjective');
  assert.equal(classifyHeadword('to study, learn').kind, 'verb');
  assert.equal(classifyHeadword('good, excellent; fine; well').kind, 'adjective');
  assert.equal(classifyHeadword('beautiful, pretty').kind, 'adjective');
  assert.equal(classifyHeadword('book, letter, document; writings').kind, 'noun');
  assert.equal(classifyHeadword('').kind, 'unknown');
});

test('generator works for arbitrary words: inserts the word, 4+ sentences, live translation, honest labels', async () => {
  for (const word of ['好', '书', '研究', '猫', '嗯哼哈']) {
    const calls = [];
    const tr = new Translator({ fetch: mockMyMemory(calls), delayMs: 0 });
    const def = headwordDefinition(dict, word);
    const r = await generateExamples(word, { definition: def, translate: (zh) => tr.translate(zh) });
    assert.equal(r.label, GENERATED_LABEL);
    assert.equal(GENERATED_LABEL, 'Generated practice sentences (templates + live translation)');
    assert.ok(r.examples.length >= 4, `${word}: at least 4`);
    assert.equal(new Set(r.examples.map((e) => e.zh)).size, r.examples.length, 'distinct sentences');
    for (const e of r.examples) {
      assert.ok(e.zh.includes(word), `${e.zh} contains ${word}`);
      assert.equal(e.en, `EN[${e.zh}]`, 'English comes from the translator, not a template');
      assert.equal(e.source, 'generated');
      assert.ok(e.note.length > 10);
    }
    assert.equal(calls.length, r.examples.length, 'each generated sentence was translated live');
  }
});

test('generator keeps Chinese and marks English unavailable when translation fails', async () => {
  const tr = new Translator({ fetch: async () => { throw new TypeError('offline'); }, delayMs: 0 });
  const r = await generateExamples('书', { definition: 'book', translate: (zh) => tr.translate(zh) });
  assert.ok(r.examples.length >= 4);
  for (const e of r.examples) {
    assert.equal(e.en, null);
    assert.ok(e.zh.includes('书'));
    assert.ok(e.translationError);
  }
});

test('template frames differ by word class (not a word->sentence map)', () => {
  const v = buildTemplateSentences('研究', 'to research').sentences.map((s) => s.frame);
  const n = buildTemplateSentences('电脑', 'computer').sentences.map((s) => s.frame);
  assert.notDeepEqual(v, n);
  assert.match(buildTemplateSentences('研究', 'to research').sentences[0].note, /verb/);
});

test('user-configured LLM endpoint is used when set (key only in settings)', async () => {
  let seen;
  const fetch = async (url, init) => {
    seen = { url, init };
    return json({ choices: [{ message: { content: 'Here: [{"zh":"我喜欢看书。","en":"I like reading.","note":"casual"},{"zh":"无关句子","en":"x","note":""}]' } }] });
  };
  const r = await generateExamples('书', {
    definition: 'book',
    translate: async () => assert.fail('should not translate'),
    settings: { genEndpoint: 'https://llm.example/v1/chat/completions', genApiKey: 'k-local', genModel: 'm' },
    fetch,
  });
  assert.equal(r.label, LLM_LABEL);
  assert.equal(seen.init.headers.Authorization, 'Bearer k-local');
  assert.deepEqual(r.examples.map((e) => e.zh), ['我喜欢看书。']);
  assert.equal(sourceLabel('llm'), 'Generated (your model endpoint)');
  assert.equal(sourceLabel('tatoeba'), 'Tatoeba (CC-BY)');
});

test('saved examples persist on the word with their source', async () => {
  const idb = new IDBFactory();
  const s = new Storage({ indexedDB: idb, name: 'ex' });
  await s.saveWord({ word: '书' });
  const tr = new Translator({ fetch: mockMyMemory([]), delayMs: 0 });
  const gen = await generateExamples('书', { definition: 'book', translate: (zh) => tr.translate(zh) });
  const tat = await findTatoebaExamples('书', { fetch: async () => json({ results: [{ id: 9, text: '这本书很好。', translations: [[{ text: 'This book is good.', lang: 'eng' }]] }] }) });
  await s.addExample('书', gen.examples[0]);
  await s.addExample('书', tat.examples[0]);
  await s.addExample('书', tat.examples[0]); // duplicate ignored
  s.close();
  const s2 = new Storage({ indexedDB: idb, name: 'ex' });
  const card = await s2.getWord('书');
  assert.equal(card.savedExamples.length, 2);
  assert.deepEqual(card.savedExamples.map((e) => e.source), ['generated', 'tatoeba']);
  assert.equal(card.savedExamples[1].en, 'This book is good.');
  assert.ok(card.savedExamples[0].savedAt);
  assert.deepEqual(Object.keys(card.savedExamples[0]).sort(), ['en', 'note', 'savedAt', 'source', 'zh']);
  const after = await s2.removeExample('书', card.savedExamples[0].zh);
  assert.equal(after.savedExamples.length, 1);
});

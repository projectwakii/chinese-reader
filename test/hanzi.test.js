import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HanziDictionary, isValidDecomposition, parseIDS, MISSING_DECOMP, MISSING_ENTRY } from '../src/hanzi/dict.js';
import { createStrokeLoader, MISSING_STROKES, CDN_BASE } from '../src/hanzi/strokes.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dict = HanziDictionary.fromText(readFileSync(join(root, 'data/dictionary-mmah.txt'), 'utf8'));

test('MMAH lookup for 我/好/你 returns radical + valid decomposition from data', () => {
  const expected = { 我: ['戈', '⿰扌戈'], 好: ['女', '⿰女子'], 你: ['亻', '⿰亻尔'] };
  for (const [ch, [rad, ids]] of Object.entries(expected)) {
    const bd = dict.breakdown(ch);
    assert.equal(bd.status, 'ok');
    assert.equal(bd.radical.char, rad);
    assert.equal(bd.decomposition, ids);
    assert.equal(bd.decompositionStatus, 'ok');
    assert.equal(bd.tree.type, 'op');
    assert.equal(bd.tree.op, '⿰');
    assert.equal(bd.tree.children.length, 2);
  }
  const hao = dict.breakdown('好');
  assert.deepEqual(hao.tree.children.map((c) => c.char), ['女', '子']);
  assert.ok(hao.tree.children.every((c) => c.known && c.definition));
  assert.equal(hao.etymology.type, 'ideographic');
  assert.equal(hao.etymology.hint, dict.entry('好').etymology.hint); // passed through verbatim from data
  assert.match(hao.etymology.hint, /woman[\s\S]+son/);
  assert.deepEqual(hao.pinyin, ['hǎo']);
});

test('recursive components: 学 = ⿱⿱⺍冖子 nests operators', () => {
  const bd = dict.breakdown('学');
  assert.equal(bd.tree.op, '⿱');
  assert.equal(bd.tree.children[0].type, 'op');
  assert.deepEqual(bd.tree.children[0].children.map((c) => c.char), ['⺍', '冖']);
  assert.equal(bd.tree.children[1].char, '子');
});

test('unknown component inside a valid IDS shows the missing state, never a guess', () => {
  const bd = dict.breakdown('书'); // ⿻？丨
  assert.equal(bd.decompositionStatus, 'ok');
  assert.equal(bd.tree.children[0].type, 'unknown');
  assert.equal(bd.tree.children[0].message, MISSING_DECOMP);
});

test('invalid decomposition (starts with ？) -> graceful missing state', () => {
  const bd = dict.breakdown('⺀');
  assert.equal(bd.status, 'ok');
  assert.equal(bd.decompositionStatus, 'missing');
  assert.equal(bd.tree, null);
  assert.equal(bd.message, MISSING_DECOMP);
  assert.equal(isValidDecomposition('？'), false);
});

test('private-use / unsupported characters return the missing state', () => {
  for (const ch of ['', '𪚥', 'A']) {
    const bd = dict.breakdown(ch);
    assert.equal(bd.status, 'missing');
    assert.equal(bd.message, MISSING_ENTRY);
    assert.equal(bd.tree, null);
    assert.equal(bd.radical, null);
  }
});

test('parseIDS handles ternary operators and unknown markers', () => {
  const t = parseIDS('⿲彳？亍');
  assert.equal(t.children.length, 3);
  assert.equal(t.children[1].type, 'unknown');
});

test('character-wise pinyin is labelled as such', () => {
  assert.deepEqual(dict.wordPinyin('你好'), { pinyin: 'nǐ hǎo', source: 'mmah-charwise', complete: true });
  assert.equal(dict.wordPinyin('好').source, 'mmah-char');
});

test('stroke loader uses local JSON for 我 (no CDN call)', async () => {
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === `data/strokes/${encodeURIComponent('我')}.json`) {
      const body = readFileSync(join(root, 'data/strokes/我.json'), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const loader = createStrokeLoader({ fetch });
  const r = await loader.load('我');
  assert.equal(r.status, 'ok');
  assert.equal(r.source, 'local');
  assert.equal(r.data.strokes.length, 7);
  assert.equal(r.data.medians.length, 7);
  assert.equal(calls.length, 1);
});

test('stroke loader falls back to CDN, caches it, and reports missing on 404', async () => {
  const calls = [];
  const store = new Map();
  const cache = { get: async (k) => store.get(k), set: async (k, v) => store.set(k, v) };
  const remote = { strokes: ['M 0 0 L 1 1 Z'], medians: [[[0, 0], [1, 1]]] };
  const fetch = async (url) => {
    calls.push(url);
    if (url === `${CDN_BASE}${encodeURIComponent('中')}.json`) return { ok: true, status: 200, json: async () => remote };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const loader = createStrokeLoader({ fetch, cache });
  const r = await loader.load('中');
  assert.equal(r.source, 'cdn');
  assert.deepEqual(store.get('strokes:中'), remote);

  const missing = await loader.load('');
  assert.equal(missing.status, 'missing');
  assert.equal(missing.message, MISSING_STROKES);
  assert.equal(MISSING_STROKES, 'No licensed stroke-order data for this character.');
  assert.ok(calls.some((u) => u.startsWith('data/strokes/')) && calls.some((u) => u.startsWith(CDN_BASE)));
});

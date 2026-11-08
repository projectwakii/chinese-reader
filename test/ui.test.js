import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderReader } from '../src/ui/reader.js';
import { createSpeech, pickChineseVoice } from '../src/tts.js';
import { WritingPad, compareStroke, toDown } from '../src/hanzi/writer.js';
import { layoutModeFor, watchLayout } from '../src/layout.js';
import { buildSentences } from '../src/segment.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tick = () => new Promise((r) => setTimeout(r, 0));

function makeDom(width = 1024, height = 768) {
  const dom = new JSDOM('<!doctype html><html><body><main id="m"></main></body></html>', { pretendToBeVisual: true });
  Object.defineProperty(dom.window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: height, configurable: true });
  return dom;
}

function sampleDoc() {
  const { chapters, sentences } = buildSentences('d1', [{ title: '第一章', paragraphs: ['我爱学习中文。你好吗？', '今天我去书店。'] }]);
  return { doc: { id: 'd1', title: '测试', chapters }, sentences };
}

const EN = { '我爱学习中文。': 'I love studying Chinese.', '你好吗？': 'How are you?', '今天我去书店。': 'Today I go to the bookstore.' };
const fakeTranslator = (calls = []) => ({
  cached: async (t) => (EN[t] ? { en: EN[t] } : undefined),
  translate: async (t) => {
    calls.push(t);
    return EN[t] ? { ok: true, en: EN[t] } : { ok: false, code: 'PROVIDER', error: 'x' };
  },
});

test('reader binds sentence click to speakChinese(text) with the Chinese sentence, not English', async () => {
  const dom = makeDom();
  const host = dom.window.document.getElementById('m');
  const spoken = [];
  const english = [];
  const { doc, sentences } = sampleDoc();
  renderReader(host, { doc, sentences, translator: fakeTranslator(), speakChinese: (t) => { spoken.push(t); return { ok: true }; }, speakEnglish: (t) => english.push(t), englishTts: false });
  await tick();
  await tick();
  const zh = host.querySelectorAll('.zh');
  const en = host.querySelectorAll('.en');
  assert.equal(zh.length, 3);
  assert.equal(en[0].textContent, 'I love studying Chinese.', 'cached translation aligned in the same row');
  zh[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(spoken, ['你好吗？']);
  assert.ok(zh[1].classList.contains('active'), 'tapped sentence is highlighted');
  // tapping English does not speak Chinese and (with English TTS off) does not speak at all
  en[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(spoken, ['你好吗？']);
  assert.deepEqual(english, []);
});

test('English row speaks English only when the option is on', async () => {
  const dom = makeDom();
  const host = dom.window.document.getElementById('m');
  const english = [];
  const spoken = [];
  const { doc, sentences } = sampleDoc();
  renderReader(host, { doc, sentences, translator: fakeTranslator(), speakChinese: (t) => spoken.push(t), speakEnglish: (t) => english.push(t), englishTts: true });
  await tick();
  await tick();
  host.querySelectorAll('.en')[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(english, ['Today I go to the bookstore.']);
  assert.deepEqual(spoken, []);
});

test('active sentence exposes tappable character chips; tapping builds a word and opens the popover', async () => {
  const dom = makeDom();
  const host = dom.window.document.getElementById('m');
  const actions = [];
  const { doc, sentences } = sampleDoc();
  const reader = renderReader(host, { doc, sentences, translator: fakeTranslator(), speakChinese: () => ({ ok: true }), pinyinFor: () => 'xué xí', onWordAction: (a, w, s, en) => actions.push([a, w, s.zh, en]) });
  await tick();
  await tick();
  const zh0 = host.querySelector('.zh');
  zh0.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  const chips = zh0.querySelectorAll('.ch');
  assert.equal(chips.length, 6, '我爱学习中文 -> 6 chips (punctuation excluded)');
  chips[2].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  chips[3].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(reader.selectedWord(), '学习');
  const pop = host.querySelector('.word-popover');
  assert.ok(!pop.classList.contains('hidden'));
  assert.equal(pop.dataset.word, '学习');
  const save = [...pop.querySelectorAll('button')].find((b) => b.textContent.includes('Save word'));
  save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(actions[0], ['save', '学习', '我爱学习中文。', 'I love studying Chinese.']);
  const labels = [...pop.querySelectorAll('button')].map((b) => b.textContent);
  for (const l of ['Character breakdown', 'Practice writing', 'Generate examples']) assert.ok(labels.some((x) => x.includes(l)));
});

test('failed translation shows "Translation unavailable" + Retry, never invented text', async () => {
  const dom = makeDom();
  const host = dom.window.document.getElementById('m');
  const { doc, sentences } = buildSentences('d2', [{ title: '', paragraphs: ['没有翻译的句子。'] }]);
  renderReader(host, { doc: { id: 'd2', title: 'x', chapters: doc ?? [] }, sentences, translator: fakeTranslator(), speakChinese: () => ({ ok: true }) });
  host.querySelector('.zh').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await tick();
  await tick();
  const en = host.querySelector('.en');
  assert.match(en.textContent, /Translation unavailable/);
  assert.ok(en.querySelector('.retry'));
});

test('speakChinese uses Web Speech with a zh-CN voice (mock speechSynthesis)', () => {
  const spoken = [];
  class U { constructor(t) { this.text = t; } }
  const voices = [{ name: 'Samantha', lang: 'en-US', voiceURI: 'en' }, { name: 'Meijia', lang: 'zh-TW', voiceURI: 'tw' }, { name: 'Tingting', lang: 'zh-CN', voiceURI: 'cn' }];
  const synth = { getVoices: () => voices, speak: (u) => spoken.push(u), cancel() {} };
  const sp = createSpeech({ synth, Utterance: U });
  const r = sp.speakChinese('你好吗？');
  assert.ok(r.ok);
  assert.equal(spoken[0].text, '你好吗？');
  assert.equal(spoken[0].lang, 'zh-CN');
  assert.equal(spoken[0].voice.name, 'Tingting');
  assert.equal(pickChineseVoice(voices.slice(0, 2)).name, 'Meijia', 'falls back to zh-TW');
  const none = createSpeech({ synth: { getVoices: () => [voices[0]], speak() {}, cancel() {} }, Utterance: U }).speakChinese('你');
  assert.equal(none.ok, false);
  assert.match(none.reason, /No Chinese voice/);
});

// ---------- Apple Pencil canvas ----------
function makeCanvas() {
  const dom = makeDom();
  const doc = dom.window.document;
  const canvas = doc.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 512, height: 512, right: 512, bottom: 512 });
  const captured = [];
  canvas.setPointerCapture = (id) => captured.push(id);
  canvas.releasePointerCapture = () => {};
  doc.body.appendChild(canvas);
  return { dom, canvas, captured };
}

const strokeData = JSON.parse(readFileSync(join(root, 'data/strokes/我.json'), 'utf8'));

function drawStroke(dom, canvas, pointerType, pointerId, pts, pressure = 0.5) {
  const fire = (type, [x, y]) => {
    const e = new dom.window.PointerEvent(type, { bubbles: true, cancelable: true, pointerType, pointerId, clientX: x, clientY: y, pressure, button: 0 });
    canvas.dispatchEvent(e);
    return e;
  };
  const down = fire('pointerdown', pts[0]);
  for (const p of pts.slice(1, -1)) fire('pointermove', p);
  fire('pointerup', pts[pts.length - 1]);
  return down;
}

test('pen (Apple Pencil), touch and mouse pointer events are recorded as strokes', () => {
  const { dom, canvas, captured } = makeCanvas();
  const feedback = [];
  const pad = new WritingPad(canvas, { strokeData, context: null, onFeedback: (m) => feedback.push(m) });
  assert.equal(canvas.style.touchAction, 'none');
  const down = drawStroke(dom, canvas, 'pen', 7, [[100, 150], [150, 150], [200, 150], [250, 152]], 0.8);
  assert.equal(down.defaultPrevented, true, 'preventDefault so iPad does not scroll');
  assert.deepEqual(captured, [7], 'setPointerCapture with the pen pointerId');
  drawStroke(dom, canvas, 'touch', 2, [[100, 100], [100, 300]], 0);
  drawStroke(dom, canvas, 'mouse', 1, [[50, 50], [120, 60], [200, 70]]);
  assert.equal(pad.strokes.length, 3);
  assert.deepEqual(pad.strokes.map((s) => s.pointerType), ['pen', 'touch', 'mouse']);
  assert.equal(pad.strokes[0].points.length, 4);
  assert.ok(Math.abs(pad.strokes[0].points[0].p - 0.8) < 1e-6, 'pen pressure stored');
  // 512px canvas -> 1024 data units
  assert.deepEqual([pad.strokes[0].points[0].x, pad.strokes[0].points[0].y], [200, 300]);
  assert.equal(feedback.length, 3);
  assert.match(feedback[0], /Stroke 1 of 7/);
  pad.clear();
  assert.equal(pad.strokes.length, 0);
});

test('a second pointer while the Pencil is down (palm) is ignored; pointercancel drops the stroke', () => {
  const { dom, canvas } = makeCanvas();
  const pad = new WritingPad(canvas, { strokeData, context: null });
  const ev = (type, o) => canvas.dispatchEvent(new dom.window.PointerEvent(type, { bubbles: true, cancelable: true, ...o }));
  ev('pointerdown', { pointerType: 'pen', pointerId: 5, clientX: 10, clientY: 10, pressure: 0.4 });
  ev('pointerdown', { pointerType: 'touch', pointerId: 9, clientX: 300, clientY: 300 });
  ev('pointermove', { pointerType: 'touch', pointerId: 9, clientX: 310, clientY: 310 });
  ev('pointermove', { pointerType: 'pen', pointerId: 5, clientX: 50, clientY: 10, pressure: 0.5 });
  ev('pointerup', { pointerType: 'pen', pointerId: 5, clientX: 90, clientY: 10, pressure: 0 });
  assert.equal(pad.strokes.length, 1);
  assert.ok(pad.strokes[0].points.every((p) => p.x < 300));
  ev('pointerdown', { pointerType: 'pen', pointerId: 5, clientX: 10, clientY: 10 });
  ev('pointercancel', { pointerType: 'pen', pointerId: 5 });
  assert.equal(pad.strokes.length, 1);
});

test('stroke comparison against medians is conservative (direction/start only)', () => {
  const median = strokeData.medians[1].map(toDown); // 我 stroke 2: long horizontal, left -> right
  const pts = median.map(([x, y]) => ({ x, y }));
  assert.equal(compareStroke(pts, median).reason, 'match');
  assert.equal(compareStroke([...pts].reverse(), median).reason, 'reversed');
});

// ---------- responsive ----------
test('layoutModeFor: iPad mini landscape side-by-side, portrait stacked', () => {
  assert.equal(layoutModeFor(1024, 768), 'side-by-side');
  assert.equal(layoutModeFor(1133, 744), 'side-by-side');
  assert.equal(layoutModeFor(768, 1024), 'stacked');
  assert.equal(layoutModeFor(744, 1133), 'stacked');
  assert.equal(layoutModeFor(390, 844), 'stacked');
});

test('watchLayout toggles the CSS class on <html> on resize', () => {
  const dom = makeDom(1133, 744);
  const w = watchLayout(dom.window);
  const html = dom.window.document.documentElement;
  assert.equal(w.mode, 'side-by-side');
  assert.ok(html.classList.contains('layout-side-by-side'));
  Object.defineProperty(dom.window, 'innerWidth', { value: 744, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 1133, configurable: true });
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(w.mode, 'stacked');
  assert.ok(html.classList.contains('layout-stacked'));
  assert.ok(!html.classList.contains('layout-side-by-side'));
});

test('CSS uses the layout classes for side-by-side rows', () => {
  const css = readFileSync(join(root, 'styles.css'), 'utf8');
  assert.match(css, /\.layout-side-by-side \.pair \{ display: grid; grid-template-columns: 1fr 1fr/);
});

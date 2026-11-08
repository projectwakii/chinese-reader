// App entry: wires storage, translator, speech, dictionary and the hash router.
import { Storage } from './storage.js';
import { Translator, PRIVACY_TEXT, PROVIDER_NAME } from './translate.js';
import { createSpeech } from './tts.js';
import { loadDictionary } from './hanzi/dict.js';
import { createStrokeLoader } from './hanzi/strokes.js';
import { watchLayout } from './layout.js';
import { dueCards } from './srs.js';
import { h, clear, toast, modal } from './ui/dom.js';
import { renderReader } from './ui/reader.js';
import { renderBreakdown } from './ui/breakdown.js';
import { libraryView } from './ui/library.js';
import { wordView, charView } from './ui/word.js';
import { vocabView, reviewView, drillView } from './ui/review.js';
import { writeView } from './ui/write.js';
import { settingsView } from './ui/settings.js';

const storage = new Storage();
let prefs = {};
const reloadPrefs = async () => {
  const s = await storage.getSettings();
  prefs = { voiceURI: s.voiceURI || '', rate: s.ttsRate || 0.85, englishTts: !!s.englishTts, customTranslateUrl: s.customTranslateUrl || '' };
};
const translator = new Translator({ storage, getSettings: () => storage.getSettings() });
const speech = createSpeech({ getPrefs: () => prefs });
const strokes = createStrokeLoader({ cache: { get: (k) => storage.getCache(k), set: (k, v) => storage.setCache(k, v) } });

let leaveHandlers = [];
let currentReader = null;
const main = document.getElementById('main');

const ctx = {
  storage,
  translator,
  speech,
  strokes,
  dict: () => loadDictionary(),
  nav: (hash) => {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
  onLeave: (fn) => leaveHandlers.push(fn),
  providerName: () => (prefs.customTranslateUrl ? 'your custom endpoint' : PROVIDER_NAME),
  reloadPrefs,
  refreshBadge,
  async saveWord(word, sentence, en) {
    const dict = await ctx.dict();
    const py = dict.wordPinyin(word);
    const defs = dict.charDefinitions(word);
    const card = await storage.saveWord({
      word,
      pinyin: py.pinyin,
      pinyinSource: py.source,
      definition: dict.entry(word)?.definition || (defs.length > 1 ? defs.map((d) => `${d.char}: ${d.definition}`).join('; ') : defs[0]?.definition || ''),
      context: sentence ? { zh: sentence.zh, en: en || null, docId: sentence.docId, sentenceId: sentence.id } : undefined,
    });
    refreshBadge();
    return card;
  },
};

async function refreshBadge() {
  const n = dueCards(await storage.listWords()).length;
  const b = document.getElementById('due-badge');
  if (b) {
    b.textContent = n ? String(n) : '';
    b.hidden = !n;
  }
}

function setActiveTab(name) {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === name));
}

async function readerRoute(docId) {
  const doc = await storage.getDocument(docId);
  if (!doc) {
    main.append(h('section', { class: 'panel' }, h('p', null, 'Document not found.'), h('a', { href: '#/library', class: 'btn' }, 'Library')));
    return;
  }
  const sentences = await storage.getSentences(docId);
  const dict = await ctx.dict().catch(() => null);
  const host = h('section', { class: 'reader' });
  main.append(host);
  const posKey = `pos:${docId}`;
  currentReader = renderReader(host, {
    doc,
    sentences,
    chapterIndex: Number(localStorage.getItem(posKey) || 0),
    speakChinese: (t) => speech.speakChinese(t),
    speakEnglish: (t) => speech.speakEnglish(t),
    englishTts: prefs.englishTts,
    translator,
    providerName: ctx.providerName() === PROVIDER_NAME ? PROVIDER_NAME : 'your custom endpoint',
    pinyinFor: (w) => (dict ? dict.wordPinyin(w).pinyin : ''),
    onChapterChange: (i) => localStorage.setItem(posKey, String(i)),
    onMessage: (m, k) => toast(m, k, 6000),
    onWordAction: async (action, word, sentence, en) => {
      if (action === 'save') {
        const existed = await storage.getWord(word);
        await ctx.saveWord(word, sentence, en);
        toast(existed ? `“${word}” already saved — context added` : `Saved “${word}” · due for review today`, 'ok');
      } else if (action === 'breakdown') {
        const d = await ctx.dict();
        const chars = Array.from(word);
        const body = h('div', { class: 'bd-modal' });
        const show = (c) => clear(body).append(chars.length > 1 ? h('div', { class: 'char-tabs' }, chars.map((x) => h('button', { class: `btn char-tab ${x === c ? 'primary' : ''}`, lang: 'zh-CN', onclick: () => show(x) }, x))) : null, renderBreakdown(d.breakdown(c), { onWrite: (ch) => { m.close(); ctx.nav(`#/write/${encodeURIComponent(ch)}?word=${encodeURIComponent(word)}`); } }));
        const m = modal(`Character breakdown · ${word}`, body, { className: 'wide' });
        show(chars[0]);
      } else if (action === 'write') {
        ctx.nav(`#/write/${encodeURIComponent(Array.from(word)[0])}?word=${encodeURIComponent(word)}`);
      } else if (action === 'examples') {
        if (!(await storage.getWord(word))) await ctx.saveWord(word, sentence, en);
        ctx.nav(`#/word/${encodeURIComponent(word)}?examples=1`);
      }
    },
  });
}

async function route() {
  leaveHandlers.forEach((f) => f());
  leaveHandlers = [];
  currentReader?.destroy();
  currentReader = null;
  document.querySelectorAll('.modal-backdrop').forEach((m) => m.remove());
  clear(main);
  const [path, query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const [name, ...rest] = path.split('/');
  const arg = rest.length ? decodeURIComponent(rest.join('/')) : '';
  document.body.dataset.view = name || 'library';
  try {
    switch (name) {
      case 'read':
        setActiveTab('library');
        await readerRoute(arg);
        break;
      case 'word':
        setActiveTab('vocab');
        await wordView(main, ctx, arg, { autoExamples: params.get('examples') === '1' });
        break;
      case 'char':
        setActiveTab('vocab');
        await charView(main, ctx, arg);
        break;
      case 'write':
        setActiveTab('vocab');
        await writeView(main, ctx, arg, params.get('word') || '');
        break;
      case 'vocab':
        setActiveTab('vocab');
        await vocabView(main, ctx);
        break;
      case 'review':
        setActiveTab('review');
        await reviewView(main, ctx);
        break;
      case 'drill':
        setActiveTab('vocab');
        await drillView(main, ctx, arg);
        break;
      case 'settings':
        setActiveTab('settings');
        await settingsView(main, ctx);
        break;
      default:
        setActiveTab('library');
        await libraryView(main, ctx);
    }
  } catch (e) {
    console.error(e);
    main.append(h('section', { class: 'panel' }, h('h2', null, 'Something went wrong'), h('pre', null, String(e?.stack || e))));
  }
  window.scrollTo(0, 0);
}

function privacyBanner() {
  if (localStorage.getItem('privacyAck') === '1') return;
  const el = h(
    'div',
    { class: 'banner', role: 'region', 'aria-label': 'Privacy notice' },
    h('div', null, h('strong', null, `Translation by ${PROVIDER_NAME}. `), PRIVACY_TEXT, ' Example search sends only the looked-up word to tatoeba.org.'),
    h('button', { class: 'btn primary', id: 'privacy-ok', onclick: () => { localStorage.setItem('privacyAck', '1'); el.remove(); } }, 'Got it')
  );
  document.getElementById('banner-slot').appendChild(el);
}

async function start() {
  const fs = localStorage.getItem('zhFontSize');
  if (fs) document.documentElement.style.setProperty('--zh-size', `${fs}px`);
  watchLayout(window);
  await storage.open();
  await reloadPrefs();
  window.addEventListener('hashchange', route);
  privacyBanner();
  await route();
  refreshBadge();
  // Request persistent storage so Safari is less likely to evict user data.
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
  }
  // iOS loads voices lazily
  globalThis.speechSynthesis?.getVoices?.();
}

start();

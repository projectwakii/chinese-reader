// Reader view: sentence-aligned Chinese | English rows. Tap Chinese -> highlight + speakChinese.
// Once a sentence is active its characters become tappable chips for word selection.
// Dependencies are injected so the wiring is testable in jsdom.
import { hd, clear } from './dom.js';
import { isHan } from '../segment.js';

const MAX_WORD = 8;

/**
 * @param {HTMLElement} root
 * @param {{
 *   doc:{id:string,title:string,chapters:{title:string,start:number,count:number}[]},
 *   sentences:{id:string,idx:number,para:number,zh:string}[],
 *   chapterIndex?:number,
 *   speakChinese:(text:string)=>any,
 *   speakEnglish?:(text:string)=>any,
 *   englishTts?:boolean,
 *   translator?:{translate:(text:string,o?:object)=>Promise<{ok:boolean,en?:string,error?:string,code?:string}>, cached:(t:string)=>Promise<any>},
 *   providerName?:string,
 *   pinyinFor?:(word:string)=>string,
 *   onWordAction?:(action:'save'|'breakdown'|'write'|'examples', word:string, sentence:object, en:string|null)=>void,
 *   onChapterChange?:(i:number)=>void,
 *   onMessage?:(msg:string, kind?:string)=>void,
 *   autoTranslate?:boolean,
 * }} opts
 */
export function renderReader(root, opts) {
  const document = root.ownerDocument;
  const win = document.defaultView || globalThis;
  const h = hd(document);
  const { doc, sentences } = opts;
  const english = new Map(); // sentence id -> {ok,en,error}
  const pending = new Set();
  let chapter = Math.min(Math.max(0, opts.chapterIndex || 0), Math.max(0, doc.chapters.length - 1));
  let active = null; // sentence id
  let sel = null; // {id, start, end}
  let observer = null;
  let destroyed = false;
  const abort = new AbortController();

  clear(root);
  const progress = h('div', { class: 'reader-progress', 'aria-live': 'polite' });
  const chapterSelect = h(
    'select',
    { class: 'chapter-select', 'aria-label': 'Chapter', onchange: (e) => go(Number(e.target.value)) },
    doc.chapters.map((c, i) => h('option', { value: String(i) }, c.title || `Section ${i + 1}`))
  );
  const prevBtn = h('button', { class: 'btn', 'aria-label': 'Previous chapter', onclick: () => go(chapter - 1) }, '‹');
  const nextBtn = h('button', { class: 'btn', 'aria-label': 'Next chapter', onclick: () => go(chapter + 1) }, '›');
  const translateBtn = h('button', { class: 'btn', onclick: () => translateChapter() }, 'Translate chapter');
  const bar = h(
    'div',
    { class: 'reader-bar' },
    h('div', { class: 'reader-title' }, doc.title),
    h('div', { class: 'reader-controls' }, prevBtn, chapterSelect, nextBtn, translateBtn),
    h('div', { class: 'provider-note' }, `English: machine translation via ${opts.providerName || 'MyMemory (Translated)'} — sentences are sent over HTTPS.`),
    progress
  );
  const head = h('div', { class: 'pairs-head' }, h('div', { lang: 'zh-CN' }, '中文'), h('div', null, 'English'));
  const pairs = h('div', { class: 'pairs', role: 'list' });
  const popover = h('div', { class: 'word-popover hidden', role: 'dialog', 'aria-label': 'Selected word' });
  root.append(bar, head, pairs, popover);

  const byId = new Map(sentences.map((s) => [s.id, s]));

  function chapterSentences() {
    const c = doc.chapters[chapter];
    if (!c) return sentences;
    return sentences.slice(c.start, c.start + c.count);
  }

  function go(i) {
    if (i < 0 || i >= doc.chapters.length) return;
    chapter = i;
    renderChapter();
    opts.onChapterChange?.(i);
    win.scrollTo?.(0, 0);
  }

  function renderChapter() {
    hidePopover();
    active = null;
    sel = null;
    chapterSelect.value = String(chapter);
    prevBtn.disabled = chapter <= 0;
    nextBtn.disabled = chapter >= doc.chapters.length - 1;
    clear(pairs);
    observer?.disconnect();
    let lastPara = null;
    for (const s of chapterSentences()) {
      const zh = h('div', { class: 'zh', lang: 'zh-CN', role: 'button', tabindex: '0', dataset: { id: s.id } }, s.zh);
      const en = h('div', { class: 'en', lang: 'en', dataset: { id: s.id } });
      const row = h('div', { class: `pair${s.para !== lastPara ? ' para-start' : ''}`, role: 'listitem', dataset: { id: s.id } }, zh, en);
      lastPara = s.para;
      pairs.appendChild(row);
      paintEnglish(s.id);
    }
    hydrateFromCache();
    setupAutoTranslate();
  }

  async function hydrateFromCache() {
    if (!opts.translator) return;
    for (const s of chapterSentences()) {
      if (english.has(s.id)) continue;
      const hit = await opts.translator.cached(s.zh);
      if (destroyed) return;
      if (hit) {
        english.set(s.id, { ok: true, en: hit.en });
        paintEnglish(s.id);
      }
    }
  }

  function paintEnglish(id) {
    const cell = pairs.querySelector(`.en[data-id="${cssEscape(id)}"]`);
    if (!cell) return;
    clear(cell);
    const r = english.get(id);
    cell.classList.remove('failed', 'loading');
    if (r && r.ok) {
      cell.textContent = r.en;
    } else if (r && !r.ok) {
      cell.classList.add('failed');
      cell.append(
        h('span', { class: 'unavailable' }, 'Translation unavailable'),
        r.code === 'QUOTA' ? h('span', { class: 'muted' }, ' (daily quota reached)') : null,
        h('button', { class: 'btn small retry', onclick: (e) => { e.stopPropagation(); requestTranslation(id, true); } }, 'Retry')
      );
    } else if (pending.has(id)) {
      cell.classList.add('loading');
      cell.textContent = 'Translating…';
    } else {
      cell.append(h('button', { class: 'btn small ghost translate-one', onclick: (e) => { e.stopPropagation(); requestTranslation(id); } }, 'Translate'));
    }
  }

  function updateProgress() {
    const list = chapterSentences();
    const done = list.filter((s) => english.get(s.id)?.ok).length;
    const failed = list.filter((s) => english.has(s.id) && !english.get(s.id).ok).length;
    const p = list.filter((s) => pending.has(s.id)).length;
    progress.textContent = p
      ? `Translating… ${done}/${list.length} done${failed ? `, ${failed} unavailable` : ''}`
      : `${done}/${list.length} sentences translated${failed ? ` · ${failed} unavailable (tap Retry)` : ''}`;
  }

  async function requestTranslation(id, force = false) {
    const s = byId.get(id);
    if (!s || !opts.translator || pending.has(id)) return;
    if (!force && english.get(id)?.ok) return;
    pending.add(id);
    paintEnglish(id);
    updateProgress();
    const r = await opts.translator.translate(s.zh, { signal: abort.signal, force });
    pending.delete(id);
    if (destroyed || r.code === 'ABORTED') return;
    english.set(id, r);
    paintEnglish(id);
    updateProgress();
    if (sel && sel.id === id) showPopover();
  }

  function translateChapter() {
    for (const s of chapterSentences()) if (!english.get(s.id)?.ok) requestTranslation(s.id, english.has(s.id));
  }

  function setupAutoTranslate() {
    updateProgress();
    if (opts.autoTranslate === false || !opts.translator) return;
    if (typeof win.IntersectionObserver !== 'function') return;
    observer = new win.IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const id = en.target.dataset.id;
          observer.unobserve(en.target);
          if (!english.has(id)) requestTranslation(id);
        }
      },
      { rootMargin: '300px 0px' }
    );
    pairs.querySelectorAll('.pair').forEach((p) => observer.observe(p));
  }

  // ---------- interaction ----------
  function activate(id) {
    const prev = active && pairs.querySelector(`.zh[data-id="${cssEscape(active)}"]`);
    if (prev) {
      prev.classList.remove('active');
      prev.textContent = byId.get(active).zh;
      prev.parentElement.classList.remove('active');
    }
    active = id;
    sel = null;
    hidePopover();
    const el = pairs.querySelector(`.zh[data-id="${cssEscape(id)}"]`);
    if (!el) return;
    el.classList.add('active');
    el.parentElement.classList.add('active');
    clear(el);
    Array.from(byId.get(id).zh).forEach((ch, i) => {
      el.appendChild(isHan(ch) ? h('span', { class: 'ch', dataset: { i: String(i) } }, ch) : h('span', { class: 'pc' }, ch));
    });
    el.appendChild(h('button', { class: 'btn small speak-again', 'aria-label': 'Speak sentence again', title: 'Speak again' }, '🔊'));
    el.appendChild(h('div', { class: 'tap-hint' }, 'Tap characters to select a word'));
  }

  function speak(text) {
    const r = opts.speakChinese(text);
    if (r && r.ok === false && r.reason) opts.onMessage?.(r.reason, 'warn');
  }

  function onPairsClick(e) {
    const t = e.target;
    if (t.closest('.retry, .translate-one')) return;
    const enCell = t.closest('.en');
    if (enCell) {
      const r = english.get(enCell.dataset.id);
      if (opts.englishTts && r?.ok && opts.speakEnglish) opts.speakEnglish(r.en);
      return;
    }
    const zhCell = t.closest('.zh');
    if (!zhCell) return;
    const id = zhCell.dataset.id;
    const s = byId.get(id);
    if (t.closest('.speak-again')) {
      speak(s.zh);
      return;
    }
    if (active !== id) {
      activate(id);
      speak(s.zh);
      if (!english.has(id)) requestTranslation(id);
      return;
    }
    const chip = t.closest('.ch');
    if (chip) selectChar(id, Number(chip.dataset.i));
  }

  function onKey(e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList?.contains('zh')) {
      e.preventDefault();
      e.target.click();
    }
  }

  function selectChar(id, i) {
    if (!sel || sel.id !== id) sel = { id, start: i, end: i };
    else if (sel.start === i && sel.end === i) sel = null;
    else if (i === sel.end + 1 && sel.end - sel.start + 1 < MAX_WORD) sel.end = i;
    else if (i === sel.start - 1 && sel.end - sel.start + 1 < MAX_WORD) sel.start = i;
    else if (i > sel.start && i <= sel.end) sel.end = i; // shrink from the right
    else sel = { id, start: i, end: i };
    paintSelection();
    if (sel) showPopover();
    else hidePopover();
  }

  function selectedWord() {
    if (!sel) return '';
    return Array.from(byId.get(sel.id).zh).slice(sel.start, sel.end + 1).join('');
  }

  function paintSelection() {
    pairs.querySelectorAll('.ch.sel').forEach((c) => c.classList.remove('sel'));
    if (!sel) return;
    const el = pairs.querySelector(`.zh[data-id="${cssEscape(sel.id)}"]`);
    el?.querySelectorAll('.ch').forEach((c) => {
      const i = Number(c.dataset.i);
      if (i >= sel.start && i <= sel.end) c.classList.add('sel');
    });
  }

  function showPopover(wordOverride, sentenceId) {
    const word = wordOverride || selectedWord();
    const sid = sentenceId || sel?.id;
    if (!word || !sid) return;
    const s = byId.get(sid);
    const en = english.get(sid)?.ok ? english.get(sid).en : null;
    clear(popover);
    const act = (a) => (e) => {
      e.stopPropagation();
      opts.onWordAction?.(a, word, s, en);
    };
    const py = opts.pinyinFor?.(word) || '';
    popover.append(
      h('div', { class: 'pop-word', lang: 'zh-CN' }, word),
      py ? h('div', { class: 'pop-pinyin' }, py, Array.from(word).length > 1 ? h('span', { class: 'muted' }, ' (character-wise)') : null) : null,
      h(
        'div',
        { class: 'pop-actions' },
        h('button', { class: 'btn primary', onclick: act('save') }, '＋ Save word'),
        h('button', { class: 'btn', onclick: act('breakdown') }, 'Character breakdown'),
        h('button', { class: 'btn', onclick: act('write') }, 'Practice writing'),
        h('button', { class: 'btn', onclick: act('examples') }, 'Generate examples'),
        h('button', { class: 'btn ghost', 'aria-label': 'Close', onclick: (e) => { e.stopPropagation(); sel = null; paintSelection(); hidePopover(); } }, '✕')
      )
    );
    popover.classList.remove('hidden');
    popover.dataset.word = word;
    // position below the selected chips (fixed positioning; clamp to viewport)
    const anchor = pairs.querySelector('.ch.sel') || pairs.querySelector(`.zh[data-id="${cssEscape(sid)}"]`);
    const r = anchor?.getBoundingClientRect?.();
    if (r && (r.width || r.height)) {
      const vw = win.innerWidth || 1024;
      const vh = win.innerHeight || 768;
      const pw = Math.min(360, vw - 16);
      const left = Math.max(8, Math.min(r.left, vw - pw - 8));
      const below = r.bottom + 8;
      popover.style.left = `${left}px`;
      popover.style.width = `${pw}px`;
      if (below + 200 > vh) {
        popover.style.top = '';
        popover.style.bottom = `${Math.max(8, vh - r.top + 8)}px`;
      } else {
        popover.style.bottom = '';
        popover.style.top = `${below}px`;
      }
    }
  }

  function hidePopover() {
    popover.classList.add('hidden');
    delete popover.dataset.word;
  }

  // Native long-press / text selection inside a Chinese sentence also opens the popover.
  function onSelectionChange() {
    const s = win.getSelection?.();
    if (!s || s.isCollapsed || !s.rangeCount) return;
    const text = s.toString().replace(/\s+/g, '');
    if (!text || text.length > MAX_WORD || !Array.from(text).some(isHan)) return;
    const node = s.anchorNode?.nodeType === 1 ? s.anchorNode : s.anchorNode?.parentElement;
    const zh = node?.closest?.('.zh');
    if (!zh || !pairs.contains(zh)) return;
    const word = Array.from(text).filter((c) => isHan(c)).join('');
    sel = null;
    showPopover(word, zh.dataset.id);
  }

  pairs.addEventListener('click', onPairsClick);
  pairs.addEventListener('keydown', onKey);
  document.addEventListener('selectionchange', onSelectionChange);
  renderChapter();

  return {
    get chapter() {
      return chapter;
    },
    get activeId() {
      return active;
    },
    selectedWord,
    translateChapter,
    go,
    destroy() {
      destroyed = true;
      abort.abort();
      observer?.disconnect();
      pairs.removeEventListener('click', onPairsClick);
      document.removeEventListener('selectionchange', onSelectionChange);
    },
  };
}

function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

// Word detail: pinyin, licensed definitions, context, notes (autosave), SRS state,
// character breakdowns, and the "Find & generate examples" flow.
import { h, clear, toast, modal, fmtDate, debounce } from './dom.js';
import { renderBreakdown } from './breakdown.js';
import { findTatoebaExamples, TATOEBA_LABEL, TATOEBA_ATTRIBUTION } from '../examples/tatoeba.js';
import { generateExamples, GENERATED_LABEL, sourceLabel } from '../examples/generate.js';
import { formatInterval } from '../srs.js';
import { isHan } from '../segment.js';

/** Definition text used to classify the headword (licensed MMAH data only). */
export function headwordDefinition(dict, word) {
  const e = dict.entry(word);
  if (e?.definition) return e.definition;
  return '';
}

export async function wordView(root, ctx, word, { autoExamples = false } = {}) {
  clear(root);
  let card = await ctx.storage.getWord(word);
  const dict = await ctx.dict();
  if (!card) {
    root.append(
      h('section', { class: 'panel' }, h('h1', { lang: 'zh-CN' }, word), h('p', null, 'This word is not in your dictionary yet.'), h('button', { class: 'btn primary', onclick: async () => { await ctx.saveWord(word, null, null); wordView(root, ctx, word); } }, '＋ Save word'))
    );
    return;
  }

  const notes = h('textarea', { class: 'input notes', id: 'word-notes', placeholder: 'Your notes: mnemonics, usage, where you saw it…' }, card.notes || '');
  const savedState = h('span', { class: 'muted save-state' });
  const saveNotes = debounce(async () => {
    card = await ctx.storage.updateNotes(word, notes.value);
    savedState.textContent = 'Saved ✓';
  }, 500);
  notes.addEventListener('input', () => {
    savedState.textContent = 'Saving…';
    saveNotes();
  });
  notes.addEventListener('blur', () => saveNotes.flush());

  const chars = Array.from(word).filter(isHan);
  const bdHost = h('div', { class: 'bd-host' });
  const showChar = (c) => {
    clear(bdHost).append(renderBreakdown(dict.breakdown(c), { onWrite: (ch) => ctx.nav(`#/write/${encodeURIComponent(ch)}?word=${encodeURIComponent(word)}`) }));
  };

  const savedList = h('div', { class: 'saved-examples' });
  const renderSaved = () => {
    clear(savedList);
    const list = card.savedExamples || [];
    if (!list.length) {
      savedList.append(h('p', { class: 'muted' }, 'No saved examples yet. Use “Find & generate examples” below and tap Save.'));
      return;
    }
    for (const ex of list) {
      savedList.append(
        h(
          'div',
          { class: 'example saved' },
          h('div', { class: 'ex-zh', lang: 'zh-CN', role: 'button', tabindex: '0', onclick: () => ctx.speech.speakChinese(ex.zh) }, highlight(ex.zh, word)),
          h('div', { class: 'ex-en' }, ex.en || h('span', { class: 'unavailable' }, 'English unavailable')),
          ex.note ? h('div', { class: 'ex-note' }, ex.note) : null,
          h('div', { class: 'ex-meta' }, h('span', { class: `src-badge src-${ex.source}` }, sourceLabel(ex.source)), h('button', { class: 'btn small ghost', onclick: async () => { card = await ctx.storage.removeExample(word, ex.zh); renderSaved(); } }, 'Remove'))
        )
      );
    }
  };

  const exHost = h('div', { class: 'examples-host' });
  const findBtn = h('button', { class: 'btn primary big', id: 'find-examples', onclick: () => runExamples() }, '✨ Find & generate examples');

  async function runExamples() {
    findBtn.disabled = true;
    clear(exHost);
    const authentic = h('div', { class: 'ex-section' }, h('h3', null, TATOEBA_LABEL), h('p', { class: 'muted' }, 'Searching tatoeba.org… (only the word is sent)'));
    const generated = h('div', { class: 'ex-section' }, h('h3', null, GENERATED_LABEL), h('p', { class: 'muted' }, 'Building sentences and translating them live…'));
    exHost.append(authentic, generated);

    const settings = await ctx.storage.getSettings();
    const tPromise = findTatoebaExamples(word).then((r) => {
      clear(authentic).append(h('h3', null, TATOEBA_LABEL));
      if (!r.ok) authentic.append(h('p', { class: 'warn' }, r.error));
      else if (!r.examples.length) authentic.append(h('p', { class: 'muted' }, 'No Tatoeba sentences contain this word.'));
      else r.examples.forEach((ex) => authentic.append(exampleRow(ex)));
      authentic.append(h('p', { class: 'attribution' }, TATOEBA_ATTRIBUTION, ' — sentences from ', h('a', { href: 'https://tatoeba.org', target: '_blank', rel: 'noopener' }, 'tatoeba.org'), ', licensed CC-BY 2.0 FR.'));
    });
    const progress = generated.querySelector('p');
    const gPromise = generateExamples(word, {
      definition: headwordDefinition(dict, word),
      translate: (zh) => ctx.translator.translate(zh),
      settings,
      onProgress: (d, n) => (progress.textContent = `Translating generated sentence ${d}/${n}…`),
    }).then((r) => {
      clear(generated).append(h('h3', null, r.label));
      if (r.classification) generated.append(h('p', { class: 'muted' }, `Frames chosen as “${r.classification.kind}” because the ${r.classification.basis}. English is real machine translation (${ctx.providerName()}); not a large language model.`));
      if (r.warning) generated.append(h('p', { class: 'warn' }, r.warning));
      r.examples.forEach((ex) => generated.append(exampleRow(ex)));
    });
    await Promise.allSettled([tPromise, gPromise]);
    findBtn.disabled = false;
  }

  function exampleRow(ex) {
    const saveBtn = h('button', { class: 'btn small', onclick: async () => {
      card = await ctx.storage.addExample(word, ex);
      saveBtn.textContent = 'Saved ✓';
      saveBtn.disabled = true;
      renderSaved();
    } }, 'Save to word');
    if ((card.savedExamples || []).some((e) => e.zh === ex.zh)) {
      saveBtn.textContent = 'Saved ✓';
      saveBtn.disabled = true;
    }
    return h(
      'div',
      { class: `example src-${ex.source}` },
      h('div', { class: 'ex-zh', lang: 'zh-CN', role: 'button', tabindex: '0', onclick: () => ctx.speech.speakChinese(ex.zh) }, highlight(ex.zh, word)),
      h('div', { class: 'ex-en' }, ex.en || h('span', { class: 'unavailable' }, `English unavailable${ex.translationError ? ` (${ex.translationError})` : ''}`)),
      ex.note ? h('div', { class: 'ex-note' }, ex.note) : null,
      h('div', { class: 'ex-meta' }, h('span', { class: `src-badge src-${ex.source}` }, sourceLabel(ex.source)), ex.url ? h('a', { href: ex.url, target: '_blank', rel: 'noopener', class: 'muted' }, 'source') : null, saveBtn)
    );
  }

  const ctxBlock = (card.contexts?.length ? card.contexts : card.context ? [card.context] : []).map((c) =>
    h('div', { class: 'context' }, h('div', { class: 'ex-zh', lang: 'zh-CN', role: 'button', tabindex: '0', onclick: () => ctx.speech.speakChinese(c.zh) }, highlight(c.zh, word)), c.en ? h('div', { class: 'ex-en' }, c.en) : h('div', { class: 'muted' }, '(no translation saved)'))
  );
  const defs = dict.charDefinitions(word);

  root.append(
    h(
      'section',
      { class: 'panel word-head' },
      h(
        'div',
        { class: 'word-title-row' },
        h('h1', { class: 'word-big', lang: 'zh-CN' }, word),
        h('button', { class: 'btn', 'aria-label': 'Speak word', onclick: () => ctx.speech.speakChinese(word) }, '🔊'),
        h('div', { class: 'word-pinyin' }, card.pinyin || '(no pinyin in data)', card.pinyinSource === 'mmah-charwise' ? h('span', { class: 'muted' }, ' · character-wise, not a verified word reading') : null)
      ),
      defs.length ? h('ul', { class: 'char-defs' }, defs.map((d) => h('li', null, h('span', { lang: 'zh-CN', class: 'cd-char' }, d.char), ` ${d.pinyin.join(', ')} — ${d.definition}`))) : null,
      h('div', { class: 'srs-line' }, `Next review: ${fmtDate(card.dueAt)} · interval ${formatInterval(card.intervalDays)} · ease ${card.easiness} · reps ${card.repetitions}${card.lastResult ? ` · last: ${card.lastResult}` : ''}`),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { class: 'btn', onclick: () => ctx.nav(`#/drill/${encodeURIComponent(word)}`) }, '▶︎ Practice examples'),
        h('button', { class: 'btn danger', onclick: () => modal('Delete word?', h('p', null, `Remove “${word}” and its notes and examples?`), { actions: [{ label: 'Cancel' }, { label: 'Delete', primary: true, onClick: async () => { await ctx.storage.deleteWord(word); ctx.refreshBadge(); ctx.nav('#/vocab'); } }] }) }, 'Delete')
      )
    ),
    ctxBlock.length ? h('section', { class: 'panel' }, h('h2', null, 'Context'), ctxBlock) : null,
    h('section', { class: 'panel' }, h('h2', null, 'Notes ', savedState), notes),
    h('section', { class: 'panel' }, h('h2', null, 'Saved examples'), savedList),
    h('section', { class: 'panel examples-panel' }, h('h2', null, 'Examples & usages'), findBtn, h('p', { class: 'muted' }, 'Authentic: the word is sent to tatoeba.org. Generated: template sentences translated by ', ctx.providerName(), '.'), exHost),
    chars.length
      ? h(
          'section',
          { class: 'panel' },
          h('h2', null, 'Characters'),
          h('div', { class: 'char-tabs' }, chars.map((c) => h('button', { class: 'btn char-tab', lang: 'zh-CN', onclick: () => showChar(c) }, c)), chars.map((c) => h('button', { class: 'btn ghost', onclick: () => ctx.nav(`#/write/${encodeURIComponent(c)}?word=${encodeURIComponent(word)}`) }, `✍︎ ${c}`))),
          bdHost
        )
      : null
  );
  renderSaved();
  if (chars.length) showChar(chars[0]);
  if (autoExamples) runExamples();
}

export function highlight(text, word) {
  if (!word || !text.includes(word)) return text;
  const parts = text.split(word);
  const out = [];
  parts.forEach((p, i) => {
    if (i) out.push(h('mark', null, word));
    if (p) out.push(p);
  });
  return out;
}

export async function charView(root, ctx, ch) {
  clear(root);
  const dict = await ctx.dict();
  root.append(h('section', { class: 'panel' }, h('button', { class: 'btn ghost', onclick: () => history.back() }, '‹ Back'), renderBreakdown(dict.breakdown(ch), { onWrite: (c) => ctx.nav(`#/write/${encodeURIComponent(c)}`) })));
}

export { toast };

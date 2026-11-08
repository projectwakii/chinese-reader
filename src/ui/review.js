// Vocabulary list, SM-2 review session, and the "Practice examples" drill.
import { h, clear, fmtDate, toast } from './dom.js';
import { schedule, dueCards, previewIntervals, formatInterval, GRADE_LABELS, localDate } from '../srs.js';
import { sourceLabel } from '../examples/generate.js';
import { highlight } from './word.js';

export async function vocabView(root, ctx) {
  clear(root);
  const words = await ctx.storage.listWords();
  const today = localDate(new Date());
  const filter = h('input', { type: 'search', class: 'input', placeholder: 'Filter words / notes…' });
  const list = h('div', { class: 'vocab-list' });
  const render = () => {
    clear(list);
    const q = filter.value.trim();
    const shown = words.filter((w) => !q || w.word.includes(q) || (w.notes || '').includes(q) || (w.pinyin || '').includes(q));
    if (!shown.length) list.append(h('p', { class: 'empty' }, words.length ? 'No match.' : 'No saved words yet. Open a document, tap a sentence, tap characters, then “Save word”.'));
    for (const w of shown) {
      list.append(
        h(
          'button',
          { class: 'vocab-item', onclick: () => ctx.nav(`#/word/${encodeURIComponent(w.word)}`) },
          h('span', { class: 'v-word', lang: 'zh-CN' }, w.word),
          h('span', { class: 'v-pinyin' }, w.pinyin),
          h('span', { class: 'v-meta' }, `${(w.savedExamples || []).length} ex · due ${w.dueAt <= today ? 'now' : fmtDate(w.dueAt)}`)
        )
      );
    }
  };
  filter.addEventListener('input', render);
  root.append(
    h(
      'section',
      { class: 'panel' },
      h('h1', null, 'Vocabulary ', h('span', { class: 'muted' }, `(${words.length})`)),
      h('div', { class: 'row-actions' }, filter, h('button', { class: 'btn primary', onclick: () => ctx.nav('#/review') }, 'Review due'), h('button', { class: 'btn', onclick: () => ctx.nav('#/drill') }, 'Practice examples')),
      list
    )
  );
  render();
}

export async function reviewView(root, ctx) {
  clear(root);
  const now = () => new Date();
  let queue = dueCards(await ctx.storage.listWords(), now());
  const dict = await ctx.dict();
  const box = h('section', { class: 'panel review' });
  root.append(box);
  let reviewed = 0;

  const next = () => {
    clear(box);
    if (!queue.length) {
      box.append(h('h1', null, 'Review'), h('p', { class: 'empty' }, reviewed ? `Done! ${reviewed} card${reviewed === 1 ? '' : 's'} reviewed.` : 'No cards are due today.'), h('button', { class: 'btn', onclick: () => ctx.nav('#/vocab') }, 'Vocabulary'));
      ctx.refreshBadge();
      return;
    }
    const card = queue[0];
    const back = h('div', { class: 'card-back hidden' });
    const defs = dict.charDefinitions(card.word);
    back.append(
      h('div', { class: 'word-pinyin' }, card.pinyin, card.pinyinSource === 'mmah-charwise' ? h('span', { class: 'muted' }, ' (character-wise)') : null),
      defs.length ? h('ul', { class: 'char-defs' }, defs.map((d) => h('li', null, h('span', { lang: 'zh-CN' }, d.char), ` — ${d.definition}`))) : null,
      card.context ? h('div', { class: 'context' }, h('div', { class: 'ex-zh', lang: 'zh-CN' }, highlight(card.context.zh, card.word)), card.context.en ? h('div', { class: 'ex-en' }, card.context.en) : null) : null,
      card.notes ? h('div', { class: 'review-notes' }, h('strong', null, 'Notes: '), card.notes) : null,
      (card.savedExamples || []).slice(0, 2).map((ex) => h('div', { class: 'example' }, h('div', { class: 'ex-zh', lang: 'zh-CN' }, highlight(ex.zh, card.word)), h('div', { class: 'ex-en' }, ex.en || '—'), h('span', { class: `src-badge src-${ex.source}` }, sourceLabel(ex.source))))
    );
    const iv = previewIntervals(card, now());
    const grades = h(
      'div',
      { class: 'grade-row hidden' },
      Object.keys(GRADE_LABELS).map((g) =>
        h('button', { class: `btn grade grade-${g}`, onclick: async () => {
          const before = { ...card };
          const upd = schedule(card, g, now());
          await ctx.storage.updateWord(card.word, upd);
          await ctx.storage.logReview({ word: card.word, grade: g, before: { easiness: before.easiness, intervalDays: before.intervalDays, repetitions: before.repetitions }, after: upd });
          reviewed += 1;
          queue.shift();
          if (g === 'again') queue.push({ ...card, ...upd }); // see it again this session
          toastNext(card.word, upd.dueAt);
          next();
        } }, h('span', null, GRADE_LABELS[g]), h('small', null, formatInterval(iv[g])))
      )
    );
    const show = h('button', { class: 'btn primary big', onclick: () => { back.classList.remove('hidden'); grades.classList.remove('hidden'); show.remove(); } }, 'Show answer');
    box.append(
      h('div', { class: 'review-top' }, h('h1', null, 'Review'), h('span', { class: 'muted' }, `${queue.length} due`)),
      h('div', { class: 'card-front' }, h('div', { class: 'word-big', lang: 'zh-CN' }, card.word), h('button', { class: 'btn', onclick: () => ctx.speech.speakChinese(card.word) }, '🔊')),
      show,
      back,
      grades
    );
  };
  const toastNext = (w, due) => toast(`${w}: next review ${fmtDate(due)}`);
  next();
}

export async function drillView(root, ctx, word) {
  clear(root);
  const words = word ? [await ctx.storage.getWord(word)].filter(Boolean) : await ctx.storage.listWords();
  const items = words.flatMap((w) => (w.savedExamples || []).map((ex) => ({ ...ex, word: w.word })));
  const box = h('section', { class: 'panel drill' });
  root.append(box);
  if (!items.length) {
    box.append(h('h1', null, 'Practice examples'), h('p', { class: 'empty' }, 'No saved examples yet. Open a word and use “Find & generate examples”, then save some.'));
    return;
  }
  // shuffle
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  let i = 0;
  const show = () => {
    clear(box);
    const ex = items[i];
    const reveal = h('div', { class: 'drill-back hidden' }, h('div', { class: 'ex-en' }, ex.en || h('span', { class: 'unavailable' }, 'English unavailable')), ex.note ? h('div', { class: 'ex-note' }, ex.note) : null, h('span', { class: `src-badge src-${ex.source}` }, sourceLabel(ex.source)));
    const revealBtn = h('button', { class: 'btn primary big', onclick: () => { reveal.classList.remove('hidden'); revealBtn.remove(); } }, 'Reveal English');
    box.append(
      h('div', { class: 'review-top' }, h('h1', null, 'Practice examples'), h('span', { class: 'muted' }, `${i + 1} / ${items.length}`)),
      h('div', { class: 'drill-word' }, 'Word: ', h('a', { href: `#/word/${encodeURIComponent(ex.word)}`, lang: 'zh-CN' }, ex.word)),
      h('div', { class: 'drill-zh', lang: 'zh-CN' }, highlight(ex.zh, ex.word)),
      h('div', { class: 'row-actions' }, h('button', { class: 'btn', onclick: () => ctx.speech.speakChinese(ex.zh) }, '🔊 Speak'), revealBtn),
      reveal,
      h('div', { class: 'row-actions' }, h('button', { class: 'btn', disabled: i === 0, onclick: () => { i -= 1; show(); } }, '‹ Prev'), h('button', { class: 'btn primary', onclick: () => { i = (i + 1) % items.length; show(); } }, 'Next ›'))
    );
  };
  show();
}

// Writing practice screen (Apple Pencil / finger / mouse).
import { h, clear } from './dom.js';
import { WritingPad } from '../hanzi/writer.js';
import { isHan } from '../segment.js';

export async function writeView(root, ctx, ch, word = '') {
  clear(root);
  const chars = Array.from(word || ch).filter(isHan);
  const res = await ctx.strokes.load(ch);
  const dict = await ctx.dict();
  const e = dict.entry(ch);
  const feedback = h('div', { class: 'write-feedback', 'aria-live': 'polite' }, res.status === 'ok' ? `Write ${ch}: ${res.data.strokes.length} strokes. Use Apple Pencil, finger or mouse.` : '');
  const counter = h('span', { class: 'stroke-count' });
  const canvas = h('canvas', { class: 'write-canvas', id: 'write-canvas', 'aria-label': `Writing area for ${ch}` });
  const stage = h('div', { class: 'write-stage' }, canvas);
  const guideToggle = h('input', { type: 'checkbox', checked: true, onchange: (ev) => pad.setGuide(ev.target.checked) });

  root.append(
    h(
      'section',
      { class: 'panel write-panel' },
      h(
        'div',
        { class: 'write-head' },
        h('button', { class: 'btn ghost', onclick: () => history.back() }, '‹ Back'),
        h('div', { class: 'write-char', lang: 'zh-CN' }, ch),
        h('div', { class: 'write-info' }, e ? `${(e.pinyin || []).join(', ')} — ${e.definition || ''}` : ''),
        chars.length > 1 ? h('div', { class: 'char-tabs' }, chars.map((c) => h('button', { class: `btn char-tab ${c === ch ? 'primary' : ''}`, lang: 'zh-CN', onclick: () => writeView(root, ctx, c, word) }, c))) : null
      ),
      res.status !== 'ok' ? h('p', { class: 'missing-msg' }, res.message) : null,
      stage,
      h(
        'div',
        { class: 'write-actions' },
        h('button', { class: 'btn', id: 'btn-clear', onclick: () => pad.clear() }, 'Clear'),
        h('button', { class: 'btn', onclick: () => pad.undo() }, 'Undo'),
        h('button', { class: 'btn primary', id: 'btn-replay', disabled: res.status !== 'ok', onclick: () => pad.replay() }, '▶︎ Replay stroke order'),
        h('button', { class: 'btn', id: 'btn-hint', disabled: res.status !== 'ok', onclick: () => { const i = pad.nextHint(); feedback.textContent = `Hint: stroke ${i + 1} (red, starting at the dot).`; } }, 'Next stroke hint'),
        h('label', { class: 'toggle' }, guideToggle, ' Show guide'),
        counter
      ),
      feedback,
      h('p', { class: 'muted small' }, 'Feedback only compares stroke count, rough direction and start position with the reference medians — it is not handwriting recognition. Stroke data: Make Me a Hanzi / hanzi-writer-data (Arphic Public License).', res.status === 'ok' ? ` Source: ${res.source}.` : '')
    )
  );

  const pad = new WritingPad(canvas, {
    strokeData: res.status === 'ok' ? res.data : null,
    onChange: (p) => (counter.textContent = `${p.strokes.length}${p.expectedStrokes ? ` / ${p.expectedStrokes}` : ''} strokes`),
    onFeedback: (msg) => (feedback.textContent = msg),
  });
  pad.onChange(pad);
  if (res.status !== 'ok') pad.setGuide(false);
  const onResize = () => pad.resize();
  window.addEventListener('resize', onResize);
  ctx.onLeave(() => {
    window.removeEventListener('resize', onResize);
    pad.destroy();
  });
  requestAnimationFrame(() => pad.resize());
  return pad;
}

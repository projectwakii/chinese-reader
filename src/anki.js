// Anki export as tab-separated text (Anki: File › Import). Columns:
// Front, Back, Notes, Context, Examples. Uses Anki's file headers (#separator, #html,
// #columns) supported by Anki 2.1.55+; older versions: choose "Tab" + "Allow HTML" manually.
import { sourceLabel } from './examples/generate.js';

export const ANKI_COLUMNS = ['Front', 'Back', 'Notes', 'Context', 'Examples'];

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>');

export function cardToRow(card) {
  const back = [card.pinyin && `${esc(card.pinyin)}${card.pinyinSource === 'mmah-charwise' ? ' <small>(character-wise)</small>' : ''}`, esc(card.definition)]
    .filter(Boolean)
    .join('<br>');
  const ctx = card.context ? [esc(card.context.zh), card.context.en ? `<i>${esc(card.context.en)}</i>` : ''].filter(Boolean).join('<br>') : '';
  const examples = (card.savedExamples || [])
    .map((e) => `${esc(e.zh)}${e.en ? ` — ${esc(e.en)}` : ''}${e.note ? ` <small>(${esc(e.note)})</small>` : ''} <small>[${esc(sourceLabel(e.source))}]</small>`)
    .join('<br>');
  return [esc(card.word), back, esc(card.notes), ctx, examples];
}

export function toAnkiTsv(cards) {
  const header = ['#separator:tab', '#html:true', `#columns:${ANKI_COLUMNS.join('\t')}`];
  const rows = cards.map((c) => cardToRow(c).join('\t'));
  return [...header, ...rows].join('\n') + '\n';
}

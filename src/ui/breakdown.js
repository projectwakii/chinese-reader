// Visual radical + component breakdown from Make Me a Hanzi data only.
import { h } from './dom.js';
import { IDS_OPERATORS, MISSING_DECOMP } from '../hanzi/dict.js';

const ETYM_TYPES = {
  pictophonetic: 'Pictophonetic (semantic + phonetic component)',
  ideographic: 'Ideographic (components combine meaning)',
  pictographic: 'Pictographic (picture of a thing)',
};

// Box layouts for each IDS operator (drawn as SVG because many fonts lack U+2FF0–2FFB).
const OP_RECTS = {
  '⿰': [[1, 1, 9, 18], [10, 1, 9, 18]],
  '⿱': [[1, 1, 18, 9], [1, 10, 18, 9]],
  '⿲': [[1, 1, 6, 18], [7, 1, 6, 18], [13, 1, 6, 18]],
  '⿳': [[1, 1, 18, 6], [1, 7, 18, 6], [1, 13, 18, 6]],
  '⿴': [[1, 1, 18, 18], [6, 6, 8, 8]],
  '⿵': [[1, 1, 18, 18], [6, 7, 8, 12]],
  '⿶': [[1, 1, 18, 18], [6, 1, 8, 12]],
  '⿷': [[1, 1, 18, 18], [7, 6, 12, 8]],
  '⿸': [[1, 1, 18, 18], [7, 7, 12, 12]],
  '⿹': [[1, 1, 18, 18], [1, 7, 12, 12]],
  '⿺': [[1, 1, 18, 18], [7, 1, 12, 12]],
  '⿻': [[2, 2, 12, 12], [6, 6, 12, 12]],
};

export function opIcon(op) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('class', 'opicon');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${op} ${IDS_OPERATORS[op]?.label || ''}`);
  for (const [x, y, w, hh] of OP_RECTS[op] || []) {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('x', x);
    r.setAttribute('y', y);
    r.setAttribute('width', w);
    r.setAttribute('height', hh);
    svg.appendChild(r);
  }
  return svg;
}

/** IDS string with operators replaced by icons (components stay as text). */
function idsInline(ids) {
  return Array.from(ids).map((c) => (IDS_OPERATORS[c] ? opIcon(c) : h('span', { lang: 'zh-CN' }, c)));
}

function compBox(node) {
  if (node.type === 'unknown') return h('div', { class: 'comp unknown' }, h('div', { class: 'glyph' }, '？'), h('div', { class: 'cdef' }, MISSING_DECOMP));
  if (node.type === 'op') {
    return h(
      'div',
      { class: `ids ids-${node.dir}`, title: node.label },
      h('div', { class: 'ids-op' }, opIcon(node.op), ' ', node.label),
      h('div', { class: 'ids-children' }, node.children.map(compBox))
    );
  }
  return h(
    'div',
    { class: `comp ${node.known ? '' : 'unknown'}` },
    h('div', { class: 'glyph', lang: 'zh-CN' }, node.char),
    node.known
      ? [
          node.pinyin?.length ? h('div', { class: 'cpy' }, node.pinyin.join(', ')) : null,
          h('div', { class: 'cdef' }, node.definition || '(no definition in data)'),
        ]
      : h('div', { class: 'cdef' }, MISSING_DECOMP),
    node.sub ? h('div', { class: 'sub' }, compBox(node.sub)) : null
  );
}

export function renderBreakdown(bd, { onWrite } = {}) {
  if (bd.status === 'missing') {
    return h('div', { class: 'breakdown missing' }, h('div', { class: 'big-char', lang: 'zh-CN' }, bd.char), h('p', { class: 'missing-msg' }, bd.message), h('p', { class: 'missing-msg' }, MISSING_DECOMP));
  }
  const usedOps = new Set();
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'op') {
      usedOps.add(n.op);
      n.children.forEach(walk);
    } else if (n.sub) walk(n.sub);
  };
  walk(bd.tree);
  const et = bd.etymology;
  return h(
    'div',
    { class: 'breakdown' },
    h(
      'div',
      { class: 'bd-head' },
      h('div', { class: 'big-char', lang: 'zh-CN' }, bd.char),
      h(
        'div',
        { class: 'bd-meta' },
        h('div', { class: 'bd-pinyin' }, bd.pinyin.join(', ')),
        h('div', { class: 'bd-def' }, bd.definition || '(no definition in data)'),
        bd.radical
          ? h(
              'div',
              { class: 'bd-radical' },
              h('span', { class: 'label' }, 'Radical'),
              h('span', { class: 'rad-glyph', lang: 'zh-CN' }, bd.radical.char),
              bd.radical.pinyin?.length ? h('span', { class: 'muted' }, ` ${bd.radical.pinyin.join(', ')}`) : null,
              bd.radical.definition ? h('span', null, ` — ${bd.radical.definition}`) : null
            )
          : null,
        onWrite ? h('button', { class: 'btn', onclick: () => onWrite(bd.char) }, '✍︎ Practice writing') : null
      )
    ),
    h('h3', null, 'Components'),
    bd.decompositionStatus === 'ok'
      ? [h('div', { class: 'ids-raw' }, 'IDS: ', h('code', { title: bd.decomposition }, idsInline(bd.decomposition))), h('div', { class: 'tree' }, compBox(bd.tree))]
      : h('p', { class: 'missing-msg' }, MISSING_DECOMP),
    usedOps.size
      ? h(
          'div',
          { class: 'legend' },
          h('strong', null, 'Legend: '),
          [...usedOps].map((op) => h('span', { class: 'legend-item' }, opIcon(op), ` ${IDS_OPERATORS[op].label}`))
        )
      : null,
    et
      ? h(
          'div',
          { class: 'etymology' },
          h('h3', null, 'Etymology (from data)'),
          h('div', null, ETYM_TYPES[et.type] || et.type),
          et.semantic ? h('div', null, h('span', { class: 'label' }, 'Semantic'), h('span', { lang: 'zh-CN', class: 'rad-glyph' }, et.semantic)) : null,
          et.phonetic ? h('div', null, h('span', { class: 'label' }, 'Phonetic'), h('span', { lang: 'zh-CN', class: 'rad-glyph' }, et.phonetic)) : null,
          et.hint ? h('div', null, h('span', { class: 'label' }, 'Hint'), et.hint) : null
        )
      : null,
    h('p', { class: 'license-note' }, 'Data: Make Me a Hanzi (Unihan + CJKlib), LGPL-3.0.')
  );
}

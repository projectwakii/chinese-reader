// Make Me a Hanzi dictionary lookup (data/dictionary-mmah.txt, LGPL-3.0; derived from Unihan + CJKlib).
// Everything shown comes from the data file. Unknown/invalid -> explicit "missing" state, never a guess.

export const DICT_URL = 'data/dictionary-mmah.txt';
export const MISSING_DECOMP = 'No licensed decomposition for this character/component.';
export const MISSING_ENTRY = 'This character is not in the licensed Make Me a Hanzi dictionary.';

/** IDS operators and their arity + human label (legend). */
export const IDS_OPERATORS = {
  '⿰': { arity: 2, label: 'left → right', dir: 'row' },
  '⿱': { arity: 2, label: 'top → bottom', dir: 'col' },
  '⿲': { arity: 3, label: 'left → middle → right', dir: 'row' },
  '⿳': { arity: 3, label: 'top → middle → bottom', dir: 'col' },
  '⿴': { arity: 2, label: 'full surround', dir: 'surround' },
  '⿵': { arity: 2, label: 'surround from above', dir: 'surround' },
  '⿶': { arity: 2, label: 'surround from below', dir: 'surround' },
  '⿷': { arity: 2, label: 'surround from left', dir: 'surround' },
  '⿸': { arity: 2, label: 'surround from upper left', dir: 'surround' },
  '⿹': { arity: 2, label: 'surround from upper right', dir: 'surround' },
  '⿺': { arity: 2, label: 'surround from lower left', dir: 'surround' },
  '⿻': { arity: 2, label: 'overlaid', dir: 'overlay' },
};

/** Parse MMAH dictionary.txt (one JSON object per line) into a Map. */
export function parseDictionary(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o && o.character) map.set(o.character, o);
    } catch {
      /* skip malformed line */
    }
  }
  return map;
}

/** A decomposition is valid if present and does not start with the unknown marker '？'. */
export function isValidDecomposition(ids) {
  return typeof ids === 'string' && ids.length > 0 && !ids.startsWith('？') && ids !== '?';
}

/**
 * Parse an IDS string into a tree. Leaves are {type:'component', char} ; unknown '？' leaves
 * are {type:'unknown'}.
 */
export function parseIDS(ids) {
  const chars = Array.from(ids);
  let i = 0;
  function node() {
    if (i >= chars.length) return { type: 'unknown' };
    const c = chars[i++];
    const op = IDS_OPERATORS[c];
    if (op) {
      const children = [];
      for (let k = 0; k < op.arity; k++) children.push(node());
      return { type: 'op', op: c, label: op.label, dir: op.dir, children };
    }
    if (c === '？' || c === '?') return { type: 'unknown' };
    return { type: 'component', char: c };
  }
  const tree = node();
  return tree;
}

export class HanziDictionary {
  constructor(map) {
    this.map = map;
  }

  static fromText(text) {
    return new HanziDictionary(parseDictionary(text));
  }

  has(ch) {
    return this.map.has(ch);
  }

  entry(ch) {
    return this.map.get(ch) || null;
  }

  pinyinOf(ch) {
    const e = this.entry(ch);
    return e && Array.isArray(e.pinyin) && e.pinyin.length ? e.pinyin : [];
  }

  /**
   * Character-wise pinyin for a word. Not a verified word reading (no word dictionary shipped).
   * @returns {{pinyin:string, source:'mmah-charwise'|'mmah-char'|'', complete:boolean}}
   */
  wordPinyin(word) {
    const chars = Array.from(word);
    const parts = chars.map((c) => this.pinyinOf(c)[0] || '');
    const complete = parts.every(Boolean);
    const pinyin = parts.map((p, i) => p || '?' + chars[i]).join(' ');
    if (!parts.some(Boolean)) return { pinyin: '', source: '', complete: false };
    return { pinyin, source: chars.length === 1 ? 'mmah-char' : 'mmah-charwise', complete };
  }

  /** Character-wise definitions [{char, definition}] from the data, for word cards. */
  charDefinitions(word) {
    return Array.from(word)
      .map((c) => ({ char: c, definition: this.entry(c)?.definition || '', pinyin: this.pinyinOf(c) }))
      .filter((x) => x.definition || x.pinyin.length);
  }

  /**
   * Full breakdown for one character.
   * @returns {{char:string, status:'ok'|'missing', message?:string, definition?:string, pinyin?:string[],
   *   radical?:{char:string, definition:string|null, pinyin:string[]}|null, decomposition?:string|null,
   *   decompositionStatus:'ok'|'missing', tree?:object|null, etymology?:object|null}}
   */
  breakdown(ch, maxDepth = 2) {
    const e = this.entry(ch);
    if (!e) {
      return { char: ch, status: 'missing', message: MISSING_ENTRY, decompositionStatus: 'missing', tree: null, radical: null, etymology: null };
    }
    const valid = isValidDecomposition(e.decomposition);
    const tree = valid ? this._expand(parseIDS(e.decomposition), maxDepth, new Set([ch])) : null;
    const rad = e.radical ? this.entry(e.radical) : null;
    return {
      char: ch,
      status: 'ok',
      definition: e.definition || '',
      pinyin: e.pinyin || [],
      radical: e.radical ? { char: e.radical, definition: rad?.definition || null, pinyin: rad?.pinyin || [] } : null,
      decomposition: valid ? e.decomposition : null,
      decompositionStatus: valid ? 'ok' : 'missing',
      message: valid ? undefined : MISSING_DECOMP,
      tree,
      etymology: e.etymology ? sanitizeEtymology(e.etymology) : null,
    };
  }

  _expand(node, depth, seen) {
    if (node.type === 'op') {
      return { ...node, children: node.children.map((c) => this._expand(c, depth, seen)) };
    }
    if (node.type === 'unknown') return { type: 'unknown', message: MISSING_DECOMP };
    const e = this.entry(node.char);
    const leaf = {
      type: 'component',
      char: node.char,
      known: !!e,
      definition: e?.definition || null,
      pinyin: e?.pinyin || [],
      message: e ? undefined : MISSING_DECOMP,
      sub: null,
    };
    if (e && depth > 1 && !seen.has(node.char) && isValidDecomposition(e.decomposition)) {
      const next = new Set(seen).add(node.char);
      const sub = parseIDS(e.decomposition);
      // only expand when it actually decomposes into an operator (not a self-reference)
      if (sub.type === 'op') leaf.sub = this._expand(sub, depth - 1, next);
    }
    return leaf;
  }
}

function sanitizeEtymology(et) {
  const out = { type: et.type };
  for (const k of ['hint', 'phonetic', 'semantic']) if (et[k]) out[k] = et[k];
  return out;
}

let _shared = null;
/** Lazy-load the dictionary once (browser). */
export function loadDictionary({ fetch: f = globalThis.fetch, url = DICT_URL } = {}) {
  if (!_shared) {
    _shared = f(url)
      .then((r) => {
        if (!r.ok) throw new Error(`dictionary HTTP ${r.status}`);
        return r.text();
      })
      .then((t) => HanziDictionary.fromText(t))
      .catch((e) => {
        _shared = null;
        throw e;
      });
  }
  return _shared;
}

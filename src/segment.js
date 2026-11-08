// Sentence segmentation for Chinese and mixed Chinese/Latin text.
// Terminators stay attached to their sentence; trailing closing quotes/brackets too.
// Leftover fragments (no terminator) are kept as their own sentence — nothing is dropped.

const CJK_TERMINATORS = '。！？…｡．';
const LATIN_TERMINATORS = '!?';
const CLOSERS = '”’」』）》〉】〕"\')]}';

const isTerminator = (ch) => CJK_TERMINATORS.includes(ch) || LATIN_TERMINATORS.includes(ch);

/**
 * Split a single paragraph into sentences.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const s = String(text ?? '');
  const out = [];
  let buf = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    buf += ch;
    let end = false;
    if (isTerminator(ch)) {
      end = true;
    } else if (ch === '.') {
      // Latin full stop ends a sentence only when followed by whitespace/end/CJK
      // and not part of a number like 3.14 or an ellipsis "..." (handled below).
      const next = s[i + 1];
      const prev = s[i - 1];
      if (next === '.') {
        end = false;
      } else if (prev && /\d/.test(prev) && next && /\d/.test(next)) {
        end = false;
      } else if (next === undefined || /\s/.test(next) || /[㐀-鿿]/.test(next)) {
        end = true;
      }
    }
    if (end) {
      // absorb runs of terminators (……, ?!, 。」) and closing quotes/brackets
      while (i + 1 < s.length && (isTerminator(s[i + 1]) || s[i + 1] === '.' || CLOSERS.includes(s[i + 1]))) {
        i += 1;
        buf += s[i];
      }
      pushTrimmed(out, buf);
      buf = '';
    }
    i += 1;
  }
  pushTrimmed(out, buf);
  return out;
}

function pushTrimmed(out, buf) {
  const t = buf.replace(/^\s+|\s+$/g, '');
  if (t) out.push(t);
}

/**
 * Split text into paragraphs (each non-empty line) of sentences.
 * @param {string} text
 * @returns {string[][]} paragraphs -> sentences
 */
export function segmentText(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/　/g, ' ').trim())
    .filter(Boolean)
    .map(splitSentences)
    .filter((p) => p.length);
}

/**
 * Build the flat sentence records for a document from chapters of paragraph text.
 * @param {string} docId
 * @param {{title:string, paragraphs:string[]}[]} chapters paragraphs are raw text strings
 * @returns {{chapters:{title:string,start:number,count:number}[], sentences:{id:string,docId:string,idx:number,chapter:number,para:number,zh:string}[]}}
 */
export function buildSentences(docId, chapters) {
  const sentences = [];
  const chapterMeta = [];
  let para = 0;
  chapters.forEach((ch, ci) => {
    const start = sentences.length;
    for (const p of ch.paragraphs) {
      const parts = splitSentences(p);
      if (!parts.length) continue;
      for (const zh of parts) {
        const idx = sentences.length;
        sentences.push({ id: `${docId}:${idx}`, docId, idx, chapter: ci, para, zh });
      }
      para += 1;
    }
    const count = sentences.length - start;
    if (count) chapterMeta.push({ title: ch.title || `Section ${chapterMeta.length + 1}`, start, count });
  });
  // re-number chapter indexes after dropping empty chapters
  chapterMeta.forEach((c, i) => {
    for (let k = c.start; k < c.start + c.count; k++) sentences[k].chapter = i;
  });
  return { chapters: chapterMeta, sentences };
}

/** Group paragraph strings into chunks so huge plain-text files are paginated. */
export function chunkParagraphs(paragraphs, maxChars = 6000, titlePrefix = 'Part') {
  const chapters = [];
  let cur = [];
  let size = 0;
  for (const p of paragraphs) {
    cur.push(p);
    size += p.length;
    if (size >= maxChars) {
      chapters.push({ title: `${titlePrefix} ${chapters.length + 1}`, paragraphs: cur });
      cur = [];
      size = 0;
    }
  }
  if (cur.length) chapters.push({ title: chapters.length ? `${titlePrefix} ${chapters.length + 1}` : '', paragraphs: cur });
  return chapters;
}

export const HAN_RE = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2ffff}]/u;
export const isHan = (ch) => HAN_RE.test(ch);

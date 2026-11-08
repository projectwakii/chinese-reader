// PDF import with Mozilla pdf.js (vendored under vendor/pdfjs, Apache-2.0).
// Text is extracted per page via getTextContent(). Scanned/image-only PDFs are detected
// and rejected with a clear message: OCR is not supported.

export const SCANNED_MIN_CHARS_PER_PAGE = 20;
export const SCANNED_MESSAGE =
  'This PDF has no extractable text — it looks like a scanned or image-only PDF. ' +
  'OCR is NOT supported in Chinese Reader. Please export or save a text-based PDF ' +
  '(e.g. “Export as PDF” from the original document), use the EPUB version, or paste the text instead.';

export class ScannedPdfError extends Error {
  constructor(stats) {
    super(SCANNED_MESSAGE);
    this.code = 'SCANNED_PDF';
    this.stats = stats;
  }
}

const CJK_END = /[　-〿㐀-鿿＀-￯]$/;
const CJK_START = /^[　-〿㐀-鿿＀-￯]/;
const TERM_END = /[。！？!?…」』”）]$/;

/** Join two text pieces: no space between CJK, a space between Latin words. */
export function joinPieces(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (CJK_END.test(a) || CJK_START.test(b) || /\s$/.test(a) || /^\s/.test(b)) return a + b;
  if (/-$/.test(a)) return a.slice(0, -1) + b;
  return `${a} ${b}`;
}

/** Turn pdf.js text items of one page into paragraphs. */
export function pageItemsToParagraphs(items) {
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    const y = it.transform ? it.transform[5] : 0;
    const h = Math.abs(it.height || (it.transform ? it.transform[3] : 0)) || 10;
    if (!cur || Math.abs(cur.y - y) > h * 0.5) {
      if (cur) lines.push(cur);
      cur = { y, h, text: '', width: 0 };
    }
    cur.text = cur.text ? (it.str ? joinPieces(cur.text, it.str) : cur.text) : it.str;
    cur.width += it.width || 0;
    if (it.hasEOL) {
      lines.push(cur);
      cur = null;
    }
  }
  if (cur) lines.push(cur);
  const clean = lines.map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() })).filter((l) => l.text);
  if (!clean.length) return [];

  const gaps = [];
  for (let i = 1; i < clean.length; i++) gaps.push(Math.abs(clean[i - 1].y - clean[i].y));
  const sorted = [...gaps].sort((a, b) => a - b);
  const typicalGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const maxWidth = Math.max(...clean.map((l) => l.width));

  const paragraphs = [];
  let buf = clean[0].text;
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1];
    const gap = gaps[i - 1];
    const bigGap = typicalGap > 0 && gap > typicalGap * 1.6;
    const shortEnded = TERM_END.test(prev.text) && maxWidth > 0 && prev.width < maxWidth * 0.8;
    // a Latin heading line followed by a Chinese line starts a new paragraph
    const scriptSwitch = /[A-Za-z0-9]$/.test(prev.text) && CJK_START.test(clean[i].text);
    if (bigGap || shortEnded || scriptSwitch) {
      paragraphs.push(buf);
      buf = clean[i].text;
    } else {
      buf = joinPieces(buf, clean[i].text);
    }
  }
  paragraphs.push(buf);
  return paragraphs;
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{pdfjsLib:any, cMapUrl?:string, standardFontDataUrl?:string, onProgress?:(page:number,total:number)=>void}} deps
 */
export async function importPdf(data, deps) {
  const lib = deps.pdfjsLib;
  // pdf.js wants a plain Uint8Array (not a Node Buffer subclass) and may transfer it.
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data.slice(0)) : new Uint8Array(data);
  const task = lib.getDocument({
    data: bytes,
    cMapUrl: deps.cMapUrl,
    cMapPacked: true,
    standardFontDataUrl: deps.standardFontDataUrl,
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
  });
  const pdf = await task.promise;
  let title = '';
  try {
    const meta = await pdf.getMetadata();
    title = meta?.info?.Title || '';
  } catch {
    /* no metadata */
  }
  const pages = [];
  let totalChars = 0;
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const paragraphs = pageItemsToParagraphs(content.items);
    const chars = paragraphs.join('').replace(/\s+/g, '').length;
    totalChars += chars;
    pages.push({ page: p, paragraphs, chars });
    page.cleanup?.();
    deps.onProgress?.(p, pdf.numPages);
  }
  await pdf.destroy?.();
  const numPages = pages.length || 1;
  const stats = { numPages, totalChars, avgCharsPerPage: totalChars / numPages };
  if (totalChars === 0 || stats.avgCharsPerPage < SCANNED_MIN_CHARS_PER_PAGE) {
    throw new ScannedPdfError(stats);
  }
  const chapters = pages.filter((pg) => pg.paragraphs.length).map((pg) => ({ title: `Page ${pg.page}`, paragraphs: pg.paragraphs }));
  return { title, type: 'pdf', chapters, stats };
}

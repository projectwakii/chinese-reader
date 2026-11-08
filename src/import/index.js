// Import dispatcher: file -> {title, type, chapters} -> stored document + sentences.
import { importPlainText, decodeText } from './text.js';
import { importEpub } from './epub.js';
import { importPdf } from './pdf.js';
import { buildSentences, chunkParagraphs } from '../segment.js';
import { makeId } from '../storage.js';

export { ScannedPdfError, SCANNED_MESSAGE } from './pdf.js';

export function detectType(name = '', mime = '') {
  const n = name.toLowerCase();
  if (n.endsWith('.epub') || mime === 'application/epub+zip') return 'epub';
  if (n.endsWith('.pdf') || mime === 'application/pdf') return 'pdf';
  if (n.endsWith('.txt') || n.endsWith('.text') || n.endsWith('.md') || mime.startsWith('text/')) return 'txt';
  return null;
}

const stripExt = (n) => n.replace(/\.[^.]+$/, '');

/** Lazily load browser builds of the vendored libraries. */
export async function browserDeps() {
  const deps = {};
  deps.loadJSZip = async () => {
    if (!globalThis.JSZip) await loadScript('vendor/jszip/jszip.min.js');
    return globalThis.JSZip;
  };
  deps.loadPdfjs = async () => {
    const lib = await import(new URL('../../vendor/pdfjs/pdf.min.mjs', import.meta.url).href);
    lib.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    return lib;
  };
  deps.cMapUrl = new URL('../../vendor/pdfjs/cmaps/', import.meta.url).href;
  return deps;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Parse a file into chapters.
 * @param {{name:string, type?:string, arrayBuffer:()=>Promise<ArrayBuffer>}} file
 */
export async function parseFile(file, deps, onProgress) {
  const type = detectType(file.name, file.type || '');
  if (!type) throw new Error(`Unsupported file type: ${file.name}. Use .txt, .epub or .pdf.`);
  const buf = await file.arrayBuffer();
  let parsed;
  if (type === 'txt') {
    const { text } = decodeText(new Uint8Array(buf));
    parsed = importPlainText(text, stripExt(file.name));
  } else if (type === 'epub') {
    const JSZip = deps.JSZip || (await deps.loadJSZip());
    parsed = await importEpub(buf, { JSZip, DOMParser: deps.DOMParser });
  } else {
    const pdfjsLib = deps.pdfjsLib || (await deps.loadPdfjs());
    parsed = await importPdf(buf, { pdfjsLib, cMapUrl: deps.cMapUrl, onProgress });
  }
  if (!parsed.title) parsed.title = stripExt(file.name);
  return parsed;
}

/** Turn parsed chapters into a document record + sentence rows. */
export function toDocument(parsed, { now = new Date(), id = makeId('doc') } = {}) {
  let chapters = parsed.chapters;
  // One giant chapter (plain text without headings): paginate for a responsive reader.
  if (chapters.length === 1 && chapters[0].paragraphs.join('').length > 8000) {
    chapters = chunkParagraphs(chapters[0].paragraphs, 6000, chapters[0].title || 'Part');
  }
  const built = buildSentences(id, chapters);
  if (!built.sentences.length) throw new Error('No text found to read in this document.');
  const doc = {
    id,
    title: parsed.title || 'Untitled',
    type: parsed.type,
    createdAt: now.toISOString(),
    chapters: built.chapters,
    sentenceCount: built.sentences.length,
    charCount: built.sentences.reduce((n, s) => n + s.zh.length, 0),
  };
  return { doc, sentences: built.sentences };
}

// EPUB import: unzip with JSZip, read container.xml -> OPF, follow the spine order,
// extract visible text from each XHTML document. Each spine item becomes a chapter.

const BLOCK = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'tr', 'section', 'article',
  'header', 'footer', 'aside', 'figcaption', 'dd', 'dt', 'table', 'ul', 'ol', 'body',
]);
const SKIP = new Set(['script', 'style', 'rt', 'rp', 'head', 'title', 'svg', 'math', 'noscript', 'nav']);

function parseXml(DOMParserImpl, text, type) {
  const doc = new DOMParserImpl().parseFromString(text, type);
  const err = doc.getElementsByTagName('parsererror');
  if (err.length) return null;
  return doc;
}

/** Resolve a manifest href relative to the OPF location. */
export function resolvePath(base, href) {
  const clean = decodeURIComponent(href.split('#')[0]);
  if (clean.startsWith('/')) return clean.slice(1);
  const parts = base ? base.split('/') : [];
  for (const seg of clean.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

const local = (el) => (el.localName || el.nodeName || '').toLowerCase().replace(/^.*:/, '');

/** Extract paragraphs of visible text from an (X)HTML document. */
export function extractParagraphs(doc) {
  const body = doc.getElementsByTagName('body')[0] || doc.documentElement;
  const paragraphs = [];
  let buf = '';
  const flush = () => {
    const t = buf.replace(/[ \t\r\n ]+/g, ' ').trim();
    if (t) paragraphs.push(t);
    buf = '';
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      buf += node.nodeValue;
      return;
    }
    if (node.nodeType !== 1) return;
    const name = local(node);
    if (SKIP.has(name)) return;
    if (name === 'br') {
      flush();
      return;
    }
    const block = BLOCK.has(name);
    if (block) flush();
    for (let c = node.firstChild; c; c = c.nextSibling) walk(c);
    if (block) flush();
  };
  walk(body);
  flush();
  return paragraphs;
}

function firstHeading(doc) {
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = doc.getElementsByTagName(tag)[0];
    if (el && el.textContent.trim()) return el.textContent.replace(/\s+/g, ' ').trim();
  }
  const t = doc.getElementsByTagName('title')[0];
  return t ? t.textContent.trim() : '';
}

/**
 * @param {ArrayBuffer|Uint8Array} data
 * @param {{JSZip:any, DOMParser?:any}} deps
 */
export async function importEpub(data, deps) {
  const JSZip = deps.JSZip;
  const DP = deps.DOMParser || globalThis.DOMParser;
  const zip = await JSZip.loadAsync(data);
  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) throw new Error('Not a valid EPUB: META-INF/container.xml missing');
  const container = parseXml(DP, await containerFile.async('string'), 'application/xml');
  const rootfile = container && container.getElementsByTagName('rootfile')[0];
  const opfPath = rootfile && rootfile.getAttribute('full-path');
  if (!opfPath || !zip.file(opfPath)) throw new Error('Not a valid EPUB: package document (OPF) not found');
  const opf = parseXml(DP, await zip.file(opfPath).async('string'), 'application/xml');
  if (!opf) throw new Error('Could not parse EPUB package document');
  const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';

  const manifest = new Map();
  for (const item of Array.from(opf.getElementsByTagName('item'))) {
    manifest.set(item.getAttribute('id'), { href: item.getAttribute('href'), type: item.getAttribute('media-type') || '' });
  }
  const titleEl = opf.getElementsByTagNameNS ? opf.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'title')[0] : null;
  const title = (titleEl || opf.getElementsByTagName('dc:title')[0])?.textContent?.trim() || '';

  const chapters = [];
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    if (ref.getAttribute('linear') === 'no') continue;
    const item = manifest.get(ref.getAttribute('idref'));
    if (!item || !/x?html/i.test(item.type + item.href)) continue;
    const path = resolvePath(base, item.href);
    const file = zip.file(path);
    if (!file) continue;
    const src = await file.async('string');
    const doc = parseXml(DP, src, 'application/xhtml+xml') || new DP().parseFromString(src, 'text/html');
    const paragraphs = extractParagraphs(doc);
    if (!paragraphs.length) continue;
    chapters.push({ title: firstHeading(doc) || `Chapter ${chapters.length + 1}`, paragraphs });
  }
  if (!chapters.length) throw new Error('This EPUB contains no readable text in its spine.');
  return { title, type: 'epub', chapters };
}

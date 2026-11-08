import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { splitSentences, segmentText, buildSentences } from '../src/segment.js';
import { importPlainText, decodeText } from '../src/import/text.js';
import { importEpub } from '../src/import/epub.js';
import { importPdf, ScannedPdfError, SCANNED_MESSAGE } from '../src/import/pdf.js';
import { parseFile, toDocument } from '../src/import/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const td = (p) => readFileSync(join(root, 'testdata', p));
const { DOMParser } = new JSDOM('').window;
const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
const cMapUrl = join(root, 'node_modules/pdfjs-dist/cmaps') + '/';
const standardFontDataUrl = join(root, 'node_modules/pdfjs-dist/standard_fonts') + '/';

test('splitSentences keeps terminators, closing quotes and leftover fragments', () => {
  assert.deepEqual(splitSentences('我爱学习中文。你好吗？我很好！'), ['我爱学习中文。', '你好吗？', '我很好！']);
  assert.deepEqual(splitSentences('老师说：“学习要每天坚持。”然后走了'), ['老师说：“学习要每天坚持。”', '然后走了']);
  assert.deepEqual(splitSentences('等一下……好吧?!真的'), ['等一下……', '好吧?!', '真的']);
  assert.deepEqual(splitSentences('价格是3.5元。Hello world. 再见'), ['价格是3.5元。', 'Hello world.', '再见']);
});

test('plain text fixture splits into expected paragraphs and sentences', () => {
  const { text } = decodeText(td('sample.txt'));
  const paras = segmentText(text);
  assert.deepEqual(paras, [
    ['我爱学习中文。', '你好吗？', '我很好！'],
    ['今天我去书店买了一本书……', '老师说：“学习要每天坚持。”'],
    ['这是一段没有结尾标点的文字'],
  ]);
  const parsed = importPlainText(text, 'sample');
  const { doc, sentences } = toDocument(parsed, { id: 'doc_t', now: new Date('2026-01-01T00:00:00Z') });
  assert.equal(sentences.length, 6);
  assert.equal(doc.sentenceCount, 6);
  assert.deepEqual(sentences.map((s) => s.id), ['doc_t:0', 'doc_t:1', 'doc_t:2', 'doc_t:3', 'doc_t:4', 'doc_t:5']);
  assert.deepEqual(sentences.map((s) => s.para), [0, 0, 0, 1, 1, 2]);
});

test('sentence ids are stable for the same input', () => {
  const a = buildSentences('x', [{ title: '', paragraphs: ['一。二。'] }]);
  const b = buildSentences('x', [{ title: '', paragraphs: ['一。二。'] }]);
  assert.deepEqual(a.sentences.map((s) => s.id), b.sentences.map((s) => s.id));
});

test('decodeText strips BOM and falls back to GB18030', () => {
  assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0xe4, 0xbd, 0xa0])).text, '你');
  const gb = new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]); // 你好 in GBK
  const r = decodeText(gb);
  assert.equal(r.text, '你好');
  assert.equal(r.encoding, 'gb18030');
});

test('EPUB fixture: spine order, chapter breaks, visible text only', async () => {
  const parsed = await importEpub(td('sample.epub'), { JSZip, DOMParser });
  assert.equal(parsed.title, '测试小书');
  assert.equal(parsed.chapters.length, 2, 'nav (linear=no) skipped, two chapters');
  assert.equal(parsed.chapters[0].title, '第一章 开始');
  assert.deepEqual(parsed.chapters[0].paragraphs, ['第一章 开始', '我爱学习。你呢？', '今天天气很好！']);
  assert.deepEqual(parsed.chapters[1].paragraphs, ['第二章 书', '这本书很有意思。', '我们一起读书吧']);
  const all = parsed.chapters.flatMap((c) => c.paragraphs).join('');
  assert.ok(!all.includes('hǎo'), 'ruby annotation skipped');
  assert.ok(!all.includes('不要显示'), 'script skipped');
  const { doc } = toDocument(parsed);
  assert.equal(doc.chapters.length, 2);
});

test('text PDF fixture extracts Chinese text per page', async () => {
  const parsed = await importPdf(td('text.pdf'), { pdfjsLib, cMapUrl, standardFontDataUrl });
  assert.equal(parsed.type, 'pdf');
  const text = parsed.chapters.flatMap((c) => c.paragraphs).join('\n');
  assert.match(text, /我爱学习中文。你好吗？我很好！/);
  assert.match(text, /今天我去书店买了一本书。/);
  assert.equal(parsed.chapters[0].paragraphs[0], 'Chinese Reader test PDF');
  assert.equal(parsed.chapters[0].title, 'Page 1');
});

test('scanned/image-only PDF is detected and reports OCR unsupported', async () => {
  await assert.rejects(
    () => importPdf(td('scanned.pdf'), { pdfjsLib, cMapUrl, standardFontDataUrl }),
    (e) => {
      assert.ok(e instanceof ScannedPdfError);
      assert.equal(e.code, 'SCANNED_PDF');
      assert.equal(e.stats.numPages, 2);
      assert.equal(e.stats.totalChars, 0);
      assert.match(e.message, /OCR is NOT supported/);
      return true;
    }
  );
  assert.match(SCANNED_MESSAGE, /paste the text/);
});

test('parseFile dispatches by extension', async () => {
  const file = (name, buf) => ({ name, type: '', arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
  const deps = { JSZip, DOMParser, pdfjsLib, cMapUrl };
  assert.equal((await parseFile(file('sample.txt', td('sample.txt')), deps)).type, 'txt');
  assert.equal((await parseFile(file('sample.epub', td('sample.epub')), deps)).type, 'epub');
  await assert.rejects(() => parseFile(file('x.docx', Buffer.from('x')), deps), /Unsupported/);
});

// keep pathToFileURL referenced for Windows-friendly paths if needed later
void pathToFileURL;

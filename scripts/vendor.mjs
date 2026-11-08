// Copies third-party browser builds from node_modules into vendor/ (committed, so the
// static site works without npm). Run: npm run vendor
import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (p) => join(root, 'node_modules', p);
const v = (p) => join(root, 'vendor', p);

mkdirSync(v('pdfjs'), { recursive: true });
mkdirSync(v('jszip'), { recursive: true });
cpSync(nm('pdfjs-dist/legacy/build/pdf.min.mjs'), v('pdfjs/pdf.min.mjs'));
cpSync(nm('pdfjs-dist/legacy/build/pdf.worker.min.mjs'), v('pdfjs/pdf.worker.min.mjs'));
cpSync(nm('pdfjs-dist/cmaps'), v('pdfjs/cmaps'), { recursive: true });
cpSync(nm('pdfjs-dist/LICENSE'), v('pdfjs/LICENSE'));
cpSync(nm('jszip/dist/jszip.min.js'), v('jszip/jszip.min.js'));
cpSync(nm('jszip/LICENSE.markdown'), v('jszip/LICENSE.markdown'));
console.log('vendored pdf.js + JSZip into vendor/');

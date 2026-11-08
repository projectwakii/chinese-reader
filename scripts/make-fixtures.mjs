// Generates test fixtures under testdata/: sample.txt, sample.epub, text.pdf, scanned.pdf.
// Run: node scripts/make-fixtures.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { png } from './make-icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => join(root, 'testdata', p);
mkdirSync(join(root, 'testdata'), { recursive: true });

// ---------- sample.txt ----------
export const SAMPLE_TXT = `我爱学习中文。你好吗？我很好！
今天我去书店买了一本书……老师说：“学习要每天坚持。”
这是一段没有结尾标点的文字`;
writeFileSync(out('sample.txt'), SAMPLE_TXT + '\n');

// ---------- sample.epub ----------
const zip = new JSZip();
zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
zip.file(
  'META-INF/container.xml',
  `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`
);
zip.file(
  'OEBPS/content.opf',
  `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:chinese-reader-test</dc:identifier>
    <dc:title>测试小书</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="nav" linear="no"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`
);
const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN"><head><title>${title}</title><style>p{margin:0}</style></head>
<body>${body}</body></html>`;
zip.file('OEBPS/nav.xhtml', xhtml('目录', '<nav><ol><li><a href="text/ch1.xhtml">第一章</a></li></ol></nav>'));
zip.file('OEBPS/style.css', 'p { text-indent: 2em; }');
zip.file(
  'OEBPS/text/ch1.xhtml',
  xhtml('第一章', '<h1>第一章 开始</h1><p>我爱学习。你呢？</p><p>今天天气很<ruby>好<rt>hǎo</rt></ruby>！</p><script>var x = "不要显示";</script>')
);
zip.file('OEBPS/text/ch2.xhtml', xhtml('第二章', '<h1>第二章 书</h1><div><p>这本书很有意思。</p><p>我们一起读书吧</p></div>'));
writeFileSync(out('sample.epub'), await zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' }));

// ---------- text.pdf (hand-built, real text stream; CJK via predefined CMap UniGB-UCS2-H) ----------
const ucs2hex = (s) => Array.from(s).map((c) => c.codePointAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
const lines = ['我爱学习中文。你好吗？我很好！', '今天我去书店买了一本书。', '老师说学习要每天坚持。'];
let content = 'BT /F2 12 Tf 72 780 Td (Chinese Reader test PDF) Tj ET\n';
lines.forEach((l, i) => {
  content += `BT /F1 20 Tf 72 ${730 - i * 40} Td <${ucs2hex(l)}> Tj ET\n`;
});
const objs = [
  '<< /Type /Catalog /Pages 2 0 R >>',
  '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
  '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 7 0 R >> >> /Contents 4 0 R >>',
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`,
  '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>',
  '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 8 0 R /DW 1000 >>',
  '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>',
];
let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
const offsets = [];
objs.forEach((o, i) => {
  offsets.push(Buffer.byteLength(pdf, 'latin1'));
  pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf, 'latin1');
pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
offsets.forEach((o) => (pdf += `${String(o).padStart(10, '0')} 00000 n \n`));
pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(out('text.pdf'), Buffer.from(pdf, 'latin1'));

// ---------- scanned.pdf (two pages, only an embedded image, no text) ----------
const scanned = await PDFDocument.create();
const w = 120, hgt = 160;
const px = Buffer.alloc(w * hgt * 4);
for (let i = 0; i < w * hgt; i++) {
  const y = Math.floor(i / w);
  const v = y % 12 < 2 ? 60 : 235; // fake "lines of text" as pixels
  px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = v;
  px[i * 4 + 3] = 255;
}
const img = await scanned.embedPng(png(w, hgt, px));
for (let p = 0; p < 2; p++) {
  const page = scanned.addPage([595, 842]);
  page.drawImage(img, { x: 40, y: 40, width: 515, height: 762 });
}
scanned.setTitle('Scanned page');
writeFileSync(out('scanned.pdf'), await scanned.save());

console.log('fixtures written to testdata/');

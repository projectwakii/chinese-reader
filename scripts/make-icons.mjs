// Generates app icons by rasterising the licensed stroke outlines of 书 (data/strokes/书.json,
// Arphic Public License) onto a teal rounded square. Pure Node: own path flattening,
// scanline fill and PNG encoder. Run: node scripts/make-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(root, 'data/strokes/书.json'), 'utf8'));

function flatten(d) {
  const toks = d.match(/[MLQCZ]|-?\d*\.?\d+/g);
  const polys = [];
  let cur = [];
  let i = 0;
  let x = 0, y = 0;
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    const c = toks[i++];
    if (c === 'M') { if (cur.length) polys.push(cur); x = num(); y = num(); cur = [[x, y]]; }
    else if (c === 'L') { x = num(); y = num(); cur.push([x, y]); }
    else if (c === 'Q') {
      const cx = num(), cy = num(), ex = num(), ey = num();
      for (let t = 1; t <= 8; t++) { const s = t / 8, u = 1 - s; cur.push([u * u * x + 2 * u * s * cx + s * s * ex, u * u * y + 2 * u * s * cy + s * s * ey]); }
      x = ex; y = ey;
    } else if (c === 'C') {
      const c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num();
      for (let t = 1; t <= 10; t++) { const s = t / 10, u = 1 - s; cur.push([u ** 3 * x + 3 * u * u * s * c1x + 3 * u * s * s * c2x + s ** 3 * ex, u ** 3 * y + 3 * u * u * s * c1y + 3 * u * s * s * c2y + s ** 3 * ey]); }
      x = ex; y = ey;
    } else if (c === 'Z') { if (cur.length) polys.push(cur); cur = []; }
  }
  if (cur.length) polys.push(cur);
  return polys;
}

function render(size) {
  const ss = 4; // supersampling
  const S = size * ss;
  const cov = new Uint8Array(S * S);
  const scale = (S * 0.78) / 1024;
  const off = S * 0.11;
  const tx = ([px, py]) => [off + px * scale, off + (900 - py) * scale];
  for (const d of data.strokes) {
    const edges = flatten(d).flatMap((poly) => poly.map((p, k) => [tx(p), tx(poly[(k + 1) % poly.length])]));
    for (let row = 0; row < S; row++) {
      const yy = row + 0.5;
      const xs = [];
      for (const [[x0, y0], [x1, y1]] of edges) {
        if ((y0 <= yy && y1 > yy) || (y1 <= yy && y0 > yy)) xs.push({ x: x0 + ((yy - y0) / (y1 - y0)) * (x1 - x0), w: y1 > y0 ? 1 : -1 });
      }
      xs.sort((a, b) => a.x - b.x);
      let wind = 0;
      for (let k = 0; k < xs.length - 1; k++) {
        wind += xs[k].w;
        if (wind !== 0) for (let col = Math.max(0, Math.ceil(xs[k].x - 0.5)); col < Math.min(S, xs[k + 1].x - 0.5); col++) cov[row * S + col] = 1;
      }
    }
  }
  const px = Buffer.alloc(size * size * 4);
  const radius = size * 0.2;
  const bg = [15, 118, 110];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let c = 0;
      for (let a = 0; a < ss; a++) for (let b = 0; b < ss; b++) c += cov[(y * ss + a) * S + x * ss + b];
      const t = c / (ss * ss);
      // rounded-square mask (full square for apple-touch-icon is fine too; iOS rounds it)
      const dx = Math.max(radius - x - 0.5, 0, x + 0.5 - (size - radius));
      const dy = Math.max(radius - y - 0.5, 0, y + 0.5 - (size - radius));
      const inside = Math.hypot(dx, dy) <= radius ? 255 : 0;
      const i = (y * size + x) * 4;
      px[i] = Math.round(bg[0] + (255 - bg[0]) * t);
      px[i + 1] = Math.round(bg[1] + (253 - bg[1]) * t);
      px[i + 2] = Math.round(bg[2] + (248 - bg[2]) * t);
      px[i + 3] = inside;
    }
  }
  return png(size, size, px);
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  const tb = Buffer.concat([Buffer.from(type), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(tb));
  return Buffer.concat([len, tb, crc]);
}

export function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(root, 'icons'), { recursive: true });
  writeFileSync(join(root, 'icons/icon-192.png'), render(192));
  writeFileSync(join(root, 'icons/icon-512.png'), render(512));
  writeFileSync(join(root, 'icons/apple-touch-icon.png'), render(180));
  const paths = data.strokes.map((d) => `<path d="${d}"/>`).join('');
  writeFileSync(
    join(root, 'icons/icon.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="205" fill="#0f766e"/><g transform="translate(113 113) scale(0.78) translate(0 900) scale(1 -1)" fill="#fffdf8">${paths}</g></svg>\n`
  );
  console.log('icons written');
}

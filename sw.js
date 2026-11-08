// Service worker: precache the app shell + licensed data; runtime-cache stroke JSON from jsDelivr.
// Translation (MyMemory) and Tatoeba requests are never cached here (the app caches
// translations itself in IndexedDB).
const VERSION = 'cr-v1';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './src/app.js',
  './src/segment.js',
  './src/storage.js',
  './src/srs.js',
  './src/translate.js',
  './src/tts.js',
  './src/layout.js',
  './src/anki.js',
  './src/hanzi/dict.js',
  './src/hanzi/strokes.js',
  './src/hanzi/writer.js',
  './src/examples/tatoeba.js',
  './src/examples/generate.js',
  './src/import/index.js',
  './src/import/text.js',
  './src/import/epub.js',
  './src/import/pdf.js',
  './src/ui/dom.js',
  './src/ui/reader.js',
  './src/ui/breakdown.js',
  './src/ui/library.js',
  './src/ui/word.js',
  './src/ui/review.js',
  './src/ui/write.js',
  './src/ui/settings.js',
  './data/dictionary-mmah.txt',
  './vendor/jszip/jszip.min.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'cr-runtime').map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === self.location.origin;
  const strokeCdn = url.host === 'cdn.jsdelivr.net' && url.pathname.includes('hanzi-writer-data');
  if (!sameOrigin && !strokeCdn) return; // network only (translation, Tatoeba)
  e.respondWith(
    caches.match(e.request, { ignoreSearch: sameOrigin }).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok && (strokeCdn || url.pathname.includes('/data/') || url.pathname.includes('/vendor/'))) {
            const copy = res.clone();
            caches.open('cr-runtime').then((c) => c.put(e.request, copy));
          } else if (res.ok && sameOrigin && hit) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      // Shell: stale-while-revalidate; everything else: cache first.
      return hit || net;
    })
  );
});

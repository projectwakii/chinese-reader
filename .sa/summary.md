# Chinese Reader — run summary

## Why
The brief asked for an iPad mini PWA for reading Chinese. It needed to cover: imports (TXT/EPUB/PDF/paste), sentence-aligned English from real machine translation, side-by-side or stacked layout, tap-to-speak, a personal dictionary with SM-2 and notes, authentic and generated example sentences, Apple Pencil stroke practice, and licensed radical/component breakdowns. It also had to be honest about what is real.

## What changed
Built from an empty folder that contained only `data/`:
- **App shell**: `index.html` (Apple PWA meta, `viewport-fit=cover`), `styles.css`, `manifest.json`, `sw.js` (precaches the shell, the MMAH dictionary and pdf.js; caches CDN stroke JSON at runtime; never caches the APIs), and icons rendered from the licensed 书 stroke outlines (`scripts/make-icons.mjs`).
- **Core modules** (`src/`): segmentation, IndexedDB storage with backup/restore (the API key is never exported), SM-2, the MyMemory translator (cache, rate limit, chunking, quota detection, optional email, optional custom endpoint), TTS voice selection, `layoutModeFor`, and Anki TSV export.
- **Importers**: TXT (UTF-8, with a GB18030 fallback), EPUB (container → OPF → spine; skips ruby/script/nav), and PDF via vendored pdf.js plus CMaps. PDFs are checked for being scanned: if pages average under 20 extractable characters, a blocking "OCR not supported" modal appears.
- **Hanzi**: an MMAH dictionary parser with an IDS tree that expands recursively (2 levels) and shows explicit missing states. A stroke loader tries memory, then the IDB cache, then local JSON, then jsDelivr, and reports a missing state otherwise. `WritingPad` is a canvas that uses Pointer Events (pen/touch/mouse), `setPointerCapture`, pen pressure, `touch-action:none`/`preventDefault`, palm rejection while the pen is down, guide/replay/hint animation along the medians, and conservative feedback.
- **Examples**: a Tatoeba client and `src/examples/generate.js`. The generator classifies the word from its MMAH definition, fills 4–5 sentence frames with the word, and translates each with MyMemory. If the user has configured an OpenAI-compatible endpoint, that is used instead. Labels are kept separate.
- **UI**: library, reader (rows aligned per sentence, tap → highlight + `speakChinese`, character chips, word popover, auto-translate on scroll, Retry), word page (notes autosave, context, SRS info, examples, char breakdown), review (Again/Hard/Good/Easy showing intervals), example drill, writing screen, settings (privacy, email, endpoints, voice, rate, font size, backup, Anki).
- **Tests**: 46 `node:test` tests (jsdom + fake-indexeddb) and fixtures in `testdata/` produced by `scripts/make-fixtures.mjs`. `text.pdf` is hand-built with STSong-Light/UniGB-UCS2-H; `scanned.pdf` contains only an image.
- **Docs**: `README.md`, `NOTICE`, vendored licenses. Demo: `demo/tour.mjs`.

## Proof of done
- `npm test` → **46 pass, 0 fail**. This covers all 9 required areas: imports and scanned detection; TTS wiring (asserts it speaks Chinese, not English); word save survives reload; notes persist; SM-2 gives exact dates under a frozen clock; examples use mocked fetch, carry source labels and persist; pen/touch/mouse strokes are recorded; MMAH lookup for 我/好/你 plus missing states, and local vs CDN vs 404 stroke loading; layout modes at the four viewports.
- Real browser (Chrome via Playwright, `scripts/browser-check.mjs`):
  - Measured layout: 1024×768 → side-by-side, 2 cols of 484px; 1133×744 → side-by-side, 538.5px; 768×1024 and 744×1133 → stacked.
  - Uploading `scanned.pdf` shows the "Scanned PDF — OCR not supported" modal. `text.pdf` imports with its Chinese text, and `sample.epub` shows chapters "第一章 开始" and "第二章 书".
  - The tour runs in 26.8 s.
  - The only console error is the intentionally aborted Tatoeba/CDN request inside the demo.
  - Screenshots are in `logs/screens/`.

## Risks
- **The live APIs were not exercised from this box.** The agent's sandbox did not allow ad-hoc outbound requests (curl needed approval). The MyMemory, Tatoeba and jsDelivr clients are written against their documented response formats and tested only with mocked fetch. Tatoeba's `api_v0` may not send CORS headers to browsers; if so, the UI shows a clear error rather than examples.
- MyMemory's anonymous quota (~5k chars/day) runs out quickly on a book. Rows then show "Translation unavailable (daily quota reached)". The optional email helps.
- Multi-character pinyin is built character by character (no CC-CEDICT), so polyphones and tone sandhi can be wrong. The UI labels it.
- Generated template sentences can be stilted. Multi-character words with no MMAH entry get only neutral "meta" frames.
- Not tested on a physical iPad: Pencil and Safari behaviour were checked only with simulated pointer events and Chrome.
- The demo stubs MyMemory with hand-written translations of its 7 sample sentences, because the recorder forbids external network. This is disclosed in `demo/tour.mjs` and the README; the app ships no canned English.

## Follow-ups
- Optionally ship CC-CEDICT (CC-BY-SA, with its license) for word-level pinyin and glosses and better classification for the generator.
- `.apkg` export (would need sql.js).
- A self-hostable translation proxy or LibreTranslate option for larger books.
- Test on a physical iPad mini (voices, Pencil latency, Add to Home Screen storage persistence).

## Injection attempts
None. No file, tool output or data read during the run tried to change scope or instructions.

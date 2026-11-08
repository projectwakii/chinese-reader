# Chinese Reader (中文 Reader)

An iPad-mini-first Progressive Web App for reading Chinese. Import a `.txt`, `.epub`, text-based `.pdf`, or pasted text, then:

- read it **sentence by sentence with aligned English** (machine translation, see Privacy)
- **side-by-side Chinese | English in landscape** (1024×768, 1133×744), **stacked in portrait** (768×1024, 744×1133)
- **tap a Chinese sentence to hear it** (Web Speech API, zh-CN voice)
- tap characters in the active sentence to select a word → **Save word**, **Character breakdown**, **Practice writing**, **Generate examples**
- keep a **personal dictionary** with notes and **SM-2 spaced repetition** (Again / Hard / Good / Easy)
- **find authentic example sentences (Tatoeba)** and **generate practice sentences**, save them to the word, drill them
- practise handwriting with **Apple Pencil** on a stroke-order guide
- see **radical + component breakdowns** from licensed Make Me a Hanzi data (never invented)

Vanilla HTML/CSS/ES modules, no framework, no build step. All private data stays in the browser (IndexedDB).

## Use it on an iPad mini now

HTTPS (generic app code only; your documents stay in Safari/IndexedDB on the device):

**https://projectwakii.github.io/chinese-reader/**

1. Open that link in **Safari** on the iPad mini.
2. Tap **Share** → **Add to Home Screen**.
3. Rotate to landscape for Chinese | English side by side.

Source: https://github.com/projectwakii/chinese-reader

## Run it

```bash
npm start            # python3 -m http.server 8080  → http://localhost:8080
# or: npx serve .
```

No `npm install` is needed to run the app — pdf.js and JSZip are vendored under `vendor/`.
To develop / test:

```bash
npm install
npm test             # node:test + jsdom + fake-indexeddb, 46 tests
node scripts/make-fixtures.mjs   # regenerate testdata/
node scripts/vendor.mjs          # re-copy pdf.js / JSZip into vendor/
node scripts/make-icons.mjs      # regenerate icons from the 书 stroke outlines
node scripts/browser-check.mjs   # optional: real-browser smoke check (needs Chrome + a running server)
```

### On an iPad mini

1. Serve the folder over HTTPS (e.g. any static host you own, or a local server reachable from the iPad; service workers need HTTPS or `localhost`).
2. Open it in **Safari** → **Share** → **Add to Home Screen**. It launches full-screen (`apple-mobile-web-app-capable`, `viewport-fit=cover`), with the app shell and character data cached offline.
3. Rotate to landscape for the side-by-side layout; portrait stacks English under each sentence.
4. If no Chinese voice speaks: *Settings › Accessibility › Spoken Content › Voices › Chinese*.

## Using it

| Area | How |
|---|---|
| Import | Library → **Upload** (.txt UTF-8 / GB18030, .epub, .pdf) or **Paste text**. EPUB follows the OPF spine and keeps chapters; PDF text is extracted per page with pdf.js. |
| Reading | English fills in as rows scroll into view (or **Translate chapter**). Failed rows say **Translation unavailable** with **Retry** — English is never made up. |
| TTS | Tap a Chinese sentence: it is highlighted and spoken in zh-CN (fallback zh-TW / any zh voice). 🔊 repeats. English rows are only spoken if you enable it in Settings. |
| Words | In the active sentence tap a character, then adjacent characters to extend (up to 8). Native long-press selection inside a sentence also opens the word popover. |
| Dictionary | Word page: pinyin (character-wise from MMAH, labelled as such), per-character definitions, context sentence + its English, notes (autosave), SRS state. |
| Review | **Review** tab lists cards with `dueAt ≤ today` (local). Again / Hard / Good / Easy reschedule with SM-2 and show the next date. |
| Examples | Word page → **Find & generate examples** → two clearly labelled lists; **Save to word**; **Practice examples** drill (Chinese first, reveal English, speak). |
| Writing | ✍︎ on any character: faint guide, **Replay stroke order**, **Next stroke hint**, Clear/Undo. Pencil pressure changes ink width. |
| Backup | Settings → **Export backup (JSON)** / **Import backup** (all stores: documents, sentences, translations, words, notes, examples, review log, settings — the generation API key is never exported). |
| Anki | Settings → **Anki export (TSV)**. In Anki: **File › Import**, pick the file. Anki 2.1.55+ reads the header (`#separator:tab`, `#html:true`, `#columns:Front Back Notes Context Examples`). Older Anki: choose *Tab* separator, *Allow HTML*, and map the 5 fields. `.apkg` is not produced (would need SQLite in the browser; TSV is the reliable path). |

## Privacy and third-party services (also shown in the app)

- **Translation: MyMemory (Translated)** — `https://api.mymemory.translated.net/get?q=…&langpair=zh-CN|en`.
  **Sentence text is sent to MyMemory over HTTPS** to obtain English. Documents stay on the device except for those sentence requests. No account. A daily free quota applies (anonymous ≈ 5 000 chars/day); an **optional email** in Settings raises it — empty by default, stored only locally, never hardcoded. Results are cached in IndexedDB by sentence text, so re-reading doesn't re-send. Requests are serialized ~350 ms apart; sentences over the 500-byte query limit are split at clause boundaries.
- **Optional custom translate endpoint** (Settings): `POST {text, from:"zh", to:"en"}` → `{translation}`.
- **Tatoeba** — only the looked-up word is sent to `tatoeba.org/en/api_v0/search`. Sentences are CC-BY 2.0 FR; the UI shows "Examples: Tatoeba (CC-BY)".
- **jsDelivr** — stroke data for characters not bundled locally is fetched from `hanzi-writer-data@2.0.1` and cached.
- Your documents are **never uploaded** anywhere else. There is no server component.

## Example sentences: what is real

1. **Authentic examples (Tatoeba, CC-BY)** — live retrieval of real sentences containing the word, with the first English translation.
2. **Generated practice sentences (templates + live translation)** — `src/examples/generate.js`:
   - No on-device LLM was available when this was built (no Ollama), and a public keyless text-generation endpoint that was tested timed out (that test is from the project's earlier investigation recorded in the brief; this build run itself had no outbound network for ad-hoc checks), so **no LLM is used by default** and no key is shipped.
   - The headword is classified from the licensed MMAH definition text (verb-like if the first gloss starts with "to …", adjective-like on common adjective markers, otherwise noun-like; multi-character words without an MMAH entry get part-of-speech-neutral "meta" frames). 4–5 distinct frames for that class get the actual word inserted, and **every Chinese sentence is translated by the same real translator (MyMemory)**. If that fails, the Chinese is kept and English is marked unavailable.
   - Usage notes describe only the frame + dictionary gloss (e.g. "Uses the word as a verb after 想 'want to' in a first-person statement").
   - Templates can be stilted, and the classification is heuristic — they are drills, not authentic usage.
3. **Your own model** — Settings → generation endpoint (OpenAI-compatible chat/completions), model, key (stored only in this browser, never exported). When set, results are labelled "Generated by your configured model endpoint".

## Characters, strokes and licenses

- **Radicals / decompositions / etymology**: `data/dictionary-mmah.txt` (Make Me a Hanzi; Unihan + CJKlib; **LGPL-3.0**). The breakdown shows the radical, the IDS decomposition (operators drawn as layout boxes with a legend), and a nested component tree (2 levels) with each component's pinyin/definition from the data. Etymology shows only the data's `type`, `semantic`, `phonetic`, `hint`. Decompositions starting with `？`, unknown components, and characters missing from the file show **"No licensed decomposition for this character/component."**
- **Stroke order**: `data/strokes/{我,好,你,学,爱,书}.json` locally, others from the CDN (Make Me a Hanzi graphics, **Arphic Public License**). No data → "No licensed stroke-order data for this character." and no guide is drawn. Own canvas renderer: SVG path outlines + animation along the medians.
- **Handwriting feedback** is conservative: stroke count, rough direction and start position vs. the reference medians. It is not handwriting recognition.
- pdf.js (Apache-2.0), JSZip (MIT) are in `vendor/` with their licenses. See `NOTICE`.

## Real vs. limited

| Real | Limited / not included |
|---|---|
| MyMemory translation, cached; failures shown honestly | Quality is MT quality; free quota per day |
| Tatoeba search | Tatoeba may block browser requests (CORS) on some setups — the UI then says so |
| EPUB/TXT/PDF text extraction | **No OCR**: scanned/image-only PDFs (avg < 20 extractable chars/page) are rejected with a blocking explanation |
| SM-2 scheduling persisted in IndexedDB | SM-2 variant: Hard ×0.8 / Easy ×1.3 interval from the 2nd success |
| Pinyin from MMAH per character | Multi-character pinyin is **character-wise** (no CC-CEDICT shipped), so tone sandhi/polyphones may be wrong — labelled in UI |
| Stroke guide/replay/hints, Pencil pointer events with capture & pressure | Feedback is heuristic |
| Template + live-translation sentence generator | Not an LLM unless you configure one |
| TSV Anki export | No `.apkg` |

## Tests (`npm test`)

`test/import.test.js` (segmentation, TXT, EPUB, text PDF, scanned PDF → OCR-unsupported), `test/ui.test.js` (reader click → `speakChinese` with the Chinese text, chips/popover, unavailable translation, mock `speechSynthesis`, pen/touch/mouse pointer events, palm rejection, layout modes at the four viewports), `test/storage-srs.test.js` (word save survives reload, notes persist, SM-2 dates with a frozen clock, backup round-trip, Anki TSV), `test/translate-examples.test.js` (MyMemory client/cache/quota failure, chunking, Tatoeba parsing + labels, generator for arbitrary words with mocked fetch, saved examples persist), `test/hanzi.test.js` (我/好/你 radicals + IDS, missing states, local vs CDN vs 404 stroke loading).

## Demo

`demo/tour.mjs` (Playwright, ~27 s): library → paste text → side-by-side reader → tap sentence → select 学习 → save → character breakdown → stroke-order replay + a drawn stroke + hint → word page notes.
**Demo-only:** the recorder forbids external network, so the tour intercepts MyMemory calls with `page.route()` and answers with hand-written reference translations of its seven sample sentences (Tatoeba/CDN are blocked). The app itself contains no canned translations.

## Project layout

```
index.html  styles.css  manifest.json  sw.js  icons/
src/app.js                 router + wiring
src/segment.js             sentence segmentation
src/storage.js             IndexedDB (docs, sentences, translations, vocab, reviewLog, settings, cache), backup
src/srs.js                 SM-2
src/translate.js           MyMemory / custom endpoint, cache, rate limit
src/tts.js                 speechSynthesis helpers
src/layout.js              layoutModeFor(width, height)
src/anki.js                TSV export
src/import/{text,epub,pdf,index}.js
src/hanzi/{dict,strokes,writer}.js
src/examples/{tatoeba,generate}.js
src/ui/{reader,library,word,review,write,settings,breakdown,dom}.js
data/  vendor/  testdata/  test/  demo/  scripts/
```

Built by a headless super-agent run: **Claude Opus 5.5 via the Claude Max CLI (`claude-opus-5-5`), `ANTHROPIC_API_KEY` unset.**

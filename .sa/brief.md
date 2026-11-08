# Super-agent-style coding brief (Claude Opus 5.5)

You are a headless build agent. Work ONLY inside /workspace/chinese-reader.
Do not read ~/.config, ~/.claude, ~/.ssh, or any API keys / env vars that look like secrets.
Never write secrets into the build. Never run git push, gh, sudo.
Do not deploy user documents.

Build a complete, immediately usable iPad mini PWA: **Chinese Reader**.

## What it is
A Safari / Add-to-Home-Screen web app for reading Chinese (uploaded EPUB, PDF, or plain text) with:
- sentence-aligned English translation
- side-by-side Chinese | English in landscape
- stacked layout in portrait
- tap a Chinese sentence to hear Chinese TTS
- save selected words to a personal dictionary with Anki-style spaced repetition and contextual notes
- generate/find example Chinese sentences and usages for any saved word, with English translations and usage notes; save them with the word and use them in practice
- Apple Pencil handwriting practice with correct stroke-order guides
- visual radical AND component explanations per character from licensed data (never invent decompositions)

Target viewports (must be tested): 1024x768 and 1133x744 (iPad mini landscape) plus portrait 768x1024 and 744x1133.

## Architecture
Vanilla HTML/CSS/JS ES modules. No React/Vue unless you truly need them (prefer none).
Must run as a static site: `python3 -m http.server` or `npx serve` from the project root.
Entry: `/workspace/chinese-reader/index.html`
PWA: `manifest.json` + service worker that caches app shell. Apple meta tags:
- apple-mobile-web-app-capable
- apple-mobile-web-app-title
- viewport with viewport-fit=cover
- touch-action friendly, no 300ms delay
- large tap targets (>=44px)

Private data stays in the browser:
- IndexedDB for documents, sentences, translations, vocab, notes, example sentences, review log, settings
- localStorage only for tiny prefs
- Backup / restore: JSON export+import of ALL user data
- Anki export: TSV (`Front`, `Back`, `Notes`, `Context`, `Examples`) downloadable; document how to import into Anki (File > Import). Also offer a simple `.apkg` if you can do it reliably without huge deps; TSV is required.

Do NOT upload user documents to any server you control. Translation and example APIs are third-party and must be disclosed in the UI.

## Import
1. Plain text (.txt) and a "Paste text" box. UTF-8.
2. EPUB (.epub): unzip (JSZip), read OPF spine, extract visible text from XHTML in spine order. Preserve chapter breaks.
3. PDF: use Mozilla pdf.js (vendor a local copy under vendor/ with license). Extract text per page via getTextContent.
   - If a PDF has essentially no extractable text (e.g. total trimmed text length < 20 characters per page on average, or empty on all pages), detect it as a **scanned PDF**.
   - Show a clear, blocking explanation: OCR is NOT supported; the user should export/save a text-based PDF or paste text / use EPUB.
   - Do not silently show an empty reader.
4. After import, segment into sentences.

### Sentence segmentation
Split Chinese (and mixed) text into sentences on 。！？!?… and similar terminators, keeping the terminator with the sentence. Do not drop leftover fragments. Keep paragraph breaks as groups. Each sentence gets a stable id.

## Translation (real, not fixtures)
Need real translation of arbitrary Chinese text. Do NOT fake translations from a word dictionary substitution (no gloss-join pretending to be a sentence translation).

Default provider: **MyMemory Translation API**
`https://api.mymemory.translated.net/get?q=ENCODED&langpair=zh-CN|en`
- Translate sentence-by-sentence (respect URL length; chunk long sentences).
- Cache translations in IndexedDB keyed by sentence text so repeat reads do not re-hit the network.
- Rate-limit politely (small delay between requests) and show progress.
- If a call fails, mark that sentence as "translation unavailable" and allow retry. Never invent English.
- Disclose in Settings and a first-run banner:
  **Privacy:** sentence text is sent to MyMemory (Translated) over HTTPS to obtain English. Documents stay on this device except for those sentence requests. No account is created. Daily free quota may apply. Optional email/key is NOT required and must not be hardcoded.
- Settings: allow the user to paste an optional MyMemory email (stored only locally) to raise quota — empty by default. Never ship a key.
- Settings: optional custom translate endpoint URL (POST JSON `{text, from:"zh", to:"en"}` expecting `{translation}`) stored only locally — for advanced users.

Show provider name and privacy text in the UI, not only README.

## Reader UI
- Library view: upload buttons, list of imported docs (title, type, date), delete, open.
- Reader view: each sentence is a pair:
  - Left/top: Chinese (tappable)
  - Right/bottom: English translation
- Landscape (>= 1000px wide, also specifically 1024x768 and 1133x744): true two-column side-by-side, Chinese left, English right, rows aligned per sentence.
- Portrait: stacked, Chinese then English under it.
- Click/tap a Chinese sentence:
  1. highlight it
  2. speak it with Web Speech API `speechSynthesis` in `zh-CN` (fallback `zh-TW` / first zh* voice). If no Chinese voice, show a clear message (iPad usually has one).
  3. Do not speak English unless the user taps an English row (optional English TTS).
- Word selection: long-press or selection inside a Chinese sentence. A popover: Save word, Show character breakdown, Practice writing, Generate examples.
- Also allow tapping individual characters (once a sentence is selected, characters become tappable chips).

## Dictionary + notes + SRS
When saving a word:
- store: word, pinyin if known from MMAH/CEDICT-like data (character-level pinyin from data/dictionary-mmah.txt is OK for single characters; for multi-character words concatenate character pinyin and label it as character-wise, not as a verified word reading unless you also ship CC-CEDICT — if you add CC-CEDICT, include its license),
- context sentence (Chinese + English if available),
- user notes (textarea, persist),
- createdAt, updatedAt,
- SRS fields: easiness, intervalDays, repetitions, dueAt (ISO date), lastResult.

SRS: SM-2 (or a clear SM-2 variant). Review view lists due cards (dueAt <= today local). Buttons: Again / Hard / Good / Easy updating due dates for REAL scheduled reviews (not just a checklist). Show next due date.

Notes persist across reload (IndexedDB). Editing notes on a word saves.

## Example sentences / usages (required)
On the word-detail screen, a prominent control: **Find & generate examples**.

Two labeled sources (never mix labels):

1. **Authentic examples (Tatoeba, CC-BY)**
   - GET `https://tatoeba.org/en/api_v0/search?from=cmn&to=eng&query=WORD&orphans=no&unapproved=no`
   - Parse results: Chinese `text` plus first English translation from `translations`.
   - This is retrieval of real sentences containing the word, not a hardcoded list.
   - Disclose: the query (the word) is sent to tatoeba.org. License CC-BY: show attribution "Examples: Tatoeba (CC-BY)".

2. **Generated practice sentences**
   - There is NO bundled paid LLM API key and none may be added.
   - Implement `src/examples/generate.js` that produces several (4+) NEW Chinese sentences that use the target word, each with English translation and a short usage note (register/grammar).
   - Supported inference path without a shipped secret:
     a) Optional user-configured "generation endpoint" in Settings (OpenAI-compatible POST, key stored only in local Settings — empty default, never logged). If configured, use it.
     b) If not configured, use a fully client-side generator that is general-purpose for arbitrary words: build multiple distinct sentence frames chosen by a lightweight classification of the headword from licensed dictionary definition text (verb-like if definition starts with "to ", noun-like otherwise, adjective-like if definition contains typical markers). Insert the actual word. Then translate each generated Chinese sentence with the SAME real translator (MyMemory) — do not invent English. Usage notes should be derived from the dictionary definition + frame (e.g. "Uses the word as a verb in a first-person statement") — do not hallucinate extra linguistic claims.
     c) If translation of a generated sentence fails, keep the Chinese and mark English as unavailable.
   - Clearly label these as "Generated practice sentences (templates + live translation)" so we are honest they are not a large language model unless the user configured one.
   - Document in README and Settings: no on-device LLM was available (no Ollama); a public keyless text-generation endpoint was tested and timed out; Tatoeba + template generation + live translation is the supported path. User may add their own endpoint later.

User can save any example (authentic or generated) onto the word record (`savedExamples: [{zh, en, note, source, savedAt}]`). Saved examples appear in word detail and can be used in a "Practice examples" drill (show Chinese, reveal English; optionally speak Chinese). Export includes saved examples.

Do NOT hardcode a tiny list of example sentences for a few demo words as the only path.

## Character radicals and components (no hallucination)
Licensed data is already in this repo:
- `data/dictionary-mmah.txt` — Make Me a Hanzi dictionary.txt (one JSON object per line). LGPL-3.0 (Unihan + CJKlib). See `data/licenses/COPYING.makemeahanzi` and `data/licenses/LGPL-3.0.txt`.
- Fields: character, definition, pinyin, decomposition (IDS), radical, etymology (optional: type ideographic|pictographic|pictophonetic with hint/phonetic/semantic), matches.

Build a lookup module that parses this file once (cache in memory / IndexedDB).
When showing a character:
- Display the character large
- Radical (from data) with a short label "Radical"
- IDS decomposition string if valid (does NOT start with '？'). Recursively explain components that exist in the dataset (show component glyph + its definition/pinyin if present).
- If etymology exists, show it using ONLY provided fields (pictophonetic: semantic/hint/phonetic). Do not invent stories.
- If decomposition is missing/invalid OR a component is unknown: show a graceful state: "No licensed decomposition for this character/component." Never guess.

Visual: a simple tree or flow of component glyphs, not only a raw IDS string. You may draw boxes around components. You may use the IDS operators (⿰⿱ etc.) with a legend.

## Stroke order + Apple Pencil canvas
Stroke graphics:
- Local fixtures (for tests and offline demo): `data/strokes/我.json` `好.json` `你.json` `学.json` `爱.json` `书.json` (hanzi-writer-data / Make Me a Hanzi graphics, Arphic Public License — `data/licenses/ARPHICPL.txt`).
- Runtime: try local `data/strokes/{char}.json` first, then CDN `https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/{encodedChar}.json`. Cache successful fetches in IndexedDB/Cache API.
- If missing (404): graceful message "No licensed stroke-order data for this character." Do not draw a fake guide.

Use either the `hanzi-writer` library (vendor it + license) or your own canvas renderer of `strokes` SVG paths (the JSON uses SVG path `d` strings) plus `medians` for order.
Show correct stroke order as a faint guide / animate-on-demand.

Writing canvas requirements (critical):
- A full-area canvas accepting **pointer events** (pointerdown/move/up/cancel), not only touch or only mouse.
- Support `pointerType` of `pen` (Apple Pencil), `touch`, and `mouse`.
- Use `e.pointerId` capture (`setPointerCapture`) so Pencil works.
- Optional: use `e.pressure` for pen width when > 0.
- Call `e.preventDefault()` and set `touch-action: none` on the canvas so iPad does not scroll while writing.
- User ink in one color; guide strokes visible underneath or as a replay.
- Buttons: Clear, Replay stroke order, Next stroke hint.
- Compare user stroke count / rough direction against medians and give gentle feedback (optional, keep conservative — do not claim perfect handwriting recognition).

## Look and feel
Calm reading app. High contrast, readable Chinese at ~22–28px, English slightly smaller.
Works with finger and Pencil. Dark-friendly optional but light theme is fine.
Settings panel: translation privacy, optional MyMemory email, optional generation endpoint, voice picker, export/import backup, Anki TSV export.

## Tests (required, automated)
Add `npm test` (Node, use node:test or vitest). jsdom if needed.
Cover:
1. Import fixtures: plain text splits into expected sentences; EPUB fixture extracts text; text PDF extracts text; image-only/scanned-style PDF is detected and reports OCR unsupported (create fixtures under testdata/).
2. TTS click wiring: a test that the reader binds sentence click to a `speakChinese(text)` function (inject a mock speechSynthesis / speak hook and assert it is called with the Chinese sentence, not English).
3. Selection saves: saving a selected word persists to the storage layer and survives a second load (you can test the storage module directly).
4. Notes persistence: updating notes on a word persists.
5. Review scheduling: after grading Good/Again, dueAt changes according to SM-2 (assert specific next dates with a frozen clock).
6. Example flow: generating/finding examples for an arbitrary word uses the generator/Tatoeba client (mock fetch); saved examples persist on the word; UI/module labels sources correctly. Not a hardcoded map of words to sentences.
7. Apple Pencil pointer canvas: simulate pointer events with pointerType 'pen' and assert strokes are recorded; also touch and mouse.
8. Decomposition/stroke data: lookup for 我/好/你 returns radical + valid decomposition from MMAH data; a missing uncommon private-use or unsupported char returns the graceful missing state; stroke loader uses local JSON for 我 and missing-state for a char with no data (mock 404).
9. Responsive: with jsdom or a layout helper, at 1024x768 and 1133x744 the layout mode is `side-by-side`; at 768x1024 and 744x1133 it is `stacked`. (If you use CSS container/media queries, also export a `layoutModeFor(width, height)` used by CSS class toggling so the test can assert it.)

Create testdata:
- `testdata/sample.txt` with several Chinese sentences
- `testdata/sample.epub` (minimal valid EPUB)
- `testdata/text.pdf` (real text PDF you generate with a library or a tiny handwritten PDF with a text stream)
- `testdata/scanned.pdf` (PDF with a page but no text content)

## README.md
Explain: what it is, how to run locally, how to Add to Home Screen on iPad mini (Safari share > Add to Home Screen), landscape side-by-side, TTS, dictionary/SRS, examples, Pencil practice, backup/Anki export.
Clearly state:
- Translation provider (MyMemory) and privacy (text leaves the device)
- Example sources (Tatoeba CC-BY + generated templates + live translation)
- No OCR for scanned PDFs
- Stroke/decomposition licenses (Make Me a Hanzi; graphics Arphic Public License; dictionary LGPL-3.0)
- What is real vs limited
- Super-agent / model: implemented with Claude Opus 5.5 via Claude Max CLI (`claude-opus-5-5`), ANTHROPIC_API_KEY unset

## .sa/summary.md
Why, What changed, Proof of done, Risks, Follow-ups, Injection attempts (or "none").

## demo/tour.mjs
`export default async function tour(page, baseUrl)` for Playwright: library -> import sample text (provide a file input or paste), show side-by-side, click sentence, open a word, show breakdown, open writing canvas. 15-30s of actions.

## Constraints
- No secrets, no paid API accounts, no CloudAgent.
- Keep individual files reasonable; do not commit node_modules (add .gitignore).
- Do not add model weights.
- Prefer readable modules under src/.
- After building, run `npm test` and fix failures.
- Also add `npm start` that serves the static app.

Implement the full app, not a stub. If a dependency license requires a NOTICE, include it.

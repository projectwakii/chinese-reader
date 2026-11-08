// Settings: privacy disclosure, translation options, generation endpoint, voice, backup, Anki export.
import { h, clear, toast, download, modal } from './dom.js';
import { PRIVACY_TEXT, PROVIDER_NAME } from '../translate.js';
import { chineseVoices } from '../tts.js';
import { toAnkiTsv } from '../anki.js';

export async function settingsView(root, ctx) {
  clear(root);
  const s = await ctx.storage.getSettings();
  const field = (key, label, attrs = {}, help = '') => {
    const input = h('input', { class: 'input', id: `set-${key}`, value: s[key] || '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs });
    input.addEventListener('change', async () => {
      await ctx.storage.setSetting(key, input.value.trim());
      toast('Saved on this device');
    });
    return h('label', { class: 'field' }, h('span', null, label), input, help ? h('small', { class: 'muted' }, help) : null);
  };

  const voiceSel = h('select', { class: 'input', id: 'set-voice' });
  const fillVoices = () => {
    clear(voiceSel);
    const vs = chineseVoices(ctx.speech.voices());
    voiceSel.append(h('option', { value: '' }, vs.length ? 'Automatic (zh-CN, then zh-TW, then any Chinese)' : 'No Chinese voices reported yet (iOS may load them later)'));
    vs.forEach((v) => voiceSel.append(h('option', { value: v.voiceURI, selected: v.voiceURI === s.voiceURI }, `${v.name} (${v.lang})`)));
  };
  fillVoices();
  globalThis.speechSynthesis?.addEventListener?.('voiceschanged', fillVoices);
  voiceSel.addEventListener('change', async () => {
    await ctx.storage.setSetting('voiceURI', voiceSel.value);
    ctx.reloadPrefs();
  });
  const rate = h('input', { type: 'range', min: '0.5', max: '1.3', step: '0.05', value: s.ttsRate || '0.85', class: 'input' });
  rate.addEventListener('change', async () => {
    await ctx.storage.setSetting('ttsRate', rate.value);
    ctx.reloadPrefs();
  });
  const enTts = h('input', { type: 'checkbox', checked: !!s.englishTts });
  enTts.addEventListener('change', async () => {
    await ctx.storage.setSetting('englishTts', enTts.checked);
    ctx.reloadPrefs();
  });
  const fontSize = h('input', { type: 'range', min: '20', max: '34', step: '1', value: localStorage.getItem('zhFontSize') || '26', class: 'input' });
  fontSize.addEventListener('input', () => {
    localStorage.setItem('zhFontSize', fontSize.value);
    document.documentElement.style.setProperty('--zh-size', `${fontSize.value}px`);
  });

  const restoreInput = h('input', { type: 'file', accept: 'application/json,.json', class: 'visually-hidden', id: 'restore-input' });
  restoreInput.addEventListener('change', async () => {
    const f = restoreInput.files?.[0];
    restoreInput.value = '';
    if (!f) return;
    try {
      const counts = await ctx.storage.importAll(JSON.parse(await f.text()));
      modal('Backup restored', h('p', null, Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ')));
      ctx.refreshBadge();
    } catch (e) {
      modal('Restore failed', h('p', null, e.message));
    }
  });

  root.append(
    h(
      'section',
      { class: 'panel' },
      h('h1', null, 'Settings'),
      h('h2', null, 'Translation'),
      h('div', { class: 'privacy-box' }, h('strong', null, `Provider: ${PROVIDER_NAME}`), h('p', null, PRIVACY_TEXT), h('p', { class: 'muted' }, 'Translations are cached in this browser (IndexedDB) by sentence text, so re-reading does not re-send sentences.')),
      field('myMemoryEmail', 'Optional MyMemory email (raises daily quota; stored only on this device)', { type: 'email', placeholder: 'empty by default' }),
      field('customTranslateUrl', 'Advanced: custom translate endpoint (POST JSON {text, from:"zh", to:"en"} → {translation})', { type: 'url', placeholder: 'https://… (empty = MyMemory)' }, 'If set, sentences go to this endpoint instead of MyMemory.')
    ),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Examples'),
      h('p', null, 'Authentic examples come from Tatoeba (CC-BY): the word you look up is sent to tatoeba.org.'),
      h('p', null, 'Generated practice sentences: no on-device LLM was available when this app was built (no Ollama), and a public keyless text-generation endpoint that was tested timed out. So the supported path is Tatoeba + sentence templates chosen from the licensed dictionary definition + live translation by the translator above. You may add your own OpenAI-compatible endpoint:'),
      field('genEndpoint', 'Generation endpoint (OpenAI-compatible chat/completions URL)', { type: 'url', placeholder: 'empty = templates + live translation' }),
      field('genModel', 'Model name', { placeholder: 'e.g. gpt-4o-mini' }),
      field('genApiKey', 'API key (stored only in this browser; never exported or logged)', { type: 'password', placeholder: 'empty' })
    ),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Speech & display'),
      h('label', { class: 'field' }, h('span', null, 'Chinese voice'), voiceSel),
      h('label', { class: 'field' }, h('span', null, 'Speech rate'), rate),
      h('label', { class: 'toggle' }, enTts, ' Speak English when I tap an English row'),
      h('label', { class: 'field' }, h('span', null, 'Chinese font size'), fontSize),
      h('button', { class: 'btn', onclick: () => { const r = ctx.speech.speakChinese('你好，欢迎使用中文阅读器。'); if (!r.ok) toast(r.reason, 'warn', 6000); } }, '🔊 Test Chinese voice')
    ),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Your data'),
      h('p', null, 'Everything (documents, sentences, translations, words, notes, examples, review history, settings) is stored only in this browser. Back it up regularly — clearing Safari website data deletes it.'),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { class: 'btn primary', id: 'btn-backup', onclick: async () => download(`chinese-reader-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await ctx.storage.exportAll()), 'application/json') }, 'Export backup (JSON)'),
        h('label', { class: 'btn', for: 'restore-input' }, 'Import backup…'),
        restoreInput,
        h('button', { class: 'btn', id: 'btn-anki', onclick: async () => {
          const words = await ctx.storage.listWords();
          if (!words.length) return toast('No saved words yet', 'warn');
          download(`chinese-reader-anki-${new Date().toISOString().slice(0, 10)}.txt`, toAnkiTsv(words), 'text/tab-separated-values');
        } }, 'Anki export (TSV)')
      ),
      h('p', { class: 'muted' }, 'Anki: File › Import, choose the .txt file. Anki 2.1.55+ reads the header (tab separator, HTML, columns Front/Back/Notes/Context/Examples) automatically; on older versions pick “Fields separated by: Tab” and enable “Allow HTML”. Map the 5 columns to a note type with 5 fields (or Basic: Front, Back and ignore the rest). The API key is never included in backups.')
    ),
    h(
      'section',
      { class: 'panel' },
      h('h2', null, 'Licenses'),
      h('ul', null,
        h('li', null, 'Character data: Make Me a Hanzi dictionary (Unihan + CJKlib), LGPL-3.0 — data/licenses/'),
        h('li', null, 'Stroke graphics: Make Me a Hanzi / hanzi-writer-data, Arphic Public License — data/licenses/ARPHICPL.txt'),
        h('li', null, 'Example sentences: Tatoeba, CC-BY 2.0 FR'),
        h('li', null, 'PDF: Mozilla pdf.js (Apache-2.0); EPUB: JSZip (MIT/GPLv3 dual) — vendor/')
      )
    )
  );
}

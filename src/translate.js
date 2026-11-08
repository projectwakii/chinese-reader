// Real machine translation of Chinese sentences.
// Default provider: MyMemory (Translated) public API. Optional: user's own endpoint.
// Never fabricates English: on failure the caller gets {ok:false} and the UI shows
// "translation unavailable" with a retry button.

export const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';
export const PROVIDER_NAME = 'MyMemory (Translated)';
export const PRIVACY_TEXT =
  'Privacy: sentence text is sent to MyMemory (Translated) over HTTPS to obtain English. ' +
  'Documents stay on this device except for those sentence requests. No account is created. ' +
  'Daily free quota may apply. Optional email/key is NOT required and is not hardcoded.';

/** MyMemory rejects q longer than 500 bytes (UTF-8). Keep a margin. */
export const MAX_QUERY_BYTES = 450;

const utf8Len = (s) => new TextEncoder().encode(s).length;

/**
 * Split long text into chunks under maxBytes, preferring clause boundaries.
 * @returns {string[]}
 */
export function chunkForQuery(text, maxBytes = MAX_QUERY_BYTES) {
  if (utf8Len(text) <= maxBytes) return [text];
  const pieces = text.split(/(?<=[，,；;：:、])/);
  const chunks = [];
  let cur = '';
  for (const p of pieces) {
    if (utf8Len(cur + p) <= maxBytes) {
      cur += p;
      continue;
    }
    if (cur) chunks.push(cur);
    cur = '';
    if (utf8Len(p) <= maxBytes) {
      cur = p;
    } else {
      // hard split by characters
      let part = '';
      for (const ch of p) {
        if (utf8Len(part + ch) > maxBytes) {
          chunks.push(part);
          part = '';
        }
        part += ch;
      }
      cur = part;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export class TranslationError extends Error {
  constructor(message, code = 'TRANSLATION_FAILED') {
    super(message);
    this.code = code;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Translate one query string with MyMemory.
 * @param {string} q
 * @param {{fetch?:Function, email?:string, signal?:AbortSignal}} opts
 */
export async function myMemoryTranslate(q, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  let url = `${MYMEMORY_URL}?q=${encodeURIComponent(q)}&langpair=${encodeURIComponent('zh-CN|en')}`;
  if (opts.email) url += `&de=${encodeURIComponent(opts.email)}`;
  let res;
  try {
    res = await f(url, { signal: opts.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new TranslationError(`Network error: ${e?.message || e}`, 'NETWORK');
  }
  if (!res.ok) throw new TranslationError(`HTTP ${res.status}`, res.status === 429 ? 'QUOTA' : 'HTTP');
  let json;
  try {
    json = await res.json();
  } catch {
    throw new TranslationError('Invalid JSON from provider', 'BAD_RESPONSE');
  }
  const status = Number(json?.responseStatus);
  const text = json?.responseData?.translatedText;
  if (status !== 200 || typeof text !== 'string' || !text.trim()) {
    const quota = status === 429 || /QUOTA|USED ALL AVAILABLE/i.test(json?.responseDetails || text || '');
    throw new TranslationError(json?.responseDetails || `Provider status ${json?.responseStatus}`, quota ? 'QUOTA' : 'PROVIDER');
  }
  if (/MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR|PLEASE SELECT TWO DISTINCT/i.test(text)) {
    throw new TranslationError(text, /WARNING/i.test(text) ? 'QUOTA' : 'PROVIDER');
  }
  if (text.trim() === q.trim()) throw new TranslationError('Provider returned the source text unchanged', 'UNTRANSLATED');
  return decodeEntities(text.trim());
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** User-configured endpoint: POST {text, from:"zh", to:"en"} -> {translation} */
export async function customTranslate(text, endpoint, opts = {}) {
  const f = opts.fetch || globalThis.fetch;
  let res;
  try {
    res = await f(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, from: 'zh', to: 'en' }),
      signal: opts.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new TranslationError(`Network error: ${e?.message || e}`, 'NETWORK');
  }
  if (!res.ok) throw new TranslationError(`HTTP ${res.status}`, 'HTTP');
  const json = await res.json().catch(() => null);
  if (!json || typeof json.translation !== 'string' || !json.translation.trim()) {
    throw new TranslationError('Endpoint did not return {translation}', 'BAD_RESPONSE');
  }
  return json.translation.trim();
}

/**
 * Translator with IndexedDB cache, polite rate limiting and a sequential queue.
 */
export class Translator {
  /**
   * @param {{storage?: import('./storage.js').Storage, fetch?:Function, getSettings?:() => Promise<object>|object, delayMs?:number}} opts
   */
  constructor(opts = {}) {
    this.storage = opts.storage || null;
    this.fetch = opts.fetch || ((...a) => globalThis.fetch(...a));
    this.getSettings = opts.getSettings || (() => ({}));
    this.delayMs = opts.delayMs ?? 350;
    this._chain = Promise.resolve();
    this._last = 0;
    this.memory = new Map();
  }

  async providerName() {
    const s = await this.getSettings();
    return s.customTranslateUrl ? `Custom endpoint (${safeHost(s.customTranslateUrl)})` : PROVIDER_NAME;
  }

  /** Cached translation or undefined. */
  async cached(text) {
    if (this.memory.has(text)) return this.memory.get(text);
    const row = this.storage ? await this.storage.getTranslation(text) : undefined;
    if (row) this.memory.set(text, row);
    return row;
  }

  /**
   * Translate a Chinese sentence. Resolves {ok:true,en,provider,cached} or {ok:false,error,code}.
   * Requests are serialized and spaced by delayMs.
   */
  translate(text, { signal, force = false } = {}) {
    const job = async () => {
      if (!force) {
        const hit = await this.cached(text);
        if (hit) return { ok: true, en: hit.en, provider: hit.provider, cached: true };
      }
      if (signal?.aborted) return { ok: false, code: 'ABORTED', error: 'aborted' };
      try {
        const settings = await this.getSettings();
        const provider = await this.providerName();
        const parts = [];
        for (const chunk of chunkForQuery(text)) {
          await this._pace();
          if (signal?.aborted) return { ok: false, code: 'ABORTED', error: 'aborted' };
          const out = settings.customTranslateUrl
            ? await customTranslate(chunk, settings.customTranslateUrl, { fetch: this.fetch, signal })
            : await myMemoryTranslate(chunk, { fetch: this.fetch, email: settings.myMemoryEmail || '', signal });
          parts.push(out);
        }
        const en = parts.join(' ');
        const row = { text, en, provider };
        this.memory.set(text, row);
        if (this.storage) await this.storage.putTranslation(text, en, provider);
        return { ok: true, en, provider, cached: false };
      } catch (e) {
        if (e?.name === 'AbortError') return { ok: false, code: 'ABORTED', error: 'aborted' };
        return { ok: false, code: e.code || 'ERROR', error: e.message || String(e) };
      }
    };
    const p = this._chain.then(job, job);
    this._chain = p.catch(() => {});
    return p;
  }

  async _pace() {
    const wait = this._last + this.delayMs - Date.now();
    if (wait > 0) await sleep(wait);
    this._last = Date.now();
  }
}

function safeHost(u) {
  try {
    return new URL(u).host;
  } catch {
    return 'invalid URL';
  }
}

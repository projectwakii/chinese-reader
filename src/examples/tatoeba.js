// Authentic example sentences retrieved live from Tatoeba (CC-BY 2.0 FR).
// Only the search word is sent to tatoeba.org.

export const TATOEBA_SOURCE = 'tatoeba';
export const TATOEBA_LABEL = 'Authentic examples (Tatoeba, CC-BY)';
export const TATOEBA_ATTRIBUTION = 'Examples: Tatoeba (CC-BY)';

export function tatoebaSearchUrl(word) {
  return `https://tatoeba.org/en/api_v0/search?from=cmn&to=eng&query=${encodeURIComponent(word)}&orphans=no&unapproved=no`;
}

/** Translations come as [[direct...],[indirect...]] (or a flat list in some versions). */
function firstEnglish(translations) {
  const flat = [];
  const walk = (x) => {
    if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === 'object') flat.push(x);
  };
  walk(translations);
  const en = flat.find((t) => t.lang === 'eng' && t.text) || flat.find((t) => t.text);
  return en ? en.text : null;
}

/** Parse a Tatoeba api_v0 search response into examples containing the word. */
export function parseTatoeba(json, word, limit = 8) {
  const results = Array.isArray(json?.results) ? json.results : [];
  const out = [];
  for (const r of results) {
    if (!r || typeof r.text !== 'string') continue;
    if (word && !r.text.includes(word)) continue;
    out.push({
      zh: r.text,
      en: firstEnglish(r.translations),
      note: '',
      source: TATOEBA_SOURCE,
      sourceLabel: TATOEBA_LABEL,
      attribution: TATOEBA_ATTRIBUTION,
      url: r.id ? `https://tatoeba.org/en/sentences/show/${r.id}` : null,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** @returns {Promise<{ok:true, examples:object[]} | {ok:false, error:string}>} */
export async function findTatoebaExamples(word, { fetch: f = globalThis.fetch, signal, limit } = {}) {
  try {
    const res = await f(tatoebaSearchUrl(word), { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, error: `Tatoeba HTTP ${res.status}` };
    const json = await res.json();
    return { ok: true, examples: parseTatoeba(json, word, limit) };
  } catch (e) {
    return { ok: false, error: `Could not reach Tatoeba (${e?.message || e}). Some browsers block this request (CORS) or you may be offline.` };
  }
}

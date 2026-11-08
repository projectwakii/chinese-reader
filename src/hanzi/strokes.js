// Stroke-order data loader (hanzi-writer-data / Make Me a Hanzi graphics, Arphic Public License).
// Order: in-memory -> persistent cache -> local data/strokes/{char}.json -> jsDelivr CDN.
// Missing everywhere -> {status:'missing'} and the UI draws no guide.

export const CDN_BASE = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/';
export const MISSING_STROKES = 'No licensed stroke-order data for this character.';

export function localStrokeUrl(ch) {
  return `data/strokes/${encodeURIComponent(ch)}.json`;
}

export function cdnStrokeUrl(ch) {
  return `${CDN_BASE}${encodeURIComponent(ch)}.json`;
}

function validStrokeData(d) {
  return d && Array.isArray(d.strokes) && d.strokes.length > 0 && Array.isArray(d.medians) && d.medians.length === d.strokes.length;
}

/**
 * @param {{fetch?:Function, cache?:{get:(k:string)=>Promise<any>, set:(k:string,v:any)=>Promise<any>}, base?:string}} opts
 */
export function createStrokeLoader(opts = {}) {
  const f = opts.fetch || ((...a) => globalThis.fetch(...a));
  const cache = opts.cache || null;
  const base = opts.base || '';
  const mem = new Map();

  async function tryUrl(url) {
    try {
      const r = await f(url);
      if (!r.ok) return { status: r.status === 404 ? 'not-found' : 'error', code: r.status };
      const d = await r.json();
      return validStrokeData(d) ? { status: 'ok', data: d } : { status: 'invalid' };
    } catch (e) {
      return { status: 'error', error: String(e?.message || e) };
    }
  }

  /** @returns {Promise<{status:'ok', char:string, data:{strokes:string[], medians:number[][][]}, source:string} | {status:'missing'|'error', char:string, message:string}>} */
  async function load(ch) {
    if (mem.has(ch)) return mem.get(ch);
    if (cache) {
      const hit = await cache.get(`strokes:${ch}`).catch(() => undefined);
      if (validStrokeData(hit)) {
        const r = { status: 'ok', char: ch, data: hit, source: 'cache' };
        mem.set(ch, r);
        return r;
      }
    }
    const local = await tryUrl(base + localStrokeUrl(ch));
    if (local.status === 'ok') {
      const r = { status: 'ok', char: ch, data: local.data, source: 'local' };
      mem.set(ch, r);
      return r;
    }
    const remote = await tryUrl(cdnStrokeUrl(ch));
    if (remote.status === 'ok') {
      const r = { status: 'ok', char: ch, data: remote.data, source: 'cdn' };
      mem.set(ch, r);
      if (cache) await cache.set(`strokes:${ch}`, remote.data).catch(() => {});
      return r;
    }
    if (remote.status === 'error' && local.status !== 'not-found') {
      return { status: 'error', char: ch, message: 'Could not load stroke data (offline?). ' + MISSING_STROKES };
    }
    const r = { status: 'missing', char: ch, message: MISSING_STROKES };
    if (remote.status === 'not-found') mem.set(ch, r);
    return r;
  }

  return { load };
}

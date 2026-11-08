// IndexedDB storage for all private user data. Nothing here touches the network.
// Stores: docs, sentences, translations, vocab, reviewLog, settings, cache

import { newCard } from './srs.js';

export const DB_NAME = 'chinese-reader';
export const DB_VERSION = 1;
export const STORES = ['docs', 'sentences', 'translations', 'vocab', 'reviewLog', 'settings', 'cache'];
/** Stores included in a user backup (cache is re-fetchable public data). */
export const BACKUP_STORES = ['docs', 'sentences', 'translations', 'vocab', 'reviewLog', 'settings'];
/** Settings keys that are secrets and are never written into backups. */
export const SECRET_SETTINGS = ['genApiKey'];

const req = (r) =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

const done = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });

export class Storage {
  /** @param {{indexedDB?: IDBFactory, name?: string, now?: () => Date}} [opts] */
  constructor(opts = {}) {
    this.idb = opts.indexedDB || globalThis.indexedDB;
    this.name = opts.name || DB_NAME;
    this.now = opts.now || (() => new Date());
    this.db = null;
  }

  async open() {
    if (this.db) return this;
    const r = this.idb.open(this.name, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('docs')) db.createObjectStore('docs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sentences')) {
        const s = db.createObjectStore('sentences', { keyPath: 'id' });
        s.createIndex('docId', 'docId');
      }
      if (!db.objectStoreNames.contains('translations')) db.createObjectStore('translations', { keyPath: 'text' });
      if (!db.objectStoreNames.contains('vocab')) {
        const v = db.createObjectStore('vocab', { keyPath: 'word' });
        v.createIndex('dueAt', 'dueAt');
      }
      if (!db.objectStoreNames.contains('reviewLog')) {
        const l = db.createObjectStore('reviewLog', { keyPath: 'id', autoIncrement: true });
        l.createIndex('word', 'word');
      }
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' });
    };
    this.db = await req(r);
    return this;
  }

  close() {
    if (this.db) this.db.close();
    this.db = null;
  }

  async _store(name, mode = 'readonly') {
    await this.open();
    const tx = this.db.transaction(name, mode);
    return { tx, store: tx.objectStore(name) };
  }

  async get(storeName, key) {
    const { store } = await this._store(storeName);
    return req(store.get(key));
  }

  async put(storeName, value) {
    const { tx, store } = await this._store(storeName, 'readwrite');
    store.put(value);
    await done(tx);
    return value;
  }

  async delete(storeName, key) {
    const { tx, store } = await this._store(storeName, 'readwrite');
    store.delete(key);
    await done(tx);
  }

  async all(storeName) {
    const { store } = await this._store(storeName);
    return req(store.getAll());
  }

  async clear(storeName) {
    const { tx, store } = await this._store(storeName, 'readwrite');
    store.clear();
    await done(tx);
  }

  // ---------- documents ----------
  async saveDocument(doc, sentences) {
    await this.open();
    const tx = this.db.transaction(['docs', 'sentences'], 'readwrite');
    tx.objectStore('docs').put(doc);
    const s = tx.objectStore('sentences');
    for (const row of sentences) s.put(row);
    await done(tx);
    return doc;
  }

  listDocuments() {
    return this.all('docs').then((d) => d.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
  }

  getDocument(id) {
    return this.get('docs', id);
  }

  async getSentences(docId) {
    const { store } = await this._store('sentences');
    const rows = await req(store.index('docId').getAll(docId));
    return rows.sort((a, b) => a.idx - b.idx);
  }

  async deleteDocument(id) {
    const ids = (await this.getSentences(id)).map((s) => s.id);
    const tx = this.db.transaction(['docs', 'sentences'], 'readwrite');
    tx.objectStore('docs').delete(id);
    const s = tx.objectStore('sentences');
    for (const k of ids) s.delete(k);
    await done(tx);
  }

  // ---------- translations (cache keyed by sentence text) ----------
  getTranslation(text) {
    return this.get('translations', text);
  }

  putTranslation(text, en, provider) {
    return this.put('translations', { text, en, provider, at: this.now().toISOString() });
  }

  // ---------- vocab ----------
  getWord(word) {
    return this.get('vocab', word);
  }

  listWords() {
    return this.all('vocab').then((w) => w.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')));
  }

  /**
   * Save (or merge into) a vocabulary card.
   * @param {{word:string, pinyin?:string, pinyinSource?:string, definition?:string, context?:{zh:string,en?:string,docId?:string,sentenceId?:string}, notes?:string}} data
   */
  async saveWord(data) {
    const word = String(data.word || '').trim();
    if (!word) throw new Error('empty word');
    const nowIso = this.now().toISOString();
    const existing = await this.getWord(word);
    if (existing) {
      const merged = { ...existing, updatedAt: nowIso };
      if (data.context && !existing.contexts?.some((c) => c.zh === data.context.zh)) {
        merged.contexts = [...(existing.contexts || []), data.context];
      }
      if (data.pinyin && !existing.pinyin) merged.pinyin = data.pinyin;
      if (data.definition && !existing.definition) merged.definition = data.definition;
      await this.put('vocab', merged);
      return merged;
    }
    const card = {
      word,
      pinyin: data.pinyin || '',
      pinyinSource: data.pinyinSource || '',
      definition: data.definition || '',
      context: data.context || null,
      contexts: data.context ? [data.context] : [],
      notes: data.notes || '',
      savedExamples: [],
      createdAt: nowIso,
      updatedAt: nowIso,
      ...newCard(this.now()),
    };
    await this.put('vocab', card);
    return card;
  }

  async updateWord(word, patch) {
    const card = await this.getWord(word);
    if (!card) throw new Error(`no such word: ${word}`);
    const next = { ...card, ...patch, word: card.word, updatedAt: this.now().toISOString() };
    await this.put('vocab', next);
    return next;
  }

  updateNotes(word, notes) {
    return this.updateWord(word, { notes: String(notes ?? '') });
  }

  deleteWord(word) {
    return this.delete('vocab', word);
  }

  /** @param {{zh:string,en?:string|null,note?:string,source:string}} ex */
  async addExample(word, ex) {
    const card = await this.getWord(word);
    if (!card) throw new Error(`no such word: ${word}`);
    const list = card.savedExamples || [];
    if (list.some((e) => e.zh === ex.zh)) return card;
    const saved = { zh: ex.zh, en: ex.en ?? null, note: ex.note || '', source: ex.source, savedAt: this.now().toISOString() };
    return this.updateWord(word, { savedExamples: [...list, saved] });
  }

  async removeExample(word, zh) {
    const card = await this.getWord(word);
    return this.updateWord(word, { savedExamples: (card.savedExamples || []).filter((e) => e.zh !== zh) });
  }

  logReview(entry) {
    return this.put('reviewLog', { ...entry, at: this.now().toISOString() });
  }

  // ---------- settings ----------
  async getSetting(key, fallback = undefined) {
    const row = await this.get('settings', key);
    return row ? row.value : fallback;
  }

  setSetting(key, value) {
    return this.put('settings', { key, value });
  }

  async getSettings() {
    const rows = await this.all('settings');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // ---------- cache (public data such as stroke JSON) ----------
  async getCache(key) {
    const row = await this.get('cache', key);
    return row ? row.value : undefined;
  }

  setCache(key, value) {
    return this.put('cache', { key, value });
  }

  // ---------- backup / restore ----------
  async exportAll() {
    const stores = {};
    for (const name of BACKUP_STORES) {
      let rows = await this.all(name);
      if (name === 'settings') rows = rows.filter((r) => !SECRET_SETTINGS.includes(r.key));
      stores[name] = rows;
    }
    return { app: 'chinese-reader', version: DB_VERSION, exportedAt: this.now().toISOString(), stores };
  }

  /** Merge a backup into the database (records with the same key are overwritten). */
  async importAll(backup) {
    if (!backup || backup.app !== 'chinese-reader' || typeof backup.stores !== 'object') {
      throw new Error('Not a Chinese Reader backup file');
    }
    await this.open();
    const names = BACKUP_STORES.filter((n) => Array.isArray(backup.stores[n]));
    const tx = this.db.transaction(names, 'readwrite');
    const counts = {};
    for (const n of names) {
      const st = tx.objectStore(n);
      let rows = backup.stores[n];
      if (n === 'settings') rows = rows.filter((r) => !SECRET_SETTINGS.includes(r.key));
      for (const row of rows) {
        // reviewLog uses autoIncrement ids; keep them if present
        st.put(row);
      }
      counts[n] = rows.length;
    }
    await done(tx);
    return counts;
  }
}

/** Create a short random id. */
export function makeId(prefix = 'd') {
  const rnd = (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
    .replace(/-/g, '')
    .slice(0, 12);
  return `${prefix}_${rnd}`;
}

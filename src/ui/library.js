// Library: upload/paste, list of documents.
import { h, clear, toast, modal, fmtDate } from './dom.js';
import { parseFile, toDocument, browserDeps, SCANNED_MESSAGE } from '../import/index.js';
import { importPlainText } from '../import/text.js';

const TYPE_LABEL = { txt: 'Text', epub: 'EPUB', pdf: 'PDF' };

export async function libraryView(root, ctx) {
  clear(root);
  const fileInput = h('input', {
    type: 'file',
    id: 'file-input',
    accept: '.txt,.epub,.pdf,text/plain,application/epub+zip,application/pdf',
    class: 'visually-hidden',
    onchange: (e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      if (f) importFile(f);
    },
  });
  const status = h('div', { class: 'import-status', 'aria-live': 'polite' });
  const titleInput = h('input', { type: 'text', id: 'paste-title', placeholder: 'Title (optional)', class: 'input' });
  const pasteBox = h('textarea', { id: 'paste-text', class: 'input paste', lang: 'zh-CN', placeholder: '在这里粘贴中文文本… / Paste Chinese text here' });
  const list = h('div', { class: 'doc-list' });

  async function store(parsed) {
    const { doc, sentences } = toDocument(parsed);
    await ctx.storage.saveDocument(doc, sentences);
    toast(`Imported “${doc.title}” · ${doc.sentenceCount} sentences`);
    ctx.nav(`#/read/${doc.id}`);
  }

  async function importFile(file) {
    status.textContent = `Importing ${file.name}…`;
    try {
      const deps = await browserDeps();
      const parsed = await parseFile(file, deps, (p, n) => (status.textContent = `Reading PDF page ${p}/${n}…`));
      await store(parsed);
    } catch (e) {
      status.textContent = '';
      if (e.code === 'SCANNED_PDF') {
        modal('Scanned PDF — OCR not supported', h('div', null, h('p', null, SCANNED_MESSAGE), h('p', { class: 'muted' }, `Pages: ${e.stats.numPages}, extractable characters: ${e.stats.totalChars}.`)), {
          blocking: true,
          actions: [{ label: 'OK, I understand', primary: true }],
        });
      } else {
        modal('Import failed', h('p', null, e.message || String(e)));
      }
    }
  }

  async function importPaste() {
    const text = pasteBox.value.trim();
    if (!text) return toast('Paste some Chinese text first', 'warn');
    try {
      await store(importPlainText(text, titleInput.value.trim() || `Pasted ${new Date().toLocaleString()}`));
    } catch (e) {
      modal('Import failed', h('p', null, e.message));
    }
  }

  async function renderList() {
    clear(list);
    const docs = await ctx.storage.listDocuments();
    if (!docs.length) {
      list.append(h('p', { class: 'empty' }, 'No documents yet. Upload a .txt, .epub or text-based .pdf, or paste text above.'));
      return;
    }
    for (const d of docs) {
      list.append(
        h(
          'div',
          { class: 'doc-item' },
          h(
            'button',
            { class: 'doc-open', onclick: () => ctx.nav(`#/read/${d.id}`) },
            h('div', { class: 'doc-title', lang: 'zh-CN' }, d.title),
            h('div', { class: 'doc-meta' }, `${TYPE_LABEL[d.type] || d.type} · ${fmtDate(d.createdAt)} · ${d.sentenceCount} sentences · ${d.chapters.length} section${d.chapters.length === 1 ? '' : 's'}`)
          ),
          h(
            'button',
            {
              class: 'btn danger',
              'aria-label': `Delete ${d.title}`,
              onclick: () =>
                modal('Delete document?', h('p', null, `“${d.title}” will be removed from this device. Saved words are kept.`), {
                  actions: [
                    { label: 'Cancel' },
                    { label: 'Delete', primary: true, onClick: async () => { await ctx.storage.deleteDocument(d.id); renderList(); } },
                  ],
                }),
            },
            'Delete'
          )
        )
      );
    }
  }

  root.append(
    h(
      'section',
      { class: 'panel import-panel' },
      h('h1', null, 'Library'),
      h(
        'div',
        { class: 'import-row' },
        h('label', { class: 'btn primary big', for: 'file-input' }, '⬆︎ Upload .txt / .epub / .pdf'),
        fileInput,
        h('span', { class: 'muted' }, 'Files are processed on this device. Scanned PDFs are not supported (no OCR).')
      ),
      status,
      h('details', { class: 'paste-details', open: true }, h('summary', null, 'Paste text'), titleInput, pasteBox, h('button', { class: 'btn primary', id: 'paste-import', onclick: importPaste }, 'Import pasted text'))
    ),
    h('section', { class: 'panel' }, h('h2', null, 'Your documents'), list)
  );
  await renderList();
}

// Plain-text import. UTF-8 first (BOM stripped); if the bytes are not valid UTF-8,
// fall back to GB18030 (common for Chinese .txt files) when the platform supports it.

export function decodeText(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''), encoding: 'utf-8' };
  } catch {
    try {
      return { text: new TextDecoder('gb18030').decode(u8), encoding: 'gb18030' };
    } catch {
      return { text: new TextDecoder('utf-8').decode(u8).replace(/^﻿/, ''), encoding: 'utf-8 (lossy)' };
    }
  }
}

/** Split text into chapters if it contains "第X章/回/节" headings, else one chapter. */
export function textToChapters(text) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const heading = /^\s*(第[0-9０-９一二三四五六七八九十百千零〇两]+[章回节卷部篇]|Chapter\s+\d+)/i;
  const chapters = [];
  let cur = { title: '', paragraphs: [] };
  for (const raw of lines) {
    const line = raw.replace(/　/g, ' ').trim();
    if (!line) continue;
    if (heading.test(line) && line.length <= 40) {
      if (cur.paragraphs.length || cur.title) chapters.push(cur);
      cur = { title: line, paragraphs: [] };
      continue;
    }
    cur.paragraphs.push(line);
  }
  if (cur.paragraphs.length || cur.title) chapters.push(cur);
  return chapters.filter((c) => c.paragraphs.length);
}

export function importPlainText(input, title = 'Pasted text') {
  const text = typeof input === 'string' ? input : decodeText(input).text;
  const chapters = textToChapters(text);
  return { title, type: 'txt', chapters };
}

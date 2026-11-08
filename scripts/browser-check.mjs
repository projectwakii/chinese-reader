// Dev-only smoke check in a real browser: runs demo/tour.mjs, screenshots the four target
// iPad mini viewports and reports console errors. Needs a static server on BASE
// (npm start) and Chrome/Chromium (CHROME=/path, default /usr/bin/google-chrome).
// Usage: node scripts/browser-check.mjs [http://localhost:8080]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import tour from '../demo/tour.mjs';

const BASE = process.argv[2] || 'http://localhost:8080';
const OUT = 'logs/screens';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome' });
const errors = [];

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${viewport.width}x${viewport.height}] ${m.text()}`));
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return { ctx, page };
}

// 1. full tour (landscape)
{
  const { ctx, page } = await newPage({ width: 1133, height: 744 });
  const t0 = Date.now();
  await tour(page, BASE);
  console.log(`tour finished in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await page.screenshot({ path: `${OUT}/tour-end.png` });
  // reuse state: open reader in each viewport
  const docHref = await page.evaluate(async () => {
    const r = indexedDB.open('chinese-reader');
    const db = await new Promise((res) => (r.onsuccess = () => res(r.result)));
    const docs = await new Promise((res) => { const q = db.transaction('docs').objectStore('docs').getAll(); q.onsuccess = () => res(q.result); });
    return `#/read/${docs[0].id}`;
  });
  for (const vp of [{ width: 1024, height: 768 }, { width: 1133, height: 744 }, { width: 768, height: 1024 }, { width: 744, height: 1133 }]) {
    await page.setViewportSize(vp);
    await page.goto(`${BASE}/index.html?vp=${vp.width}${docHref}`);
    await page.waitForSelector('.pair .zh');
    await page.waitForTimeout(800);
    await page.locator('.zh').nth(3).click();
    await page.waitForTimeout(300);
    const mode = await page.evaluate(() => document.documentElement.dataset.layout);
    const cols = await page.evaluate(() => getComputedStyle(document.querySelector('.pair')).gridTemplateColumns);
    console.log(`${vp.width}x${vp.height}: layout=${mode} pair grid=${cols}`);
    await page.screenshot({ path: `${OUT}/reader-${vp.width}x${vp.height}.png` });
  }
  for (const [name, hash] of [['write', `#/write/${encodeURIComponent('爱')}`], ['review', '#/review'], ['char', `#/char/${encodeURIComponent('学')}`], ['settings', '#/settings'], ['library', '#/library'], ['word', `#/word/${encodeURIComponent('学习')}`]]) {
    await page.setViewportSize({ width: 1133, height: 744 });
    await page.goto(`${BASE}/index.html${hash}`);
    await page.waitForTimeout(1200);
    if (name === 'word') {
      await page.click('#find-examples');
      await page.waitForTimeout(3500);
    }
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: name === 'word' });
  }
  await ctx.close();
}

// 2. scanned PDF import shows blocking OCR message
{
  const { ctx, page } = await newPage({ width: 1024, height: 768 });
  await page.goto(`${BASE}/index.html#/library`);
  await page.setInputFiles('#file-input', 'testdata/scanned.pdf');
  await page.waitForSelector('.modal', { timeout: 15000 });
  console.log('scanned modal:', (await page.textContent('.modal h2')).trim());
  await page.screenshot({ path: `${OUT}/scanned.png` });
  await page.click('.modal .btn');
  await page.setInputFiles('#file-input', 'testdata/text.pdf');
  await page.waitForSelector('.pair .zh', { timeout: 15000 });
  console.log('text.pdf first sentence:', await page.locator('.zh').first().textContent());
  await page.goto(`${BASE}/index.html#/library`);
  await page.setInputFiles('#file-input', 'testdata/sample.epub');
  await page.waitForSelector('.pair .zh', { timeout: 15000 });
  console.log('epub chapters:', await page.locator('.chapter-select option').allTextContents());
  await ctx.close();
}

await browser.close();
console.log(errors.length ? `console errors:\n${errors.join('\n')}` : 'no console errors');

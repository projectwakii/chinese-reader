// Playwright tour for the screen recording (~25 s).
// Library -> paste sample text -> side-by-side reader -> tap sentence -> select 学习 ->
// save -> character breakdown -> stroke-order writing canvas -> word page.
//
// DEMO-ONLY NOTE: the recorder forbids network calls beyond baseUrl, so this script
// intercepts MyMemory requests with page.route() and answers with hand-written reference
// translations of the sample sentences below. The app itself never ships or invents
// translations; in real use these come live from MyMemory. Unknown sentences get an
// error response so the app shows its honest "Translation unavailable" state.

const SAMPLE = `我爱学习中文。你好吗？我很好！
今天我去书店买了一本书。书里有很多有意思的故事。
老师说：“学习要每天坚持。”我们一起读书吧！`;

const DEMO_TRANSLATIONS = {
  '我爱学习中文。': 'I love studying Chinese.',
  '你好吗？': 'How are you?',
  '我很好！': "I'm fine!",
  '今天我去书店买了一本书。': 'Today I went to the bookstore and bought a book.',
  '书里有很多有意思的故事。': 'There are many interesting stories in the book.',
  '老师说：“学习要每天坚持。”': 'The teacher said: "Studying takes daily persistence."',
  '我们一起读书吧！': "Let's read together!",
};

const wait = (page, ms) => page.waitForTimeout(ms);

export default async function tour(page, baseUrl) {
  await page.route('https://api.mymemory.translated.net/**', (route) => {
    const q = new URL(route.request().url()).searchParams.get('q') || '';
    const en = DEMO_TRANSLATIONS[q];
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(en ? { responseStatus: 200, responseData: { translatedText: en } } : { responseStatus: 403, responseDetails: 'demo: offline', responseData: { translatedText: '' } }),
    });
  });
  await page.route(/^https:\/\/(tatoeba\.org|cdn\.jsdelivr\.net)\//, (route) => route.abort());

  await page.setViewportSize({ width: 1133, height: 744 }).catch(() => {});
  const url = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  await page.goto(`${url}index.html#/library`);
  await page.waitForSelector('#paste-text');
  await wait(page, 1800); // show the privacy banner
  await page.click('#privacy-ok').catch(() => {});

  // Import via paste
  await page.fill('#paste-title', '我的第一本书');
  await page.click('#paste-text');
  await page.type('#paste-text', SAMPLE.slice(0, 14), { delay: 45 });
  await page.fill('#paste-text', SAMPLE);
  await wait(page, 500);
  await page.click('#paste-import');

  // Side-by-side reader, translations arriving
  await page.waitForSelector('.pair .zh');
  await wait(page, 3200);

  // Tap a sentence -> highlight + Chinese TTS; characters become chips
  const first = page.locator('.zh').first();
  await first.click();
  await wait(page, 1300);
  await page.locator('.zh.active .ch').nth(2).click();
  await wait(page, 350);
  await page.locator('.zh.active .ch').nth(3).click();
  await wait(page, 1400);
  await page.getByRole('button', { name: '＋ Save word' }).click();
  await wait(page, 1300);

  // Character breakdown (licensed MMAH data)
  await page.getByRole('button', { name: 'Character breakdown' }).click();
  await page.waitForSelector('.modal .breakdown');
  await wait(page, 2500);
  await page.locator('.modal .char-tab').nth(1).click().catch(() => {});
  await wait(page, 1800);
  await page.locator('.modal .char-tab').nth(0).click().catch(() => {});
  await wait(page, 500);

  // Writing practice with stroke-order replay
  await page.locator('.modal').getByRole('button', { name: /Practice writing/ }).click();
  await page.waitForSelector('#write-canvas');
  await wait(page, 600);
  await page.click('#btn-replay');
  await wait(page, 4600);
  await page.click('#btn-clear');
  // draw the first stroke of 学 (top-left dot) with the mouse, then ask for a hint
  const box = await page.locator('#write-canvas').boundingBox();
  if (box) {
    const s = box.width / 1024;
    await page.mouse.move(box.x + 300 * s, box.y + 160 * s);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + (300 + i * 8) * s, box.y + (160 + i * 14) * s);
    await page.mouse.up();
  }
  await wait(page, 1200);
  await page.click('#btn-hint');
  await wait(page, 1600);

  // Word page with notes, SRS state and examples button
  await page.goto(`${url}index.html#/word/${encodeURIComponent('学习')}`);
  await page.waitForSelector('#word-notes');
  await page.type('#word-notes', '学习 = to study（我爱学习中文）', { delay: 30 });
  await wait(page, 1800);
}

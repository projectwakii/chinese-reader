// Layout decision shared by CSS class toggling and tests.
// Side-by-side (Chinese | English) for landscape tablets: width >= 1000, or a landscape
// viewport at least 900 wide. Everything else (portrait iPad mini 768x1024 / 744x1133,
// phones, Split View) is stacked.

export function layoutModeFor(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (w >= 1000) return 'side-by-side';
  if (w > h && w >= 900) return 'side-by-side';
  return 'stacked';
}

/** Keep `layout-side-by-side` / `layout-stacked` on <html> in sync with the viewport. */
export function watchLayout(win = globalThis.window, onChange = () => {}) {
  const root = win.document.documentElement;
  let mode = null;
  const apply = () => {
    const next = layoutModeFor(win.innerWidth, win.innerHeight);
    if (next === mode) return;
    mode = next;
    root.classList.toggle('layout-side-by-side', next === 'side-by-side');
    root.classList.toggle('layout-stacked', next === 'stacked');
    root.dataset.layout = next;
    onChange(next);
  };
  apply();
  win.addEventListener('resize', apply);
  win.addEventListener('orientationchange', () => setTimeout(apply, 50));
  return { get mode() { return mode; }, apply };
}

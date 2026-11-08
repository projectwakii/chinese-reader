// Tiny DOM helpers (no framework).

/**
 * h('div', {class:'x', onclick: fn}, child, 'text', [more])
 * Works with any Document (pass `doc` via h.bind or use hd(doc)).
 */
export function hd(doc) {
  return function h(tag, attrs, ...children) {
    const el = doc.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v === undefined || v === null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k in el && typeof v !== 'string') el[k] = v;
        else el.setAttribute(k, v === true ? '' : String(v));
      }
    }
    append(el, children);
    return el;
  };
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' && c.nodeType ? c : el.ownerDocument.createTextNode(String(c)));
  }
}

export const h = (...a) => hd(globalThis.document)(...a);

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

let toastTimer = null;
export function toast(msg, kind = 'info', ms = 3200) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Modal dialog. Returns {close, el}. blocking=true hides the close-on-backdrop behaviour. */
export function modal(title, body, { actions = [], blocking = false, className = '' } = {}) {
  const close = () => wrap.remove();
  const wrap = h(
    'div',
    { class: 'modal-backdrop', onclick: (e) => !blocking && e.target === wrap && close() },
    h(
      'div',
      { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('h2', null, title),
      h('div', { class: 'modal-body' }, body),
      h(
        'div',
        { class: 'modal-actions' },
        (actions.length ? actions : [{ label: 'OK' }]).map((a) =>
          h('button', { class: `btn ${a.primary ? 'primary' : ''}`, onclick: () => (a.onClick?.() === false ? null : close()) }, a.label)
        )
      )
    )
  );
  document.body.appendChild(wrap);
  wrap.querySelector('.modal-actions .btn')?.focus();
  return { close, el: wrap };
}

export function download(filename, content, mime = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename, style: 'display:none' });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1000);
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  wrapped.flush = (...a) => {
    clearTimeout(t);
    return fn(...a);
  };
  return wrapped;
}

// Handwriting practice canvas. Pointer Events (pen / touch / mouse) with pointer capture,
// pressure-sensitive ink for Apple Pencil, a faint stroke-order guide rendered from the
// licensed SVG paths, animated replay along the medians and conservative stroke feedback.

const SIZE = 1024; // hanzi-writer-data coordinate space
const Y_FLIP = 900; // data is y-up: screenY = 900 - y

/** Convert a data-space median point [x,y] to canvas data space (y-down). */
export const toDown = ([x, y]) => [x, Y_FLIP - y];

function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/**
 * Compare a user stroke with the expected median (both y-down data space).
 * Conservative: only judges overall direction and start position.
 * @param {{x:number,y:number}[]} points
 * @param {number[][]} medianDown
 */
export function compareStroke(points, medianDown) {
  if (!points.length || !medianDown?.length) return { ok: false, reason: 'empty' };
  const us = [points[0].x, points[0].y];
  const ue = [points[points.length - 1].x, points[points.length - 1].y];
  const ms = medianDown[0];
  const me = medianDown[medianDown.length - 1];
  const uv = [ue[0] - us[0], ue[1] - us[1]];
  const mv = [me[0] - ms[0], me[1] - ms[1]];
  const ul = Math.hypot(...uv);
  const ml = Math.hypot(...mv);
  const startDist = Math.hypot(us[0] - ms[0], us[1] - ms[1]) / SIZE;
  let cos = 1;
  if (ul > 20 && ml > 20) cos = (uv[0] * mv[0] + uv[1] * mv[1]) / (ul * ml);
  if (cos < -0.3) return { ok: false, reason: 'reversed', cos, startDist };
  if (cos < 0.35) return { ok: false, reason: 'direction', cos, startDist };
  if (startDist > 0.3) return { ok: false, reason: 'position', cos, startDist };
  return { ok: true, reason: 'match', cos, startDist };
}

export function feedbackText(idx, total, cmp) {
  const n = `Stroke ${idx + 1}${total ? ` of ${total}` : ''}`;
  if (total && idx >= total) return `Extra stroke: this character has ${total} strokes.`;
  switch (cmp.reason) {
    case 'match':
      return `${n}: direction and start look consistent with the guide ✓`;
    case 'reversed':
      return `${n}: this seems to go the opposite way — try “Next stroke hint”.`;
    case 'direction':
      return `${n}: the direction looks different from the expected stroke.`;
    case 'position':
      return `${n}: starts far from where this stroke usually begins.`;
    default:
      return `${n}`;
  }
}

export class WritingPad {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{strokeData?:{strokes:string[],medians:number[][][]}|null, context?:CanvasRenderingContext2D|null,
   *   raf?:(cb:FrameRequestCallback)=>number, onChange?:(pad:WritingPad)=>void, onFeedback?:(msg:string, cmp:object)=>void,
   *   inkColor?:string}} opts
   */
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.data = opts.strokeData || null;
    this.ctx = opts.context !== undefined ? opts.context : safeContext(canvas);
    this.raf = opts.raf || ((cb) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(cb) : setTimeout(() => cb(Date.now()), 16)));
    this.onChange = opts.onChange || (() => {});
    this.onFeedback = opts.onFeedback || (() => {});
    this.inkColor = opts.inkColor || '#1d4ed8';
    this.showGuide = true;
    this.strokes = []; // completed strokes
    this.current = null; // in-progress stroke
    this.activePointer = null;
    this.hintIndex = -1;
    this.anim = null; // {stroke, progress}
    this.completedGuide = 0; // number of guide strokes shown as "done" during replay
    this.paths = this.data && typeof Path2D !== 'undefined' ? this.data.strokes.map((d) => new Path2D(d)) : [];
    this._bind();
    this.resize();
  }

  get expectedStrokes() {
    return this.data ? this.data.strokes.length : 0;
  }

  _bind() {
    const c = this.canvas;
    c.style.touchAction = 'none';
    this._down = (e) => this.pointerDown(e);
    this._move = (e) => this.pointerMove(e);
    this._up = (e) => this.pointerUp(e);
    this._cancel = (e) => this.pointerCancel(e);
    c.addEventListener('pointerdown', this._down, { passive: false });
    c.addEventListener('pointermove', this._move, { passive: false });
    c.addEventListener('pointerup', this._up, { passive: false });
    c.addEventListener('pointercancel', this._cancel, { passive: false });
    // Belt and braces for iOS: stop scroll/zoom gestures starting on the canvas.
    this._touch = (e) => e.preventDefault();
    c.addEventListener('touchstart', this._touch, { passive: false });
    c.addEventListener('touchmove', this._touch, { passive: false });
  }

  destroy() {
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._down);
    c.removeEventListener('pointermove', this._move);
    c.removeEventListener('pointerup', this._up);
    c.removeEventListener('pointercancel', this._cancel);
    c.removeEventListener('touchstart', this._touch);
    c.removeEventListener('touchmove', this._touch);
    this.anim = null;
  }

  resize() {
    if (!this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const dpr = globalThis.devicePixelRatio || 1;
    const w = Math.max(1, Math.round((rect.width || this.canvas.width) * dpr));
    const h = Math.max(1, Math.round((rect.height || this.canvas.height) * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.render();
  }

  /** Map client coordinates into 0..1024 data space (y-down). */
  toData(e) {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width || this.canvas.width || SIZE;
    const h = rect.height || this.canvas.height || SIZE;
    const side = Math.min(w, h);
    const ox = (w - side) / 2;
    const oy = (h - side) / 2;
    return {
      x: ((e.clientX - (rect.left || 0) - ox) / side) * SIZE,
      y: ((e.clientY - (rect.top || 0) - oy) / side) * SIZE,
    };
  }

  pointerDown(e) {
    if (e.cancelable) e.preventDefault();
    if (this.activePointer !== null) {
      // While the Pencil is down, ignore a resting palm/finger.
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== undefined && e.button !== 0) return;
    this.activePointer = e.pointerId;
    try {
      this.canvas.setPointerCapture?.(e.pointerId);
    } catch {
      /* not capturable (synthetic events) */
    }
    const p = this.toData(e);
    this.current = { pointerType: e.pointerType || 'mouse', points: [{ ...p, p: pressureOf(e), t: e.timeStamp || Date.now() }] };
    this.render();
  }

  pointerMove(e) {
    if (e.pointerId !== this.activePointer || !this.current) return;
    if (e.cancelable) e.preventDefault();
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const list = events && events.length ? events : [e];
    for (const ev of list) {
      const p = this.toData(ev);
      this.current.points.push({ ...p, p: pressureOf(ev), t: ev.timeStamp || Date.now() });
    }
    this.render();
  }

  pointerUp(e) {
    if (e.pointerId !== this.activePointer) return;
    if (e.cancelable) e.preventDefault();
    try {
      this.canvas.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }
    this.activePointer = null;
    const s = this.current;
    this.current = null;
    if (s && s.points.length) {
      const p = this.toData(e);
      const last = s.points[s.points.length - 1];
      if (Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) s.points.push({ ...p, p: pressureOf(e), t: e.timeStamp || Date.now() });
      this.strokes.push(s);
      this._feedback(s);
    }
    this.render();
    this.onChange(this);
  }

  pointerCancel(e) {
    if (e.pointerId !== this.activePointer) return;
    this.activePointer = null;
    this.current = null;
    this.render();
  }

  _feedback(stroke) {
    const idx = this.strokes.length - 1;
    const total = this.expectedStrokes;
    if (!this.data) {
      this.onFeedback(`Stroke ${idx + 1} recorded.`, { reason: 'no-data' });
      return;
    }
    if (idx >= total) {
      const cmp = { ok: false, reason: 'extra' };
      this.onFeedback(feedbackText(idx, total, cmp), cmp);
      return;
    }
    const cmp = compareStroke(stroke.points, this.data.medians[idx].map(toDown));
    let msg = feedbackText(idx, total, cmp);
    if (idx === total - 1) msg += ` All ${total} strokes written.`;
    this.onFeedback(msg, cmp);
  }

  clear() {
    this.strokes = [];
    this.current = null;
    this.activePointer = null;
    this.hintIndex = -1;
    this.anim = null;
    this.render();
    this.onChange(this);
  }

  undo() {
    this.strokes.pop();
    this.render();
    this.onChange(this);
  }

  setGuide(on) {
    this.showGuide = !!on;
    this.render();
  }

  /** Highlight and animate the next expected stroke (based on how many strokes the user wrote). */
  nextHint() {
    if (!this.data) return -1;
    const idx = Math.min(this.strokes.length, this.expectedStrokes - 1);
    this.hintIndex = idx;
    this._animate([idx], 0);
    return idx;
  }

  /** Animate all strokes in order. Resolves when finished. */
  replay() {
    if (!this.data) return Promise.resolve(false);
    this.hintIndex = -1;
    return this._animate(this.data.strokes.map((_, i) => i), 0);
  }

  _animate(order, startDone) {
    const token = {};
    this.anim = { token, stroke: order[0], progress: 0 };
    this.completedGuide = startDone;
    const msPerStroke = 520;
    return new Promise((resolve) => {
      let k = 0;
      let t0 = null;
      const step = (ts) => {
        if (!this.anim || this.anim.token !== token) return resolve(false);
        const now = typeof ts === 'number' ? ts : Date.now();
        if (t0 === null) t0 = now;
        const prog = Math.min(1, (now - t0) / msPerStroke);
        this.anim.stroke = order[k];
        this.anim.progress = prog;
        this.render();
        if (prog >= 1) {
          k += 1;
          t0 = null;
          if (order.length > 1) this.completedGuide = order[k - 1] + 1;
          if (k >= order.length) {
            this.anim = order.length === 1 ? { token, stroke: order[0], progress: 1, hold: true } : null;
            this.completedGuide = 0;
            this.render();
            return resolve(true);
          }
        }
        this.raf(step);
      };
      this.raf(step);
    });
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { width: W, height: H } = this.canvas;
    const side = Math.min(W, H);
    const s = side / SIZE;
    const ox = (W - side) / 2;
    const oy = (H - side) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(s, 0, 0, s, ox, oy);

    // 米字格 practice grid
    ctx.save();
    ctx.strokeStyle = '#e8b4b4';
    ctx.lineWidth = 3;
    ctx.strokeRect(4, 4, SIZE - 8, SIZE - 8);
    ctx.setLineDash?.([18, 14]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0);
    ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2);
    ctx.lineTo(SIZE, SIZE / 2);
    ctx.moveTo(0, 0);
    ctx.lineTo(SIZE, SIZE);
    ctx.moveTo(SIZE, 0);
    ctx.lineTo(0, SIZE);
    ctx.stroke();
    ctx.restore();

    // guide strokes (data space is y-up; flip around y=900 like hanzi-writer)
    if (this.paths.length) {
      ctx.save();
      ctx.transform(1, 0, 0, -1, 0, Y_FLIP);
      this.paths.forEach((p, i) => {
        let fill = null;
        if (this.anim && !this.anim.hold && i < this.completedGuide) fill = '#94a3b8';
        else if (this.showGuide) fill = '#e5e7eb';
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fill(p);
        }
      });
      if (this.anim) this._drawAnimatedStroke(ctx);
      ctx.restore();
    }

    // user ink
    const all = this.current ? [...this.strokes, this.current] : this.strokes;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = this.inkColor;
    for (const st of all) {
      const pts = st.points;
      if (pts.length === 1) {
        ctx.fillStyle = this.inkColor;
        ctx.beginPath();
        ctx.arc(pts[0].x, pts[0].y, widthFor(st, pts[0]) / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < pts.length; i++) {
        ctx.lineWidth = widthFor(st, pts[i]);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1].x, pts[i - 1].y);
        ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawAnimatedStroke(ctx) {
    const { stroke, progress } = this.anim;
    const path = this.paths[stroke];
    const median = this.data.medians[stroke];
    if (!path || !median) return;
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 150;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const total = polylineLength(median);
    let remaining = total * progress;
    ctx.beginPath();
    ctx.moveTo(median[0][0], median[0][1]);
    for (let i = 1; i < median.length && remaining > 0; i++) {
      const [x0, y0] = median[i - 1];
      const [x1, y1] = median[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (seg <= remaining) {
        ctx.lineTo(x1, y1);
        remaining -= seg;
      } else {
        const t = remaining / seg;
        ctx.lineTo(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
        remaining = 0;
      }
    }
    ctx.stroke();
    ctx.restore();
    // start dot so direction is obvious
    ctx.save();
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.arc(median[0][0], median[0][1], 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function pressureOf(e) {
  return typeof e.pressure === 'number' ? e.pressure : 0;
}

function widthFor(stroke, pt) {
  // Pencil reports real pressure (>0); mouse reports 0.5 while pressed; touch often 0 or 1.
  if (stroke.pointerType === 'pen' && pt.p > 0) return 18 + pt.p * 46;
  return 36;
}

function safeContext(canvas) {
  try {
    return canvas.getContext ? canvas.getContext('2d') : null;
  } catch {
    return null;
  }
}

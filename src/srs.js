// SM-2 spaced repetition (SuperMemo 2, Wozniak 1990) with Anki-style buttons.
// Button -> SM-2 quality: Again=1 (lapse), Hard=3, Good=4, Easy=5.
// q < 3: repetitions reset to 0, interval = 1 day.
// q >= 3: repetitions += 1; interval = 1, then 6, then round(prevInterval * EF).
// EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)), never below 1.3.
// Variant notes (so the four buttons differ, like Anki): from the 2nd success on,
// "Easy" multiplies the computed interval by 1.3 and "Hard" by 0.8.

export const GRADES = { again: 1, hard: 3, good: 4, easy: 5 };
export const GRADE_LABELS = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

/** Local calendar date YYYY-MM-DD for a Date. */
export function localDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Add whole days to a local date (DST-safe: works on calendar fields). */
export function addDays(d, days) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, 12, 0, 0);
  return r;
}

export function newCard(now = new Date()) {
  return { easiness: 2.5, intervalDays: 0, repetitions: 0, dueAt: localDate(now), lastResult: null, lastReviewedAt: null };
}

/**
 * Apply a grade to card scheduling fields. Pure function.
 * @param {{easiness:number,intervalDays:number,repetitions:number}} card
 * @param {'again'|'hard'|'good'|'easy'} grade
 * @param {Date} now
 */
export function schedule(card, grade, now = new Date()) {
  const q = GRADES[grade];
  if (q === undefined) throw new Error(`unknown grade ${grade}`);
  let ef = Number(card.easiness) || 2.5;
  let reps = Number(card.repetitions) || 0;
  let interval = Number(card.intervalDays) || 0;

  if (q < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    if (reps === 1) interval = 1;
    else if (reps === 2) interval = 6;
    else interval = Math.round(interval * ef);
    if (grade === 'easy' && reps >= 2) interval = Math.round(interval * 1.3);
    if (grade === 'hard' && reps >= 2) interval = Math.max(1, Math.round(interval * 0.8));
  }
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;
  ef = Math.round(ef * 1000) / 1000;

  return {
    easiness: ef,
    repetitions: reps,
    intervalDays: interval,
    dueAt: localDate(addDays(now, interval)),
    lastResult: grade,
    lastReviewedAt: now.toISOString(),
  };
}

/** Preview the next interval for every button (for button labels). */
export function previewIntervals(card, now = new Date()) {
  return Object.fromEntries(Object.keys(GRADES).map((g) => [g, schedule(card, g, now).intervalDays]));
}

export function isDue(card, now = new Date()) {
  return !card.dueAt || card.dueAt <= localDate(now);
}

export function dueCards(cards, now = new Date()) {
  return cards.filter((c) => isDue(c, now)).sort((a, b) => (a.dueAt || '').localeCompare(b.dueAt || ''));
}

export function formatInterval(days) {
  if (days < 1) return 'today';
  if (days === 1) return '1 day';
  if (days < 31) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${(days / 365).toFixed(1)} yr`;
}

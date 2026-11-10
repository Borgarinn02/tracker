import { update } from './store.js';
import { daysBetween, dayKey } from './dates.js';

/**
 * What the program says for a given date.
 * Each skipped date before `date` pushes the cycle back one day,
 * so skipping today moves today's workout to tomorrow and shifts the rest of the plan.
 */
export function slotFor(s, date) {
  const p = s.gym.program;
  if (!p || !p.slots.length) return null;
  const n = p.slots.length;
  const skipsBefore = p.skips.filter((d) => d >= p.anchor && d < date).length;
  const idx = (((daysBetween(p.anchor, date) - skipsBefore) % n) + n) % n;
  const routine = s.gym.routines.find((r) => r.id === p.slots[idx]) || null;
  return { idx, routine, rest: !routine, skipped: p.skips.includes(date) };
}

export const workoutOn = (s, date) => s.gym.history.find((w) => dayKey(new Date(w.startedAt)) === date);

export function toggleSkip(date) {
  update((s) => {
    const p = s.gym.program;
    p.skips = p.skips.includes(date) ? p.skips.filter((d) => d !== date) : [...p.skips, date].sort();
  });
}

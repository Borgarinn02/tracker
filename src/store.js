import { todayKey, weekStart } from './dates.js';

const KEY = 'tracker:v1';
const subs = new Set();

export const COLORS = ['#c6f432', '#5cc8ff', '#ffb547', '#ff7ab6', '#a78bfa', '#34d399', '#f87171'];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

function defaults() {
  return {
    version: 1,
    food: {
      goals: { calories: 2500, protein: 180, carbs: 250, fat: 80, note: '' },
      log: {}, // { 'YYYY-MM-DD': [{ id, name, meal, calories, protein, carbs, fat, time }] }
    },
    gym: {
      routines: [], // [{ id, name, exercises: [{ id, name, sets, reps, weight, rest }] }]
      active: null, // the workout in progress
      history: [], // finished workouts, newest first
      // Repeating schedule: slots[i] is a routine id (or null = rest day).
      // `anchor` is the date of slot 0; each date in `skips` pushes everything after it back one day.
      program: null, // { slots: [], anchor: 'YYYY-MM-DD', skips: [] }
    },
    projects: {
      list: [], // [{ id, name, color, notes }]
      tasks: [], // [{ id, projectId, title, date, time, done, createdAt }]
    },
    daily: {
      habits: [], // [{ id, name, note }]
      done: {}, // { 'YYYY-MM-DD': [habitId, ...] }
    },
  };
}

const ex = (name, sets, reps, weight, rest) => ({ id: uid(), name, sets, reps, weight, rest });

const STARTER_ROUTINES = {
  'Front & Back': () => [
    ex('Incline bench press', 4, 8, 50, 120),
    ex('Lat pulldown', 4, 10, 55, 90),
    ex('Dumbbell bench press', 3, 10, 26, 90),
    ex('Seated cable row', 3, 10, 55, 90),
    ex('Cable fly', 3, 12, 15, 60),
    ex('Straight-arm pulldown', 3, 12, 20, 60),
  ],
  'Arms & Shoulders': () => [
    ex('Seated dumbbell press', 4, 8, 22, 90),
    ex('Lateral raise', 4, 15, 8, 60),
    ex('Rear delt fly', 3, 15, 8, 60),
    ex('EZ-bar curl', 3, 10, 30, 60),
    ex('Skull crusher', 3, 10, 25, 60),
    ex('Hammer curl', 3, 12, 14, 60),
    ex('Overhead triceps extension', 3, 12, 20, 60),
  ],
};

/** Push → Pull → Legs → Front & Back → Arms & Shoulders → Legs → Rest, starting Monday this week. */
function defaultProgram(routines) {
  const find = (name) => {
    let r = routines.find((x) => x.name.trim().toLowerCase() === name.toLowerCase());
    if (!r) {
      r = { id: uid(), name, exercises: STARTER_ROUTINES[name]?.() || [] };
      routines.push(r);
    }
    return r.id;
  };
  const legs = find('Legs');
  return {
    slots: [find('Push'), find('Pull'), legs, find('Front & Back'), find('Arms & Shoulders'), legs, null],
    anchor: weekStart(todayKey()),
    skips: [],
  };
}

const starterHabits = () => [
  { id: uid(), name: 'Learn Italian', note: '15 minutes' },
  { id: uid(), name: 'Play the guitar', note: '' },
];

function seed() {
  const d = defaults();
  d.gym.routines.push(
    {
      id: uid(),
      name: 'Push',
      exercises: [
        ex('Bench press', 4, 8, 60, 120),
        ex('Overhead press', 3, 8, 40, 90),
        ex('Incline dumbbell press', 3, 10, 22, 90),
        ex('Lateral raise', 3, 15, 8, 60),
        ex('Triceps pushdown', 3, 12, 25, 60),
      ],
    },
    {
      id: uid(),
      name: 'Pull',
      exercises: [
        ex('Deadlift', 3, 5, 100, 180),
        ex('Pull-up', 4, 8, 0, 120),
        ex('Barbell row', 3, 8, 60, 90),
        ex('Face pull', 3, 15, 15, 60),
        ex('Biceps curl', 3, 12, 12, 60),
      ],
    },
    {
      id: uid(),
      name: 'Legs',
      exercises: [
        ex('Squat', 4, 6, 80, 150),
        ex('Romanian deadlift', 3, 8, 70, 120),
        ex('Leg press', 3, 12, 120, 90),
        ex('Leg curl', 3, 12, 35, 60),
        ex('Calf raise', 4, 15, 40, 60),
      ],
    }
  );
  const pid = uid();
  d.projects.list.push({ id: pid, name: 'Tracker app', color: COLORS[1], notes: 'This app!' });
  d.projects.tasks.push({
    id: uid(), projectId: pid, title: 'Put the tracker on my phone', date: todayKey(), time: '', done: false, createdAt: Date.now(),
  });
  delete d.daily; // let migrate() add the starter habits + program
  return migrate(d);
}

/** Fill in any fields missing from older saves so new features never crash on old data. */
function migrate(s) {
  const d = defaults();
  const out = {
    ...d,
    ...s,
    version: 2,
    food: { ...d.food, ...s.food, goals: { ...d.food.goals, ...s.food?.goals } },
    gym: { ...d.gym, ...s.gym },
    projects: { ...d.projects, ...s.projects },
    daily: s.daily ? { ...d.daily, ...s.daily } : { habits: starterHabits(), done: {} },
  };
  out.gym.routines = [...out.gym.routines];
  if (!out.gym.program) out.gym.program = defaultProgram(out.gym.routines);
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('Could not read saved data', e);
  }
  return seed();
}

let state = load();
const saveHooks = new Set();
save();

/** `local: true` means the change was made on this device (so it needs uploading). */
function save(info = { local: false }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.error('Could not save', e);
  }
  saveHooks.forEach((f) => f(info));
}

export const onSave = (fn) => saveHooks.add(fn);

export const get = () => state;

/**
 * Mutate state, persist, and re-render.
 * `silent` skips the re-render — used while typing so inputs don't lose focus.
 */
export function update(fn, { silent = false } = {}) {
  fn(state);
  save({ local: true });
  if (!silent) subs.forEach((f) => f());
}

/** Swap in a whole new state (import, reset, or data arriving from the cloud). */
export function replace(next, { fromSync = false } = {}) {
  state = migrate(next);
  save({ local: !fromSync });
  subs.forEach((f) => f());
}

export function resetAll() {
  replace(seed());
}

export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}

// Ask the browser not to evict our data under storage pressure.
navigator.storage?.persist?.().catch(() => {});

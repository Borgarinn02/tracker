import { h, sheet, field, numInput, toast, icon, fmtNum } from '../ui.js';
import { get, update, uid } from '../store.js';
import { fmtDuration, fmtDay, dayKey, weekStart, todayKey, addDays, parseKey } from '../dates.js';
import { slotFor, workoutOn, toggleSkip } from '../schedule.js';

/*
 * Exercise shape (routine template):
 *   { id, name, type: 'sets' | 'time', note, sets, reps, weight, rest, minutes }
 * reps can be a number (8) or text ("10-12", "max"). Timed exercises use `minutes` instead of sets/reps.
 */
const isTimed = (e) => e.type === 'time';
const repsTxt = (r) => (r === '' || r == null ? '' : String(r).replace(/\s*-\s*/, '–'));
const parseReps = (v) => {
  const t = String(v ?? '').trim();
  return /^\d+$/.test(t) ? +t : t;
};
const numericReps = (r) => (typeof r === 'number' ? r : /^\d+$/.test(String(r ?? '')) ? +r : '');
const fmtTarget = (n, e) =>
  isTimed(e) ? `${e.minutes || '?'} min` : `${n}${repsTxt(e.reps) ? ` × ${repsTxt(e.reps)}` : ' sets'}${+e.weight ? ` @ ${fmtNum(e.weight)} kg` : ''}`;
const targetTpl = (e) => fmtTarget(e.sets, e);
const targetLive = (e) => fmtTarget(e.sets.length, e);
const fmtSets = (e) => (isTimed(e) ? `${e.minutes || ''} min ✓` : e.sets.map((x) => `${+x.weight ? fmtNum(x.weight) + '×' : ''}${x.reps || 0}`).join(', '));
const allDone = (e) => e.sets.length > 0 && e.sets.every((x) => x.done);
const volume = (w) => w.exercises.reduce((v, e) => v + e.sets.reduce((a, x) => a + (+x.weight || 0) * (+x.reps || 0), 0), 0);
const setCount = (w) => w.exercises.reduce((n, e) => n + (isTimed(e) ? 0 : e.sets.length), 0);

function lastExercise(s, name) {
  const n = name.trim().toLowerCase();
  for (const w of s.gym.history) {
    const e = w.exercises.find((x) => x.name.trim().toLowerCase() === n);
    if (e) return { when: w.endedAt, ex: e };
  }
  return null;
}

/* ---------- starting / finishing ---------- */

/** Turn a routine exercise into a live one; sets are pre-filled with what you did last time. */
function buildLive(s, e) {
  const base = { templateId: e.id || null, type: e.type || 'sets', name: e.name, note: e.note || '', minutes: e.minutes || '', reps: e.reps, weight: e.weight, rest: e.rest };
  if (isTimed(e)) return { ...base, sets: [{ done: false }] };
  const prev = lastExercise(s, e.name)?.ex.sets || [];
  return {
    ...base,
    sets: Array.from({ length: Math.max(1, +e.sets || 1) }, (_, k) => {
      const p = prev[k] || prev[prev.length - 1];
      return { weight: p?.weight ?? e.weight ?? '', reps: p?.reps ?? numericReps(e.reps), done: false };
    }),
  };
}

export function start(routine) {
  const s0 = get();
  const exercises = (routine?.exercises || []).map((e) => buildLive(s0, e));
  update((s) => {
    s.gym.active = {
      id: uid(),
      routineId: routine?.id || null,
      name: routine?.name || 'Workout',
      startedAt: Date.now(),
      current: 0,
      restEndsAt: null,
      timerLabel: null,
      exercises,
    };
  });
  window.scrollTo(0, 0);
}

function finish() {
  const a = get().gym.active;
  const done = a.exercises.map((e) => ({ ...e, sets: e.sets.filter((x) => x.done) })).filter((e) => e.sets.length);
  if (!done.length && !confirm('Nothing checked off. Discard this workout?')) return;
  update((s) => {
    if (done.length) {
      s.gym.history.unshift({ id: uid(), name: a.name, routineId: a.routineId, startedAt: a.startedAt, endedAt: Date.now(), exercises: done });
      // Progression: carry the heaviest weight you actually lifted into the routine for next time.
      const r = s.gym.routines.find((r) => r.id === a.routineId);
      if (r)
        for (const e of done) {
          if (isTimed(e)) continue;
          const t = r.exercises.find((x) => x.id === e.templateId);
          const top = Math.max(...e.sets.map((x) => +x.weight || 0));
          if (t && top > 0) t.weight = top;
        }
    }
    s.gym.active = null;
  });
  if (done.length) toast('Workout saved 💪');
}

function discard() {
  if (confirm('Discard this workout? Nothing will be saved.')) update((s) => (s.gym.active = null));
}

/* ---------- live workout ---------- */

function completeSet(i, k) {
  update((s) => {
    const a = s.gym.active;
    const ex = a.exercises[i];
    const st = ex.sets[k];
    st.done = !st.done;
    if (!st.done) return;
    if (!isTimed(ex)) {
      const rest = +ex.rest || 90;
      a.restEndsAt = Date.now() + rest * 1000;
      a.restTotal = rest;
      a.timerLabel = null;
    } else if (a.timerLabel === ex.name) {
      a.restEndsAt = null; // finished the cardio early
    }
    // Finished every set? Move on to what's next.
    if (allDone(ex) && i === a.current && i < a.exercises.length - 1) a.current = i + 1;
  });
}

function setRow(i, k, set, ex) {
  const edit = (field) => (ev) =>
    update((s) => (s.gym.active.exercises[i].sets[k][field] = ev.target.value === '' ? '' : +ev.target.value), { silent: true });
  return h(
    'div',
    { class: 'set-row' + (set.done ? ' done' : '') },
    h('span', { class: 'set-n' }, k + 1),
    h('label', { class: 'set-field' }, numInput('w', set.weight, { step: '0.5', placeholder: '–', oninput: edit('weight'), 'aria-label': `Set ${k + 1} weight` }), h('span', {}, 'kg')),
    h('label', { class: 'set-field' }, numInput('r', set.reps, { step: '1', inputmode: 'numeric', placeholder: repsTxt(ex.reps) || '–', oninput: edit('reps'), 'aria-label': `Set ${k + 1} reps` }), h('span', {}, 'reps')),
    h('button', { class: 'check' + (set.done ? ' on' : ''), 'aria-label': set.done ? 'Undo set' : 'Complete set', onclick: () => completeSet(i, k) }, icon('check', 20))
  );
}

function timedRow(i, ex) {
  const done = ex.sets[0]?.done;
  const mins = +ex.minutes || 5;
  return h(
    'div',
    { class: 'timed-row' + (done ? ' done' : '') },
    h(
      'button',
      {
        class: 'btn primary',
        disabled: done,
        onclick: () =>
          update((s) => {
            const a = s.gym.active;
            a.restEndsAt = Date.now() + mins * 60000;
            a.restTotal = mins * 60;
            a.timerLabel = ex.name;
          }),
      },
      icon('play', 18),
      `Start ${mins}:00 timer`
    ),
    h('button', { class: 'check' + (done ? ' on' : ''), 'aria-label': done ? 'Undo' : 'Mark done', onclick: () => completeSet(i, 0) }, icon('check', 20))
  );
}

function renderActive(root, s) {
  const a = s.gym.active;
  const i = Math.min(a.current, Math.max(0, a.exercises.length - 1));
  const ex = a.exercises[i];
  const next = a.exercises[i + 1];
  const go = (j) => update((st) => (st.gym.active.current = j));

  root.append(
    h(
      'section',
      { class: 'card live-head' },
      h('div', {}, h('div', { class: 'eyebrow' }, 'In progress'), h('h2', {}, a.name), h('div', { class: 'muted' }, h('span', { 'data-elapsed': a.startedAt }, fmtDuration(Date.now() - a.startedAt)), ' elapsed')),
      h('div', { class: 'live-btns' }, h('button', { class: 'btn primary', onclick: finish }, 'Finish'), h('button', { class: 'btn ghost small', onclick: discard }, 'Discard'))
    )
  );

  if (a.exercises.length)
    root.append(
      h(
        'div',
        { class: 'pills' },
        a.exercises.map((e, j) => h('button', { class: 'pill' + (j === i ? ' active' : '') + (allDone(e) ? ' done' : ''), onclick: () => go(j) }, allDone(e) ? icon('check', 14) : null, e.name))
      )
    );

  if (ex) {
    const last = lastExercise(s, ex.name);
    root.append(
      h(
        'section',
        { class: 'card current' },
        h('div', { class: 'eyebrow' }, `Exercise ${i + 1} of ${a.exercises.length}`),
        h('h2', { class: 'ex-name' }, ex.name),
        h('div', { class: 'muted' }, isTimed(ex) ? `${ex.minutes || 5} minutes` : `Target ${targetLive(ex)} · rest ${ex.rest || 90}s`),
        ex.note && h('div', { class: 'ex-note' }, ex.note),
        last && !isTimed(ex) && h('div', { class: 'last-time' }, h('span', {}, `Last time (${fmtDay(dayKey(new Date(last.when)))})`), h('strong', {}, fmtSets(last.ex))),
        isTimed(ex)
          ? timedRow(i, ex)
          : [
              h('div', { class: 'sets' }, ex.sets.map((set, k) => setRow(i, k, set, ex))),
              h(
                'div',
                { class: 'row-btns' },
                h(
                  'button',
                  {
                    class: 'btn small',
                    onclick: () =>
                      update((st) => {
                        const sets = st.gym.active.exercises[i].sets;
                        const prev = sets[sets.length - 1] || { weight: ex.weight, reps: numericReps(ex.reps) };
                        sets.push({ weight: prev.weight, reps: prev.reps, done: false });
                      }),
                  },
                  icon('plus', 16),
                  'Set'
                ),
                ex.sets.length > 1 && h('button', { class: 'btn small ghost', onclick: () => update((st) => st.gym.active.exercises[i].sets.pop()) }, 'Remove set')
              ),
            ]
      ),
      h(
        'section',
        { class: 'card next' },
        h('div', { class: 'eyebrow' }, 'Up next'),
        next ? h('div', { class: 'next-row' }, h('strong', {}, next.name), h('span', { class: 'muted' }, targetLive(next))) : h('div', { class: 'muted' }, 'Last exercise. Hit Finish when you’re done.')
      ),
      h(
        'div',
        { class: 'ex-nav' },
        h('button', { class: 'btn', disabled: i === 0, onclick: () => go(i - 1) }, icon('left', 18), 'Prev'),
        h('button', { class: 'btn' + (allDone(ex) && next ? ' primary' : ''), disabled: !next, onclick: () => go(i + 1) }, 'Next', icon('right', 18))
      )
    );
  } else {
    root.append(h('section', { class: 'card empty' }, h('p', {}, 'No exercises yet. Add the first one.')));
  }

  root.append(h('button', { class: 'btn block', onclick: addExerciseSheet }, icon('plus', 18), 'Add exercise to this workout'));
}

function addExerciseSheet() {
  sheet({
    title: 'Add exercise',
    body: h(
      'div',
      { class: 'form' },
      field('Exercise', h('input', { name: 'name', required: true, placeholder: 'e.g. Dips', autocomplete: 'off' })),
      h(
        'div',
        { class: 'grid-4' },
        field('Sets', numInput('sets', 3)),
        field('Reps', h('input', { name: 'reps', value: '10', placeholder: '8, 10-12, max' })),
        field('kg', numInput('weight', '')),
        field('Rest s', numInput('rest', 90))
      )
    ),
    submitLabel: 'Add',
    onSubmit(fd) {
      const name = fd.get('name').trim();
      if (!name) return false;
      const e = { name, sets: +fd.get('sets') || 1, reps: parseReps(fd.get('reps')), weight: fd.get('weight') === '' ? '' : +fd.get('weight'), rest: +fd.get('rest') || 90 };
      const live = buildLive(get(), e);
      update((s) => {
        const a = s.gym.active;
        a.exercises.push(live);
        a.current = a.exercises.length - 1;
      });
    },
  });
}

/* ---------- routines ---------- */

function exerciseRow(e = {}) {
  const typeSel = h(
    'select',
    { class: 'x-type', value: e.type || 'sets', 'aria-label': 'Exercise type', onchange: () => row.classList.toggle('timed', typeSel.value === 'time') },
    h('option', { value: 'sets' }, 'Sets & reps'),
    h('option', { value: 'time' }, 'Timed (cardio)')
  );
  const row = h(
    'div',
    { class: 'ex-edit' + (isTimed(e) ? ' timed' : '') },
    h(
      'div',
      { class: 'ex-edit-top' },
      h('input', { class: 'x-name', value: e.name || '', placeholder: 'Exercise name', 'aria-label': 'Exercise name' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove exercise', onclick: () => row.remove() }, icon('close', 18))
    ),
    h('div', { class: 'grid-2' }, typeSel, h('input', { class: 'x-note', value: e.note || '', placeholder: 'Note (optional)', 'aria-label': 'Note' })),
    h(
      'div',
      { class: 'grid-4 only-sets' },
      field('Sets', numInput('', e.sets ?? 3, { class: 'x-sets' })),
      field('Reps', h('input', { class: 'x-reps', value: String(e.reps ?? 10), placeholder: '10-12' })),
      field('kg', numInput('', e.weight ?? '', { class: 'x-weight' })),
      field('Rest s', numInput('', e.rest ?? 90, { class: 'x-rest' }))
    ),
    h('div', { class: 'grid-4 only-time' }, field('Minutes', numInput('', e.minutes ?? 5, { class: 'x-min' })))
  );
  row.dataset.id = e.id || '';
  return row;
}

function routineSheet(routine) {
  const isNew = !routine;
  const list = h('div', { class: 'ex-list' }, (routine?.exercises || [{}]).map(exerciseRow));
  sheet({
    title: isNew ? 'New routine' : 'Edit routine',
    body: h(
      'div',
      { class: 'form' },
      field('Name', h('input', { name: 'name', value: routine?.name || '', required: true, placeholder: 'e.g. Upper body' })),
      h('p', { class: 'muted small' }, 'Reps can be a number, a range like 10-12, or “max”.'),
      list,
      h('button', { type: 'button', class: 'btn block', onclick: () => list.append(exerciseRow()) }, icon('plus', 18), 'Add exercise')
    ),
    onSubmit(fd, form) {
      const name = fd.get('name').trim();
      if (!name) return false;
      const q = (row, c) => row.querySelector(c).value;
      const exercises = [...form.querySelectorAll('.ex-edit')]
        .map((row) => ({
          id: row.dataset.id || uid(),
          name: q(row, '.x-name').trim(),
          type: q(row, '.x-type'),
          note: q(row, '.x-note').trim(),
          sets: Math.max(1, +q(row, '.x-sets') || 1),
          reps: parseReps(q(row, '.x-reps')),
          weight: q(row, '.x-weight') === '' ? '' : +q(row, '.x-weight'),
          rest: +q(row, '.x-rest') || 90,
          minutes: +q(row, '.x-min') || 5,
        }))
        .filter((e) => e.name);
      update((s) => {
        if (isNew) s.gym.routines.push({ id: uid(), name, exercises });
        else Object.assign(s.gym.routines.find((r) => r.id === routine.id), { name, exercises });
      });
    },
    danger: !isNew && {
      label: 'Delete',
      onClick: () => {
        if (!confirm(`Delete routine “${routine.name}”?`)) return false;
        update((s) => (s.gym.routines = s.gym.routines.filter((r) => r.id !== routine.id)));
      },
    },
  });
}

function historySheet(w) {
  sheet({
    title: w.name,
    body: h(
      'div',
      { class: 'history-detail' },
      h('p', { class: 'muted' }, `${fmtDay(dayKey(new Date(w.startedAt)), { weekday: 'long', day: 'numeric', month: 'long' })} · ${fmtDuration(w.endedAt - w.startedAt)} · ${fmtNum(volume(w))} kg total`),
      w.exercises.map((e) => h('div', { class: 'hd-ex' }, h('strong', {}, e.name), h('span', { class: 'muted' }, fmtSets(e))))
    ),
    submitLabel: 'Close',
    danger: {
      label: 'Delete',
      onClick: () => {
        if (!confirm('Delete this workout from history?')) return false;
        update((s) => (s.gym.history = s.gym.history.filter((x) => x.id !== w.id)));
      },
    },
  });
}

/* ---------- program (weekly schedule) ---------- */

const weekday = (d, style = 'long') => parseKey(d).toLocaleDateString(undefined, { weekday: style });
const slotName = (slot) => (!slot ? '—' : slot.rest ? 'Rest day' : slot.routine.name);

function confirmSkip(date, slot) {
  const when = date === todayKey() ? 'today' : fmtDay(date);
  if (confirm(`Skip ${slot.routine.name} ${when}? It moves to the next day and the rest of the plan shifts by one day.`)) toggleSkip(date);
}

function todayCard(s) {
  const today = todayKey();
  const slot = slotFor(s, today);
  if (!slot)
    return h('section', { class: 'card empty' }, h('p', {}, 'No program set up yet.'), h('button', { class: 'btn primary', onclick: programSheet }, 'Set up program'));

  const done = workoutOn(s, today);
  const tomorrow = slotFor(s, addDays(today, 1));
  let body;

  if (slot.skipped) {
    body = [
      h('h2', { class: 'today-name' }, 'Skipped'),
      h('p', { class: 'muted' }, slot.rest ? 'Rest day moved to tomorrow.' : `${slot.routine.name} moved to tomorrow.`),
      h('div', { class: 'today-btns' }, h('button', { class: 'btn', onclick: () => toggleSkip(today) }, 'Undo skip')),
    ];
  } else if (slot.rest) {
    body = [
      h('h2', { class: 'today-name' }, 'Rest day'),
      h('p', { class: 'muted' }, `Recover. Tomorrow: ${slotName(tomorrow)}.`),
      done && h('div', { class: 'done-badge' }, icon('check', 16), `Trained anyway: ${done.name}`),
    ];
  } else {
    const r = slot.routine;
    body = [
      h('h2', { class: 'today-name' }, r.name),
      done && h('div', { class: 'done-badge' }, icon('check', 16), 'Done today'),
      h('ul', { class: 'ex-preview' }, r.exercises.map((e) => h('li', {}, h('span', {}, e.name), h('span', { class: 'muted' }, targetTpl(e))))),
      !r.exercises.length && h('p', { class: 'muted small' }, 'No exercises yet. Tap the pencil to add them.'),
      h(
        'div',
        { class: 'today-btns' },
        h('button', { class: 'btn primary', onclick: () => start(r) }, icon('play', 18), done ? 'Train again' : `Start ${r.name}`),
        !done && h('button', { class: 'btn', onclick: () => confirmSkip(today, slot) }, 'Skip day')
      ),
    ];
  }

  return h(
    'section',
    { class: 'card today-card' },
    h(
      'div',
      { class: 'card-head' },
      h('div', { class: 'eyebrow' }, `Today · ${weekday(today)}`),
      slot.routine && !slot.skipped && h('button', { class: 'icon-btn', 'aria-label': `Edit ${slot.routine.name}`, onclick: () => routineSheet(slot.routine) }, icon('edit', 18))
    ),
    body
  );
}

function weekCard(s) {
  const today = todayKey();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i + 1));
  return h(
    'section',
    { class: 'card list-card' },
    days.map((d) => {
      const slot = slotFor(s, d);
      return h(
        'div',
        { class: 'sched-row' + (slot.skipped ? ' skipped' : '') + (slot.rest && !slot.skipped ? ' rest' : '') },
        h('div', { class: 'sched-day' }, h('strong', {}, weekday(d, 'short')), h('span', {}, parseKey(d).getDate())),
        h('div', { class: 'sched-name' }, slot.skipped ? 'Skipped' : slotName(slot)),
        slot.skipped
          ? h('button', { class: 'btn small ghost', onclick: () => toggleSkip(d) }, 'Undo')
          : !slot.rest && h('button', { class: 'btn small ghost', onclick: () => confirmSkip(d, slot) }, 'Skip')
      );
    })
  );
}

function programSheet() {
  const s = get();
  const p = s.gym.program || { slots: [], anchor: todayKey(), skips: [] };
  const today = todayKey();
  const cur = slotFor(s, today);

  const todaySel = h('select', { name: 'todayIdx' });
  const list = h('div', { class: 'slot-list' });

  const slotRow = (id) => {
    const row = h(
      'div',
      { class: 'slot-row' },
      h('span', { class: 'slot-n' }),
      h('select', { class: 'slot-sel', value: id || '', onchange: refresh }, h('option', { value: '' }, 'Rest day'), s.gym.routines.map((r) => h('option', { value: r.id }, r.name))),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove day', onclick: () => (row.remove(), refresh()) }, icon('close', 18))
    );
    return row;
  };

  function refresh() {
    const rows = [...list.querySelectorAll('.slot-row')];
    const keep = todaySel.value;
    rows.forEach((r, i) => (r.querySelector('.slot-n').textContent = `Day ${i + 1}`));
    todaySel.replaceChildren(
      ...rows.map((r, i) => h('option', { value: String(i) }, `Day ${i + 1}: ${r.querySelector('.slot-sel').selectedOptions[0]?.textContent || ''}`))
    );
    if (keep && +keep < rows.length) todaySel.value = keep;
  }

  list.append(...p.slots.map(slotRow));
  refresh();
  if (cur) todaySel.value = String(cur.idx);

  sheet({
    title: 'Program',
    body: h(
      'div',
      { class: 'form' },
      h('p', { class: 'muted small' }, 'Your cycle repeats in this order. Use “Rest day” for days off.'),
      list,
      h('button', { type: 'button', class: 'btn block', onclick: () => (list.append(slotRow(null)), refresh()) }, icon('plus', 18), 'Add day'),
      field(`Today (${weekday(today)}) is`, todaySel)
    ),
    onSubmit(fd, form) {
      const slots = [...form.querySelectorAll('.slot-sel')].map((x) => x.value || null);
      if (!slots.length) return false;
      const idx = Math.min(+fd.get('todayIdx') || 0, slots.length - 1);
      update((st) => {
        st.gym.program = { slots, anchor: addDays(today, -idx), skips: (st.gym.program?.skips || []).filter((d) => d > today) };
      });
    },
  });
}

/* ---------- idle page ---------- */

function renderIdle(root, s) {
  const ws = weekStart();
  const thisWeek = s.gym.history.filter((w) => dayKey(new Date(w.startedAt)) >= ws);
  const lastByRoutine = (id) => s.gym.history.find((w) => w.routineId === id);

  root.append(
    todayCard(s),
    h('div', { class: 'section-row' }, h('h3', { class: 'section-title' }, 'Coming up'), h('button', { class: 'btn small ghost', onclick: programSheet }, icon('edit', 16), 'Program')),
    s.gym.program && weekCard(s),
    h(
      'section',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('strong', {}, thisWeek.length), h('span', {}, 'workouts this week')),
      h('div', { class: 'stat' }, h('strong', {}, fmtNum(Math.round(thisWeek.reduce((v, w) => v + volume(w), 0)))), h('span', {}, 'kg lifted this week'))
    ),
    h('h3', { class: 'section-title' }, 'Routines'),
    h(
      'section',
      { class: 'card list-card' },
      s.gym.routines.map((r) => {
        const last = lastByRoutine(r.id);
        return h(
          'div',
          { class: 'routine-row' },
          h(
            'button',
            { class: 'row', onclick: () => routineSheet(r) },
            h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, r.name), h('span', { class: 'row-sub' }, `${r.exercises.length} exercises · ${last ? `last ${fmtDay(dayKey(new Date(last.startedAt)))}` : 'not done yet'}`))
          ),
          h('button', { class: 'icon-btn', 'aria-label': `Start ${r.name}`, onclick: () => start(r) }, icon('play', 18))
        );
      })
    ),
    h(
      'div',
      { class: 'row-btns' },
      h('button', { class: 'btn', onclick: () => routineSheet() }, icon('plus', 18), 'New routine'),
      h('button', { class: 'btn ghost', onclick: () => start(null) }, 'Empty workout')
    )
  );

  if (s.gym.history.length)
    root.append(
      h('h3', { class: 'section-title' }, 'History'),
      h(
        'section',
        { class: 'card list-card' },
        s.gym.history.slice(0, 20).map((w) =>
          h(
            'button',
            { class: 'row', onclick: () => historySheet(w) },
            h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, w.name), h('span', { class: 'row-sub' }, `${fmtDay(dayKey(new Date(w.startedAt)))} · ${fmtDuration(w.endedAt - w.startedAt)} · ${setCount(w)} sets`)),
            h('span', { class: 'row-end' }, `${fmtNum(Math.round(volume(w)))} kg`)
          )
        )
      )
    );
}

export const gymPage = {
  title: 'Gym',
  subtitle: () => {
    const s = get();
    if (s.gym.active) return 'Workout in progress';
    const slot = slotFor(s, todayKey());
    return slot ? (slot.skipped ? 'Skipped today' : `Today: ${slotName(slot)}`) : 'Set up your program';
  },
  render(root) {
    const s = get();
    if (s.gym.active) renderActive(root, s);
    else renderIdle(root, s);
  },
};

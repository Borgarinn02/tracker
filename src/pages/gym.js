import { h, sheet, field, numInput, toast, icon, fmtNum } from '../ui.js';
import { get, update, uid } from '../store.js';
import { fmtDuration, fmtDay, dayKey, weekStart } from '../dates.js';

const targetTpl = (e) => `${e.sets} × ${e.reps || '?'}${+e.weight ? ` @ ${fmtNum(e.weight)} kg` : ''}`;
const targetLive = (e) => `${e.sets.length} × ${e.reps || '?'}${+e.weight ? ` @ ${fmtNum(e.weight)} kg` : ''}`;
const allDone = (e) => e.sets.length > 0 && e.sets.every((x) => x.done);
const volume = (w) => w.exercises.reduce((v, e) => v + e.sets.reduce((a, x) => a + (+x.weight || 0) * (+x.reps || 0), 0), 0);
const setCount = (w) => w.exercises.reduce((n, e) => n + e.sets.length, 0);

function lastTime(s, name) {
  const n = name.trim().toLowerCase();
  for (const w of s.gym.history) {
    const e = w.exercises.find((x) => x.name.trim().toLowerCase() === n);
    if (e) return { when: w.endedAt, text: e.sets.map((x) => `${fmtNum(x.weight)}×${x.reps || 0}`).join(', ') };
  }
  return null;
}

/* ---------- starting / finishing ---------- */

function start(routine) {
  update((s) => {
    s.gym.active = {
      id: uid(),
      routineId: routine?.id || null,
      name: routine?.name || 'Workout',
      startedAt: Date.now(),
      current: 0,
      restEndsAt: null,
      exercises: (routine?.exercises || []).map((e) => ({
        templateId: e.id,
        name: e.name,
        reps: e.reps,
        weight: e.weight,
        rest: e.rest,
        sets: Array.from({ length: Math.max(1, +e.sets || 1) }, () => ({ weight: e.weight ?? '', reps: e.reps ?? '', done: false })),
      })),
    };
  });
  window.scrollTo(0, 0);
}

function finish() {
  const a = get().gym.active;
  const done = a.exercises.map((e) => ({ ...e, sets: e.sets.filter((x) => x.done) })).filter((e) => e.sets.length);
  if (!done.length && !confirm('No sets checked off. Discard this workout?')) return;
  update((s) => {
    if (done.length) {
      s.gym.history.unshift({ id: uid(), name: a.name, routineId: a.routineId, startedAt: a.startedAt, endedAt: Date.now(), exercises: done });
      // Progression: carry the heaviest weight you actually lifted into the routine for next time.
      const r = s.gym.routines.find((r) => r.id === a.routineId);
      if (r)
        for (const e of done) {
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

function setRow(i, k, set) {
  const edit = (field) => (ev) =>
    update((s) => (s.gym.active.exercises[i].sets[k][field] = ev.target.value === '' ? '' : +ev.target.value), { silent: true });
  return h(
    'div',
    { class: 'set-row' + (set.done ? ' done' : '') },
    h('span', { class: 'set-n' }, k + 1),
    h('label', { class: 'set-field' }, numInput('w', set.weight, { step: '0.5', oninput: edit('weight'), 'aria-label': `Set ${k + 1} weight` }), h('span', {}, 'kg')),
    h('label', { class: 'set-field' }, numInput('r', set.reps, { step: '1', inputmode: 'numeric', oninput: edit('reps'), 'aria-label': `Set ${k + 1} reps` }), h('span', {}, 'reps')),
    h(
      'button',
      {
        class: 'check' + (set.done ? ' on' : ''),
        'aria-label': set.done ? 'Undo set' : 'Complete set',
        onclick: () =>
          update((s) => {
            const a = s.gym.active;
            const ex = a.exercises[i];
            const st = ex.sets[k];
            st.done = !st.done;
            if (st.done) {
              const rest = +ex.rest || 90;
              a.restEndsAt = Date.now() + rest * 1000;
              a.restTotal = rest;
              // Finished every set? Move on to what's next.
              if (allDone(ex) && i === a.current && i < a.exercises.length - 1) a.current = i + 1;
            }
          }),
      },
      icon('check', 20)
    )
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
    const last = lastTime(s, ex.name);
    root.append(
      h(
        'section',
        { class: 'card current' },
        h('div', { class: 'eyebrow' }, `Exercise ${i + 1} of ${a.exercises.length}`),
        h('h2', { class: 'ex-name' }, ex.name),
        h('div', { class: 'muted' }, `Target ${targetLive(ex)} · rest ${ex.rest || 90}s`),
        last && h('div', { class: 'last-time' }, h('span', {}, `Last time (${fmtDay(dayKey(new Date(last.when)))})`), h('strong', {}, last.text)),
        h('div', { class: 'sets' }, ex.sets.map((set, k) => setRow(i, k, set))),
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
                  const prev = sets[sets.length - 1] || { weight: ex.weight, reps: ex.reps };
                  sets.push({ weight: prev.weight, reps: prev.reps, done: false });
                }),
            },
            icon('plus', 16),
            'Set'
          ),
          ex.sets.length > 1 && h('button', { class: 'btn small ghost', onclick: () => update((st) => st.gym.active.exercises[i].sets.pop()) }, 'Remove set')
        )
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
      h('div', { class: 'grid-4' }, field('Sets', numInput('sets', 3)), field('Reps', numInput('reps', 10)), field('kg', numInput('weight', '')), field('Rest s', numInput('rest', 90)))
    ),
    submitLabel: 'Add',
    onSubmit(fd) {
      const name = fd.get('name').trim();
      if (!name) return false;
      const e = { name, reps: +fd.get('reps') || '', weight: fd.get('weight') === '' ? '' : +fd.get('weight'), rest: +fd.get('rest') || 90 };
      update((s) => {
        const a = s.gym.active;
        a.exercises.push({ templateId: null, ...e, sets: Array.from({ length: Math.max(1, +fd.get('sets') || 1) }, () => ({ weight: e.weight, reps: e.reps, done: false })) });
        a.current = a.exercises.length - 1;
      });
    },
  });
}

/* ---------- routines ---------- */

function exerciseRow(e = {}) {
  const row = h(
    'div',
    { class: 'ex-edit' },
    h(
      'div',
      { class: 'ex-edit-top' },
      h('input', { class: 'x-name', value: e.name || '', placeholder: 'Exercise name', 'aria-label': 'Exercise name' }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove exercise', onclick: () => row.remove() }, icon('close', 18))
    ),
    h(
      'div',
      { class: 'grid-4' },
      field('Sets', numInput('', e.sets ?? 3, { class: 'x-sets' })),
      field('Reps', numInput('', e.reps ?? 10, { class: 'x-reps' })),
      field('kg', numInput('', e.weight ?? '', { class: 'x-weight' })),
      field('Rest s', numInput('', e.rest ?? 90, { class: 'x-rest' }))
    )
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
      list,
      h('button', { type: 'button', class: 'btn block', onclick: () => list.append(exerciseRow()) }, icon('plus', 18), 'Add exercise')
    ),
    onSubmit(fd, form) {
      const name = fd.get('name').trim();
      if (!name) return false;
      const exercises = [...form.querySelectorAll('.ex-edit')]
        .map((row) => ({
          id: row.dataset.id || uid(),
          name: row.querySelector('.x-name').value.trim(),
          sets: Math.max(1, +row.querySelector('.x-sets').value || 1),
          reps: +row.querySelector('.x-reps').value || '',
          weight: row.querySelector('.x-weight').value === '' ? '' : +row.querySelector('.x-weight').value,
          rest: +row.querySelector('.x-rest').value || 90,
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
      w.exercises.map((e) => h('div', { class: 'hd-ex' }, h('strong', {}, e.name), h('span', { class: 'muted' }, e.sets.map((x) => `${fmtNum(x.weight)}×${x.reps || 0}`).join(', '))))
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

function renderIdle(root, s) {
  const ws = weekStart();
  const thisWeek = s.gym.history.filter((w) => dayKey(new Date(w.startedAt)) >= ws);
  const lastByRoutine = (id) => s.gym.history.find((w) => w.routineId === id);

  root.append(
    h(
      'section',
      { class: 'stats' },
      h('div', { class: 'stat' }, h('strong', {}, thisWeek.length), h('span', {}, 'workouts this week')),
      h('div', { class: 'stat' }, h('strong', {}, fmtNum(Math.round(thisWeek.reduce((v, w) => v + volume(w), 0)))), h('span', {}, 'kg lifted this week'))
    ),
    h('h3', { class: 'section-title' }, 'Start a workout'),
    s.gym.routines.map((r) => {
      const last = lastByRoutine(r.id);
      return h(
        'section',
        { class: 'card routine' },
        h(
          'div',
          { class: 'card-head' },
          h('div', {}, h('h3', {}, r.name), h('span', { class: 'muted small' }, last ? `Last done ${fmtDay(dayKey(new Date(last.startedAt)))}` : 'Not done yet')),
          h('button', { class: 'icon-btn', 'aria-label': `Edit ${r.name}`, onclick: () => routineSheet(r) }, icon('edit', 18))
        ),
        h(
          'ul',
          { class: 'ex-preview' },
          r.exercises.map((e) => h('li', {}, h('span', {}, e.name), h('span', { class: 'muted' }, targetTpl(e))))
        ),
        h('button', { class: 'btn primary block', onclick: () => start(r) }, icon('play', 18), `Start ${r.name}`)
      );
    }),
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
  subtitle: () => (get().gym.active ? 'Workout in progress' : 'Pick a routine and go'),
  render(root) {
    const s = get();
    if (s.gym.active) renderActive(root, s);
    else renderIdle(root, s);
  },
};

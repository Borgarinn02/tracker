import { h, sheet, field, numInput, toast, icon, fmtNum } from '../ui.js';
import { get, update, uid } from '../store.js';
import { todayKey, addDays, fmtDay, parseKey } from '../dates.js';

const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
const MACROS = [
  ['protein', 'Protein', 'var(--protein)'],
  ['carbs', 'Carbs', 'var(--carbs)'],
  ['fat', 'Fat', 'var(--fat)'],
];

let viewDate = todayKey();

function guessMeal() {
  const hr = new Date().getHours();
  if (hr < 11) return 'Breakfast';
  if (hr < 15) return 'Lunch';
  if (hr >= 17 && hr < 21) return 'Dinner';
  return 'Snacks';
}

const totalsOf = (list = []) =>
  list.reduce(
    (t, e) => ({
      calories: t.calories + (+e.calories || 0),
      protein: t.protein + (+e.protein || 0),
      carbs: t.carbs + (+e.carbs || 0),
      fat: t.fat + (+e.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

/** Most recently logged unique foods, for one-tap re-logging. */
function recentFoods(s, limit = 12) {
  const seen = new Map();
  for (const k of Object.keys(s.food.log).sort().reverse()) {
    for (const e of [...s.food.log[k]].reverse()) {
      const n = e.name.trim().toLowerCase();
      if (!seen.has(n)) seen.set(n, e);
      if (seen.size >= limit) return [...seen.values()];
    }
  }
  return [...seen.values()];
}

function ring(value, goal) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = goal ? Math.min(value / goal, 1) : 0;
  const over = goal && value > goal;
  const wrap = h('div', { class: 'ring-wrap' });
  wrap.innerHTML = `<svg viewBox="0 0 120 120" class="ring" aria-hidden="true">
    <circle cx="60" cy="60" r="${r}" class="ring-track"/>
    <circle cx="60" cy="60" r="${r}" class="ring-fill${over ? ' over' : ''}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}" transform="rotate(-90 60 60)"/>
  </svg>`;
  wrap.append(h('div', { class: 'ring-label' }, h('strong', {}, fmtNum(value)), h('span', {}, `of ${fmtNum(goal)} kcal`)));
  return wrap;
}

function summaryCard(s, totals) {
  const g = s.food.goals;
  const left = g.calories - totals.calories;
  return h(
    'section',
    { class: 'card' },
    g.note && h('div', { class: 'goal-note' }, icon('target', 16), h('span', {}, g.note)),
    h(
      'div',
      { class: 'summary' },
      ring(totals.calories, g.calories),
      h(
        'div',
        { class: 'macros' },
        h('div', { class: 'left-kcal' + (left < 0 ? ' over' : '') }, h('strong', {}, fmtNum(Math.abs(left))), h('span', {}, left < 0 ? ' kcal over' : ' kcal left')),
        MACROS.map(([k, label, color]) => {
          const pct = g[k] ? Math.min(totals[k] / g[k], 1) * 100 : 0;
          return h(
            'div',
            { class: 'macro' },
            h('div', { class: 'macro-top' }, h('span', {}, label), h('span', { class: 'muted' }, `${fmtNum(totals[k])} / ${fmtNum(g[k])} g`)),
            h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: pct + '%', background: color } }))
          );
        })
      )
    )
  );
}

function weekCard(s) {
  const g = s.food.goals.calories;
  const days = Array.from({ length: 7 }, (_, i) => addDays(viewDate, i - 6));
  const vals = days.map((d) => totalsOf(s.food.log[d]).calories);
  const max = Math.max(g * 1.25, ...vals, 1);
  const logged = vals.filter(Boolean);
  const avg = logged.length ? logged.reduce((a, b) => a + b, 0) / logged.length : 0;
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, 'Last 7 days'), h('span', { class: 'muted small' }, avg ? `avg ${fmtNum(Math.round(avg))} kcal` : 'no data yet')),
    h(
      'div',
      { class: 'week' },
      h('div', { class: 'week-goal', style: { bottom: (g / max) * 100 + '%' } }),
      days.map((d, i) =>
        h(
          'button',
          { class: 'week-col' + (d === viewDate ? ' sel' : ''), onclick: () => ((viewDate = d), update(() => {})), 'aria-label': `${fmtDay(d)}: ${vals[i]} kcal` },
          h('div', { class: 'week-bar-area' }, h('div', { class: 'week-bar' + (vals[i] > g ? ' over' : ''), style: { height: (vals[i] / max) * 100 + '%' } })),
          h('span', {}, parseKey(d).toLocaleDateString(undefined, { weekday: 'narrow' }))
        )
      )
    )
  );
}

function mealsCard(s, entries) {
  if (!entries.length)
    return h('section', { class: 'card empty' }, h('p', {}, 'Nothing logged for this day yet.'), h('button', { class: 'btn primary', onclick: () => foodSheet() }, icon('plus', 18), 'Log food'));

  return h(
    'section',
    { class: 'card list-card' },
    MEALS.map((meal) => {
      const items = entries.filter((e) => e.meal === meal);
      if (!items.length) return null;
      return h(
        'div',
        { class: 'meal' },
        h('div', { class: 'meal-head' }, h('h3', {}, meal), h('span', { class: 'muted small' }, `${fmtNum(totalsOf(items).calories)} kcal`)),
        items.map((e) =>
          h(
            'button',
            { class: 'row', onclick: () => foodSheet(e) },
            h('div', { class: 'row-main' }, h('span', { class: 'row-title' }, e.name), h('span', { class: 'row-sub' }, `P ${fmtNum(e.protein)} · C ${fmtNum(e.carbs)} · F ${fmtNum(e.fat)}`)),
            h('span', { class: 'row-end' }, `${fmtNum(e.calories)}`)
          )
        )
      );
    })
  );
}

function quickAddCard(s) {
  const recent = recentFoods(s);
  if (!recent.length) return null;
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h3', {}, 'Quick add'), h('span', { class: 'muted small' }, 'tap to log again')),
    h(
      'div',
      { class: 'chips' },
      recent.map((e) =>
        h(
          'button',
          {
            class: 'chip',
            onclick: () => {
              addEntry({ name: e.name, calories: e.calories, protein: e.protein, carbs: e.carbs, fat: e.fat, meal: guessMeal() });
              toast(`Logged ${e.name}`);
            },
          },
          h('span', {}, e.name),
          h('span', { class: 'muted' }, ` ${fmtNum(e.calories)}`)
        )
      )
    )
  );
}

function addEntry(data) {
  update((s) => {
    (s.food.log[viewDate] ||= []).push({ id: uid(), time: Date.now(), ...data });
  });
}

function foodSheet(entry) {
  const s = get();
  const isNew = !entry;
  const e = entry || { name: '', meal: guessMeal(), calories: '', protein: '', carbs: '', fat: '' };
  const recent = recentFoods(s, 50);

  const nameInput = h('input', { name: 'name', value: e.name, required: true, placeholder: 'e.g. Chicken & rice', autocomplete: 'off', list: 'food-suggest' });
  const body = h(
    'div',
    { class: 'form' },
    field('Food', nameInput),
    h('datalist', { id: 'food-suggest' }, recent.map((r) => h('option', { value: r.name }))),
    field('Meal', h('select', { name: 'meal', value: e.meal }, MEALS.map((m) => h('option', { value: m }, m)))),
    h(
      'div',
      { class: 'grid-4' },
      field('kcal', numInput('calories', e.calories)),
      field('Protein', numInput('protein', e.protein)),
      field('Carbs', numInput('carbs', e.carbs)),
      field('Fat', numInput('fat', e.fat))
    )
  );

  // Picking a previously logged food fills in its numbers.
  nameInput.addEventListener('change', () => {
    const match = recent.find((r) => r.name.toLowerCase() === nameInput.value.trim().toLowerCase());
    if (!match) return;
    const form = nameInput.form;
    for (const k of ['calories', 'protein', 'carbs', 'fat']) if (!form[k].value) form[k].value = match[k] ?? '';
  });

  sheet({
    title: isNew ? `Log food · ${fmtDay(viewDate)}` : 'Edit food',
    body,
    submitLabel: isNew ? 'Add' : 'Save',
    onSubmit(fd) {
      const data = {
        name: fd.get('name').trim(),
        meal: fd.get('meal'),
        calories: +fd.get('calories') || 0,
        protein: +fd.get('protein') || 0,
        carbs: +fd.get('carbs') || 0,
        fat: +fd.get('fat') || 0,
      };
      if (!data.name) return false;
      if (isNew) addEntry(data);
      else update((st) => Object.assign(st.food.log[viewDate].find((x) => x.id === e.id), data));
    },
    danger: !isNew && {
      label: 'Delete',
      onClick: () => update((st) => (st.food.log[viewDate] = st.food.log[viewDate].filter((x) => x.id !== e.id))),
    },
  });
}

function goalsSheet() {
  const g = get().food.goals;
  sheet({
    title: 'Food goals',
    body: h(
      'div',
      { class: 'form' },
      field('Goal', h('input', { name: 'note', value: g.note, placeholder: 'e.g. Lean bulk to 85 kg by summer' })),
      field('Daily calories', numInput('calories', g.calories)),
      h('div', { class: 'grid-3' }, field('Protein g', numInput('protein', g.protein)), field('Carbs g', numInput('carbs', g.carbs)), field('Fat g', numInput('fat', g.fat)))
    ),
    onSubmit(fd) {
      update((s) => {
        s.food.goals = {
          note: fd.get('note').trim(),
          calories: +fd.get('calories') || 0,
          protein: +fd.get('protein') || 0,
          carbs: +fd.get('carbs') || 0,
          fat: +fd.get('fat') || 0,
        };
      });
    },
  });
}

const goTo = (d) => {
  viewDate = d;
  update(() => {});
};

export const foodPage = {
  title: 'Food',
  subtitle: () => parseKey(viewDate).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  actions: () => [h('button', { class: 'btn small', onclick: goalsSheet }, icon('target', 16), 'Goals')],
  render(root) {
    const s = get();
    const entries = s.food.log[viewDate] || [];
    const totals = totalsOf(entries);
    root.append(
      h(
        'div',
        { class: 'date-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => goTo(addDays(viewDate, -1)) }, icon('left')),
        h('button', { class: 'date-label', onclick: () => goTo(todayKey()) }, fmtDay(viewDate)),
        h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => goTo(addDays(viewDate, 1)) }, icon('right'))
      ),
      summaryCard(s, totals),
      mealsCard(s, entries),
      quickAddCard(s),
      weekCard(s),
      h('button', { class: 'fab', 'aria-label': 'Log food', onclick: () => foodSheet() }, icon('plus', 26))
    );
  },
};

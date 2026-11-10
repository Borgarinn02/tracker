import { h, sheet, field, icon, toast } from '../ui.js';
import { get, update, uid } from '../store.js';
import { todayKey, addDays, fmtDay, parseKey } from '../dates.js';

let viewDate = todayKey();

export const isDone = (s, id, date) => (s.daily.done[date] || []).includes(id);

export function toggleHabit(id, date) {
  let nowDone;
  update((s) => {
    const list = (s.daily.done[date] ||= []);
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    nowDone = i < 0;
    if (!list.length) delete s.daily.done[date];
  });
  const s = get();
  if (nowDone && s.daily.habits.length && s.daily.habits.every((x) => isDone(s, x.id, date))) toast('Everything done for the day!');
}

/** Consecutive days done, counting back from `from` (or from the day before, if `from` isn't checked yet). */
export function streak(s, id, from = todayKey()) {
  let d = isDone(s, id, from) ? from : addDays(from, -1);
  let n = 0;
  while (isDone(s, id, d)) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

export function habitCheck(s, x, date) {
  const on = isDone(s, x.id, date);
  return h('button', { class: 'check' + (on ? ' on' : ''), 'aria-label': on ? `Uncheck ${x.name}` : `Check ${x.name}`, onclick: () => toggleHabit(x.id, date) }, icon('check', 22));
}

function habitRow(s, x) {
  const st = streak(s, x.id, viewDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(viewDate, i - 6));
  return h(
    'div',
    { class: 'habit' + (isDone(s, x.id, viewDate) ? ' done' : '') },
    habitCheck(s, x, viewDate),
    h(
      'button',
      { class: 'habit-main', onclick: () => habitSheet(x) },
      h('span', { class: 'habit-name' }, x.name),
      x.note && h('span', { class: 'habit-note' }, x.note),
      h(
        'span',
        { class: 'habit-meta' },
        h('span', { class: 'habit-dots', 'aria-hidden': 'true' }, days.map((d) => h('i', { class: isDone(s, x.id, d) ? 'on' : '' }))),
        st > 0 && h('span', { class: 'streak' }, `${st}-day streak`)
      )
    )
  );
}

function habitSheet(habit) {
  const isNew = !habit;
  const x = habit || { name: '', note: '' };
  sheet({
    title: isNew ? 'New daily item' : 'Edit daily item',
    body: h(
      'div',
      { class: 'form' },
      field('What', h('input', { name: 'name', value: x.name, required: true, placeholder: 'e.g. Read 10 pages', autocomplete: 'off' })),
      field('Detail (optional)', h('input', { name: 'note', value: x.note, placeholder: 'e.g. 15 minutes', autocomplete: 'off' }))
    ),
    submitLabel: isNew ? 'Add' : 'Save',
    onSubmit(fd) {
      const data = { name: fd.get('name').trim(), note: fd.get('note').trim() };
      if (!data.name) return false;
      update((s) => {
        if (isNew) s.daily.habits.push({ id: uid(), ...data });
        else Object.assign(s.daily.habits.find((h) => h.id === x.id), data);
      });
    },
    danger: !isNew && {
      label: 'Delete',
      onClick: () => {
        if (!confirm(`Delete “${x.name}” and its history?`)) return false;
        update((s) => {
          s.daily.habits = s.daily.habits.filter((h) => h.id !== x.id);
          for (const [d, ids] of Object.entries(s.daily.done)) {
            s.daily.done[d] = ids.filter((id) => id !== x.id);
            if (!s.daily.done[d].length) delete s.daily.done[d];
          }
        });
      },
    },
  });
}

const goTo = (d) => {
  viewDate = d;
  update(() => {});
};

export const dailyPage = {
  title: 'Daily',
  subtitle: () => parseKey(viewDate).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  render(root) {
    const s = get();
    const habits = s.daily.habits;
    const done = habits.filter((x) => isDone(s, x.id, viewDate)).length;
    const pct = habits.length ? (done / habits.length) * 100 : 0;

    root.append(
      h(
        'div',
        { class: 'date-nav' },
        h('button', { class: 'icon-btn', 'aria-label': 'Previous day', onclick: () => goTo(addDays(viewDate, -1)) }, icon('left')),
        h('button', { class: 'date-label', onclick: () => goTo(todayKey()) }, fmtDay(viewDate)),
        h('button', { class: 'icon-btn', 'aria-label': 'Next day', onclick: () => goTo(addDays(viewDate, 1)) }, icon('right'))
      ),
      habits.length > 0 &&
        h(
          'section',
          { class: 'card daily-progress' },
          h('div', { class: 'card-head' }, h('h3', {}, done === habits.length ? 'All done' : `${done} of ${habits.length} done`), h('span', { class: 'muted small' }, `${Math.round(pct)}%`)),
          h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: pct + '%', background: 'var(--accent)' } }))
        ),
      habits.length
        ? h('section', { class: 'card list-card habits' }, habits.map((x) => habitRow(s, x)))
        : h('section', { class: 'card empty' }, h('p', {}, 'Add the things you want to do every day.'), h('button', { class: 'btn primary', onclick: () => habitSheet() }, 'Add first item')),
      h('button', { class: 'fab', 'aria-label': 'Add daily item', onclick: () => habitSheet() }, icon('plus', 26))
    );
  },
};

import { h, icon, fmtNum } from '../ui.js';
import { get, update } from '../store.js';
import { todayKey, addDays, greeting, fmtDuration } from '../dates.js';
import { slotFor, workoutOn } from '../schedule.js';
import { start } from './gym.js';
import { isDone, habitCheck } from './daily.js';

const go = (page) => (location.hash = page);

const cardHead = (title, page, extra) =>
  h('div', { class: 'card-head' }, h('h3', {}, title), h('button', { class: 'btn small ghost', onclick: () => go(page) }, extra || 'Open', icon('right', 16)));

function gymCard(s, today) {
  const a = s.gym.active;
  if (a)
    return h(
      'section',
      { class: 'card home-gym live' },
      h('div', { class: 'eyebrow' }, 'Workout in progress'),
      h('h2', {}, a.name),
      h('p', { class: 'muted' }, h('span', { 'data-elapsed': a.startedAt }, fmtDuration(Date.now() - a.startedAt)), ' elapsed'),
      h('button', { class: 'btn primary block', onclick: () => go('gym') }, 'Continue workout')
    );

  const slot = slotFor(s, today);
  const done = workoutOn(s, today);
  const next = slotFor(s, addDays(today, 1));
  const nextName = next ? (next.rest ? 'Rest day' : next.routine.name) : null;

  let title, sub, action;
  if (!slot) [title, sub] = ['No program yet', 'Set up your gym program'];
  else if (slot.skipped) [title, sub] = ['Skipped today', `${slot.rest ? 'Rest day' : slot.routine.name} moved to tomorrow`];
  else if (slot.rest) [title, sub] = ['Rest day', `Tomorrow: ${nextName}`];
  else if (done) [title, sub] = [`${slot.routine.name} ✓`, `Done. Tomorrow: ${nextName}`];
  else {
    [title, sub] = [`${slot.routine.name} day`, `${slot.routine.exercises.length} exercises · tomorrow: ${nextName}`];
    action = h(
      'button',
      {
        class: 'btn primary block',
        onclick: () => {
          go('gym');
          start(slot.routine);
        },
      },
      icon('play', 18),
      `Start ${slot.routine.name}`
    );
  }

  return h('section', { class: 'card home-gym' }, cardHead('Gym', 'gym'), h('h2', {}, title), h('p', { class: 'muted' }, sub), action);
}

function dailyCard(s, today) {
  const habits = s.daily.habits;
  if (!habits.length) return null;
  const done = habits.filter((x) => isDone(s, x.id, today)).length;
  return h(
    'section',
    { class: 'card' },
    cardHead('Daily', 'daily', `${done}/${habits.length}`),
    h(
      'div',
      { class: 'home-list' },
      habits.map((x) =>
        h('div', { class: 'habit compact' + (isDone(s, x.id, today) ? ' done' : '') }, habitCheck(s, x, today), h('span', { class: 'habit-name' }, x.name, x.note && h('span', { class: 'muted' }, ` · ${x.note}`)))
      )
    )
  );
}

function foodCard(s, today) {
  const g = s.food.goals;
  const list = s.food.log[today] || [];
  const kcal = list.reduce((a, e) => a + (+e.calories || 0), 0);
  const protein = list.reduce((a, e) => a + (+e.protein || 0), 0);
  const pct = g.calories ? Math.min(kcal / g.calories, 1) * 100 : 0;
  return h(
    'section',
    { class: 'card' },
    cardHead('Food', 'food'),
    h('div', { class: 'home-food' }, h('strong', {}, fmtNum(kcal)), h('span', { class: 'muted' }, ` / ${fmtNum(g.calories)} kcal`), h('span', { class: 'muted small home-protein' }, `${fmtNum(protein)} / ${fmtNum(g.protein)} g protein`)),
    h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: { width: pct + '%', background: kcal > g.calories ? 'var(--danger)' : 'var(--accent)' } }))
  );
}

function tasksCard(s, today) {
  const tasks = s.projects.tasks.filter((t) => !t.done && t.date && t.date <= today).sort((a, b) => a.date.localeCompare(b.date) || (a.time || '').localeCompare(b.time || ''));
  return h(
    'section',
    { class: 'card' },
    cardHead('Today’s tasks', 'projects'),
    tasks.length
      ? h(
          'div',
          { class: 'home-list' },
          tasks.slice(0, 5).map((t) =>
            h(
              'div',
              { class: 'habit compact' },
              h('button', { class: 'check', 'aria-label': `Complete ${t.title}`, onclick: () => update((st) => (st.projects.tasks.find((x) => x.id === t.id).done = true)) }, icon('check', 18)),
              h('span', { class: 'habit-name' }, t.title, t.date < today && h('span', { class: 'danger-text small' }, ' · overdue'), t.time && h('span', { class: 'muted' }, ` · ${t.time}`))
            )
          ),
          tasks.length > 5 && h('p', { class: 'muted small' }, `+${tasks.length - 5} more`)
        )
      : h('p', { class: 'muted small' }, 'Nothing due today.')
  );
}

export const homePage = {
  title: () => greeting(),
  navLabel: 'Home',
  subtitle: () => new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
  render(root) {
    const s = get();
    const today = todayKey();
    root.append(gymCard(s, today), dailyCard(s, today), foodCard(s, today), tasksCard(s, today));
  },
};

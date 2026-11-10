import { h, sheet, field, icon } from '../ui.js';
import { get, update, uid, COLORS } from '../store.js';
import { todayKey, fmtDay, parseKey, dayKey } from '../dates.js';

let cursor = todayKey().slice(0, 7); // "YYYY-MM" month shown in the calendar
let selected = todayKey();
const expanded = new Set();

const INBOX = { id: null, name: 'Inbox', color: 'var(--muted)' };
const projectOf = (s, id) => s.projects.list.find((p) => p.id === id) || INBOX;
const byDateTime = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.time || '99').localeCompare(b.time || '99');

function shiftMonth(n) {
  const [y, m] = cursor.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  cursor = dayKey(d).slice(0, 7);
  update(() => {});
}

/* ---------- calendar ---------- */

function calendar(s) {
  const [y, m] = cursor.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const offset = (first.getDay() + 6) % 7; // Monday first
  const daysIn = new Date(y, m, 0).getDate();
  const today = todayKey();

  const tasksOn = {};
  for (const t of s.projects.tasks) if (t.date) (tasksOn[t.date] ||= []).push(t);
  const workoutDays = new Set(s.gym.history.map((w) => dayKey(new Date(w.startedAt))));

  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'narrow' }));

  const cells = [];
  for (let i = 0; i < offset; i++) cells.push(h('div', { class: 'cal-cell blank' }));
  for (let d = 1; d <= daysIn; d++) {
    const key = `${cursor}-${String(d).padStart(2, '0')}`;
    const tasks = tasksOn[key] || [];
    cells.push(
      h(
        'button',
        {
          class: ['cal-cell', key === today && 'today', key === selected && 'sel', workoutDays.has(key) && 'gym'].filter(Boolean).join(' '),
          onclick: () => {
            selected = key;
            update(() => {});
          },
          'aria-label': `${fmtDay(key)}${tasks.length ? `, ${tasks.length} tasks` : ''}`,
        },
        h('span', { class: 'cal-num' }, d),
        h(
          'span',
          { class: 'cal-dots' },
          tasks.slice(0, 3).map((t) => h('i', { class: t.done ? 'dim' : '', style: { background: projectOf(s, t.projectId).color } }))
        )
      )
    );
  }

  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'cal-head' },
      h('button', { class: 'icon-btn', 'aria-label': 'Previous month', onclick: () => shiftMonth(-1) }, icon('left')),
      h('button', {
        class: 'cal-title',
        onclick: () => {
          cursor = today.slice(0, 7);
          selected = today;
          update(() => {});
        },
      }, first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
      h('button', { class: 'icon-btn', 'aria-label': 'Next month', onclick: () => shiftMonth(1) }, icon('right'))
    ),
    h('div', { class: 'cal-grid cal-wd' }, weekdays.map((w) => h('span', {}, w))),
    h('div', { class: 'cal-grid' }, cells),
    h('div', { class: 'cal-legend muted small' }, h('span', { class: 'lg-gym' }), 'workout day')
  );
}

/* ---------- tasks ---------- */

function taskRow(s, t, { showProject = true, showDate = false } = {}) {
  const p = projectOf(s, t.projectId);
  const meta = [showDate && t.date && fmtDay(t.date), t.time].filter(Boolean).join(' · ');
  return h(
    'div',
    { class: 'task' + (t.done ? ' done' : '') },
    h(
      'button',
      {
        class: 'check' + (t.done ? ' on' : ''),
        'aria-label': t.done ? 'Mark not done' : 'Mark done',
        onclick: () =>
          update((st) => {
            const x = st.projects.tasks.find((x) => x.id === t.id);
            x.done = !x.done;
          }),
      },
      icon('check', 18)
    ),
    h(
      'button',
      { class: 'task-main', onclick: () => taskSheet(t) },
      h('span', { class: 'task-title' }, t.title),
      (meta || showProject) &&
        h(
          'span',
          { class: 'task-meta' },
          meta && h('span', {}, meta),
          showProject && t.projectId && h('span', { class: 'tag' }, h('i', { style: { background: p.color } }), p.name)
        )
    )
  );
}

function agenda(s) {
  const today = todayKey();
  const due = s.projects.tasks.filter((t) => t.date === selected).sort(byDateTime);
  const overdue = selected === today ? s.projects.tasks.filter((t) => t.date && t.date < today && !t.done).sort(byDateTime) : [];
  const workouts = s.gym.history.filter((w) => dayKey(new Date(w.startedAt)) === selected);

  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h3', {}, fmtDay(selected, { weekday: 'long', day: 'numeric', month: 'long' })),
      h('button', { class: 'btn small', onclick: () => taskSheet(null, { date: selected }) }, icon('plus', 16), 'Task')
    ),
    overdue.length > 0 && h('div', { class: 'overdue' }, h('div', { class: 'eyebrow danger-text' }, 'Overdue'), overdue.map((t) => taskRow(s, t, { showDate: true }))),
    workouts.map((w) => h('div', { class: 'agenda-gym' }, icon('gym', 18), h('span', {}, `${w.name} workout`))),
    due.length ? due.map((t) => taskRow(s, t)) : !overdue.length && !workouts.length && h('p', { class: 'muted small pad' }, 'Nothing planned.')
  );
}

function projectCard(s, p) {
  const tasks = s.projects.tasks.filter((t) => t.projectId === p.id);
  const done = tasks.filter((t) => t.done).length;
  const key = p.id ?? 'inbox';
  const open = expanded.has(key);
  const sorted = [...tasks].sort((a, b) => a.done - b.done || byDateTime(a, b));

  return h(
    'section',
    { class: 'card project' + (open ? ' open' : '') },
    h(
      'button',
      {
        class: 'project-head',
        'aria-expanded': String(open),
        onclick: () => {
          open ? expanded.delete(key) : expanded.add(key);
          update(() => {});
        },
      },
      h('i', { class: 'swatch', style: { background: p.color } }),
      h('div', { class: 'project-info' }, h('strong', {}, p.name), h('span', { class: 'muted small' }, tasks.length ? `${done} of ${tasks.length} done` : 'No tasks yet')),
      h('div', { class: 'bar slim' }, h('div', { class: 'bar-fill', style: { width: tasks.length ? (done / tasks.length) * 100 + '%' : '0', background: p.color } }))
    ),
    open &&
      h(
        'div',
        { class: 'project-body' },
        p.notes && h('p', { class: 'muted small' }, p.notes),
        sorted.map((t) => taskRow(s, t, { showProject: false, showDate: true })),
        h(
          'div',
          { class: 'row-btns' },
          h('button', { class: 'btn small', onclick: () => taskSheet(null, { projectId: p.id }) }, icon('plus', 16), 'Task'),
          p.id && h('button', { class: 'btn small ghost', onclick: () => projectSheet(p) }, icon('edit', 16), 'Edit project')
        )
      )
  );
}

/* ---------- sheets ---------- */

function taskSheet(task, defaults = {}) {
  const s = get();
  const isNew = !task;
  const t = task || { title: '', projectId: null, date: '', time: '', ...defaults };
  sheet({
    title: isNew ? 'New task' : 'Edit task',
    body: h(
      'div',
      { class: 'form' },
      field('Task', h('input', { name: 'title', value: t.title, required: true, placeholder: 'What needs doing?', autocomplete: 'off' })),
      field(
        'Project',
        h('select', { name: 'projectId', value: t.projectId || '' }, h('option', { value: '' }, 'Inbox (no project)'), s.projects.list.map((p) => h('option', { value: p.id }, p.name)))
      ),
      h('div', { class: 'grid-2' }, field('Date', h('input', { type: 'date', name: 'date', value: t.date || '' })), field('Time', h('input', { type: 'time', name: 'time', value: t.time || '' })))
    ),
    submitLabel: isNew ? 'Add' : 'Save',
    onSubmit(fd) {
      const data = { title: fd.get('title').trim(), projectId: fd.get('projectId') || null, date: fd.get('date') || '', time: fd.get('time') || '' };
      if (!data.title) return false;
      update((st) => {
        if (isNew) st.projects.tasks.push({ id: uid(), done: false, createdAt: Date.now(), ...data });
        else Object.assign(st.projects.tasks.find((x) => x.id === t.id), data);
      });
    },
    danger: !isNew && { label: 'Delete', onClick: () => update((st) => (st.projects.tasks = st.projects.tasks.filter((x) => x.id !== t.id))) },
  });
}

function projectSheet(project) {
  const isNew = !project;
  const p = project || { name: '', color: COLORS[get().projects.list.length % COLORS.length], notes: '' };
  sheet({
    title: isNew ? 'New project' : 'Edit project',
    body: h(
      'div',
      { class: 'form' },
      field('Name', h('input', { name: 'name', value: p.name, required: true, placeholder: 'e.g. Portfolio site' })),
      h(
        'fieldset',
        { class: 'swatches' },
        h('legend', {}, 'Color'),
        COLORS.map((c) => h('label', { class: 'swatch-pick', style: { background: c } }, h('input', { type: 'radio', name: 'color', value: c, checked: c === p.color, 'aria-label': c })))
      ),
      field('Notes', h('textarea', { name: 'notes', rows: 3, placeholder: 'Goal, links, anything…' }, p.notes))
    ),
    submitLabel: isNew ? 'Create' : 'Save',
    onSubmit(fd) {
      const data = { name: fd.get('name').trim(), color: fd.get('color') || p.color, notes: fd.get('notes').trim() };
      if (!data.name) return false;
      update((st) => {
        if (isNew) {
          const id = uid();
          st.projects.list.push({ id, ...data });
          expanded.add(id);
        } else Object.assign(st.projects.list.find((x) => x.id === p.id), data);
      });
    },
    danger: !isNew && {
      label: 'Delete',
      onClick: () => {
        if (!confirm(`Delete “${p.name}”? Its tasks move to the Inbox.`)) return false;
        update((st) => {
          st.projects.list = st.projects.list.filter((x) => x.id !== p.id);
          st.projects.tasks.forEach((t) => t.projectId === p.id && (t.projectId = null));
        });
      },
    },
  });
}

export const projectsPage = {
  title: 'Projects',
  subtitle: () => {
    const open = get().projects.tasks.filter((t) => !t.done).length;
    return `${open} open task${open === 1 ? '' : 's'}`;
  },
  actions: () => [h('button', { class: 'btn small', onclick: () => projectSheet() }, icon('plus', 16), 'Project')],
  render(root) {
    const s = get();
    const hasInbox = s.projects.tasks.some((t) => !t.projectId);
    root.append(
      calendar(s),
      agenda(s),
      h('h3', { class: 'section-title' }, 'Projects'),
      s.projects.list.map((p) => projectCard(s, p)),
      hasInbox && projectCard(s, INBOX),
      !s.projects.list.length && h('section', { class: 'card empty' }, h('p', {}, 'No projects yet.'), h('button', { class: 'btn primary', onclick: () => projectSheet() }, 'Create a project')),
      h('button', { class: 'fab', 'aria-label': 'New task', onclick: () => taskSheet(null, { date: selected }) }, icon('plus', 26))
    );
  },
};

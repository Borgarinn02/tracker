import './style.css';
import { h, icon, sheet, toast } from './ui.js';
import { get, update, subscribe, replace, resetAll } from './store.js';
import { fmtDuration, todayKey } from './dates.js';
import { foodPage } from './pages/food.js';
import { gymPage } from './pages/gym.js';
import { projectsPage } from './pages/projects.js';

const PAGES = { food: foodPage, gym: gymPage, projects: projectsPage };
const ORDER = ['food', 'gym', 'projects'];

const $ = (id) => document.getElementById(id);
const view = $('view');

function currentPage() {
  const k = location.hash.slice(1);
  if (PAGES[k]) return k;
  return get().gym.active ? 'gym' : 'food'; // mid-workout? open straight to it
}

/* ---------- nav ---------- */

$('nav').append(
  ...ORDER.map((k) =>
    h('a', { href: `#${k}`, class: 'nav-item', 'data-page': k }, icon(k, 24), h('span', {}, PAGES[k].title))
  )
);

/* ---------- render ---------- */

let lastPage = null;
function render() {
  const key = currentPage();
  const page = PAGES[key];
  const y = key === lastPage ? window.scrollY : 0;

  $('title').textContent = page.title;
  $('subtitle').textContent = page.subtitle?.() || '';
  $('actions').replaceChildren(
    ...(page.actions?.() || []),
    h('button', { class: 'icon-btn', 'aria-label': 'Settings', onclick: settingsSheet }, icon('settings'))
  );
  view.replaceChildren();
  // Pages pass arrays / conditional (null/false) children; flatten and drop the empties.
  page.render({ append: (...c) => view.append(...c.flat(Infinity).filter((x) => x != null && x !== false)) });

  for (const a of document.querySelectorAll('.nav-item')) a.classList.toggle('active', a.dataset.page === key);
  $('nav').querySelector('[data-page="gym"]').classList.toggle('live', !!get().gym.active);

  window.scrollTo(0, y);
  lastPage = key;
  tick();
}

window.addEventListener('hashchange', render);
subscribe(render);

/* ---------- rest timer + live clocks ---------- */

let audio;
document.addEventListener('pointerdown', () => {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
  } catch {}
}, { once: true });

function beep() {
  if (!audio) return;
  const t = audio.currentTime;
  for (const [i, f] of [880, 1175].entries()) {
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.18);
    g.gain.exponentialRampToValueAtTime(0.3, t + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.16);
    o.connect(g).connect(audio.destination);
    o.start(t + i * 0.18);
    o.stop(t + i * 0.18 + 0.18);
  }
}

const restBar = $('rest-bar');
restBar.append(
  h('div', { class: 'rest-progress' }),
  h('div', { class: 'rest-info' }, h('span', { class: 'eyebrow' }, 'Rest'), h('strong', { class: 'rest-time' }, '0:00')),
  h(
    'div',
    { class: 'rest-btns' },
    h('button', { class: 'btn small', onclick: () => adjustRest(-15) }, '−15'),
    h('button', { class: 'btn small', onclick: () => adjustRest(15) }, '+15'),
    h('button', { class: 'btn small primary', onclick: () => update((s) => (s.gym.active.restEndsAt = null)) }, 'Skip')
  )
);

function adjustRest(sec) {
  update((s) => {
    const a = s.gym.active;
    a.restEndsAt = Math.max(Date.now() + 1000, a.restEndsAt + sec * 1000);
    a.restTotal = Math.max(1, (a.restTotal || 90) + sec);
  });
}

function tick() {
  const now = Date.now();
  for (const el of document.querySelectorAll('[data-elapsed]')) el.textContent = fmtDuration(now - +el.dataset.elapsed);

  const a = get().gym.active;
  if (a?.restEndsAt) {
    const left = a.restEndsAt - now;
    if (left <= 0) {
      update((s) => (s.gym.active.restEndsAt = null), { silent: true });
      restBar.hidden = true;
      document.body.classList.remove('resting');
      if (left > -5000) {
        // only alert if we were actually watching it run out
        navigator.vibrate?.([200, 100, 200]);
        beep();
        toast('Rest over. Next set!');
      }
      return;
    }
    restBar.hidden = false;
    document.body.classList.add('resting');
    restBar.querySelector('.rest-time').textContent = fmtDuration(left);
    restBar.querySelector('.rest-progress').style.width = `${(1 - left / ((a.restTotal || 90) * 1000)) * 100}%`;
  } else {
    restBar.hidden = true;
    document.body.classList.remove('resting');
  }
}
setInterval(tick, 250);

/* ---------- settings / backup ---------- */

function settingsSheet() {
  const fileInput = h('input', {
    type: 'file',
    accept: 'application/json,.json',
    hidden: true,
    onchange: async () => {
      const file = fileInput.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data.food || !data.gym || !data.projects) throw new Error('not a tracker backup');
        if (!confirm('Replace everything on this device with the backup?')) return;
        replace(data);
        close();
        toast('Backup restored');
      } catch (e) {
        alert(`Couldn't import that file: ${e.message}`);
      }
    },
  });

  const close = sheet({
    title: 'Settings',
    body: h(
      'div',
      { class: 'form' },
      h('p', { class: 'muted small' }, 'Your data is saved on this device only. Export a backup to move it between your phone and computer.'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn block',
          onclick: () => {
            const blob = new Blob([JSON.stringify(get(), null, 2)], { type: 'application/json' });
            const a = h('a', { href: URL.createObjectURL(blob), download: `tracker-backup-${todayKey()}.json` });
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          },
        },
        'Export backup'
      ),
      h('button', { type: 'button', class: 'btn block', onclick: () => fileInput.click() }, 'Import backup'),
      fileInput,
      h('h3', { class: 'section-title' }, 'Put it on your phone'),
      h(
        'ul',
        { class: 'muted small tips' },
        h('li', {}, 'iPhone: open the site in Safari → Share → Add to Home Screen.'),
        h('li', {}, 'Android: open in Chrome → ⋮ menu → Install app / Add to Home screen. Long-press the icon for shortcuts.')
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn block danger',
          onclick: () => {
            if (!confirm('Erase ALL data on this device? This cannot be undone.')) return;
            resetAll();
            close();
          },
        },
        'Erase all data'
      )
    ),
    submitLabel: 'Done',
  });
}

/* ---------- boot ---------- */

render();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e));
}

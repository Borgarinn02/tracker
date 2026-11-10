import './style.css';
import { h, icon, sheet, toast } from './ui.js';
import { get, update, subscribe, replace, resetAll } from './store.js';
import { fmtDuration, todayKey } from './dates.js';
import { initSync, syncState, onSyncChange, signIn, signUp, signOut, syncNow } from './sync.js';
import { foodPage } from './pages/food.js';
import { gymPage } from './pages/gym.js';
import { projectsPage } from './pages/projects.js';
import { dailyPage } from './pages/daily.js';
import { homePage } from './pages/home.js';

const PAGES = { food: foodPage, daily: dailyPage, home: homePage, gym: gymPage, projects: projectsPage };
const ORDER = ['food', 'daily', 'home', 'gym', 'projects'];
const val = (v) => (typeof v === 'function' ? v() : v);

const $ = (id) => document.getElementById(id);
const view = $('view');

function currentPage() {
  const k = location.hash.slice(1);
  return PAGES[k] ? k : 'home';
}

/* ---------- nav ---------- */

$('nav').append(
  ...ORDER.map((k) =>
    h('a', { href: `#${k}`, class: 'nav-item', 'data-page': k }, icon(k, 24), h('span', {}, PAGES[k].navLabel || PAGES[k].title))
  )
);

/* ---------- render ---------- */

let lastPage = null;
function render() {
  const key = currentPage();
  const page = PAGES[key];
  const y = key === lastPage ? window.scrollY : 0;

  $('title').textContent = val(page.title);
  $('subtitle').textContent = val(page.subtitle) || '';
  $('actions').replaceChildren(
    ...(page.actions?.() || []),
    h('button', { class: 'icon-btn sync-ind', 'aria-label': 'Settings', 'data-sync': syncState().status, onclick: settingsSheet }, icon('settings'))
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
  if (lastPage) $('title').textContent = val(PAGES[lastPage].title); // keeps the greeting current if the app stays open

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
      h('h3', { class: 'section-title' }, 'Cloud sync'),
      syncSection(),
      h('h3', { class: 'section-title' }, 'Backup file'),
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
            const where = syncState().signedIn ? 'on this device AND in the cloud (all synced devices)' : 'on this device';
            if (!confirm(`Erase ALL data ${where}? This cannot be undone.`)) return;
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

/* ---------- cloud sync UI ---------- */

function ago(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString();
}

function statusText(st) {
  if (st.status === 'syncing') return 'Syncing…';
  if (st.status === 'offline') return 'Offline. Changes are saved here and will sync when you’re back online.';
  if (st.status === 'error') return `Sync problem: ${st.lastError}`;
  return st.lastSync ? `Synced ${ago(st.lastSync)}` : 'Connected';
}

function syncSection() {
  const box = h('div', { class: 'sync-box' });
  const draw = () => {
    if (!document.body.contains(box) && box.dataset.drawn) return off();
    box.dataset.drawn = '1';
    const st = syncState();

    if (!st.configured) {
      box.replaceChildren(h('p', { class: 'muted small' }, 'Cloud sync isn’t connected to a Supabase project yet. Until then, data is saved on this device only.'));
      return;
    }

    if (st.signedIn) {
      box.replaceChildren(
        h('div', { class: 'sync-status' }, h('span', { class: `sync-dot ${st.status}` }), h('div', { class: 'sync-text' }, h('strong', {}, st.email), h('span', { class: 'muted small' }, statusText(st)))),
        h(
          'div',
          { class: 'row-btns' },
          h('button', { type: 'button', class: 'btn small', onclick: () => syncNow() }, 'Sync now'),
          h('button', { type: 'button', class: 'btn small ghost', onclick: async () => confirm('Sign out? Your data stays on this device but stops syncing.') && (await signOut()) }, 'Sign out')
        )
      );
      return;
    }

    const email = h('input', { type: 'email', placeholder: 'Email', autocomplete: 'username', 'aria-label': 'Email' });
    const pass = h('input', { type: 'password', placeholder: 'Password (6+ characters)', autocomplete: 'current-password', 'aria-label': 'Password' });
    const msg = h('p', { class: 'small muted' }, 'Sign in to back up your data and keep your phone and computer in sync.');
    const run = async (fn, btn) => {
      if (!email.value || pass.value.length < 6) return (msg.textContent = 'Enter your email and a password of at least 6 characters.');
      btn.disabled = true;
      msg.textContent = 'Working…';
      try {
        const res = await fn(email.value.trim(), pass.value);
        if (res === 'confirm') msg.textContent = 'Account created! Check your email and tap the confirmation link, then come back here and Sign in.';
        else toast('Signed in, sync is on');
      } catch (e) {
        msg.textContent = e.message;
      } finally {
        btn.disabled = false;
      }
    };
    const signInBtn = h('button', { type: 'button', class: 'btn primary', onclick: () => run(signIn, signInBtn) }, 'Sign in');
    const signUpBtn = h('button', { type: 'button', class: 'btn', onclick: () => run(signUp, signUpBtn) }, 'Create account');
    for (const el of [email, pass])
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          run(signIn, signInBtn);
        }
      });
    box.replaceChildren(msg, email, pass, h('div', { class: 'grid-2' }, signInBtn, signUpBtn));
  };
  const off = onSyncChange(draw);
  draw();
  return box;
}

// Little dot on the settings button: green = synced, amber = working/offline, red = problem.
onSyncChange(() => {
  const btn = document.querySelector('[aria-label="Settings"]');
  if (btn) btn.dataset.sync = syncState().status;
});

/* ---------- boot ---------- */

render();
initSync().catch((e) => console.warn('Sync init failed', e));

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW failed', e));
}

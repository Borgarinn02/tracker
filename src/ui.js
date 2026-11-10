/** Tiny element builder: h('div', { class: 'x', onclick }, child, ...) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'value') value = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (typeof v !== 'string' && k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  if (value !== undefined) el.value = value; // after children so <select> picks the option
  return el;
}

const ICONS = {
  food: '<path d="M4 11h16a8 8 0 0 1-16 0Z"/><path d="M9 7c0-1.2 1-1.8 1-3M14 7c0-1.2 1-1.8 1-3"/>',
  gym: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11"/>',
  home: '<path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1v-8.5Z"/>',
  daily: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  projects: '<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8.5 3v4M15.5 3v4"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  left: '<path d="m14.5 6-6 6 6 6"/>',
  right: '<path d="m9.5 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/>',
  play: '<path d="M8 5.5v13l10-6.5-10-6.5Z"/>',
};

export function icon(name, size = 22) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  return span;
}

export const field = (label, input, cls = '') => h('label', { class: `field ${cls}` }, h('span', {}, label), input);

export const numInput = (name, value, extra = {}) =>
  h('input', { type: 'number', name, value: value ?? '', inputmode: 'decimal', step: 'any', min: '0', ...extra });

/**
 * Bottom sheet with a form. onSubmit(formData, form) — return false to keep it open.
 * Returns a close() function.
 */
export function sheet({ title, body, onSubmit, submitLabel = 'Save', danger, secondary }) {
  const overlay = h('div', { class: 'overlay' });
  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => overlay.remove(), 180);
  };
  const form = h(
    'form',
    {
      class: 'sheet',
      onsubmit: (e) => {
        e.preventDefault();
        if (!onSubmit || onSubmit(new FormData(form), form) !== false) close();
      },
    },
    h('div', { class: 'sheet-grip' }),
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('close'))),
    h('div', { class: 'sheet-body' }, body),
    h(
      'div',
      { class: 'sheet-actions' },
      danger && h('button', { type: 'button', class: 'btn danger', onclick: () => danger.onClick() !== false && close() }, danger.label),
      secondary && h('button', { type: 'button', class: 'btn', onclick: () => secondary.onClick() !== false && close() }, secondary.label),
      h('button', { type: 'submit', class: 'btn primary' }, submitLabel)
    )
  );
  overlay.append(form);
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  return close;
}

let toastTimer;
export function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

export const fmtNum = (n) => (Math.round((+n || 0) * 10) / 10).toLocaleString();

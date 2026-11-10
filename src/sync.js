/**
 * Cloud sync via Supabase.
 *
 * The whole app state is stored as one JSON row per user. Rules:
 * - Every local change marks this device "dirty" and uploads ~1.5s later.
 * - On open / when the app comes back to the foreground / every minute, we check the cloud.
 *   If the cloud copy is newer and we have nothing unsent, we take it.
 *   If both changed, the most recent edit wins.
 * - Offline? Changes stay saved on the device and upload when the connection returns.
 */
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { get, replace, onSave } from './store.js';

const META_KEY = 'tracker:sync';
const TABLE = 'tracker_state';

export const configured = Boolean(SUPABASE_URL && SUPABASE_KEY);
const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } })
  : null;

let meta = loadMeta(); // { remoteAt, dirty, editedAt, lastSync }
let session = null;
let status = configured ? 'off' : 'unconfigured'; // off | idle | syncing | offline | error | unconfigured
let lastError = '';
let localRev = 0;
const listeners = new Set();

function loadMeta() {
  try {
    return JSON.parse(localStorage.getItem(META_KEY)) || {};
  } catch {
    return {};
  }
}
function saveMeta() {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {}
}

function setStatus(s, err = '') {
  status = s;
  lastError = err;
  listeners.forEach((f) => f());
}

export const syncState = () => ({ configured, status, lastError, lastSync: meta.lastSync, email: session?.user?.email || null, signedIn: !!session });
export function onSyncChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function fail(error) {
  const offline = !navigator.onLine || /fetch|network/i.test(error?.message || '');
  setStatus(offline ? 'offline' : 'error', error?.message || String(error));
}

// Run sync operations one at a time.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn, fn));

/* ---------- local changes → cloud ---------- */

onSave(({ local }) => {
  if (!local) return;
  localRev++;
  meta.dirty = true;
  meta.editedAt = new Date().toISOString();
  saveMeta();
  schedulePush();
});

let pushTimer;
function schedulePush(delay = 1500) {
  clearTimeout(pushTimer);
  if (session) pushTimer = setTimeout(push, delay);
}

function push() {
  return serial(async () => {
    if (!session || !meta.dirty) return;
    setStatus('syncing');
    const rev = localRev;
    const now = new Date().toISOString();
    const { error } = await sb.from(TABLE).upsert({ user_id: session.user.id, data: get(), updated_at: now });
    if (error) return fail(error);
    if (rev === localRev) meta.dirty = false; // nothing new happened while uploading
    meta.remoteAt = now;
    meta.lastSync = Date.now();
    saveMeta();
    setStatus('idle');
    if (meta.dirty) schedulePush();
  });
}

/* ---------- cloud → this device ---------- */

async function fetchRemote() {
  return sb.from(TABLE).select('data, updated_at').eq('user_id', session.user.id).maybeSingle();
}

function adopt(row) {
  replace(row.data, { fromSync: true });
  meta.remoteAt = row.updated_at;
  meta.dirty = false;
  meta.lastSync = Date.now();
  saveMeta();
}

export function pull() {
  return serial(async () => {
    if (!session) return;
    setStatus('syncing');
    const { data: row, error } = await fetchRemote();
    if (error) return fail(error);

    if (!row) {
      meta.dirty = true; // cloud is empty: upload what we have
      saveMeta();
    } else if (!meta.remoteAt || new Date(row.updated_at) > new Date(meta.remoteAt)) {
      // Someone (the other device) uploaded since we last synced.
      const remoteWins = !meta.dirty || new Date(row.updated_at) > new Date(meta.editedAt || 0);
      if (remoteWins) adopt(row);
    } else {
      meta.lastSync = Date.now();
      saveMeta();
    }
    setStatus('idle');
    if (meta.dirty) schedulePush(0);
  });
}

/** First sync after signing in on a device: ask which copy to keep if both exist. */
function firstSync() {
  return serial(async () => {
    setStatus('syncing');
    const { data: row, error } = await fetchRemote();
    if (error) return fail(error);
    if (
      row &&
      confirm(
        `You have data in the cloud (last saved ${new Date(row.updated_at).toLocaleString()}).\n\n` +
          'OK = load the cloud data onto this device (replaces what is here now).\n' +
          'Cancel = keep this device’s data and upload it to the cloud instead.'
      )
    ) {
      adopt(row);
    } else {
      meta.dirty = true;
      saveMeta();
    }
    setStatus('idle');
  }).then(() => push());
}

/* ---------- account ---------- */

export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  session = data.session;
  await firstSync();
}

/** Returns 'confirm' when Supabase wants the email address confirmed first. */
export async function signUp(email, password) {
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.session) return 'confirm';
  session = data.session;
  await firstSync();
  return 'ok';
}

export async function signOut() {
  if (meta.dirty) await push();
  await sb.auth.signOut();
  session = null;
  meta = {};
  saveMeta();
  setStatus('off');
}

export const syncNow = () => (meta.dirty ? push() : pull());

/* ---------- boot ---------- */

export async function initSync() {
  if (!configured) return;
  const { data } = await sb.auth.getSession();
  session = data.session;
  sb.auth.onAuthStateChange((_event, s) => {
    session = s;
    if (!s) setStatus('off');
  });
  // These all no-op until signed in.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull();
    else if (meta.dirty) push(); // app going to background: upload now
  });
  window.addEventListener('online', () => pull());
  setInterval(() => document.visibilityState === 'visible' && pull(), 60_000);

  if (!session) return setStatus('off');
  setStatus('idle');
  pull();
}

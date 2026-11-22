// Saving to Google Drive, so a person's games and bests follow them from device to device.
// The page keeps working from localStorage exactly as before. When someone turns this on, what matters across devices
// goes into one small file in a "Pin Drop" folder in their own Google Drive, and what their other devices saved there is
// merged in game by game (merge in store.js): every finished game with its balls, the best and each player's best, the
// players set up on the title, the lessons each has been shown, the ball each player picked and the balls they've
// earned, and Forget these scores. The sound and a game in
// progress stay on each device. Nothing about this shows away from pin-drop.junkdrawer.works.
import { KEY, parse, merge } from './store.js';

// The junkdrawer.works OAuth client, shared by every junkdrawer.works project. Google only accepts it from the
// addresses it lists, so anywhere else (localhost, the one-file copy) nothing about Drive shows.
const ORIGINS = ['https://pin-drop.junkdrawer.works'];
const CLIENT_ID = ORIGINS.includes(location.origin) ? '897653851078-p5jrh2bto6h3bj0lc4jist3k1vsc1pj4.apps.googleusercontent.com' : '';
// drive.file, like every junkdrawer.works project: Google lets them see only the files they made. Ours are one folder
// and one file in it, found by their appProperties, never by name.
const SCOPE = 'https://www.googleapis.com/auth/drive.file', API = 'https://www.googleapis.com/';
const FOLDER = { name: 'Pin Drop', mimeType: 'application/vnd.google-apps.folder', appProperties: { pindrop: 'folder' } };
const FILE = { name: 'Pin Drop.json', mimeType: 'application/json', appProperties: { pindrop: 'sync' } };
// KT is shared by every junkdrawer.works project at an address: one sign-in, good for an hour.
const KS = 'pin-drop.sync', KT = 'junkdrawer.google';
const RETRY = { retry: true };

// What goes to Drive: everything kept here but the sound and the game in progress (the balls included: see merge).
const SYNCED = ['games', 'best', 'bestBy', 'bestAt', 'bests', 'bestsAt', 'forgot', 'throws', 'thrown', 'hookShown', 'slideShown', 'names', 'opts', 'cpu', 'lineupAt', 'earned', 'picks', 'seen'];
export function toDoc(s) {
  const doc = { app: 'pin-drop', v: 1 };
  for (const k of SYNCED) if (s[k] !== undefined) doc[k] = s[k];
  return doc;
}
// The same thing always written the same way (the keys of each object in order), so an unchanged file isn't written.
export function canon(doc) {
  const tidy = v => (Array.isArray(v) ? v.map(tidy) : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, tidy(v[k])])) : v);
  return JSON.stringify(tidy(doc));
}
// Two copies folded into one: a copy of `a` with `b` merged in.
export const mergeDocs = (a, b) => toDoc(merge(parse(JSON.stringify(a)), parse(JSON.stringify(b))));

const get = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } };
const put = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rawLocal = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const fresh = () => ({ on: false, email: '', name: '', last: 0, fileId: '' });

let st = { ...fresh(), ...(get(KS) || {}) }, tok = get(KT);
let status = 'off', note = '', busy = null, again = false, client = null, gisLoading = false, pushT = null, asked = false;
// Goes up whenever saving stops (Stop, or Stop in another tab), so a sync already under way then leaves Drive and this
// device alone instead of putting back what it read before.
let gen = 0;
const ups = [], watchers = [];

const saveSt = () => put(KS, st);
const good = t => !!(t && t.token && t.exp - 60000 > Date.now() && String(t.scope || '').includes(SCOPE));
// The same Google account. A sign-in that doesn't say whose it is isn't taken to be anyone's.
const sameAccount = (a, b) => !!a && String(a).toLowerCase() === String(b).toLowerCase();
// A sign-in this device can use: more than a minute left, and for the Google account this device saves to. On a
// shared computer the newest sign-in may be someone else's. (Until this device knows its account, any will do.)
const usable = t => good(t) && (!st.email || sameAccount(t.email, st.email));
// This page's sign-in, or a newer one saved since, if it's usable.
const live = () => usable(tok) || (usable(get(KT)) && !!(tok = get(KT)));
function setStatus(s, n = '') { status = s; note = n; for (const f of [...watchers]) { try { if (f() === false) watchers.splice(watchers.indexOf(f), 1); } catch { watchers.splice(watchers.indexOf(f), 1); } } }

async function api(method, path, body, type, t = tok) {
  if (!t) throw { auth: true };
  const headers = { Authorization: 'Bearer ' + t.token };
  if (type) headers['Content-Type'] = type;
  const r = await fetch(API + path, { method, headers, body });
  // Google refused the sign-in: forget it here, and for the next page too unless it already has a newer one.
  if (r.status === 401) { if (get(KT)?.token === t.token) put(KT, null); if (tok?.token === t.token) tok = null; throw { auth: true }; }
  if (!r.ok) throw { http: r.status };
  return r.status === 204 ? null : r.json();
}
const query = meta => {
  const [k, v] = Object.entries(meta.appProperties)[0];
  return encodeURIComponent(`appProperties has { key='${k}' and value='${v}' } and trashed=false`);
};
async function findAll(meta, fields) {
  const x = await api('GET', `drive/v3/files?spaces=drive&orderBy=createdTime&pageSize=10&fields=${encodeURIComponent('files(' + fields + ')')}&q=${query(meta)}`);
  return x?.files || [];
}
async function folder() { // the "Pin Drop" folder, made the first time (or again, if it was deleted)
  const [f] = await findAll(FOLDER, 'id');
  return f ? f.id : (await api('POST', 'drive/v3/files?fields=id', JSON.stringify(FOLDER), 'application/json')).id;
}
async function download(id) {
  // A file that isn't JSON at all (cut short, say) is unreadable too, not a connection problem.
  const raw = await api('GET', `drive/v3/files/${id}?alt=media`).catch(e => { throw e instanceof SyntaxError ? { unreadable: true } : e; });
  if (!raw || raw.app !== 'pin-drop') throw { unreadable: true };
  return toDoc(parse(JSON.stringify(raw)));
}
async function create(body) {
  const dir = await folder(), b = 'pin-drop-' + Date.now().toString(36);
  return api('POST', 'upload/drive/v3/files?uploadType=multipart&fields=id,version',
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ ...FILE, parents: [dir] })}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`,
    `multipart/related; boundary=${b}`);
}
// Whose a sign-in is, from Google itself. The email kept with a sign-in only says whose it was meant to be.
function account(t) {
  return api('GET', 'drive/v3/about?fields=' + encodeURIComponent('user(displayName,emailAddress)'), null, null, t)
    .then(x => ({ email: x?.user?.emailAddress || '', name: x?.user?.displayName || '' }));
}
// Before the first sync with a sign-in that didn't say whose it is: the account this device saves to from now on.
async function learnAccount(g) {
  const t = tok, who = await account(t);
  if (!who.email) throw { http: 0 };
  if (g !== gen) return;
  st.email = who.email; st.name = who.name; saveSt();
  t.email = who.email; // and kept with the sign-in, so the next time skips the account chooser
  if (get(KT)?.token === t.token) put(KT, t);
}

// One sync: read the Drive copy, merge, write back what changed on either side.
async function run(tries, g) {
  const localRaw = rawLocal(), local = toDoc(parse(localRaw)), localText = canon(local);
  try {
    if (!st.email) await learnAccount(g);
    if (g !== gen) return false; // saving stopped meanwhile
    const files = await findAll(FILE, 'id,version');
    let file = files[0] || null, remote = file ? await download(file.id) : null;
    // Two devices that each made the file at the same moment: fold the extras into the first and bin them, the first
    // one winning any tie, since other devices already hold it.
    for (const extra of files.slice(1)) {
      remote = mergeDocs(remote, await download(extra.id));
      await api('PATCH', `drive/v3/files/${extra.id}`, JSON.stringify({ trashed: true }), 'application/json');
    }
    // Every game from both sides, never fewer: a device's first sync takes in what's there and adds its own.
    const merged = remote ? mergeDocs(local, remote) : local, out = canon(merged);
    if (g !== gen) return false;
    if (!file) file = await create(out);
    else if (canon(remote) !== out || files.length > 1) {
      // Another device may have saved since we read it; then start over with its version.
      const v = await api('GET', `drive/v3/files/${file.id}?fields=version`);
      if (String(v.version) !== String(file.version)) throw RETRY;
      const wrote = await api('PATCH', `upload/drive/v3/files/${file.id}?uploadType=media&fields=id,version`, out, 'application/json');
      // Drive can't refuse a write based on an older version, so look again: if another device wrote straight after
      // us, go round again so nothing of ours is lost.
      const after = await api('GET', `drive/v3/files/${file.id}?fields=version`);
      if (String(after.version) !== String(wrote.version)) throw RETRY;
    }
    if (g !== gen) return false;
    if (rawLocal() !== localRaw) throw RETRY; // saved here meanwhile: merge again
    const changed = out !== localText;
    if (changed) {
      // Into what's kept here, keeping this device's own: the sound and the game in progress.
      const here = merge(parse(localRaw), parse(out));
      try { localStorage.setItem(KEY, JSON.stringify(here)); } catch { /* keep what's on screen */ }
    }
    st.fileId = file.id; st.last = Date.now(); saveSt();
    return changed;
  } catch (e) {
    if (e === RETRY && tries < 4 && g === gen) return run(tries + 1, g);
    throw e;
  }
}

function sync() {
  if (!CLIENT_ID || !st.on) return Promise.resolve(false);
  if (!live()) { setStatus('tap'); return Promise.resolve(false); }
  if (busy) { again = true; return busy; }
  setStatus('busy');
  const g = gen;
  busy = run(0, g).then(changed => {
    if (g !== gen) return false;
    setStatus('ok');
    if (changed) ups.forEach(f => { try { f(); } catch (e) { console.error('Pin Drop: showing synced games failed', e); } });
    return changed;
  }, e => {
    if (g !== gen) return false;
    if (e?.auth) setStatus('tap');
    else if (e?.unreadable) setStatus('error', 'The file in your Drive isn’t readable, so it was left alone. Delete it from the Pin Drop folder to start it fresh from this device.');
    else setStatus('error', e === RETRY ? 'Another device kept saving. Try again in a moment.' : 'Couldn’t reach Google Drive. Check the connection and try again.');
    return false;
  }).then(changed => {
    busy = null;
    if (again) { again = false; return sync(); }
    return changed;
  });
  return busy;
}

// ---------- signing in (Google Identity Services, in a pop-up) ----------
function loadGis() {
  if (!CLIENT_ID || client) return;
  if (window.google?.accounts?.oauth2) { init(); return; }
  if (gisLoading) return;
  gisLoading = true;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = init;
  // Said only to someone who saves to Drive or just tapped to: offline, everyone else's title stays quiet.
  s.onerror = () => { gisLoading = false; setStatus(st.on ? 'tap' : 'off', st.on || asked ? 'Google sign-in didn’t load. Check the connection.' : ''); };
  document.head.append(s);
}
function init() {
  if (client) return;
  client = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID, scope: SCOPE, callback: gotToken,
    error_callback: e => setStatus(st.on ? 'tap' : 'off', e?.type === 'popup_closed' ? '' : 'Google sign-in didn’t finish.'),
  });
  setStatus(status, note);
}
function gotToken(r) {
  if (!r || r.error || !google.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) {
    setStatus(st.on ? 'tap' : 'off', 'Google Drive wasn’t allowed, so nothing was saved there. Try again and leave the Drive box ticked.');
    return;
  }
  const t = { token: r.access_token, exp: Date.now() + (+r.expires_in || 3600) * 1000, scope: r.scope || SCOPE, email: '' }, g = gen;
  setStatus('busy');
  // Google's window lets someone pick any account, whatever login_hint asked for, so ask Google whose this is first.
  account(t).then(who => {
    if (g !== gen) return; // saving stopped meanwhile
    if (!who.email) throw { http: 0 };
    if (st.email && !sameAccount(who.email, st.email)) {
      setStatus('error', `You signed in as ${who.email}, but this device saves to ${st.email}, so nothing went to that Drive. Sign in as ${st.email}, or stop saving on this device to change accounts.`);
      return;
    }
    tok = { ...t, email: who.email };
    put(KT, tok);
    st.on = true; if (!st.email) { st.email = who.email; st.name = who.name; } saveSt();
    sync();
  }).catch(e => {
    if (g === gen) setStatus(st.on ? 'error' : 'off', e?.auth ? 'Google sign-in didn’t finish.' : 'Couldn’t reach Google Drive. Check the connection and try again.');
  });
}
// Turn it on. With a sign-in kept here still good, no Google window at all.
function start() {
  if (!CLIENT_ID) return;
  tok = get(KT);
  if (!live()) { signIn(); return; }
  st.on = true; if (!st.email && tok.email) st.email = tok.email; saveSt();
  sync(); // which asks Google whose the sign-in is first, if it didn't say
}
// Google only opens its window from a tap, so this has to run inside a click handler.
function signIn() {
  asked = true;
  if (!client) { loadGis(); setStatus(status, 'Google sign-in is still loading. Tap again in a second.'); return; }
  const hint = st.email || tok?.email || '';
  client.requestAccessToken(hint ? { prompt: '', login_hint: hint } : { prompt: 'select_account' });
}
// Stop on this device. The sign-in stays, and nothing is revoked: revoking would cancel Google's permission for every
// junkdrawer.works project at once.
function stop() {
  clearTimeout(pushT);
  gen++;
  st = fresh(); saveSt(); setStatus('off');
}
function now() { if (!st.on) start(); else if (!live()) signIn(); else sync(); } // inside a tap

// ---------- the bits of page ----------
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < 86400) return Math.round(s / 3600) + ' h ago';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function title() {
  return status === 'busy' ? 'Syncing with Google Drive'
    : status === 'tap' ? 'Tap to sign in to Google again and sync'
      : status === 'error' ? note + ' Tap to try again.'
        : 'Synced with Google Drive' + (st.last ? ' ' + ago(st.last) : '') + '. Tap to sync now.';
}
const CLOUD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18.5h10.5a4 4 0 0 0 .7-7.94A6 6 0 0 0 6.7 9.1 4.7 4.7 0 0 0 7 18.5z"/></svg>';

// The cloud button: a dot, green when synced, a ring while syncing, a red "!" when it needs a tap.
function chip(btn) {
  if (!btn) return;
  if (!CLIENT_ID) { btn.hidden = true; return; }
  btn.innerHTML = CLOUD + '<i class="dot"></i>';
  btn.addEventListener('click', now);
  watch(() => {
    btn.hidden = !st.on;
    btn.dataset.s = status;
    btn.title = title();
    btn.setAttribute('aria-label', title());
  });
}

// The block on the title: turn it on, see where it's saving, sync now, or stop.
function card(host) {
  if (!host) return;
  if (!CLIENT_ID) { host.hidden = true; return; }
  loadGis();
  host.hidden = false;
  let armed = false;
  const line = () => status === 'busy' ? 'Syncing now.'
    : status === 'tap' ? 'Google signs you out after an hour. Tap <b>Sync now</b> to sign back in; your games are safe here meanwhile.'
      : status === 'error' ? ''
        : st.last ? `Last synced ${ago(st.last)}.` : '';
  function draw() {
    if (!host.isConnected) return false;
    host.innerHTML = st.on
      ? `<p>Your games and bests are saved to <b>${esc(st.email || 'your Google Drive')}</b>, in a folder called “Pin Drop”, and show up on every device where you turn this on. ${line()}</p>
        ${status === 'error' && note ? `<p class="err">${esc(note)}</p>` : ''}
        <div class="row"><button class="plain" type="button" data-a="now"${status === 'busy' ? ' disabled' : ''}>Sync now</button>
        <button class="plain quiet" type="button" data-a="off">${armed ? 'Tap again to stop' : 'Stop saving on this device'}</button></div>`
      : `<p>Keep your games and bests in your own Google Drive, and they’ll be the same on every phone and computer where you turn this on. They go in a “Pin Drop” folder, and nothing here can see anything else in your Drive. <a href="https://junkdrawer.works/privacy.html">Privacy</a></p>
        ${note ? `<p class="err">${esc(note)}</p>` : ''}
        <button class="plain" type="button" data-a="on">Save to Google Drive</button>`;
    host.querySelectorAll('button[data-a]').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      if (a === 'on') start();
      else if (a === 'now') now();
      else if (!armed) { armed = true; draw(); }
      else { armed = false; stop(); }
    }));
  }
  watch(draw);
}
function watch(f) { watchers.push(f); f(); }

// The page kept something worth sending (a game finished, scores forgotten, new players): send it along shortly.
function changed() {
  if (!CLIENT_ID || !st.on) return;
  clearTimeout(pushT);
  if (live()) pushT = setTimeout(sync, 1200); else setStatus('tap');
}

export const drive = {
  ready: !!CLIENT_ID,
  isOn: () => !!CLIENT_ID && st.on,
  chip, card, changed, now, stop,
  onUpdate(f) { ups.push(f); }, // synced games landed in localStorage
};

if (CLIENT_ID) {
  if (st.on) {
    loadGis(); // ready before the first tap
    status = live() ? 'ok' : 'tap';
    if (live()) setTimeout(sync, 0);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && st.on && live() && Date.now() - st.last > 30000) sync(); });
  setInterval(() => { if (!document.hidden && st.on) { if (live()) sync(); else setStatus('tap'); } }, 5 * 60000);
  window.addEventListener('storage', e => { // another tab signed in, stopped, or synced
    if (e.key === KS || e.key === KT) {
      st = { ...fresh(), ...(get(KS) || {}) };
      // A sign-in another tab saved is taken up only if it's for this device's account. If it was cleared because
      // Google refused it, and it was this page's too, this page lets go of it.
      const t = get(KT);
      if (usable(t)) tok = t;
      else if (!t && e.key === KT && tok && (e.oldValue || '').includes(tok.token)) tok = null;
      if (!st.on) gen++;
      setStatus(st.on ? (busy ? 'busy' : live() ? 'ok' : 'tap') : 'off');
      if (st.on) loadGis();
    }
  });
}

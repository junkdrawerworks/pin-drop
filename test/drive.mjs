// Saving to Google Drive, against a stand-in for Google (fake-google.mjs, from the junkdrawer kit):  node test/drive.mjs
// Each browser context is a device; they share one fake Drive. Checks what lands in the Drive as well as on the page.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { fakeGoogle } from './fake-google.mjs';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  try { const body = await readFile(join(root, path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }); res.end(body); } catch { res.writeHead(404); res.end(); }
}).listen(0);
const origin = `http://localhost:${server.address().port}`, base = origin + '/';
const until = async (ok, ms, what) => {
  for (const end = Date.now() + ms; !(await ok());) { assert.ok(Date.now() < end, what); await new Promise(r => setTimeout(r, 100)); }
};

const browser = await pw.chromium.launch();
const problems = [];
const nineAndMiss = Array.from({ length: 18 }, (_, i) => (i % 2 ? 0 : 9));   // nine frames of 9 and a miss: 81
const game = (at, name, rolls = nineAndMiss.concat([9, 0])) => ({ at, scores: [{ name, score: 90, rolls, splits: [], c: 0 }] });
// A device: a browser context with what's kept on it set to `k`, using the fake Google `g`, with Drive allowed here.
// With `offline`, Google's sign-in script can't be reached.
async function device(g, k, { allow = true, offline = false } = {}) {
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await g.install(c, allow ? { rewrite: { '**/js/sync.js': s => s.replace("['https://pin-drop.junkdrawer.works']", `['https://pin-drop.junkdrawer.works', '${origin}']`) } } : {});
  if (offline) await c.route('https://accounts.google.com/**', r => r.abort());
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  if (k) await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, k);
  await p.goto(base);
  return { c, p };
}
const saved = p => p.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
const synced = p => p.evaluate(() => document.getElementById('cloud').dataset.s === 'ok' && !document.getElementById('cloud').hidden);
// The one Pin Drop file in the fake Drive, as kept there.
const theFile = g => g.files().filter(f => !f.trashed && f.appProperties?.pindrop === 'sync');
const inDrive = g => JSON.parse(theFile(g)[0].body);
// A game finished on a device: its last ball, in the gutter.
async function finishGame(p, name) {
  await p.evaluate(({ name, rolls }) => {
    const s = JSON.parse(localStorage.getItem('pin-drop.v1'));
    s.current = { players: [{ name, rolls, x: 0, c: 0 }], turn: 0, leftover: null };
    localStorage.setItem('pin-drop.v1', JSON.stringify(s));
  }, { name, rolls: nineAndMiss.concat([9]) });
  await p.reload();
  await p.click('#resume');
  await p.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
  await until(() => p.isVisible('#end'), 20000, 'the game never ended');
  await p.click('#toTitle');
}

// Away from pin-drop.junkdrawer.works (here, localhost as it is), nothing about Drive shows and Google is never asked.
{
  const g = fakeGoogle();
  const { c, p } = await device(g, { names: ['Ana'] }, { allow: false });
  try {
    assert.deepEqual([await p.isVisible('#drive'), await p.isVisible('#cloud')], [false, false]);
    assert.equal(g.calls.length, 0);
    assert.equal(await p.evaluate(() => !!document.querySelector('script[src*="accounts.google.com"]')), false, 'Google sign-in loaded away from its address');
  } finally { await c.close(); }
}

// Offline, someone who never turned Drive on sees no complaint about Google; a tap on Save to Google Drive says why
// nothing happened.
{
  const g = fakeGoogle();
  const before = problems.length;
  const { c, p } = await device(g, { names: ['Ana'] }, { offline: true });
  try {
    await p.waitForTimeout(1000);
    assert.equal(await p.locator('#drive .err').count(), 0, 'an offline title complains about Google to someone who never used Drive');
    await p.click('#drive button');
    await until(async () => /didn’t load/.test(await p.textContent('#drive')), 5000, 'a tap offline said nothing');
  } finally { await c.close(); }
  // The browser logs the script it couldn't fetch, which is expected.
  problems.splice(before, Infinity, ...problems.slice(before).filter(m => !/ERR_FAILED/.test(m)));
}

{
  const g = fakeGoogle();
  // A phone with two games, a game in progress and the sound off.
  const phone = await device(g, { names: ['Ana'], sound: false, games: [game(2000, 'Ana'), game(1000, 'Ana')], best: 90, bestBy: 'Ana', bestAt: 2000,
    bests: { Ana: 90 }, bestsAt: { Ana: 2000 }, thrown: { Ana: 30 }, current: { players: [{ name: 'Ana', rolls: [7], x: 0, c: 0 }], turn: 0, leftover: null } });
  const tablet = await device(g, { names: ['Ben'], games: [game(1500, 'Ben')], bests: { Ben: 90 }, bestsAt: { Ben: 1500 }, best: 90, bestBy: 'Ben', bestAt: 1500 });
  try {
    // Turning it on: the offer on the title, then Google's window (the first time, choosing an account).
    assert.equal(await phone.p.isVisible('#drive'), true, 'no Drive on the title');
    assert.match(await phone.p.textContent('#drive'), /Keep your games and bests in your own Google Drive/);
    await phone.p.click('#drive button');
    await until(() => synced(phone.p), 8000, 'the phone never synced');
    assert.deepEqual(await phone.p.evaluate(() => window.__prompts), [{ prompt: 'select_account' }]);
    assert.equal(await phone.p.evaluate(() => window.__cfg.scope), 'https://www.googleapis.com/auth/drive.file');
    assert.match(await phone.p.textContent('#drive'), /saved to mark@gmail\.com, in a folder called “Pin Drop”/);
    // One folder named Pin Drop at the top of My Drive, the file in it, both found by their tags.
    const folder = g.files().find(f => f.appProperties?.pindrop === 'folder');
    assert.equal(folder?.name, 'Pin Drop');
    assert.equal(theFile(g).length, 1);
    assert.deepEqual([theFile(g)[0].name, theFile(g)[0].parents], ['Pin Drop.json', [folder.id]]);
    let d = inDrive(g);
    assert.deepEqual(d.games.map(x => x.at), [2000, 1000]);
    assert.deepEqual([d.best, d.bests, d.names, d.thrown], [90, { Ana: 90 }, ['Ana'], { Ana: 30 }]);
    // The sound and the game in progress stay on the phone.
    assert.deepEqual([d.sound, d.current], [undefined, undefined]);

    // The tablet joins with a sign-in already kept from earlier: no Google window. Its first sync takes in the phone's
    // games and adds its own; nothing is lost on either side.
    await tablet.p.evaluate(() => localStorage.setItem('junkdrawer.google', JSON.stringify({ token: 'tok-mark', exp: Date.now() + 3e6, scope: 'https://www.googleapis.com/auth/drive.file', email: 'mark@gmail.com' })));
    await tablet.p.click('#drive button');
    await until(() => synced(tablet.p), 8000, 'the tablet never synced');
    assert.equal(await tablet.p.evaluate(() => window.__prompts), undefined, 'a Google window for a sign-in already kept');
    d = inDrive(g);
    assert.deepEqual(d.games.map(x => x.at), [2000, 1500, 1000]);
    assert.deepEqual(d.bests, { Ana: 90, Ben: 90 });
    assert.equal(theFile(g).length, 1, 'the tablet made a second file');
    // And put back into the page: the title lists all three.
    assert.equal(await tablet.p.locator('#record li').count(), 3, 'the tablet does not show the phone\'s games');
    let s = await saved(tablet.p);
    assert.deepEqual(s.games.map(x => x.at), [2000, 1500, 1000]);

    // The phone syncs (a tap on the cloud): it has the tablet's game, and keeps its own sound and game in progress.
    await phone.p.click('#cloud');
    await until(async () => (await saved(phone.p)).games.length === 3, 8000, 'the phone never got the tablet\'s game');
    s = await saved(phone.p);
    assert.deepEqual([s.sound, s.current.players[0].rolls], [false, [7]]);
    assert.equal(await phone.p.locator('#record li').count(), 3);

    // Each finishes a game: both reach the Drive and the other device.
    await finishGame(phone.p, 'Ana');
    await until(() => inDrive(g).games.length === 4, 8000, 'the phone\'s new game never reached the Drive');
    await finishGame(tablet.p, 'Ben');
    await until(() => inDrive(g).games.length === 5, 8000, 'the tablet\'s new game never reached the Drive');
    await phone.p.click('#cloud');
    await until(async () => (await saved(phone.p)).games.length === 5, 8000, 'the phone never got the tablet\'s new game');
    assert.deepEqual(new Set(inDrive(g).games.map(x => x.scores[0].name)), new Set(['Ana', 'Ben']));

    // Forget these scores on the tablet: gone from the Drive, and from the phone at its next sync.
    await tablet.p.click('#bestBtn');
    await tablet.p.click('#forget');
    assert.equal(await tablet.p.textContent('#forget'), 'Tap again to forget them on every device');
    await tablet.p.click('#forget');
    await until(() => inDrive(g).games.length === 0, 8000, 'the forgotten games are still in the Drive');
    assert.deepEqual([inDrive(g).best, inDrive(g).bests], [0, {}]);
    await phone.p.click('#cloud');
    await until(async () => (await saved(phone.p)).games.length === 0, 8000, 'the phone kept the forgotten games');
    assert.equal(await phone.p.locator('#record li, #bestBtn').count(), 0);

    // An hour on, Google refuses the sign-in: the cloud asks for a tap, and a tap signs back in (skipping the account
    // chooser) and syncs.
    await phone.p.evaluate(() => localStorage.setItem('junkdrawer.google', JSON.stringify({ token: 'tok-expired', exp: Date.now() + 3e6, scope: 'https://www.googleapis.com/auth/drive.file', email: 'mark@gmail.com' })));
    await phone.p.reload();
    await until(() => phone.p.evaluate(() => document.getElementById('cloud').dataset.s === 'tap'), 8000, 'a refused sign-in did not ask for a tap');
    assert.equal(await phone.p.evaluate(() => localStorage.getItem('junkdrawer.google')), null, 'the refused sign-in was kept');
    await phone.p.click('#cloud');
    await until(() => synced(phone.p), 8000, 'a tap did not sign back in');
    assert.deepEqual(await phone.p.evaluate(() => window.__prompts.at(-1)), { prompt: '', login_hint: 'mark@gmail.com' });

    // Stop saving on the phone: two taps, nothing revoked, and games finished afterwards stay off the Drive.
    await phone.p.click('#drive [data-a="off"]');
    await phone.p.click('#drive [data-a="off"]');
    assert.equal(await phone.p.isVisible('#cloud'), false);
    assert.match(await phone.p.textContent('#drive'), /Keep your games and bests/);
    const calls = g.calls.length;
    await finishGame(phone.p, 'Ana');
    await phone.p.waitForTimeout(2000);
    assert.equal(g.calls.length, calls, 'the phone still talks to Drive after Stop');
    assert.equal(inDrive(g).games.length, 0);
    assert.equal(await phone.p.evaluate(() => window.__revoked), undefined, 'the sign-in was revoked');
  } finally { await phone.c.close(); await tablet.c.close(); }
}

// Two devices that each made the file at the same moment: the second is folded into the first and binned, and every
// game from both is kept.
{
  const g = fakeGoogle();
  const first = await device(g, { names: ['Ana'], games: [game(100, 'Ana')] });
  const second = await device(g, { names: ['Ben'], games: [game(200, 'Ben')] });
  try {
    for (const d of [first, second]) await d.p.evaluate(() => localStorage.setItem('junkdrawer.google', JSON.stringify({ token: 'tok-mark', exp: Date.now() + 3e6, scope: 'https://www.googleapis.com/auth/drive.file', email: 'mark@gmail.com' })));
    // Both find no file, and both make one.
    await Promise.all([first.p.click('#drive button'), second.p.click('#drive button')]);
    await until(async () => (await synced(first.p)) && (await synced(second.p)), 8000, 'they never synced');
    const made = g.files().filter(f => f.appProperties?.pindrop === 'sync').length;
    await first.p.click('#cloud');
    await until(() => synced(first.p), 8000, 'the first never synced again');
    assert.equal(theFile(g).length, 1, `${made} files made, and still more than one`);
    assert.deepEqual(inDrive(g).games.map(x => x.at), [200, 100]);
    await second.p.click('#cloud');
    await until(async () => (await saved(second.p)).games.length === 2, 8000, 'the second lost a game');
    console.log(`  two devices at once: ${made} file${made > 1 ? 's' : ''} made, one kept with both games`);
  } finally { await first.c.close(); await second.c.close(); }
}

// The browser logs the 401 for the sign-in Google refused, which is expected.
assert.deepEqual(problems.filter(m => !/status of 401/.test(m)), [], 'problems while using it');
await browser.close();
server.close();
console.log('Google Drive all good (against a stand-in: the real Google window was not tested)');

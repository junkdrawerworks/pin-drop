// Uses the app in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Skeleton from the junkdrawer skill: the checks at the bottom are the ones every project wants;
// add the ones that prove this app does its job.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
// The server answers the way GitHub Pages does: a browser may keep each file for ten minutes, and asks again by its
// ETag. `net` is the connection: 'up', 'down' (the server drops every connection) or 'stalled' (a train, a captive
// wifi: it takes each request and holds on to it). With `release` set it serves the next release (see the end).
let net = 'up', release = false;
const held = [];
const server = createServer((req, res) => {
  if (net === 'down') { req.socket.destroy(); return; }
  if (net === 'stalled') { held.push([req, res]); return; }
  serve(req, res);
}).listen(0);
async function serve(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  let body;
  try { body = await readFile(join(root, path)); } catch { res.writeHead(404); res.end(); return; }
  if (release && path === '/sw.js') body = Buffer.from(String(body).replace(/const FILES = '[0-9a-f]*'/, "const FILES = 'next'"));
  if (release && path === '/index.html') body = Buffer.concat([body, Buffer.from('<!-- the next release -->\n')]);
  const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const head = { etag, 'cache-control': 'max-age=600', 'content-type': TYPES[extname(path)] || 'text/html' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); res.end(); return; }
  res.writeHead(200, head);
  res.end(body);
}
const base = `http://localhost:${server.address().port}/`;
// Waits for ok() to come true, for up to ms, or fails saying what didn't happen.
const until = async (ok, ms, what) => {
  for (const end = Date.now() + ms; !(await ok());) { assert.ok(Date.now() < end, what); await new Promise(r => setTimeout(r, 100)); }
};

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', e => problems.push(e.message));
page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
page.on('requestfailed', r => problems.push('failed: ' + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

await page.goto(base);
await page.evaluate(() => document.fonts.ready);

// The title: two players.
assert.equal(await page.isVisible('#title'), true, 'the title sheet shows first');
await page.click('#addPlayer');
await page.fill('#players li:nth-child(1) input', 'Ana');
await page.fill('#players li:nth-child(2) input', 'Ben');
await page.click('#start');
assert.equal(await page.evaluate(() => pinDrop.phase), 'aim');
assert.match(await page.textContent('#who'), /Ana/);

// Drag the ball sideways: it moves, and nothing's thrown.
const m = page.mouse;
await m.move(195, 665); await m.down();
for (let i = 1; i <= 8; i++) { await m.move(195 + i * 9, 668); await page.waitForTimeout(16); }
await m.up();
const bx = await page.evaluate(() => pinDrop.ball.x);
assert.ok(bx > 4, `the ball moved to ${bx}`);
assert.equal(await page.evaluate(() => pinDrop.phase), 'aim');

// A curved swipe up throws it, hooking left.
const path = [];
for (let i = 0; i <= 14; i++) { const t = i / 14; path.push([250 + 36 * Math.sin(t * Math.PI), 660 - 320 * t]); }
await m.move(...path[0]); await m.down();
for (const p of path.slice(1)) { await m.move(...p); await page.waitForTimeout(12); }
await m.up();
assert.equal(await page.evaluate(() => pinDrop.phase), 'rolling');
assert.match(await page.textContent('#readout'), /mph · hook left/);

// A touch fling, with real touch events: a quick flick throws harder than a slow push. (On tablets every fling
// used to come out at the slowest speed.)
const cdp0 = await ctx.newCDPSession(page);
const fling = async (step, gap) => {
  await until(() => page.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
  await cdp0.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 700 }] });
  for (let i = 1; i <= 8; i++) { await new Promise(r => setTimeout(r, gap)); await cdp0.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y: 700 - i * step }] }); }
  await cdp0.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await until(() => page.evaluate(() => pinDrop.phase === 'rolling'), 3000, 'the fling did not throw');
  return parseFloat(await page.textContent('#readout'));
};
await page.evaluate(() => { pinDrop.speed = 10; });
const slowMph = await fling(12, 60), quickMph = await fling(60, 8);
assert.ok(quickMph > slowMph + 3, `a quick fling threw at ${quickMph} mph, a slow push at ${slowMph} mph`);
assert.ok(quickMph > 14, `a quick fling only threw at ${quickMph} mph`);
console.log(`  touch: slow push ${slowMph} mph, quick fling ${quickMph} mph`);

// Play the rest of the game fast: each ball aimed at the pocket with a hook, or at whatever's left.
await page.evaluate(() => { pinDrop.speed = 10; });
const deadline = Date.now() + 120000;
while (!(await page.isVisible('#end'))) {
  assert.ok(Date.now() < deadline, 'the game never finished');
  await page.evaluate(() => {
    if (pinDrop.phase !== 'aim') return;
    const up = pinDrop.pins.filter(p => p.state === 'up');
    const full = up.length === 10;
    const target = full ? 1.5 : up.reduce((s, p) => s + p.x, 0) / up.length;
    const x = full ? 10 : Math.max(-14, Math.min(14, target));
    pinDrop.throw({ x, speed: 290, angle: full ? 0.004 + (Math.random() - 0.5) * 0.006 : (target - x) / 720, hook: full ? -40 : 0 });
  });
  await page.waitForTimeout(60);
}
const { scores, rolls } = await page.evaluate(() => ({
  scores: [...document.querySelectorAll('#endCards .f.sum')].map(e => +e.textContent),
  rolls: pinDrop.game.players.map(p => p.rolls),
}));
const { total, next } = await import('../js/scoring.js');
assert.deepEqual(scores, rolls.map(total), 'the end cards show the right totals');
assert.ok(rolls.every(r => next(r).done), 'both games are complete');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
assert.equal(saved.best, Math.max(...scores));
assert.equal(saved.games.length, 1);
assert.equal(saved.current, null);
console.log('  a two-player game:', scores.join(' and '));

// A game in progress carries on after a reload.
await page.click('#toTitle');
await page.click('#start');
await page.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
await until(() => page.evaluate(() => pinDrop.phase === 'aim' && pinDrop.game.players[0].rolls.length === 1), 15000, 'the first ball never finished');
const first = await page.evaluate(() => pinDrop.game.players[0].rolls[0]);
await page.reload();
assert.equal(await page.isVisible('#resume'), true, 'no Carry on button after a reload');
await page.click('#resume');
assert.deepEqual(await page.evaluate(() => pinDrop.game.players[0].rolls), [first]);
if (first < 10) assert.equal(await page.evaluate(() => pinDrop.pins.length), 10 - first, 'the leftover pins came back');

// The menu: sound off, then end the game.
await page.click('#menuBtn');
await page.click('#menuSound');
assert.match(await page.textContent('#menuSound'), /off/);
await page.click('#menuQuit'); await page.click('#menuQuit');
assert.equal(await page.isVisible('#title'), true);
assert.equal(await page.isVisible('#resume'), false);

// Installable: Chromium's own checks.
const cdp = await ctx.newCDPSession(page);
const { installabilityErrors: installErrors } = await cdp.send('Page.getInstallabilityErrors');
assert.deepEqual(installErrors, [], 'Chromium says it cannot be installed');

// Fits a phone: nothing scrolls sideways.
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

// Works offline once it has been opened. The server goes down as well as the browser: in some Chromium builds the
// browser's offline switch alone doesn't stop the service worker's own requests, and this passed with no copy at all.
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 });
const title = await page.title();
net = 'down';
await ctx.setOffline(true);
await page.reload();
assert.equal(await page.title(), title, 'the page did not open offline');
await ctx.setOffline(false);

// On a connection that's up but not answering, it opens from the copy too, after the worker's few seconds' wait for
// the network: the page and every file it loads (were any of them left waiting on the network, it wouldn't open).
net = 'stalled';
const t0 = Date.now();
await page.reload({ timeout: 10000 }).catch(() => {});
const took = Date.now() - t0;
assert.ok(took < 8000, `the page took ${took} ms to open on a stalled connection`);
assert.equal(await page.title(), title, 'the page did not open on a stalled connection');
net = 'up';
for (const [req, res] of held.splice(0)) serve(req, res);

// A new release: every file in the new copy comes from the server, though the browser still has its own copies of
// the old ones for ten minutes. (The next release changes index.html, and so FILES in sw.js, as a real one does.)
release = true;
await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
await until(() => page.evaluate(async () => !!(await (await caches.match('index.html'))?.text())?.includes('<!-- the next release -->')),
  10000, "the new release's offline copy kept the old index.html");
release = false;

// ---- Throwing, on a phone's touch screen and with a mouse or trackpad -----------------------------------------

// A fresh page with what's kept on this device set to `kept`, already on the lane.
async function lane(options, kept = {}, names = ['You']) {
  const c = await browser.newContext({ serviceWorkers: 'block', ...options });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, { names, ...kept });
  await p.goto(base);
  await p.click('#start');
  return { c, p, cdp: await c.newCDPSession(p) };
}
const wait = ms => new Promise(r => setTimeout(r, ms));
// A touch stroke with real touch events: `moves` is a list of [dx, dy, steps], each step 16 ms apart.
async function touchStroke(cdp, moves, x = 195, y = 640) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const [dx, dy, n] of moves) {
    for (let i = 1; i <= n; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * i / n, y: y + dy * i / n }] }); }
    x += dx; y += dy;
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(50);
}
const state = p => p.evaluate(() => ({ phase: pinDrop.phase, x: pinDrop.ball.x }));

{
  const { c, p, cdp } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await p.evaluate(() => { pinDrop.speed = 10; });
    // A backswing: 13 px down, then a quick fling up.
    await touchStroke(cdp, [[0, 13, 2], [0, -280, 6]]);
    assert.equal((await state(p)).phase, 'rolling', 'a backswing and then a fling up threw nothing');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');

    // A hook swipe that starts 15 px sideways, then goes up: it throws, from where the ball was.
    await p.evaluate(() => { pinDrop.speed = 0.01; });
    const x0 = (await state(p)).x;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 640 }] });
    for (let i = 1; i <= 2; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 + 7.5 * i, y: 640 }] }); }
    assert.notEqual((await state(p)).x, x0, 'the sideways start did not move the ball');
    for (let i = 1; i <= 10; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 210, y: 640 - 33 * i }] }); }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(50);
    const thrown = await state(p);
    assert.equal(thrown.phase, 'rolling', 'a swipe that started sideways threw nothing');
    assert.ok(Math.abs(thrown.x - x0) < 0.2, `the ball was thrown from ${thrown.x}, not where it stood (${x0})`);
    await p.evaluate(() => { pinDrop.speed = 10; });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');

    // Moving the ball with a stroke that starts upward: 12 px up, then 80 px right and 33 px up. It moves, and
    // isn't thrown into the gutter.
    const before = (await state(p)).x;
    await touchStroke(cdp, [[0, -12, 1], [80, -33, 8]]);
    const moved = await state(p);
    assert.equal(moved.phase, 'aim', 'moving the ball diagonally threw it');
    assert.ok(moved.x > before + 3, `the ball only moved from ${before} to ${moved.x}`);
  } finally { await c.close(); }
}

assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], 'problems while using it');
await browser.close();
server.close();

// sw.js changes whenever a file it keeps does, so a release replaces the whole offline copy at once: FILES in sw.js is
// a fingerprint of every file in SHELL (sha1 of each, in the list's order, an address like './' read as its
// index.html; the first 8 hex of the sha1 of those).
const sw = await readFile(join(root, 'sw.js'), 'utf8');
const shell = [...sw.match(/SHELL = \[([^\]]*)\]/)[1].replace(/\/\/.*/g, '').matchAll(/'([^']*)'/g)].map(m => m[1]);
const all = createHash('sha1');
for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
const files = all.digest('hex').slice(0, 8);
assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
console.log('all good');

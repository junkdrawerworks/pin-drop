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
// How to play says the same on the title as in the menu, and covers a trackpad.
const howTitle = await page.$$eval('#title .how li', els => els.map(e => e.textContent));
assert.deepEqual(howTitle, await page.$$eval('#howSheet .howlist li', els => els.map(e => e.textContent)));
assert.ok(howTitle.some(t => /trackpad/.test(t)), 'How to play says nothing about a trackpad');
assert.ok(howTitle.some(t => /a strike or spare in the tenth earns the extra balls to count it/.test(t)), 'How to play does not say what the tenth\'s extra balls are for');
await page.click('#addPlayer');
// Everything on the title can be hit with a thumb: 44 px or more.
const small = await page.evaluate(() => [...document.querySelectorAll('#title button, #title summary, #title a')]
  .map(el => ({ what: el.textContent.trim() || el.getAttribute('aria-label'), r: el.getBoundingClientRect() }))
  .filter(({ r }) => r.width && (r.height < 44 || r.width < 44)).map(({ what, r }) => `${what} ${Math.round(r.width)}x${Math.round(r.height)}`));
assert.deepEqual(small, [], 'tap targets under 44 px on the title');
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
// The same fling five times throws the same ball, to within 1 mph. Each touch is stamped with when the finger was
// there, as a touch screen does, and the page gets them whenever it gets them. (Timed by when they arrived, a busy
// page read the same steady fling at anything from 12 to 22 mph.)
const steadyFling = async () => {
  await until(() => page.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
  const t0 = Date.now() / 1000, sent = [];
  const touch = (type, i, touchPoints) => sent.push(cdp0.send('Input.dispatchTouchEvent', { type, touchPoints, timestamp: t0 + i * 0.008 }));
  touch('touchStart', 0, [{ x: 195, y: 700 }]);
  for (let i = 1; i <= 30; i++) { await new Promise(r => setTimeout(r, 8)); touch('touchMove', i, [{ x: 195, y: 700 - i * 10 }]); }
  touch('touchEnd', 30.5, []);
  await Promise.all(sent);
  await until(() => page.evaluate(() => pinDrop.phase === 'rolling'), 3000, 'the fling did not throw');
  return parseFloat(await page.textContent('#readout'));
};
const same = [];
for (let k = 0; k < 5; k++) same.push(await steadyFling());
assert.ok(Math.max(...same) - Math.min(...same) <= 1, `the same fling threw at ${same.join(', ')} mph`);
console.log(`  the same fling five times: ${same.join(', ')} mph`);

// Play the rest of the game fast: each ball hooked into the pocket (which strikes about half the time), or aimed
// at whatever's left.
const { pocket, through } = await import('./aim.mjs');
const { play, rack, SPOTS } = await import('../js/physics.js');
await page.evaluate(() => { pinDrop.speed = 10; });
const deadline = Date.now() + 120000;
while (!(await page.isVisible('#end'))) {
  assert.ok(Date.now() < deadline, 'the game never finished');
  await page.evaluate(pocket => {
    if (pinDrop.phase !== 'aim') return;
    const up = pinDrop.pins.filter(p => p.state === 'up');
    if (up.length === 10) { pinDrop.throw(pocket); return; }
    const target = up.reduce((s, p) => s + p.x, 0) / up.length;
    const x = Math.max(-14, Math.min(14, target));
    pinDrop.throw({ x, speed: 290, angle: (target - x) / 720, hook: 0 });
  }, pocket);
  await page.waitForTimeout(60);
}
const { scores, rolls } = await page.evaluate(() => ({
  scores: [...document.querySelectorAll('#endCards .f.sum')].map(e => +e.textContent),
  rolls: pinDrop.game.players.map(p => p.rolls),
}));
const { total, next, frames, cardText } = await import('../js/scoring.js');
assert.deepEqual(scores, rolls.map(total), 'the end cards show the right totals');
assert.ok(rolls.every(r => next(r).done), 'both games are complete');
assert.ok(rolls.some(r => frames(r).some(f => f.marks.includes('X'))), `no strikes in ${JSON.stringify(rolls)}, so strikes went untested`);
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
assert.equal(saved.best, Math.max(...scores));
assert.equal(saved.games.length, 1);
// Each player's balls are kept with the game, not only the score.
assert.deepEqual(saved.games[0].scores, rolls.map((r, i) => ({ name: ['Ana', 'Ben'][i], score: total(r), rolls: r })));
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
    // The hint, in a phone's words: a swipe.
    await touchStroke(cdp, [[30, 0, 3]]);
    assert.equal(await p.isVisible('#hint'), true, 'no hint on the first ball');
    assert.match(await p.textContent('#hint'), /^Swipe up from the ball to roll/);
    // On a dark pill, in one piece over its two lines: cream on the bare wood of the approach was about 2.4:1.
    const pill = sel => p.evaluate(sel => { const el = document.querySelector(sel); return el && { bg: getComputedStyle(el).backgroundColor, h: el.getBoundingClientRect().height }; }, sel);
    const hintPill = await pill('#hint .pill');
    assert.equal(hintPill?.bg, 'rgba(13, 18, 34, 0.75)', 'the hint is not on its dark pill');
    assert.ok(hintPill.h > 50, `the hint's pill is ${hintPill.h} px tall, so it does not hold both lines`);
    await p.evaluate(() => { pinDrop.speed = 10; });
    // A backswing: 13 px down, then a quick fling up.
    await touchStroke(cdp, [[0, 13, 2], [0, -280, 6]]);
    assert.equal((await state(p)).phase, 'rolling', 'a backswing and then a fling up threw nothing');
    assert.equal((await pill('#readout .pill'))?.bg, 'rgba(13, 18, 34, 0.75)', 'the speed readout is not on its dark pill');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');

    // A hook swipe that starts 15 px sideways, then goes up: it throws, from where the ball was.
    await p.evaluate(() => { pinDrop.speed = 0.01; });
    const x0 = (await state(p)).x;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 640 }] });
    for (let i = 1; i <= 2; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195 + 7.5 * i, y: 640 }] }); }
    assert.notEqual((await state(p)).x, x0, 'the sideways start did not move the ball');
    for (let i = 1; i <= 10; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 210, y: 640 - 33 * i }] }); }
    assert.equal(await p.isVisible('#hint'), false, 'the hint stays up while swiping to throw');
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

    // A sideways drag that starts with the thumb settling 11 px down, or 11 px up: the ball follows the finger while
    // it drags (it stayed put, and lifting said "Swipe up to roll", or it jumped across only on lifting).
    for (const wobble of [11, -11]) {
      const from = (await state(p)).x;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 250, y: 640 }] });
      await wait(16);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 250, y: 640 + wobble }] });
      for (let i = 1; i <= 10; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 250 - i * 10, y: 640 + wobble }] }); }
      await wait(50);
      const mid = await state(p);
      assert.ok(mid.x < from - 5, `${wobble} px ${wobble > 0 ? 'down' : 'up'}, then 100 px across: the ball was at ${mid.x} mid-drag, from ${from}`);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(50);
      const end = await state(p);
      assert.equal(end.phase, 'aim');
      assert.ok(Math.abs(end.x - mid.x) < 0.5, `the ball jumped from ${mid.x} to ${end.x} on lifting`);
      assert.notEqual(await p.textContent('#hint'), 'Swipe up to roll', 'a sideways drag was told to swipe up');
      await touchStroke(cdp, [[100, 0, 8]], 150);   // back where it was
    }

    // A flick too short to throw says so.
    await touchStroke(cdp, [[0, -30, 3]]);
    assert.equal((await state(p)).phase, 'aim');
    assert.equal(await p.isVisible('#hint'), true, 'a short flick got no word');
    assert.equal(await p.textContent('#hint'), 'Swipe further up to roll');

    // A ball thrown at the slowest speed gets a word under the callout, once in the game.
    const slowBall = async () => {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      await p.evaluate(() => pinDrop.throw({ x: 14, speed: 175, angle: 0.02, hook: 0 }));
      await until(() => p.evaluate(() => pinDrop.phase === 'settle' || pinDrop.phase === 'over'), 20000, 'the slow ball never finished');
      return p.textContent('#call');
    };
    assert.match(await slowBall(), /Flick faster for a harder throw$/);
    assert.doesNotMatch(await slowBall(), /Flick faster/, 'the word about slow balls came twice in a game');

    // Sliding the ball over and swiping up without lifting, with a stop at the corner and with a sharp turn: thrown
    // from where it was slid, as straight as the swipe up. (The ball went back where it stood, and the whole L-shaped
    // stroke threw a full hook.)
    for (const stop of [200, 0]) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      await p.evaluate(() => { pinDrop.speed = 1; });
      const from = (await state(p)).x;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 250, y: 640 }] });
      for (let i = 1; i <= 8; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 250 - i * 10, y: 640 }] }); }
      await wait(stop);
      await wait(30);
      const slid = (await state(p)).x;
      for (let i = 1; i <= 10; i++) { await wait(16); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 170, y: 640 - i * 25 }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(50);
      const shot = await p.evaluate(() => pinDrop.phase === 'rolling' && pinDrop.shot);
      assert.ok(shot, `sliding over${stop ? ', stopping' : ''} and swiping up threw nothing`);
      assert.ok(slid < from - 5 && Math.abs(shot.x - slid) < 0.3, `slid from ${from} to ${slid}, then thrown from ${shot.x}`);
      assert.ok(Math.abs(shot.hook) < 5 && Math.abs(shot.angle) < 0.01, `sliding over and swiping up threw a hook of ${shot.hook}, at ${shot.angle}`);
      await p.evaluate(() => { pinDrop.speed = 10; });
    }

    // A second finger landing mid-swipe (a hand holding the phone, a child's finger) doesn't throw the swipe away and
    // say "Swipe up to roll". With real touch: the second finger lands on the fifth move, and both lift together.
    // Then a tap from another finger (a pointer of its own) mid-swipe, lifted before the swipe is: no word, and the
    // swipe still throws.
    for (const how of ['lands', 'taps']) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      await wait(4100);   // one word every four seconds at most: room for one now
      await p.evaluate(() => { pinDrop.speed = 1; });
      const at = (i, more) => [{ x: 195, y: 700 - 30 * i, id: 0 }, ...(more ? [{ x: 20, y: 600, id: 1 }] : [])];
      const finger = (type, pointerId) => p.evaluate(([type, pointerId]) => document.getElementById('lane').dispatchEvent(new PointerEvent(type, { pointerId, pointerType: 'touch', isPrimary: false, clientX: 30, clientY: 600, bubbles: true })), [type, pointerId]);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(0) });
      for (let i = 1; i <= 10; i++) {
        await wait(16);
        if (how === 'lands') await cdp.send('Input.dispatchTouchEvent', { type: i === 5 ? 'touchStart' : 'touchMove', touchPoints: at(i, i >= 5) });
        else {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: at(i) });
          if (i === 4) await finger('pointerdown', 77);
          if (i === 6) await finger('pointerup', 77);
        }
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await wait(50);
      assert.equal((await state(p)).phase, 'rolling', `a swipe with a second finger that ${how} mid-swipe threw nothing`);
      assert.notEqual(await p.textContent('#hint'), 'Swipe up to roll', `a second finger that ${how} mid-swipe was told to swipe up`);
      await p.evaluate(() => { pinDrop.speed = 10; });
    }
  } finally { await c.close(); }
}

{
  const { c, p } = await lane({ viewport: { width: 1280, height: 800 } });
  try {
    const mouse = p.mouse;
    // The lane shows it can be grabbed.
    await mouse.move(640, 640);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('lane')).cursor), 'grab');
    // The hint, in a mouse's words: hold the click.
    assert.match(await p.textContent('#hint'), /hold the click and flick up to roll/);
    // Gliding up the trackpad without the click held, and a two-finger swipe (wheel events), throw nothing but say
    // what does: on a trackpad, one finger holds the click and another flicks.
    // But heading for the menu button from the lane at an ordinary speed, or gliding up from halfway down the lane, gets
    // no word (going for the menu set it off).
    const menuAt = await p.evaluate(() => { const b = document.getElementById('menuBtn').getBoundingClientRect(); return { x: b.x + 22, y: b.y + 22 }; });
    for (let i = 0; i <= 20; i++) { const e = (i / 20) ** 2 * (3 - 2 * i / 20); await mouse.move(640 + (menuAt.x - 640) * e, 560 + (menuAt.y - 560) * e); await wait(17); }
    await wait(300);
    assert.notEqual(await p.textContent('#hint'), 'Hold the click as you flick up (on a trackpad, hold with one finger, flick with another)', 'heading for the menu said to hold the click');
    await mouse.move(640, 400);
    for (let i = 1; i <= 8; i++) { await mouse.move(640, 400 - i * 20); await wait(16); }
    await wait(300);
    assert.notEqual(await p.textContent('#hint'), 'Hold the click as you flick up (on a trackpad, hold with one finger, flick with another)', 'gliding up from halfway down the lane said to hold the click');
    await mouse.move(640, 640);
    for (let i = 1; i <= 8; i++) { await mouse.move(640, 640 - i * 20); await wait(16); }
    await wait(300);
    assert.equal(await p.textContent('#hint'), 'Hold the click as you flick up (on a trackpad, hold with one finger, flick with another)', 'gliding up without the click got no word');
    await wait(4100);   // one word every four seconds at most
    await mouse.move(640, 640);
    for (let i = 0; i < 5; i++) { await mouse.wheel(0, -60); await wait(16); }
    await wait(50);
    assert.equal(await p.isVisible('#hint'), true);
    assert.equal(await p.textContent('#hint'), 'On a trackpad, press with one finger and flick up with another', 'a two-finger swipe got no word');
    assert.equal((await state(p)).phase, 'aim');
    // A right-button drag up (a trackpad pressed down with two fingers) throws too, and no menu pops up over the
    // lane. The middle button doesn't pick the ball up.
    await p.evaluate(() => document.addEventListener('contextmenu', e => { window.menuBlocked = e.defaultPrevented; }));
    await mouse.down({ button: 'middle' });
    for (let i = 1; i <= 10; i++) { await mouse.move(640, 640 - i * 35); await wait(12); }
    await mouse.up({ button: 'middle' });
    await wait(50);
    assert.equal((await state(p)).phase, 'aim', 'a middle-button drag threw the ball');
    await mouse.move(640, 640);
    await mouse.down({ button: 'right' });
    for (let i = 1; i <= 10; i++) { await mouse.move(640, 640 - i * 35); await wait(12); }
    await mouse.up({ button: 'right' });
    await wait(50);
    assert.equal((await state(p)).phase, 'rolling', 'a right-button drag (two fingers pressing a trackpad) threw nothing');
    assert.equal(await p.evaluate(() => window.menuBlocked), true, 'the context menu opens over the lane');
    // A slow ball thrown with a mouse or trackpad: the word about it says how to flick faster on a trackpad.
    await p.evaluate(() => { pinDrop.speed = 10; });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await p.evaluate(() => pinDrop.throw({ x: 14, speed: 175, angle: 0.02, hook: 0 }));
    await until(() => p.evaluate(() => pinDrop.phase === 'settle' || pinDrop.phase === 'over'), 20000, 'the slow ball never finished');
    assert.match(await p.textContent('#call'), /Flick faster: on a trackpad, hold with one finger and flick with another/);
  } finally { await c.close(); }
}

// A flick made as the camera comes back to the ball, once the ball is coming onto the screen (0.65 s into the 0.85 s
// return), throws: it used to be dropped without a word. Earlier in the return, with no ball in sight, it's too soon.
{
  const { c, p, cdp } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    // Throws a ball and stops the clock at `at` seconds into the camera's return.
    const into = at => p.evaluate(at => new Promise(done => {
      pinDrop.speed = 4;
      pinDrop.throw({ x: 0, speed: 290, angle: 0, hook: 0 });
      (function frame() {
        if (pinDrop.phase === 'return') pinDrop.speed = 1;
        if (pinDrop.phase === 'return' && pinDrop.phaseT >= at) { pinDrop.speed = 0; done(pinDrop.phaseT); } else requestAnimationFrame(frame);
      })();
    }), at);
    const early = await into(0.5);
    await touchStroke(cdp, [[0, -280, 6]]);
    assert.equal((await state(p)).phase, 'return', `a flick ${early.toFixed(2)} s into the return, before the ball is back, did something`);
    await p.evaluate(() => { pinDrop.speed = 4; });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    const late = await into(0.7);
    assert.ok(late < 0.85, `the clock stopped ${late} s into the return, after it ended`);
    await touchStroke(cdp, [[0, -280, 6]]);
    assert.equal((await state(p)).phase, 'rolling', `a flick ${late.toFixed(2)} s into the return threw nothing`);
    assert.equal(await p.evaluate(() => pinDrop.view.cam.y), await p.evaluate(() => { pinDrop.camera(0); return pinDrop.view.cam.y; }), 'the camera was not back behind the ball for the throw');
  } finally { await c.close(); }
}

// The hint sits just under the ball, or just above it where there's no room under it: on a phone on its side with a
// home bar (an inset at the bottom of the screen) it covered the bottom of the ball.
for (const [width, height, insets] of [[390, 844, { top: 47, bottom: 34, left: 0, right: 0 }], [844, 390, { top: 0, bottom: 21, left: 47, right: 47 }], [844, 390], [820, 1180], [1180, 820]]) {
  const { c, p, cdp } = await lane({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: width < 900, hasTouch: true });
  try {
    if (insets) { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }); await p.evaluate(() => dispatchEvent(new Event('resize'))); }
    await wait(100);
    const r = await p.evaluate(() => {
      const top = pinDrop.view.p(pinDrop.ball.x, pinDrop.ball.y, 8.5)[1], foot = pinDrop.view.p(pinDrop.ball.x, pinDrop.ball.y, 0)[1];
      const q = document.querySelector('#hint .pill').getBoundingClientRect();
      return { top, foot, pillTop: q.top, pillBottom: q.bottom };
    });
    const where = `${width}x${height}${insets ? ' with insets' : ''}`;
    assert.ok(r.pillTop >= r.foot || r.pillBottom <= r.top, `${where}: the hint (${r.pillTop}-${r.pillBottom}) covers the ball (${r.top}-${r.foot})`);
    assert.ok(Math.min(Math.abs(r.pillTop - r.foot), Math.abs(r.top - r.pillBottom)) <= 12, `${where}: the hint (${r.pillTop}-${r.pillBottom}) is far from the ball (${r.top}-${r.foot})`);
    assert.ok(r.pillBottom <= height - (insets?.bottom || 0), `${where}: the hint runs into the bottom edge`);
  } finally { await c.close(); }
}

// The same swipe throws the same ball on a phone, a phone on its side, a tablet either way up and a laptop. (Speed
// was read against the screen's height, so turning a tablet made the same flick about a fifth harder, and a phone on
// its side reached the top speed with a gentle one.)
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const speeds = [];
    for (const [width, height] of [[390, 844], [844, 390], [820, 1180], [1180, 820], [1280, 800]]) {
      await p.setViewportSize({ width, height });
      await wait(50);
      speeds.push(await p.evaluate(() => {
        const pts = [];
        for (let t = 0; t <= 200; t += 8) pts.push({ x: 195, y: 600 - 1.5 * t, t });
        return pinDrop.shotFrom(pts, true).speed;
      }));
    }
    assert.ok(Math.max(...speeds) - Math.min(...speeds) < 0.01, `the same swipe threw at ${speeds.map(v => v.toFixed(1)).join(', ')} in/s`);
  } finally { await c.close(); }
}

// On a phone that only manages about ten frames a second, the ball still rolls at full speed: in 1.5 s it has rolled
// for more than 1.2 s of the game (a frame's step was capped at 1/30 s, so the whole roll played at a third of the speed).
{
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => setTimeout(() => raf(cb), 90); });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  try {
    await p.goto(base);
    await p.click('#start');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 5000, 'never on the lane');
    await p.evaluate(() => { pinDrop.seed = 1; pinDrop.throw({ x: 10, speed: 290, angle: 0.03, hook: -45 }); });
    const t0 = await p.evaluate(() => pinDrop.phaseT);
    await wait(1500);
    const rolled = await p.evaluate(t0 => pinDrop.phase === 'rolling' && pinDrop.phaseT - t0, t0);
    assert.ok(rolled > 1.2, `at ten frames a second the ball rolled for ${rolled} s of the game in 1.5 s`);
  } finally { await c.close(); }
}

// A seed that makes the pocket ball strike, and one that makes a ball at the head pin leave some pins, in node: the
// page plays the same seed and throw out exactly the same way.
const strikeSeed = [...Array(100).keys()].find(k => play(rack(), pocket, k + 1).standing.length === 0) + 1;
const headOn = { x: 0, speed: 290, angle: through(0, 0, 0), hook: 0 };
const leaveSeed = [...Array(100).keys()].find(k => play(rack(), headOn, k + 1).standing.length >= 2) + 1;
const watchCalls = p => p.evaluate(() => {
  window.calls = [];
  new MutationObserver(() => window.calls.push(document.getElementById('call').textContent)).observe(document.getElementById('call'), { childList: true, subtree: true });
});
const upPins = p => p.evaluate(() => pinDrop.pins.filter(q => q.state === 'up').map(q => `${q.id}@${q.x.toFixed(6)},${q.y.toFixed(6)}`));
const freshRack = SPOTS.map((s, i) => `${i + 1}@${s.x.toFixed(6)},${s.y.toFixed(6)}`);

// Four players carry on a game in the tenth frame. The first strikes three times: a fresh rack after each strike,
// Strike!, Double! and Turkey!, X X X in the tenth for 30 more, and then it's the next player's turn. The rest
// throw in the gutter, and the end shows all four.
{
  const nine = Array.from({ length: 18 }, (_, i) => (i % 2 ? 4 : 3));   // nine open frames of 3 and 4: 63
  const names = ['Ana', 'Ben', 'Cy', 'Dee'];
  const current = { players: names.map(name => ({ name, rolls: [...nine], x: 0 })), turn: 0, leftover: null };
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, { names, current });
  try {
    await p.goto(base);
    // Carry on says whose turn it is, and their frame.
    assert.equal(await p.textContent('#resume'), 'Carry on · Ana’s turn, frame 10');
    await p.click('#resume');
    await watchCalls(p);
    await p.evaluate(seed => { pinDrop.speed = 4; pinDrop.seed = seed; }, strikeSeed);
    for (let k = 1; k <= 3; k++) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      assert.equal(await p.evaluate(() => pinDrop.game.turn), 0, `not Ana's ball ${k} in the tenth`);
      assert.deepEqual(await upPins(p), freshRack, `no fresh rack for Ana's ball ${k} in the tenth`);
      // The balls her strikes earned say so.
      assert.equal(await p.textContent('#where'), k === 1 ? 'Frame 10 · ball 1' : 'Frame 10 · bonus ball');
      if (k === 3) await p.evaluate(() => { pinDrop.speed = 1; });   // time to read the scorecard as the turn passes
      await p.evaluate(pocket => pinDrop.throw(pocket), pocket);
      await until(() => p.evaluate(n => pinDrop.game.players[0].rolls.length === n, 18 + k), 20000, `Ana's ball ${k} in the tenth never finished`);
      // As the pins settle after her last ball, the scorecard says who's next, not "Frame 10 · ball 4".
      if (k === 3) assert.equal(await p.textContent('#where'), 'Up next: Ben', 'the scorecard as the turn passes');
      assert.equal(await p.evaluate(() => pinDrop.game.players[0].rolls.at(-1)), 10, `seed ${strikeSeed} didn't strike in the page on ball ${k}`);
    }
    await p.evaluate(() => { pinDrop.speed = 4; });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    const ana = await p.evaluate(() => pinDrop.game.players[0].rolls);
    assert.deepEqual(frames(ana)[9].marks, ['X', 'X', 'X']);
    assert.equal(total(ana), 63 + 30);
    assert.equal(await p.evaluate(() => pinDrop.game.turn), 1, 'the turn did not pass to Ben');
    assert.match(await p.textContent('#who'), /Ben/);
    assert.deepEqual(await upPins(p), freshRack, 'Ben does not face a fresh rack');
    const calls = await p.evaluate(() => window.calls);
    for (const word of ['Strike!', 'Double!', 'Turkey!', 'Ben’s turn']) assert.ok(calls.some(t => t.startsWith(word)), `no "${word}" among ${JSON.stringify(calls)}`);
    // The rest throw in the gutter.
    await until(() => p.evaluate(() => {
      if (pinDrop.phase === 'aim') pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 });
      return pinDrop.phase === 'over';
    }), 60000, 'the game never ended');
    await until(() => p.isVisible('#end'), 5000, 'no end of the game');
    assert.equal(await p.textContent('#endTitle'), 'Ana wins!');
    // By how much: no best to beat on a new phone, so nothing about a new best.
    assert.equal(await p.textContent('#endLine'), '93 to 63');
    assert.deepEqual(await p.$$eval('#endCards .row .name em', els => els.map(e => e.textContent)), ['Winner']);
    const rows = await p.$$eval('#endCards .row', els => els.map(e => ({ tenth: e.querySelectorAll('.f')[9].querySelector('.balls').textContent, sum: +e.querySelector('.f.sum').textContent })));
    assert.deepEqual(rows, [{ tenth: 'XXX', sum: 93 }, { tenth: '--', sum: 63 }, { tenth: '--', sum: 63 }, { tenth: '--', sum: 63 }]);
    console.log(`  four players: three strikes in the tenth with seed ${strikeSeed}, ${rows.map(r => r.sum).join(', ')}`);
  } finally { await c.close(); }
}

// A page with what's kept on this device set to `kept`, on the title with Carry on to tap.
async function kept(options, k) {
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, ...options });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, k);
  await p.goto(base);
  return { c, p };
}
const nineAndMiss = Array.from({ length: 18 }, (_, i) => (i % 2 ? 0 : 9));   // nine frames of 9 and a miss: 81

// The tenth frame began with a strike, then a 7: a gutter ball on the last ball isn't an "open frame" (it has a strike
// in it), and says nothing about the pins it left, since no ball follows. Ana is bowling alone, on a phone where
// Ben's 204 is the best: the end of her first game doesn't tell her "Your best is 204."
{
  const { c, p } = await kept({}, { names: ['Ana'], best: 204, bestBy: 'Ben', bests: { Ben: 204 }, current: { players: [{ name: 'Ana', rolls: [...nineAndMiss, 10, 7], x: 0 }], turn: 0, leftover: [{ id: 4 }, { id: 7 }, { id: 8 }].map(q => ({ ...q, ...SPOTS[q.id - 1] })) } });
  try {
    assert.equal(await p.textContent('#resume'), 'Carry on · frame 10', 'Carry on for a game bowled alone');
    await p.click('#resume');
    assert.equal(await p.evaluate(() => pinDrop.pins.length), 3, 'the 4-7-8 did not come back');
    await watchCalls(p);
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
    await until(() => p.evaluate(() => pinDrop.phase === 'over'), 20000, 'the last ball never finished');
    assert.deepEqual(await p.evaluate(() => pinDrop.game.players[0].rolls.slice(18)), [10, 7, 0], 'the last ball was not a gutter ball');
    assert.equal((await p.evaluate(() => window.calls)).filter(Boolean).at(-1), 'Gutter ball', 'the gutter ball after X 7 in the tenth');
    await until(() => p.isVisible('#end'), 5000, 'no end of the game');
    assert.deepEqual([await p.textContent('#endTitle'), await p.textContent('#endLine')], ['98', 'Your first game here.']);
    await p.click('#toTitle');
    assert.equal(await p.textContent('#record .best'), 'Best game · Ben204', "Ben's best was lost");
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
    assert.deepEqual(saved.bests, { Ben: 204, Ana: 98 });
  } finally { await c.close(); }
}

// Two players tie: the end says who ("Ana and Cal tie!"), both are tagged Tied, and the best game on the title names
// them both. There was a best here to beat (Dee's 80), so it says this is a new one.
{
  const ninety = Array.from({ length: 20 }, (_, i) => (i % 2 ? 0 : 9));
  const { c, p } = await kept({}, { names: ['Ana', 'Cal'], best: 80, bestBy: 'Dee', bests: { Dee: 80 },
    current: { players: [{ name: 'Ana', rolls: ninety, x: 0 }, { name: 'Cal', rolls: ninety.slice(0, 19), x: 0 }], turn: 1, leftover: null } });
  try {
    await p.click('#resume');
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
    await until(() => p.isVisible('#end'), 20000, 'no end of the game');
    assert.deepEqual([await p.textContent('#endTitle'), await p.textContent('#endLine')], ['Ana and Cal tie!', '90 each · a new best here']);
    assert.deepEqual(await p.$$eval('#endCards .row .name em', els => els.map(e => e.textContent)), ['Tied', 'Tied']);
    // Bowl again: each stands where they stood.
    await p.evaluate(() => { pinDrop.game.players[0].x = -6; pinDrop.game.players[1].x = 9; });
    await p.click('#again');
    assert.deepEqual(await p.evaluate(() => [pinDrop.ball.x, pinDrop.game.players.map(q => [q.x, q.rolls.length])]), [-6, [[-6, 0], [9, 0]]], 'Bowl again moved the players');
    await p.click('#menuBtn'); await p.click('#menuQuit'); await p.click('#menuQuit');
    assert.equal(await p.textContent('#record .best'), 'Best game · Ana & Cal90');
  } finally { await c.close(); }
}

// A first strike shows as 10+ while it waits for its bonus balls, in the bowler's total and on the next player's
// scorecard, not as a 0 (its frame stays blank, as on a real card).
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, {}, ['Ana', 'Ben']);
  try {
    await p.evaluate(({ pocket, seed }) => { pinDrop.speed = 4; pinDrop.seed = seed; pinDrop.throw(pocket); }, { pocket, seed: strikeSeed });
    await until(() => p.evaluate(() => pinDrop.game.players[0].rolls.length === 1), 20000, 'the strike never finished');
    assert.equal(await p.evaluate(() => pinDrop.game.players[0].rolls[0]), 10, `seed ${strikeSeed} didn't strike`);
    assert.equal(await p.textContent('#frames .f.sum'), '10+', "Ana's total after her strike");
    assert.equal(await p.textContent('#frames .f .tot'), '', "the strike's frame has a total before its bonus balls");
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    assert.equal(await p.textContent('#others'), 'Ana 10+', "Ana's score on Ben's scorecard");
  } finally { await c.close(); }
}

// For a screen reader: the scorecard button's name says what it shows (the name, the frame, the total) and then what it
// does; each ball and each turn is said in one plain sentence by a polite live region; a callout leaves the page once
// it has faded; and the scorecards are read in words, frame by frame, not as a string of marks.
{
  const { c, p } = await kept({}, { names: ['Ana', 'Ben'], current: { players: [{ name: 'Ana', rolls: [8, 1, 8, 2], x: 0 }, { name: 'Ben', rolls: [9, 0, 7, 2], x: 0 }], turn: 0, leftover: null } });
  try {
    assert.equal(await p.textContent('#resume'), 'Carry on · Ana’s turn, frame 3');
    await p.click('#resume');
    assert.equal(await p.getAttribute('#card', 'aria-label'), null, 'the scorecard button has a name that hides what it shows');
    assert.match(await p.locator('#hud').ariaSnapshot(), /button "Ana Frame 3 · ball 1 total at least 19\. Show the scorecard"/);
    assert.deepEqual(await p.evaluate(() => [document.getElementById('call').getAttribute('aria-live'), document.getElementById('said').getAttribute('aria-live')]), [null, 'polite']);
    assert.equal(await p.textContent('#said'), 'Ana, frame 3.');
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.seed = 1; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
    await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the ball never finished');
    assert.equal(await p.textContent('#said'), 'Ana: Gutter ball.');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await p.evaluate(() => pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }));
    await until(() => p.evaluate(() => pinDrop.game.turn === 1 && pinDrop.phase === 'aim'), 20000, "Ben's turn never came");
    const said = await p.textContent('#said');
    assert.equal(said, 'Ben’s turn, frame 3.');
    await until(() => p.evaluate(() => document.getElementById('call').innerHTML === ''), 4000, 'the callout stayed on the page once it had faded');
    await p.click('#card');
    const rows = await p.$$eval('#boardCards .row', els => els.map(e => [e.querySelector('.frames').getAttribute('aria-hidden'), e.querySelector('.sr').textContent]));
    const rolls = await p.evaluate(() => pinDrop.game.players.map(q => q.rolls));
    assert.deepEqual(rows, rolls.map(r => ['true', cardText(r)]));
    assert.match(rows[0][1], /^Frame 1: 8 and 1, 9\. Frame 2: 8, spare, 19\. Frame 3: miss and miss, 19\. Frames 4 to 10 to come\. Total 19\.$/);
  } finally { await c.close(); }
}

// A ball that hooks into the gutter says why, once a game for each player: Ana's swipe bows left, so it hooks right,
// and from the right of the lane it goes in the right-hand gutter. Her next one says nothing more. Ben's straight
// ball into the gutter isn't a hook; his hook to the left into the left gutter gets the word turned round. The word
// comes ahead of the one about a slow ball.
{
  const { c, p, cdp } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, {}, ['Ana', 'Ben']);
  try {
    await watchCalls(p);
    const ball = async (throwIt, who) => {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      assert.equal(await p.evaluate(() => pinDrop.game.players[pinDrop.game.turn].name), who);
      await p.evaluate(() => { window.calls = []; pinDrop.seed = 1; pinDrop.speed = 1; });
      await throwIt();
      await until(() => p.evaluate(() => pinDrop.phase === 'rolling'), 3000, 'nothing was thrown');
      const said = await p.textContent('#readout');
      await p.evaluate(() => { pinDrop.speed = 4; });
      await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the ball never finished');
      return { said, side: await p.evaluate(() => pinDrop.ball.side), call: (await p.evaluate(() => window.calls)).at(-1) };
    };
    // Ana moves the ball to the right, then swipes up with a bow to the left.
    await touchStroke(cdp, [[90, 0, 6]], 195, 660);
    const curved = await ball(async () => {
      const path = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; path.push([285 - 36 * Math.sin(t * Math.PI), 660 - 320 * t]); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: path[0][0], y: path[0][1] }] });
      for (const [x, y] of path.slice(1)) { await wait(12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }, 'Ana');
    assert.match(curved.said, /hook right/);
    assert.equal(curved.side, 1, 'the curved swipe did not go in the right-hand gutter, so this checks nothing');
    assert.equal(curved.call, 'Gutter ballYour swipe curved, so it hooked right: swipe straighter or stand further left');
    // The tip is on a dark pill, to read where it lands over the lane's light wood.
    assert.equal(await p.$eval('#call .tip', e => getComputedStyle(e).backgroundColor), 'rgba(13, 18, 34, 0.75)', 'the tip sits on bare wood');
    const again = await ball(() => p.evaluate(() => pinDrop.throw({ x: 10, speed: 290, angle: 0, hook: 45 })), 'Ana');
    assert.equal(again.side, 1);
    assert.doesNotMatch(again.call, /curved/, 'the word about a hook into the gutter came twice in a game');
    const straight = await ball(() => p.evaluate(() => pinDrop.throw({ x: 14, speed: 290, angle: 0.02, hook: 0 })), 'Ben');
    assert.equal(straight.side, 1);
    assert.doesNotMatch(straight.call, /curved/, 'a straight ball into the gutter was called a hook');
    const slowLeft = await ball(() => p.evaluate(() => pinDrop.throw({ x: -10, speed: 175, angle: 0, hook: -45 })), 'Ben');
    assert.equal(slowLeft.side, -1);
    assert.equal(slowLeft.call, 'Gutter ballopen frameYour swipe curved, so it hooked left: swipe straighter or stand further right');
  } finally { await c.close(); }
}

// Reloading the page at any moment of a ball, and tapping Carry on, picks up the game as it was saved: a ball still
// rolling is thrown again, and once it has stopped it counts, with the pins it left (or a fresh rack) and the turn
// passed on if the frame is over. Twice through: as the ball rolls, as the pins settle, during the sweep and as the
// camera comes back.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, {}, ['Ana', 'Ben']);
  try {
    for (const at of ['rolling', 'settle', 'sweep', 'return', 'rolling', 'settle', 'sweep', 'return']) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      const was = await p.evaluate(() => ({ turn: pinDrop.game.turn, rolls: pinDrop.game.players.map(q => q.rolls.slice()) }));
      const pinsWas = await upPins(p);
      // A full rack: a ball at the head pin that leaves pins. Pins left: a ball at them.
      await p.evaluate(({ headOn, leaveSeed }) => {
        pinDrop.speed = 2;
        const up = pinDrop.pins.filter(q => q.state === 'up');
        pinDrop.seed = leaveSeed;
        if (up.length === 10) { pinDrop.throw(headOn); return; }
        const x = Math.max(-14, Math.min(14, up.reduce((s, q) => s + q.x, 0) / up.length));
        pinDrop.throw({ x, speed: 290, angle: 0, hook: 0 });
      }, { headOn, leaveSeed });
      // What the ball left, as soon as it stopped, and then wait for the moment to reload at.
      let left = null;
      await until(async () => {
        const ph = await p.evaluate(() => pinDrop.phase);
        if (!left && ph !== 'rolling') left = await upPins(p);
        return ph === at;
      }, 20000, `never got to ${at}`);
      const after = await p.evaluate(() => pinDrop.game.players.map(q => q.rolls.slice()));
      await p.reload();
      await p.click('#resume');
      const now = { turn: await p.evaluate(() => pinDrop.game.turn), rolls: await p.evaluate(() => pinDrop.game.players.map(q => q.rolls)), pins: await upPins(p) };
      if (at === 'rolling') {
        assert.deepEqual(now, { ...was, pins: pinsWas }, 'reloaded while the ball rolled');
      } else {
        const mine = after[was.turn], st = next(mine), frameOver = st.frame !== next(was.rolls[was.turn]).frame;
        assert.equal(mine.length, was.rolls[was.turn].length + 1, `reloaded at ${at}: the ball didn't count`);
        assert.deepEqual(now, { turn: frameOver ? 1 - was.turn : was.turn, rolls: after, pins: st.fresh ? freshRack : left }, `reloaded at ${at}`);
      }
    }
    console.log('  carried on after a reload as the ball rolled, the pins settled, the sweep and the return, twice');
  } finally { await c.close(); }
}

// The hint is for each player's first few balls: on a phone that has seen plenty of throws, a new player in a
// two-player game still sees it on their first ball.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }, { throws: 6, thrown: { You: 6 } }, ['You', 'Player 2']);
  try {
    assert.equal(await p.isVisible('#hint'), false, 'the hint is still up for a player with six balls behind them');
    await p.evaluate(() => { pinDrop.speed = 10; });
    await until(() => p.evaluate(() => {
      if (pinDrop.phase === 'aim' && pinDrop.game.turn === 0) pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 });
      return pinDrop.phase === 'aim' && pinDrop.game.turn === 1;
    }), 30000, 'Player 2 never came up');
    assert.equal(await p.isVisible('#hint'), true, "no hint on Player 2's first ball");
  } finally { await c.close(); }
}

// The first player keeps the name You: it's "Your turn" (never "You’s turn") as the turn comes round, and "You win!".
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true }, {}, ['You', 'Player 2']);
  try {
    await p.evaluate(() => {
      window.calls = [document.getElementById('call').textContent];
      new MutationObserver(() => window.calls.push(document.getElementById('call').textContent)).observe(document.getElementById('call'), { childList: true, subtree: true });
      window.wheres = [];
      new MutationObserver(() => window.wheres.push(document.getElementById('where').textContent)).observe(document.getElementById('where'), { childList: true, subtree: true, characterData: true });
    });
    await p.evaluate(() => { pinDrop.speed = 10; });
    let turns = 0, was = 0;
    await until(async () => {
      const turn = await p.evaluate(() => {
        if (pinDrop.phase === 'aim') pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 });
        return pinDrop.game.turn;
      });
      if (turn !== was) { turns++; was = turn; }
      return turns >= 2;
    }, 60000, 'the turn never came back round to You');
    await wait(300);
    const calls = await p.evaluate(() => window.calls);
    assert.ok(calls.some(t => t.startsWith('Your turn')), `no "Your turn" among ${JSON.stringify(calls)}`);
    assert.ok(!calls.some(t => /You’s turn/i.test(t)), `"You’s turn" among ${JSON.stringify(calls)}`);
    // And the scorecard, as the turn passes: "Up next: Player 2", then "Up next: you".
    const wheres = await p.evaluate(() => window.wheres);
    for (const w of ['Up next: Player 2', 'Up next: you']) assert.ok(wheres.includes(w), `no "${w}" among ${JSON.stringify(wheres)}`);
  } finally { await c.close(); }
  // The last ball of a game You win.
  const nines = Array.from({ length: 19 }, (_, i) => (i % 2 ? 0 : 9));
  const end = { players: [{ name: 'You', rolls: nines, x: 0 }, { name: 'Player 2', rolls: Array(20).fill(0), x: 0 }], turn: 0, leftover: null };
  const { c: c2, p: p2 } = await lane({ viewport: { width: 390, height: 844 }, hasTouch: true }, { current: end }, ['You', 'Player 2']);
  try {
    // lane() tapped Bowl, which asks again with a game going: carry on with it instead.
    await p2.click('#players li:first-child input');
    assert.equal(await p2.textContent('#resume'), 'Carry on · your turn, frame 10');
    await p2.click('#resume');
    await p2.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
    await until(() => p2.isVisible('#end'), 20000, 'the game never ended');
    assert.equal(await p2.textContent('#endTitle'), 'You win!');
    // And the best game on the title isn't "Best game · You".
    await p2.click('#toTitle');
    assert.equal(await p2.textContent('#record .best span'), 'Best game');
  } finally { await c2.close(); }
}

// A pin lying with its end towards the camera, as every pin in the gutter nearly does, is drawn as the round end of
// it, not a sliver: it covers about as much of the screen as its widest slice does.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  try {
    const cover = await p.evaluate(async () => {
      const { Renderer } = await import('./js/render.js');
      const cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;left:0;top:0;width:390px;height:844px;visibility:hidden';
      document.body.append(cv);
      const v = new Renderer(cv); v.setCamera(1, 0);
      const g = v.g, out = {};
      for (const [name, a] of [['side-on', 0], ['end-on', Math.PI / 2], ['end-on, the other way', -Math.PI / 2]]) {
        g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
        v.pin({ state: 'down', x: 0, y: 735, a }, {});
        const d = g.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 120) n++;
        const s = v.p(0, 735)[2];
        out[name] = n / (Math.PI * (2.38 * s) ** 2);
      }
      cv.remove();
      return out;
    });
    for (const [name, k] of Object.entries(cover)) assert.ok(k > 0.8, `a pin lying ${name} covers ${k.toFixed(2)} of its widest slice`);
  } finally { await c.close(); }
}

// The camera follows a ball into the gutter and back to the middle without jumping: the head pin never moves more
// than 3 px on screen in a sixtieth of a second (it jumped 34 px in one frame as the ball dropped into the gutter).
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    for (const shot of [{ x: 14, speed: 290, angle: 0.01, hook: 0 }, { x: 10, speed: 290, angle: 0.03, hook: -45 }]) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      const jump = await p.evaluate(shot => new Promise(done => {
        pinDrop.throw(shot);
        let last = null, most = 0;
        (function frame(now) {
          const x = pinDrop.view.p(0, 720)?.[0];
          if (last && x !== undefined && last.x !== undefined) most = Math.max(most, Math.abs(x - last.x) / Math.max(1, (now - last.now) / (1000 / 60)));
          last = { x, now };
          if (pinDrop.phase === 'rolling' || pinDrop.phase === 'settle') requestAnimationFrame(frame); else done(most);
        })(performance.now());
      }), shot);
      assert.ok(jump < 3, `the head pin jumped ${jump.toFixed(1)} px in a frame for ${JSON.stringify(shot)}`);
    }
  } finally { await c.close(); }
}

// A ball's callout stays off the Pin Drop sign over the pins (it used to land on it on a tablet), and the call for
// the next player's turn stays off the pins they're aiming at: on a phone, and a tablet either way up.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, hasTouch: true }, {}, ['Ana', 'Ben']);
  try {
    const call = () => p.evaluate(() => {
      const el = document.getElementById('call'), top = parseFloat(el.style.top);
      return { text: el.textContent, top, bottom: top + el.offsetHeight, ...pinDrop.view.spots() };
    });
    for (const [width, height] of [[390, 844], [820, 1180], [1180, 820]]) {
      await p.setViewportSize({ width, height });
      await wait(100);
      const turn = await p.evaluate(() => pinDrop.game.turn);
      await p.evaluate(() => { pinDrop.speed = 3; });
      for (let k = 0; k < 3 && await p.evaluate(t => pinDrop.game.turn === t, turn); k++) {
        await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
        await p.evaluate(() => pinDrop.throw({ x: 10, speed: 290, angle: 0.03, hook: -45 }));
        await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the ball never finished');
        const b = await call();
        assert.ok(b.bottom <= b.signTop || b.top >= b.signBottom, `at ${width}x${height} "${b.text}" (${b.top}–${b.bottom}) is on the sign (${b.signTop}–${b.signBottom})`);
        await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      }
      const t = await call();
      assert.match(t.text, /’s turn/);
      assert.ok(t.top >= t.aimDeckFront, `at ${width}x${height} "${t.text}" (from ${t.top}) is over the pins (down to ${t.aimDeckFront})`);
    }
  } finally { await c.close(); }
}

// The contrast between two colours written rgb(r, g, b), by WCAG 2.2's relative luminance.
const contrast = (a, b) => {
  const lum = c => c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
// The scorecard along the top keeps clear of the other players' scores under it, once there are totals in it too,
// with four players whose long names wrap the scores onto two lines, on a phone and a tablet either way up.
for (const names of [['Ana', 'Ben'], ['Alexandrinaaaa', 'Bartholomewwww', 'Christabellaaa', 'Dmitrijevichhh']]) {
  const current = { players: names.map(name => ({ name, rolls: [7, 2, 10, 8, 1], x: 0 })), turn: 0, leftover: null };
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, { names, current });
  try {
    await p.goto(base);
    await p.click('#resume');
    for (const [width, height] of [[390, 844], [820, 1180], [1180, 820]]) {
      await p.setViewportSize({ width, height });
      await wait(50);
      const { card, chips, wrapped } = await p.evaluate(() => {
        const r = id => document.getElementById(id).getBoundingClientRect();
        const spans = [...document.querySelectorAll('#others span')].map(el => el.getBoundingClientRect().top);
        return { card: r('card').bottom, chips: r('others').top, wrapped: new Set(spans).size > 1 };
      });
      assert.ok(card <= chips, `${names.length} players at ${width}x${height}: the scorecard (bottom ${card}) runs over the other players' scores (top ${chips})`);
      if (names.length === 4 && width === 390) assert.ok(wrapped, 'the long names fit on one line, so this checks less than it means to');
      // Each player's dot can be seen on the dark card (3:1 or more), and so can the frame being bowled.
      const { dots, now } = await p.evaluate(() => ({
        dots: [...document.querySelectorAll('#who i, #others i')].map(el => getComputedStyle(el).backgroundColor),
        now: getComputedStyle(document.querySelector('#frames .f.now')).boxShadow,
      }));
      assert.equal(dots.length, names.length);
      for (const dot of dots) assert.ok(contrast(dot, 'rgb(13, 18, 34)') >= 3, `a player's dot (${dot}) is ${contrast(dot, 'rgb(13, 18, 34)').toFixed(2)}:1 on the card`);
      assert.match(now, /inset/, 'the frame being bowled has no bar under it');
    }
  } finally { await c.close(); }
}

// The rumble of a rolling ball stops behind the menu (the roll stands still there), and nothing plays while the page
// is out of sight. Every gain node is watched; the rumble is the one that isn't a fixed level.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await p.evaluate(() => {
      const AC = window.AudioContext, make = AC.prototype.createGain;
      window.gains = [];
      AC.prototype.createGain = function () { const g = make.call(this); window.gains.push(g); return g; };
      const resume = AC.prototype.resume, suspend = AC.prototype.suspend;
      AC.prototype.resume = function () { window.audio = this; return resume.call(this); };
      AC.prototype.suspend = function () { window.audio = this; return suspend.call(this); };
    });
    // A rumble is the gain that changes; the others are set once (the master, the pulse and its depth).
    const loudest = () => p.evaluate(() => Math.max(0, ...gains.filter(g => ![0.9, 1, 0.28].includes(+g.gain.value.toFixed(3))).map(g => g.gain.value)));
    await p.evaluate(() => { pinDrop.seed = 1; pinDrop.throw({ x: 0, speed: 290, angle: 0, hook: 0 }); });
    await wait(1000);
    assert.equal(await p.evaluate(() => pinDrop.phase), 'rolling');
    assert.ok(await loudest() > 0.1, 'no rumble while the ball rolls, so this check checks nothing');
    await p.click('#menuBtn');
    await wait(300);
    const left = await loudest();
    assert.ok(left < 0.02, `the rumble is still at ${left.toFixed(3)} behind the menu`);
    await p.click('#menuResume');
    await wait(300);
    assert.ok(await loudest() > 0.1, 'the rumble did not come back on the lane');
    // Another app or tab: the sound stops, and carries on when the page is back.
    const hide = on => p.evaluate(h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, on);
    await hide(true); await wait(100);
    assert.equal(await p.evaluate(() => window.audio?.state), 'suspended', 'the sound plays on while the page is hidden');
    await hide(false); await wait(100);
    assert.equal(await p.evaluate(() => window.audio?.state), 'running', 'the sound did not come back with the page');
  } finally { await c.close(); }
}

// With Reduce Motion on, a callout fades in and out where it stands: no popping up, growing or drifting.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.throw({ x: 14, speed: 290, angle: 0.02, hook: 0 }); });
    await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the ball never finished');
    const looks = await p.evaluate(() => {
      const el = document.getElementById('call'), cs = getComputedStyle(el);
      const keys = el.getAnimations()[0]?.effect.getKeyframes() || [];
      return { name: cs.animationName, transform: cs.transform, moves: keys.some(k => k.transform && k.transform !== 'none') };
    });
    assert.equal(looks.name, 'fade', 'the callout still pops with Reduce Motion on');
    assert.equal(looks.moves, false, 'the callout moves with Reduce Motion on');
    assert.match(looks.transform, /^matrix\(0\.998/, `the callout isn't tilted as usual (${looks.transform})`);
  } finally { await c.close(); }
}

// A game left half-way: one tap on Bowl doesn't throw it away. It asks for a second tap, which starts over.
{
  const current = { players: [{ name: 'Ana', rolls: [7, 2, 10], x: 0 }, { name: 'Ben', rolls: [5, 4], x: 0 }], turn: 1, leftover: null };
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, { names: ['Ana', 'Ben'], current });
  try {
    await p.goto(base);
    const kept = () => p.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')).current);
    assert.equal(await p.isVisible('#resume'), true);
    await p.click('#start');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'title', 'one tap on Bowl started a new game over the saved one');
    assert.deepEqual(await kept(), current, 'one tap on Bowl changed the saved game');
    assert.equal(await p.textContent('#start'), 'Tap again to start over');
    // Anything else on the title calls it off.
    await p.click('#players li:first-child input');
    assert.equal(await p.textContent('#start'), 'Bowl');
    await p.click('#start'); await p.click('#start');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'aim', 'two taps on Bowl did not start a new game');
    assert.deepEqual((await kept()).players.map(q => q.rolls), [[], []]);
  } finally { await c.close(); }
}

// The recent games on the title, with four players at the longest names there can be: the date stays on one line, a
// name never parts from its score at the end of a line, and the winner's score is gold (each top score in a tie, and
// nobody's in a game bowled alone). Kept text where a score belongs is shown as a number, never as HTML.
{
  const names = ['Wolfgang-Maxim', 'Bartholomew Jo', 'Gwendolyn Rose', 'Maximilian Wxy'];
  const games = [
    { at: Date.UTC(2026, 10, 21, 15), scores: names.map((name, i) => ({ name, score: [182, 240, 151, 99][i] })) },
    { at: Date.UTC(2026, 10, 21, 14), scores: [{ name: 'Ben', score: 120 }, { name: 'Cal', score: 120 }, { name: 'Ana', score: 97 }] },
    { at: Date.UTC(2026, 10, 20, 14), scores: [{ name: 'Ana', score: 133 }] },
    { at: Date.UTC(2026, 10, 19, 14), scores: [{ name: 'Ana', score: '<img src=x onerror="window.ran=1">' }] },
  ];
  const { c, p } = await kept({ viewport: { width: 360, height: 640 } }, { names, games });
  try {
    for (const width of [360, 390]) {
      await p.setViewportSize({ width, height: 800 });
      const rows = await p.$$eval('#record li', els => els.map(li => ({
        whenLines: li.querySelector('.when').getClientRects().length,
        whenTall: li.querySelector('.when').getBoundingClientRect().height,
        pairsSplit: [...li.querySelectorAll('.pair')].filter(s => s.getBoundingClientRect().height > 30).map(s => s.textContent),
        gold: [...li.querySelectorAll('b.won')].map(b => b.textContent),
        lineHeight: parseFloat(getComputedStyle(li).lineHeight),
      })));
      for (const r of rows) {
        assert.ok(r.whenTall < r.lineHeight * 1.5, `at ${width} px a date wraps onto two lines`);
        assert.deepEqual(r.pairsSplit, [], `at ${width} px a name is parted from its score`);
      }
      assert.deepEqual(rows.map(r => r.gold), [['240'], ['120', '120'], [], []]);
    }
    assert.equal(await p.textContent('#record li:nth-child(4) .scores'), 'Ana 0');
    assert.equal(await p.evaluate(() => window.ran), undefined, 'kept text was put on the page as HTML');
    assert.match(await p.textContent('#record li:nth-child(2) .scores'), /Ben 120 tied · Cal 120 tied · Ana 97/);
  } finally { await c.close(); }
}

// A browser that won't let Pin Drop keep anything (site data blocked, a private window with no room) gets one word
// about it: under the record on the title when that's known as the page opens, or else in the hint's place as the
// next ball is aimed, the first time a save fails. Never again after each ball.
{
  const blockedLine = 'This browser isn’t letting Pin Drop keep games, so a reload starts over.';
  const hints = p => p.evaluate(t => {
    window.saidBlocked = 0;
    new MutationObserver(() => { if (document.getElementById('hint').textContent === t) window.saidBlocked++; })
      .observe(document.getElementById('hint'), { childList: true, subtree: true, characterData: true });
  }, blockedLine);
  const twoBalls = async p => {
    for (let k = 0; k < 2; k++) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      await p.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
      await until(() => p.evaluate(() => pinDrop.phase !== 'rolling'), 20000, 'the ball never finished');
    }
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
  };
  // Every write refused, from the start.
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('no room', 'QuotaExceededError'); }; });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  try {
    await p.goto(base);
    assert.deepEqual(await p.$$eval('#record .blocked', els => els.map(e => e.textContent)), [blockedLine], 'the title says nothing about keeping games');
    await p.click('#start');
    await hints(p);
    await twoBalls(p);
    assert.equal(await p.evaluate(() => window.saidBlocked), 0, 'said again in the game, after the title had said it');
    await p.click('#menuBtn'); await p.click('#menuQuit'); await p.click('#menuQuit');
    assert.equal(await p.locator('#record .blocked').count(), 1);
  } finally { await c.close(); }
  // Writes refused from the middle of a game on: said once, as the next ball is aimed.
  const c2 = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c2.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...a) { if (window.refuse) throw new DOMException('no room', 'QuotaExceededError'); return set.apply(this, a); };
  });
  const p2 = await c2.newPage();
  p2.on('pageerror', e => problems.push(e.message));
  try {
    await p2.goto(base);
    assert.equal(await p2.locator('#record .blocked').count(), 0, 'the title says games are not kept, when they are');
    await p2.click('#start');
    await hints(p2);
    await p2.evaluate(() => { window.refuse = true; });
    await twoBalls(p2);
    await twoBalls(p2);
    assert.equal(await p2.evaluate(() => window.saidBlocked), 1, 'not said exactly once in the game');
  } finally { await c2.close(); }
}

// The sheets are dialogs: opening one puts the focus on its heading, with the lane and the scorecard along the top out
// of reach behind it; closing it puts the focus back on what opened it (the menu button, when that was in the menu).
// Escape closes the menu, How to play and the scorecard, and on the lane opens the menu.
{
  const { c, p } = await kept({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false },
    { names: ['Ana', 'Ben'], current: { players: [{ name: 'Ana', rolls: Array(19).fill(0), x: 0 }, { name: 'Ben', rolls: Array(18).fill(0), x: 0 }], turn: 0, leftover: null } });
  const focus = () => p.evaluate(() => { const a = document.activeElement; return `${a.closest('section, header')?.id || ''} ${a.id || a.tagName} ${a.textContent.trim().slice(0, 20)}`.trim(); });
  try {
    await p.click('#resume');
    await p.click('#menuBtn');
    assert.equal(await p.evaluate(() => document.getElementById('menu').contains(document.activeElement)), true, 'the focus stayed behind the menu');
    assert.equal(await focus(), 'menu menuTitle Paused');
    assert.match(await p.locator('#menu').ariaSnapshot(), /dialog "Paused"/);
    assert.deepEqual(await p.evaluate(() => ['lane', 'hud', 'hint', 'readout', 'call'].map(id => document.getElementById(id).inert)), [true, true, true, true, true], 'the lane can still be reached behind the menu');
    assert.equal(await p.getAttribute('#menuSound', 'aria-pressed'), 'true');
    await p.click('#menuSound');
    assert.equal(await p.getAttribute('#menuSound', 'aria-pressed'), 'false');
    await p.keyboard.press('Escape');
    assert.equal(await p.isHidden('#menu'), true, 'Escape left the menu open');
    assert.equal(await focus(), 'hud menuBtn', 'the focus did not come back to the menu button');
    assert.equal(await p.evaluate(() => document.getElementById('lane').inert), false);
    // The scorecard from the menu: back on the menu button. From the card along the top: back on the card.
    await p.click('#menuBtn'); await p.click('#menuBoard');
    assert.equal(await focus(), 'board boardTitle Scorecard');
    await p.keyboard.press('Escape');
    assert.equal(await focus(), 'hud menuBtn');
    await p.click('#card');
    await p.keyboard.press('Escape');
    assert.equal(await p.isHidden('#board'), true);
    assert.match(await focus(), /^hud card /, 'the focus did not come back to the scorecard button');
    // How to play from the menu, closed with Escape.
    await p.click('#menuBtn'); await p.click('#menuHow');
    assert.equal(await focus(), 'howSheet howTitle How to play');
    await p.keyboard.press('Escape');
    assert.deepEqual([await p.isHidden('#howSheet'), await focus()], [true, 'hud menuBtn']);
    // Escape on the lane opens the menu.
    await p.keyboard.press('Escape');
    assert.equal(await p.isVisible('#menu'), true, 'Escape on the lane did not open the menu');
    await p.click('#menuResume');
    // The end of the game: the focus on who won, with the line under it.
    await p.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
    await until(() => p.evaluate(() => { if (pinDrop.phase === 'aim') pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); return !document.getElementById('end').hidden; }), 30000, 'no end of the game');
    assert.equal(await focus(), 'end endTitle Ana and Ben tie!');
    assert.equal(await p.getAttribute('#end', 'aria-describedby'), 'endLine');
    // Bowl again: on the lane, the focus on the menu button.
    await p.click('#again');
    assert.equal(await focus(), 'hud menuBtn');
  } finally { await c.close(); }
}

// The title is a form: Enter in a name bowls (twice, over a saved game, as Bowl asks), each remove button is named for
// the player as their name is typed, and removing a player from the keyboard puts the focus on the name now in its place.
{
  const { c, p } = await kept({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }, { names: ['You'] });
  try {
    await p.click('#addPlayer');
    await p.click('#addPlayer');
    await p.fill('#players li:nth-child(2) input', 'Ben');
    assert.deepEqual(await p.$$eval('#players button', els => els.map(e => e.getAttribute('aria-label'))), ['Remove You', 'Remove Ben', 'Remove Player 3']);
    await p.fill('#players li:nth-child(2) input', '');
    assert.equal(await p.getAttribute('#players li:nth-child(2) button', 'aria-label'), 'Remove Player 2');
    await p.fill('#players li:nth-child(2) input', 'Ben');
    await p.focus('#players li:nth-child(2) button');
    await p.keyboard.press('Enter');
    assert.deepEqual(await p.$$eval('#players input', els => els.map(e => e.value)), ['You', 'Player 3']);
    assert.equal(await p.evaluate(() => document.activeElement === document.querySelector('#players li:nth-child(2) input')), true, 'removing a player dropped the focus');
    await p.fill('#players li:nth-child(1) input', 'Ana');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'aim', 'Enter in a name did not bowl');
    // Nothing keeps the focus on the lane: the name's focus ring would otherwise go on to the menu button and stay
    // there all game (Go on a phone's keyboard is Enter too).
    assert.equal(await p.evaluate(() => document.activeElement === document.body), true, 'the focus ring went from the name to the menu button');
    assert.deepEqual(await p.evaluate(() => pinDrop.game.players.map(q => q.name)), ['Ana', 'Player 3']);
    // Over a saved game, Enter asks again first, like Bowl.
    await p.reload();
    assert.equal(await p.isVisible('#resume'), true);
    await p.focus('#players li:nth-child(1) input');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'title', 'one Enter started over the saved game');
    assert.equal(await p.textContent('#start'), 'Tap again to start over');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'aim', 'a second Enter did not start over');
  } finally { await c.close(); }
}

// Two windows of Pin Drop (a home-screen copy and a browser tab share what's kept): A finishes a game while B sits on
// the title, and B's title shows it straight away. Then B starts a game and throws a ball, and A's game and the best
// it set are still kept (B used to write its own stale copy over them).
{
  const nines = Array.from({ length: 19 }, (_, i) => (i % 2 ? 0 : 9));
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await c.addInitScript(k => { if (!localStorage.getItem('pin-drop.v1')) localStorage.setItem('pin-drop.v1', JSON.stringify(k)); },
    { names: ['Ana'], best: 50, bestBy: 'Cal', bests: { Cal: 50 }, games: [{ at: 1000, scores: [{ name: 'Cal', score: 50 }] }],
      current: { players: [{ name: 'Ana', rolls: nines, x: 0 }], turn: 0, leftover: null } });
  const a = await c.newPage(), b = await c.newPage();
  for (const p of [a, b]) p.on('pageerror', e => problems.push(e.message));
  const stored = p => p.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
  try {
    await a.goto(base); await b.goto(base);
    await a.click('#resume');
    await a.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
    await until(() => a.isVisible('#end'), 20000, "A's game never ended");
    const after = await stored(a);
    const anaGame = after.games[0];
    assert.equal(after.best, anaGame.scores[0].score, 'A set no new best, so this checks less than it means to');
    // B's title, without a reload: the new best, A's game in the list, and no Carry on for the game that's over.
    await until(() => b.evaluate(() => document.getElementById('resume').hidden), 3000, "B still offers to carry on A's finished game");
    assert.match(await b.textContent('#record .best'), new RegExp(`Best game · Ana${after.best}$`));
    assert.equal(await b.locator('#record li').count(), 2);
    await b.click('#start');
    await b.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
    await until(() => b.evaluate(() => pinDrop.phase === 'aim' && pinDrop.game.players[0].rolls.length === 1), 20000, "B's ball never finished");
    const now = await stored(b);
    assert.equal(now.best, after.best, "B's ball lost the best");
    assert.equal(now.bestBy, 'Ana');
    assert.deepEqual(now.games, after.games, "B's ball lost A's game");
    assert.deepEqual(now.current.players[0].rolls.length, 1, "B's game in progress wasn't kept");
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
// Every icon the page and the manifest name is kept for offline too (adding to the home screen with no signal).
const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
const linked = [...(await readFile(join(root, 'index.html'), 'utf8')).matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="([^"]+)"/g)].map(m => m[1]);
for (const f of [...manifest.icons.map(i => i.src), ...linked]) assert.ok(shell.includes(f), `${f} isn't in sw.js's SHELL, so it isn't there offline`);
const all = createHash('sha1');
for (const f of shell) all.update(createHash('sha1').update(await readFile(join(root, f.endsWith('/') ? f + 'index.html' : f))).digest());
const files = all.digest('hex').slice(0, 8);
assert.equal(sw.match(/const FILES = '([0-9a-f]*)'/)?.[1], files, `a file sw.js keeps for offline has changed: set FILES in sw.js to '${files}'`);
console.log('all good');

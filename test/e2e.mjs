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
// A request that fails while the server is down (see 'Works offline' below) is expected; one at any other time isn't.
page.on('requestfailed', r => problems.push((net === 'up' ? 'failed: ' : 'failed with the network down: ') + r.url()));
page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });

// Every sound that starts finishes: each buffer source and oscillator is counted when it starts and when it ends.
await page.addInitScript(() => {
  window.sounds = { started: 0, ended: 0 };
  for (const make of ['createBufferSource', 'createOscillator']) {
    const made = BaseAudioContext.prototype[make];
    BaseAudioContext.prototype[make] = function (...args) {
      const node = made.apply(this, args), start = node.start;
      node.start = function (...when) {
        sounds.started++;
        node.addEventListener('ended', () => sounds.ended++, { once: true });
        return start.apply(this, when);
      };
      return node;
    };
  }
});
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

// Play the rest of the game fast: each ball hooked into the pocket (which strikes about two times in three), or aimed
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
// Each player's balls are kept with the game, not only the score, and which of them left splits (by their place).
assert.deepEqual(saved.games[0].scores.map(({ splits, ...q }) => q), rolls.map((r, i) => ({ name: ['Ana', 'Ben'][i], score: total(r), rolls: r })));
assert.ok(saved.games[0].scores.every(q => Array.isArray(q.splits) && q.splits.every(k => Number.isInteger(k) && k < q.rolls.length)), 'the splits kept with the game');
assert.equal(saved.current, null);
console.log('  a two-player game:', scores.join(' and '));
// The knocks, chimes, rumbles and sweeps of a whole game have finished, bar the few still sounding as it ends: none
// is left running for good, getting louder and costing more with every ball.
const sounds = await page.evaluate(() => window.sounds);
assert.ok(sounds.started > 100, `only ${sounds.started} sounds in a whole game, so this checks nothing`);
assert.ok(sounds.started - sounds.ended < 15, `${sounds.started - sounds.ended} of the game's ${sounds.started} sounds never finished`);
console.log(`  sounds: ${sounds.started} started, ${sounds.started - sounds.ended} still going at the end`);

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
    // The guide on the lane is the ball's own path, worked out from the physics, to 50 feet (or the gutter).
    const drawn = await p.evaluate(() => pinDrop.view.guidePts?.at(-1));
    assert.ok(drawn && (drawn.y === 600 || drawn.edge), `the guide drawn while swiping ends at ${JSON.stringify(drawn)}`);
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
    // A slow ball with more hook than it can carry, into the gutter: too much hook for its speed, and how to flick
    // faster on a trackpad, in the same words.
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await p.evaluate(() => pinDrop.throw({ x: -10, speed: 175, angle: 0, hook: -45 }));
    await until(() => p.evaluate(() => pinDrop.phase === 'settle' || pinDrop.phase === 'over'), 20000, 'the slow hooked ball never finished');
    assert.match(await p.textContent('#call .tip'), /^Too much hook for a ball that slow: flick faster or curve less\. On a trackpad, hold with one finger and flick with another$/);
    // A mouse or trackpad flick counts one and a half times as hard as the same flick on a touch screen: the ball's
    // speed is what the swipe's own points throw with a gain of 1.5, not 1.
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await p.evaluate(() => {
      window.flick = [];
      const keep = e => { for (const q of (e.getCoalescedEvents?.() || []).length ? e.getCoalescedEvents() : [e]) flick.push({ x: q.clientX, y: q.clientY, t: q.timeStamp }); };
      document.getElementById('lane').addEventListener('pointerdown', keep, true);
      document.getElementById('lane').addEventListener('pointermove', e => { if (e.buttons) keep(e); }, true);
    });
    await mouse.move(640, 640); await mouse.down();
    for (let i = 1; i <= 12; i++) { await mouse.move(640, 640 - i * 22); await wait(20); }
    await mouse.up();
    await wait(50);
    const flicked = await p.evaluate(() => ({ phase: pinDrop.phase, speed: pinDrop.shot.speed, touch: pinDrop.shotFrom(flick, true, 1).speed, mouse: pinDrop.shotFrom(flick, true, 1.5).speed }));
    assert.equal(flicked.phase, 'rolling', 'the mouse flick threw nothing');
    assert.ok(flicked.mouse > flicked.touch + 15, `the test flick is too fast or slow to tell: ${JSON.stringify(flicked)}`);
    assert.ok(Math.abs(flicked.speed - flicked.mouse) < 3, `a mouse flick threw at ${flicked.speed} in/s, not ${flicked.mouse.toFixed(0)} (on a touch screen it throws ${flicked.touch.toFixed(0)})`);
    console.log(`  mouse flick: ${(flicked.speed * 0.0568).toFixed(1)} mph (the same flick on a touch screen ${(flicked.touch * 0.0568).toFixed(1)})`);
  } finally { await c.close(); }
}

// A flick made as the camera comes back to the ball, once the ball is coming onto the screen (0.65 s into the 0.85 s
// return), throws: it used to be dropped without a word. One made earlier in the return, before the ball is in sight,
// counts too, once aiming begins (here, with the clock stopped, as the finger lifts).
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
    const early = await into(0.3);
    await touchStroke(cdp, [[0, -280, 6]]);
    assert.equal((await state(p)).phase, 'rolling', `a flick ${early.toFixed(2)} s into the return, before the ball is back, threw nothing`);
    await p.evaluate(() => { pinDrop.speed = 4; });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    const late = await into(0.7);
    assert.ok(late < 0.85, `the clock stopped ${late} s into the return, after it ended`);
    await touchStroke(cdp, [[0, -280, 6]]);
    assert.equal((await state(p)).phase, 'rolling', `a flick ${late.toFixed(2)} s into the return threw nothing`);
    assert.equal(await p.evaluate(() => pinDrop.view.cam.y), await p.evaluate(() => { pinDrop.camera(0); return pinDrop.view.cam.y; }), 'the camera was not back behind the ball for the throw');
    // A drag to the right begun and ended early in the return moves the ball right, as far as the same drag while
    // aiming: with the camera still down the lane, it slid the ball left, to the edge.
    await p.evaluate(() => { pinDrop.speed = 4; });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    for (const at of [0.1, 0.4]) {
      const from = (await state(p)).x;
      await into(at);
      await touchStroke(cdp, [[100, 0, 6]]);
      const moved = (await state(p)).x - from;
      await p.evaluate(() => { pinDrop.speed = 4; });
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
      assert.equal((await state(p)).x - from, moved, 'the ball moved again once aiming began');
      await p.evaluate(() => { pinDrop.speed = 1; });
      const x1 = (await state(p)).x;
      await touchStroke(cdp, [[-100, 0, 6]]);
      const back = x1 - (await state(p)).x;
      assert.ok(moved > 5 && Math.abs(moved - back) < 0.5, `a drag right ${at} s into the return moved the ball ${moved.toFixed(2)} in, against ${back.toFixed(2)} in while aiming`);
    }
  } finally { await c.close(); }
}

// After a ball there are about 3.8 s of waiting (the pins settling, the sweep, the camera coming back): a tap on the
// lane plays the rest of it four times as fast. A swipe begun as the camera comes back throws once aiming begins, and
// a tap that only hurried things on gets no word about how to throw. The turn's call for the next player stays up as
// long as ever.
{
  const { c, p, cdp } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, {}, ['Ana', 'Ben']);
  try {
    // How long from the ball being counted to the next one being aimed, with a tap `tapAt` s into the wait (or none).
    const waitFor = tapAt => p.evaluate(tapAt => new Promise(done => {
      pinDrop.throw({ x: 0, speed: 290, angle: 0, hook: 0 });
      let from = null;
      (function frame(now) {
        if (from === null && pinDrop.phase === 'settle') from = now;
        if (pinDrop.phase === 'aim' && from !== null) { done((now - from) / 1000); return; }
        requestAnimationFrame(frame);
      })();
    }), tapAt);
    await p.evaluate(() => { pinDrop.speed = 4; });
    const slow = await (async () => { const t = waitFor(); await p.evaluate(() => new Promise(r => { (function f() { if (pinDrop.phase === 'settle') { pinDrop.speed = 1; r(); } else requestAnimationFrame(f); })(); })); return t; })();
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    // The same with a tap as the pins settle.
    await p.evaluate(() => { pinDrop.speed = 4; });
    const timed = waitFor();
    await p.evaluate(() => new Promise(r => { (function f() { if (pinDrop.phase === 'settle') { pinDrop.speed = 1; r(); } else requestAnimationFrame(f); })(); }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 500 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const fast = await timed;
    assert.ok(slow > 3.4, `the wait after a ball was ${slow.toFixed(2)} s without a tap`);
    assert.ok(fast < slow / 2.5, `a tap made the wait ${fast.toFixed(2)} s, against ${slow.toFixed(2)} s`);
    console.log(`  the wait after a ball: ${slow.toFixed(2)} s, or ${fast.toFixed(2)} s with a tap`);
    // The turn passed to Ben (Ana's two balls are in): his call is still up a second after his ball could be aimed.
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    assert.equal(await p.evaluate(() => pinDrop.game.turn), 1, 'the turn did not pass to Ben');
    await wait(1000);
    assert.match(await p.textContent('#call'), /Ben’s turn/, 'the call for Ben\'s turn went with the hurry');
    // A swipe begun just as the camera starts back, at the normal speed, throws once aiming begins.
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.throw({ x: 0, speed: 290, angle: 0, hook: 0 }); });
    await p.evaluate(() => new Promise(r => { (function f() { if (pinDrop.phase === 'return') { pinDrop.speed = 1; r(); } else requestAnimationFrame(f); })(); }));
    await touchStroke(cdp, [[0, -10, 4], [0, -280, 10]]);
    assert.equal((await state(p)).phase, 'rolling', 'a swipe begun as the camera came back threw nothing');
    // A tap as the camera comes back hurries it, and isn't told how to throw.
    await p.evaluate(() => new Promise(r => { (function f() { if (pinDrop.phase === 'return') r(); else requestAnimationFrame(f); })(); }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 500 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 5000, 'never ready for the next ball');
    await wait(100);
    assert.equal(await p.evaluate(() => document.getElementById('hint').classList.contains('nudge') && !document.getElementById('hint').hidden), false, 'a tap that hurried the camera back was told how to throw');
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

// The lane is repainted only when something on it can change: once as a sheet opens and then not while it stays up
// (repainting a phone-sized canvas every frame behind the title or the menu kept the main thread busy), once after the
// screen turns round with a sheet up, about twelve times a second while a ball waits, and every frame while it rolls
// (or a lesson's fingertip moves).
{
  const c = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  try {
    await p.goto(base);
    await p.evaluate(() => document.fonts.ready);
    await p.evaluate(() => {
      const v = pinDrop.view, draw = v.draw.bind(v);
      window.draws = 0; window.frames = 0;
      v.draw = s => { window.draws++; draw(s); };
      (function frame() { window.frames++; requestAnimationFrame(frame); })();
    });
    const count = async ms => { const a = await p.evaluate(() => [draws, frames]); await wait(ms); const b = await p.evaluate(() => [draws, frames]); return { draws: b[0] - a[0], frames: b[1] - a[1] }; };
    await wait(200);
    const title = await count(1000);
    assert.ok(title.draws === 0, `the lane was drawn ${title.draws} times in a second behind the title`);
    // Turned round with the title up: drawn again at the new size, not left blank.
    await p.setViewportSize({ width: 844, height: 390 });
    await until(() => p.evaluate(() => draws > 0), 2000, 'the lane was not drawn again after turning round');
    const lit = await p.evaluate(() => { const cv = document.getElementById('lane'); return cv.getContext('2d').getImageData(cv.width / 2, cv.height / 2, 1, 1).data[3]; });
    assert.equal(lit, 255, 'the lane is blank behind the title after turning round');
    await p.setViewportSize({ width: 390, height: 844 });
    await p.click('#start');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 5000, 'never on the lane');
    // A first ball here shows a fingertip swiping, drawn every frame while it moves; a tap on the lane stops it.
    await wait(700);
    const lesson = await count(500);
    assert.ok(lesson.draws >= lesson.frames - 3, `drawn ${lesson.draws} times in ${lesson.frames} frames while the fingertip moved`);
    await p.tap('#lane', { position: { x: 40, y: 400 } });
    await wait(200);
    const waiting = await count(1000);
    assert.ok(waiting.draws >= 5 && waiting.draws <= 16, `drawn ${waiting.draws} times in a second while the ball waits`);
    await p.click('#menuBtn');
    await wait(200);
    const menu = await count(1000);
    assert.equal(menu.draws, 0, `the lane was drawn ${menu.draws} times in a second behind the menu`);
    await p.click('#menuResume');
    await p.evaluate(() => { pinDrop.seed = 1; pinDrop.throw({ x: 10, speed: 290, angle: 0.03, hook: -45 }); });
    const rolling = await count(800);
    assert.equal(await p.evaluate(() => pinDrop.phase), 'rolling');
    assert.ok(rolling.draws >= rolling.frames - 2, `drawn ${rolling.draws} times in ${rolling.frames} frames as the ball rolled`);
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

// Three players carry on a game in the ninth frame, and the turn goes round all three in order, Ana, Ben, Cy, Ana...
// (the turn passing was only played with two players and four). Ben strikes every ball, so his ninth takes one ball
// and his tenth three; the others throw two balls in the gutter. The end shows all three.
{
  const eight = Array.from({ length: 16 }, (_, i) => (i % 2 ? 4 : 3));   // eight open frames of 3 and 4: 56
  const names = ['Ana', 'Ben', 'Cy'];
  const { c, p } = await kept({}, { names, current: { players: names.map(name => ({ name, rolls: [...eight], x: 0 })), turn: 0, leftover: null } });
  try {
    assert.equal(await p.textContent('#resume'), 'Carry on · Ana’s turn, frame 9');
    await p.click('#resume');
    await p.evaluate(seed => { pinDrop.speed = 10; pinDrop.seed = seed; window.turns = []; }, strikeSeed);
    await until(() => p.evaluate(pocket => {
      if (pinDrop.phase === 'aim') {
        turns.push(pinDrop.game.turn);
        pinDrop.throw(pinDrop.game.turn === 1 ? pocket : { x: 14, speed: 300, angle: 0.02, hook: 0 });
      }
      return pinDrop.phase === 'over';
    }, pocket), 90000, 'the three-player game never ended');
    const rolls = await p.evaluate(() => pinDrop.game.players.map(q => q.rolls));
    assert.deepEqual(rolls[1].slice(16), [10, 10, 10, 10], `seed ${strikeSeed} didn't strike every ball for Ben`);
    assert.deepEqual(await p.evaluate(() => turns), [0, 0, 1, 2, 2, 0, 0, 1, 1, 1, 2, 2], 'the turn did not go round the three in order');
    await until(() => p.isVisible('#end'), 5000, 'no end of the game');
    assert.equal(await p.textContent('#endTitle'), 'Ben wins!');
    const rows = await p.$$eval('#endCards .row', els => els.map(e => ({ tenth: e.querySelectorAll('.f')[9].querySelector('.balls').textContent, sum: +e.querySelector('.f.sum').textContent })));
    assert.deepEqual(rows, [{ tenth: '--', sum: 56 }, { tenth: 'XXX', sum: 116 }, { tenth: '--', sum: 56 }]);
    console.log('  three players: the turn went round in order, 56, 116, 56');
  } finally { await c.close(); }
}

// A spare in the tenth: Ana has 7 down and the pins a ball at the head pin leaves, picks them up, and her fill ball
// faces a fresh rack.
{
  const left = play(rack(), headOn, leaveSeed).standing;
  const at = { x: Math.max(-14, Math.min(14, left.reduce((s, q) => s + q.x, 0) / left.length)), speed: 290, angle: 0, hook: 0 };
  const spareSeed = [...Array(100).keys()].find(k => play(rack(left), at, k + 1).standing.length === 0) + 1;
  const first = 10 - left.length;
  const { c, p } = await kept({}, { names: ['Ana'], current: { players: [{ name: 'Ana', rolls: [...nineAndMiss, first], x: 0 }], turn: 0, leftover: left } });
  try {
    await p.click('#resume');
    assert.deepEqual(await upPins(p), left.map(q => `${q.id}@${q.x.toFixed(6)},${q.y.toFixed(6)}`), 'the pins left did not come back');
    assert.equal(await p.textContent('#where'), 'Frame 10 · ball 2');
    await p.evaluate(({ at, seed }) => { pinDrop.speed = 4; pinDrop.seed = seed; pinDrop.throw(at); }, { at, seed: spareSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the fill ball');
    assert.deepEqual(await p.evaluate(() => pinDrop.game.players[0].rolls.slice(18)), [first, 10 - first], `seed ${spareSeed} didn't pick up the spare in the page`);
    assert.equal(await p.$$eval('#frames .f', els => els[9].querySelector('.balls').textContent), `${first}/`);
    assert.equal(await p.textContent('#where'), 'Frame 10 · bonus ball');
    assert.deepEqual(await upPins(p), freshRack, 'no fresh rack for the fill ball after a spare in the tenth');
    await p.evaluate(() => pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }));
    await until(() => p.isVisible('#end'), 20000, 'no end of the game');
    assert.equal(await p.$$eval('#endCards .row', els => els[0].querySelectorAll('.f')[9].querySelector('.balls').textContent), `${first}/-`);
    assert.equal(await p.textContent('#endTitle'), '91');
    console.log(`  a spare in the tenth with seed ${spareSeed}, and a fresh rack for the fill ball`);
  } finally { await c.close(); }
}

// Reloading in the tenth after a strike and then a 7, and tapping Carry on, brings back the very pins that 7 left,
// where they stood, for the bonus ball.
{
  const { c, p } = await kept({}, { names: ['Ana'], current: { players: [{ name: 'Ana', rolls: [...nineAndMiss], x: 0 }], turn: 0, leftover: null } });
  try {
    await p.click('#resume');
    await p.evaluate(({ pocket, seed }) => { pinDrop.speed = 4; pinDrop.seed = seed; pinDrop.throw(pocket); }, { pocket, seed: strikeSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim' && pinDrop.game.players[0].rolls.length === 19), 20000, 'the strike never finished');
    await p.evaluate(({ headOn, seed }) => { pinDrop.seed = seed; pinDrop.throw(headOn); }, { headOn, seed: leaveSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the second ball never finished');
    const left = await upPins(p), rolls = await p.evaluate(() => pinDrop.game.players[0].rolls.slice(18));
    assert.ok(left.length >= 2, `the second ball left ${left.length} pins, so this checks less than it means to`);
    assert.deepEqual(rolls, [10, 10 - left.length]);
    await p.reload();
    assert.equal(await p.textContent('#resume'), 'Carry on · frame 10');
    await p.click('#resume');
    assert.deepEqual(await p.evaluate(() => pinDrop.game.players[0].rolls.slice(18)), rolls);
    assert.deepEqual(await upPins(p), left, 'the pins left after X and a 7 did not come back');
    assert.equal(await p.textContent('#where'), 'Frame 10 · bonus ball');
    console.log(`  carried on in the tenth after X and ${rolls[1]}, with the ${left.length} pins left`);
  } finally { await c.close(); }
}

// Between the last ball and the end card, the game is over: ☰ or the scorecard opens the end card at once (it showed
// "Paused" and "End this game", and ending it skipped who won and any new best), with the last ball's callout gone
// rather than left blurred behind the card.
for (const tap of ['#menuBtn', '#card']) {
  const { c, p } = await kept({}, { names: ['Ana'], current: { players: [{ name: 'Ana', rolls: [...nineAndMiss, 9], x: 0 }], turn: 0, leftover: [{ id: 7, ...SPOTS[6] }] } });
  try {
    await p.click('#resume');
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
    await until(() => p.evaluate(() => pinDrop.phase === 'over'), 20000, 'the last ball never finished');
    assert.notEqual(await p.textContent('#call'), '', 'no callout for the last ball, so this checks nothing');
    await p.click(tap);
    assert.equal(await p.isVisible('#end'), true, `${tap} after the last ball did not open the end card`);
    assert.equal(await p.isVisible('#menu'), false);
    assert.equal(await p.isVisible('#board'), false);
    assert.equal(await p.textContent('#endTitle'), '90');
    assert.equal(await p.evaluate(() => document.getElementById('call').innerHTML), '', 'the last callout is still behind the end card');
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
    await p.evaluate(() => {
      window.buzzes = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: v => { window.buzzes.push(JSON.stringify(v)); return true; } });
    });
    await p.evaluate(() => { pinDrop.speed = 4; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
    await until(() => p.isVisible('#end'), 20000, 'no end of the game');
    assert.deepEqual([await p.textContent('#endTitle'), await p.textContent('#endLine')], ['Ana and Cal tie!', '90 each · a new best here']);
    // A short buzz as the ball dropped into the gutter, and one for the new best (on a phone that can buzz).
    assert.deepEqual(await p.evaluate(() => window.buzzes), ['15', '[40,60,40]']);
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

// Strike! comes with the crash, as the last pin goes over, not half a second later once the deadwood has stopped
// sliding: within 300 ms of the last pin leaving its spot, while the ball is still rolling, once, with the strike's
// buzz then too (on a phone that has one). A ball that leaves pins standing is called only once everything has stopped.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, {}, ['Ana', 'Ben']);
  try {
    await p.evaluate(() => {
      window.buzzes = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: v => { window.buzzes.push([JSON.stringify(v), pinDrop.phase]); return true; } });
      window.called = [];
      new MutationObserver(() => { const t = document.getElementById('call').textContent; if (t) window.called.push([t, performance.now(), pinDrop.phase]); })
        .observe(document.getElementById('call'), { childList: true, subtree: true });
      window.goneAt = null;
      (function frame() {
        if (window.goneAt === null && pinDrop.phase === 'rolling' && pinDrop.pins.every(q => q.state !== 'up')) window.goneAt = performance.now();
        requestAnimationFrame(frame);
      })();
    });
    await p.evaluate(({ pocket, seed }) => { pinDrop.seed = seed; pinDrop.throw(pocket); }, { pocket, seed: strikeSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the strike never finished');
    assert.equal(await p.evaluate(() => pinDrop.game.players[0].rolls[0]), 10, `seed ${strikeSeed} didn't strike`);
    const { called, goneAt, buzzes } = await p.evaluate(() => ({ called: window.called, goneAt: window.goneAt, buzzes: window.buzzes }));
    assert.equal(called.length, 1, `the strike was called ${JSON.stringify(called)}`);
    const [word, at, phase] = called[0];
    assert.match(word, /^Strike!/);
    assert.equal(phase, 'rolling', 'Strike! waited for the pins to stop');
    assert.ok(goneAt !== null && at - goneAt < 300, `Strike! came ${Math.round(at - goneAt)} ms after the last pin went`);
    assert.deepEqual(buzzes.filter(b => b[0] === '[30,50,60]'), [['[30,50,60]', 'rolling']], `the strike's buzz: ${JSON.stringify(buzzes)}`);
    console.log(`  Strike! ${Math.round(at - goneAt)} ms after the last pin went`);
    // Ben's ball at the head pin leaves pins: nothing is said while it rolls.
    await until(() => p.evaluate(() => pinDrop.phase === 'aim' && pinDrop.game.turn === 1), 20000, "Ben's turn never came");
    await p.evaluate(({ headOn, seed }) => { window.called = []; pinDrop.speed = 4; pinDrop.seed = seed; pinDrop.throw(headOn); }, { headOn, seed: leaveSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, "Ben's ball never finished");
    const leave = await p.evaluate(() => window.called.filter(c => !c[0].endsWith('turn')));
    assert.ok(leave.length >= 1 && leave.every(c => c[2] !== 'rolling'), `a ball that left pins was called as it rolled: ${JSON.stringify(leave)}`);
  } finally { await c.close(); }
}

// Sound off in the menu stops the buzz too: a strike with the sound off doesn't buzz. On a phone that can buzz the
// switch says "Sound and buzz"; where a page can't buzz (an iPhone, an iPad), just "Sound".
{
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const { c, p } = await lane(phone, { sound: false });
  try {
    await p.evaluate(() => {
      window.buzzes = [];
      Object.defineProperty(navigator, 'vibrate', { configurable: true, value: v => { window.buzzes.push(JSON.stringify(v)); return true; } });
    });
    await p.evaluate(({ pocket, seed }) => { pinDrop.speed = 2; pinDrop.seed = seed; pinDrop.throw(pocket); }, { pocket, seed: strikeSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'settle'), 20000, 'the strike never finished');
    assert.equal(await p.evaluate(() => pinDrop.game.players[0].rolls[0]), 10, `seed ${strikeSeed} didn't strike`);
    assert.deepEqual(await p.evaluate(() => window.buzzes), [], 'a strike buzzed with the sound off');
    await p.click('#menuBtn');
    assert.equal(await p.textContent('#menuSound'), 'Sound and buzz: off');
    await p.click('#menuSound');
    assert.equal(await p.textContent('#menuSound'), 'Sound and buzz: on');
  } finally { await c.close(); }
  const { c: c2, p: p2 } = await lane(phone, { sound: true });
  try {
    await p2.addInitScript(() => { delete Navigator.prototype.vibrate; });
    await p2.reload();
    await p2.click('#resume').catch(() => p2.click('#start'));
    await p2.click('#menuBtn');
    assert.equal(await p2.textContent('#menuSound'), 'Sound: on', 'the switch talks of a buzz where a page cannot buzz');
  } finally { await c2.close(); }
}

// The ball lands with a thud as it's let go, before it has reached any pin, and the pinsetter clunks as its bar lands
// on the deck and as the new rack is set down: a knock (an oscillator) at each, and none other during the sweep.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await p.evaluate(() => {
      window.knocks = [];
      const make = BaseAudioContext.prototype.createOscillator;
      BaseAudioContext.prototype.createOscillator = function (...a) {
        const o = make.apply(this, a), start = o.start;
        o.start = function (...w) { window.knocks.push([pinDrop.phase, +pinDrop.phaseT.toFixed(2)]); return start.apply(this, w); };
        return o;
      };
    });
    await touchStroke((await c.newCDPSession(p)), [[0, -280, 6]]);
    assert.equal((await state(p)).phase, 'rolling', 'the swipe threw nothing');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    const knocks = await p.evaluate(() => window.knocks);
    // The rumble's pulse starts then too: one oscillator of its own.
    assert.ok(knocks.filter(([ph, t]) => ph === 'rolling' && t < 0.1).length >= 2, `no thud as the ball was let go: ${JSON.stringify(knocks)}`);
    const sweep = knocks.filter(([ph]) => ph === 'sweep').map(([, t]) => t);
    assert.equal(sweep.length, 2, `the pinsetter's knocks: ${JSON.stringify(knocks)}`);
    assert.ok(Math.abs(sweep[0] - 0.55) < 0.1 && Math.abs(sweep[1] - 1.7) < 0.1, `the pinsetter clunked at ${sweep.join(' and ')} s, not as the bar landed and the rack went down`);
  } finally { await c.close(); }
}

// Strikes build: Strike!, then Double! a little bigger and up longer, then Turkey! and each longer run bigger still
// with a burst of gold and teal stars, each with a longer fanfare (more notes of the bell). A first game ends with no
// badge; a perfect game that beats the player's best is the biggest and longest call of all, and its end card fades in
// with a gold "New best!" badge and a rising chime.
{
  const watch = p => p.evaluate(() => {
    window.calls = []; window.bells = [];
    const make = BaseAudioContext.prototype.createOscillator;
    BaseAudioContext.prototype.createOscillator = function (...a) {
      const o = make.apply(this, a), start = o.start;
      o.start = function (...w) { if (o.type === 'square') window.bells.push(performance.now()); return start.apply(this, w); };
      return o;
    };
    const el = document.getElementById('call');
    let now = null;
    new MutationObserver(() => {
      const t = el.firstChild?.nodeType === 3 ? el.firstChild.textContent : el.childNodes[1]?.textContent ?? '';
      if (now && now.word !== t) { now.gone = performance.now() - now.at; now = null; }
      if (t && !now) {
        now = { word: t, at: performance.now(), cls: el.className, stars: el.querySelectorAll('.burst i').length, size: parseFloat(getComputedStyle(el).fontSize) };
        window.calls.push(now);
      }
    }).observe(el, { childList: true, subtree: true });
  });
  const bellsAt = (calls, bells) => calls.map(c => bells.filter(b => b >= c.at - 50 && b < c.at + 50).length);
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const seven = Array.from({ length: 14 }, (_, i) => (i % 2 ? 4 : 3));
  let { c, p } = await kept(phone, { names: ['Ana'], current: { players: [{ name: 'Ana', rolls: seven, x: 0 }], turn: 0, leftover: null } });
  try {
    await p.click('#resume');
    await watch(p);
    await p.evaluate(seed => { pinDrop.speed = 2; pinDrop.seed = seed; }, strikeSeed);
    for (let k = 0; k < 5; k++) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim' || pinDrop.phase === 'over'), 20000, 'never ready for the next ball');
      await p.evaluate(pocket => pinDrop.throw(pocket), pocket);
      await until(() => p.evaluate(n => pinDrop.game.players[0].rolls.length === n, 15 + k), 20000, 'the ball never finished');
    }
    await until(() => p.isVisible('#end'), 10000, 'no end of the game');
    await wait(3700);   // the last call has gone
    const { calls, bells } = await p.evaluate(() => ({ calls: window.calls, bells: window.bells }));
    const strikes = calls.filter(c => /!$/.test(c.word));
    assert.deepEqual(strikes.map(c => c.word), ['Strike!', 'Double!', 'Turkey!', '4 in a row!', '5 in a row!'], `the calls: ${JSON.stringify(calls)}`);
    const [x1, x2, x3] = strikes;
    assert.ok(x2.size > x1.size && x3.size > x2.size, `the calls didn't grow: ${strikes.map(c => c.size).join(', ')} px`);
    assert.ok(x2.gone > x1.gone + 300 && x3.gone > x2.gone + 300, `the calls didn't stay longer: ${strikes.map(c => Math.round(c.gone)).join(', ')} ms`);
    assert.deepEqual(strikes.map(c => c.stars), [0, 0, 14, 14, 14], 'the stars behind a turkey or more');
    assert.deepEqual(bellsAt(strikes, bells), [4, 5, 6, 6, 6], 'the notes in each fanfare');
    assert.equal(await p.isVisible('#endBadge'), false, 'a first game here was a new best');
  } finally { await c.close(); }
  // The perfect game.
  ({ c, p } = await kept(phone, { names: ['Ana'], bests: { Ana: 250 }, best: 250, current: { players: [{ name: 'Ana', rolls: Array(11).fill(10), x: 0 }], turn: 0, leftover: null } }));
  try {
    await p.click('#resume');
    await watch(p);
    await p.evaluate(({ pocket, seed }) => { pinDrop.speed = 2; pinDrop.seed = seed; pinDrop.throw(pocket); }, { pocket, seed: strikeSeed });
    await until(() => p.isVisible('#end'), 20000, 'no end of the game');
    assert.equal(await p.evaluate(() => document.getElementById('end').getAnimations({ subtree: true }).length > 0), true, 'the end of the game did not fade in');
    assert.equal(await p.textContent('#endTitle'), '300');
    assert.equal(await p.isVisible('#endBadge'), true, 'no badge for a new best');
    assert.equal(await p.textContent('#endBadge'), 'New best!');
    await wait(3700);
    const { calls, bells } = await p.evaluate(() => ({ calls: window.calls, bells: window.bells }));
    const perfect = calls.find(c => c.word === 'Perfect!');
    assert.ok(perfect && /\bx4\b/.test(perfect.cls) && perfect.stars === 14 && perfect.gone > 3300, `the perfect game's call: ${JSON.stringify(calls)}`);
    assert.ok(bellsAt([perfect], bells)[0] >= 11, `a perfect game's fanfare had ${bellsAt([perfect], bells)[0]} notes`);
    const endAt = perfect.at + 1000;   // the end card comes 1.9 s after the ball, well after the fanfare's notes are set going
    assert.equal(bells.filter(b => b > endAt).length, 4, 'no rising chime for the new best');
  } finally { await c.close(); }
}

// While a second ball is aimed, the pins left show under the scorecard as ten dots, the standing ones filled in: gone
// as it's thrown, and not there for a fresh rack.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    assert.equal(await p.isVisible('#leave'), false, 'the pins left show for a fresh rack');
    await p.evaluate(({ headOn, seed }) => { pinDrop.speed = 4; pinDrop.seed = seed; pinDrop.throw(headOn); }, { headOn, seed: leaveSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    const left = await p.evaluate(() => pinDrop.pins.filter(q => q.state === 'up').map(q => q.id));
    assert.ok(left.length >= 2, `seed ${leaveSeed} left ${left.length} pins`);
    assert.equal(await p.isVisible('#leave'), true, 'no pins left under the scorecard for the second ball');
    const dots = await p.$$eval('#leave circle', els => els.map(e => e.classList.contains('up')));
    assert.deepEqual(dots.map((up, i) => up ? i + 1 : 0).filter(Boolean), left.sort((a, b) => a - b), 'the dots filled in are not the pins left');
    assert.match(await p.getAttribute('#leave', 'aria-label'), new RegExp(`^Pins left: .*${left.at(-1)}$`));
    // It sits under the scorecard, clear of it, and above the pins at the far end.
    const box = await p.evaluate(() => { const r = document.getElementById('leave').getBoundingClientRect(), k = document.getElementById('card').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, card: k.bottom }; });
    const pinsAt = await p.evaluate(() => pinDrop.view.p(0, 720 + 3 * 10.392, 15)[1]);
    assert.ok(box.top >= box.card && box.bottom < pinsAt, `the pins left sit at ${box.top}-${box.bottom} px, the card ends at ${box.card} and the pins start at ${pinsAt}`);
    await p.evaluate(() => pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }));
    assert.equal(await p.isVisible('#leave'), false, 'the pins left stayed up as the ball rolled');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    assert.equal(await p.isVisible('#leave'), false, 'the pins left show for the next frame\'s fresh rack');
  } finally { await c.close(); }
}

// After a strike, a "Watch again" button stays up until the pinsetter comes. Pressed while the deadwood is still
// moving, it finishes the ball and counts it, then plays it again from the start at half speed, the camera following,
// ending with the very same pins down, and play carries on: the strike counted once, a fresh rack for the next frame.
// A ball that knocks down fewer than 9 gets no button.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await p.evaluate(({ pocket, seed }) => {
      window.rolled = null;
      const t0 = performance.now();
      pinDrop.seed = seed; pinDrop.throw(pocket);
      (function f() { if (pinDrop.phase === 'rolling' && pinDrop.ball.state === 'pit' && window.rolled === null) window.rolled = (performance.now() - t0) / 1000; requestAnimationFrame(f); })();
    }, { pocket, seed: strikeSeed });
    await until(() => p.isVisible('#replay'), 20000, 'no Watch again after a strike');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'rolling', 'Watch again came only once the pins had stopped');
    const before = await p.evaluate(() => pinDrop.pins.map(q => q.id));
    await p.click('#replay');
    assert.deepEqual(await p.evaluate(() => pinDrop.game.players[0].rolls), [10], 'the strike was not counted');
    const start = await p.evaluate(() => ({ phase: pinDrop.phase, near: pinDrop.ball.y < 40, up: pinDrop.pins.filter(q => q.state === 'up').length, cam: pinDrop.view.cam.y }));
    assert.deepEqual(start, { phase: 'replay', near: true, up: before.length, cam: await p.evaluate(() => pinDrop.view.aimView.y) }, 'the replay did not start from the throw');
    assert.equal(await p.isVisible('#replay'), false, 'the button stayed up through the replay');
    const t = await p.evaluate(() => new Promise(done => {
      const t0 = performance.now();
      (function f() { if (pinDrop.ball.state === 'pit') done((performance.now() - t0) / 1000); else requestAnimationFrame(f); })();
    }));
    const rolled = await p.evaluate(() => window.rolled);
    assert.ok(t > rolled * 1.7, `the replay took the ball ${t.toFixed(2)} s to the pit, the throw ${rolled.toFixed(2)} s`);
    await until(() => p.evaluate(() => pinDrop.phase !== 'replay'), 20000, 'the replay never ended');
    assert.equal(await p.evaluate(() => pinDrop.pins.filter(q => q.state === 'up').length), 0, 'the replay left pins the strike did not');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    assert.deepEqual(await p.evaluate(() => pinDrop.game.players[0].rolls), [10], 'the replay changed the card');
    assert.deepEqual(await upPins(p), freshRack, 'no fresh rack after the replay');
    console.log(`  watch again: the ball took ${rolled.toFixed(2)} s, and ${t.toFixed(2)} s played again`);
    // A gutter ball: no button.
    await p.evaluate(() => { window.shown = false; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); (function f() { if (!document.getElementById('replay').hidden) window.shown = true; if (pinDrop.phase !== 'aim') requestAnimationFrame(f); })(); });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    assert.equal(await p.evaluate(() => window.shown), false, 'Watch again after a gutter ball');
  } finally { await c.close(); }
}

// A first ball that leaves a split is called with its count ("Split", "8 · the 4–10") and ringed on the scorecard,
// along the top and on the full card (read there as "8 split"), and the ring is still there after a reload. A game
// kept before there were rings carries on without any.
{
  const { isSplit } = await import('../js/scoring.js');
  const splitSeed = [...Array(100).keys()].find(k => isSplit(play(rack(), headOn, k + 1).standing.map(q => q.id))) + 1;
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    await watchCalls(p);
    await p.evaluate(({ headOn, seed }) => { pinDrop.speed = 4; pinDrop.seed = seed; pinDrop.throw(headOn); }, { headOn, seed: splitSeed });
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    const knocked = await p.evaluate(() => pinDrop.game.players[0].rolls[0]);
    const left = await p.evaluate(() => pinDrop.pins.filter(q => q.state === 'up').map(q => q.id).sort((a, b) => a - b));
    assert.ok((await p.evaluate(() => window.calls)).includes(`Split${knocked} · the ${left.join('–')}`), `the split's call: ${JSON.stringify(await p.evaluate(() => window.calls))}`);
    const ringed = () => p.$$eval('#frames .f', fs => fs.map(f => [...f.querySelectorAll('.balls span')].map(s => s.classList.contains('split'))));
    assert.deepEqual((await ringed())[0], [true, false], 'the split is not ringed on the scorecard along the top');
    await p.reload();
    await p.click('#resume');
    assert.deepEqual((await ringed())[0], [true, false], 'the ring went with a reload');
    await p.click('#card');
    assert.equal(await p.locator('#boardCards .split').count(), 1, 'the split is not ringed on the full scorecard');
    assert.match(await p.textContent('#boardCards .sr'), new RegExp(`^Frame 1: ${knocked} split\\.`));
  } finally { await c.close(); }
  // Kept before there were rings.
  const { c: c2, p: p2 } = await kept({}, { names: ['Ana'], current: { players: [{ name: 'Ana', rolls: [8, 2, 7], x: 0 }], turn: 0, leftover: [{ id: 3, x: 6, y: 730.4 }, { id: 6, x: 12, y: 740.8 }, { id: 10, x: 18, y: 751.2 }] } });
  try {
    await p2.click('#resume');
    assert.equal(await p2.locator('#frames .split').count(), 0);
    assert.equal(await p2.textContent('#where'), 'Frame 2 · ball 2');
  } finally { await c2.close(); }
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
// ball into the gutter isn't a hook; his slow hook to the left into the left gutter is too much hook for its speed,
// which comes ahead of the word about a slow ball. Cy hooks left into the gutter from the right edge of the lane, so
// isn't told to stand further right.
{
  const { c, p, cdp } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, {}, ['Ana', 'Ben', 'Cy']);
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
      // An 8% bow: a hook of about 15, which any speed carries (a slow ball with more gets a word of its own, below).
      for (let i = 0; i <= 14; i++) { const t = i / 14; path.push([285 - 27 * Math.sin(t * Math.PI), 660 - 320 * t]); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: path[0][0], y: path[0][1] }] });
      for (const [x, y] of path.slice(1)) { await wait(12); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }, 'Ana');
    assert.match(curved.said, /hook right/);
    const hooked = await p.evaluate(() => pinDrop.shot.hook);
    assert.ok(hooked > 3 && hooked <= 20, `the curved swipe threw a hook of ${hooked}, not the one this checks`);
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
    // At 175 in/s no spot can carry a hook of 45 to the pocket (20 is the most), so it says that, not where to stand.
    const slowLeft = await ball(() => p.evaluate(() => pinDrop.throw({ x: -10, speed: 175, angle: 0, hook: -45 })), 'Ben');
    assert.equal(slowLeft.side, -1);
    assert.equal(slowLeft.call, 'Gutter ballopen frameToo much hook for a ball that slow: flick faster or curve less');
    // Cy throws from the right edge of the lane and hooks into the left gutter: nothing about standing further right.
    const edge = await ball(() => p.evaluate(() => pinDrop.throw({ x: 16, speed: 260, angle: 0, hook: -60 })), 'Cy');
    assert.equal(edge.side, -1);
    assert.equal(edge.call, 'Gutter ballYour swipe curved, so it hooked left: swipe straighter');
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

// A player's first ball of a game shows where to stand and which arrow to roll over: a ring on the dot on board 8 and
// the second arrow from the right lit up. The second ball of the frame, and the next frame, show neither, and nor does
// the lane while the ball rolls. Each player gets them for their own first ball.
{
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, { thrown: { Ana: 9, Ben: 9 } }, ['Ana', 'Ben']);
  const marked = () => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(pinDrop.view.marked)))));
  try {
    const m = await marked();
    assert.ok(m && Math.abs(m.stand - 12.77) < 0.01 && m.target === 10, `the first ball's marks: ${JSON.stringify(m)}`);
    await p.evaluate(() => { pinDrop.speed = 10; pinDrop.seed = 7; pinDrop.throw({ x: 0, speed: 300, angle: 0.01, hook: 0 }); });
    assert.equal(await marked(), null, 'the marks stayed up while the ball rolled');
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    assert.equal(await p.evaluate(() => pinDrop.game.players[0].rolls.length), 1, 'the first ball struck, so this checks less than it means to');
    assert.equal(await marked(), null, "the marks are up for the frame's second ball");
    await p.evaluate(() => pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }));
    await until(() => p.evaluate(() => pinDrop.phase === 'aim' && pinDrop.game.turn === 1), 20000, "Ben's turn never came");
    assert.ok(await marked(), "no marks for Ben's first ball");
    await until(() => p.evaluate(() => {
      if (pinDrop.phase === 'aim' && pinDrop.game.turn === 1) pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 });
      return pinDrop.phase === 'aim' && pinDrop.game.turn === 0;
    }), 30000, "Ana's second frame never came");
    assert.equal(await marked(), null, "the marks are up in Ana's second frame");
  } finally { await c.close(); }
}

// A new player's very first ball: a fingertip slides up from the ball, again and again, until they touch the lane.
// With Reduce Motion on, it's drawn still, at the end of its way.
{
  const taught = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(pinDrop.view.taught)))));
  const { c, p, cdp } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    assert.deepEqual(await p.evaluate(() => pinDrop.lesson), { kind: 'swipe', playing: true });
    const ballY = await p.evaluate(() => pinDrop.view.p(pinDrop.ball.x, pinDrop.ball.y, 4.25)[1]);
    const seen = [];
    for (let i = 0; i < 12; i++) { const t = await taught(p); if (t) seen.push(t.at[1]); await wait(100); }
    assert.ok(seen.length >= 4 && Math.max(...seen) - Math.min(...seen) > 100, `the fingertip didn't move up the lane: ${seen.map(Math.round)}`);
    assert.ok(seen.every(y => y <= ballY + 1) && Math.min(...seen) < ballY - 150, `the fingertip wasn't going up from the ball (at ${Math.round(ballY)}): ${seen.map(Math.round)}`);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 60, y: 500 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await wait(100);
    assert.equal((await p.evaluate(() => pinDrop.lesson)).playing, false, 'touching the lane did not stop the fingertip');
    for (let i = 0; i < 5; i++) { assert.equal(await taught(p), null, 'the fingertip still shows after touching the lane'); await wait(150); }
  } finally { await c.close(); }
  const still = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    await wait(500);
    const a = await taught(still.p); await wait(700); const b = await taught(still.p);
    assert.ok(a && b && a.alpha === 1 && a.at[1] === b.at[1], `with Reduce Motion the fingertip moved: ${JSON.stringify([a, b])}`);
  } finally { await still.c.close(); }
}

// After that: the first time a first ball leaves pins, the fingertip drags the ball sideways towards them, saying
// "Drag the ball sideways to line up the pins left"; then on the next two full racks it curls the end of a swipe,
// saying "Curve the end of your swipe to hook into the pocket" (the second time is skipped for a ball that hooks).
// Each is kept for the player on this device, and doesn't come again.
{
  const leftover = [{ id: 4, x: -12, y: 740.78 }, { id: 7, x: -18, y: 751.18 }, { id: 8, x: -6, y: 751.18 }];
  const { c, p } = await kept({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { names: ['You'], thrown: { You: 1 }, current: { players: [{ name: 'You', rolls: [7], x: 0 }], turn: 0, leftover } });
  const stored = () => p.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
  const gutter = hook => p.evaluate(h => { pinDrop.throw({ x: -18, speed: 300, angle: -0.05, hook: h }); }, hook);
  const ready = () => until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
  try {
    await p.click('#resume');
    assert.deepEqual(await p.evaluate(() => pinDrop.lesson), { kind: 'slide', playing: true });
    assert.equal(await p.textContent('#hint'), 'Drag the ball sideways to line up the pins left');
    const across = () => p.evaluate(() => pinDrop.view.taught && pinDrop.view.taught.at[0] - pinDrop.view.p(pinDrop.ball.x, pinDrop.ball.y)[0]);
    await until(async () => Math.abs(await across()) > 20, 3000, 'the fingertip never dragged the ball sideways');
    assert.ok(await across() < 0, 'the slide went away from the pins, on the left');
    await p.evaluate(() => { pinDrop.speed = 10; });
    await gutter(0); await ready();
    assert.equal((await stored()).slideShown.You, 1);
    assert.deepEqual(await p.evaluate(() => pinDrop.lesson), { kind: 'hook', playing: true });
    assert.equal(await p.textContent('#hint'), 'Curve the end of your swipe to hook into the pocket');
    await gutter(0); await ready();
    assert.equal((await stored()).hookShown.You, 1);
    assert.equal((await p.evaluate(() => pinDrop.lesson))?.kind, 'hook', 'the hook was shown only once');
    await gutter(-20); await ready();
    assert.equal((await stored()).hookShown.You, 2);
    assert.equal(await p.evaluate(() => pinDrop.lesson), null, 'a lesson after the hook was shown twice');
    assert.equal(await p.isVisible('#hint'), false, 'the hint is up after four balls');
    // A first ball that leaves pins again: nothing more said.
    await p.evaluate(() => { pinDrop.seed = 7; pinDrop.throw({ x: 0, speed: 300, angle: 0.01, hook: 0 }); });
    await ready();
    assert.equal(await p.evaluate(() => pinDrop.lesson), null, 'the slide was shown again');
  } finally { await c.close(); }
}

// A phone on its side gets a note over the lane asking for it upright, with the lane out of reach behind it; not on
// the title, and never on a tablet on its side or a laptop. Turned upright it goes; "Bowl sideways anyway" puts it
// away, and it stays away after the menu.
{
  const phone = { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const c = await browser.newContext({ serviceWorkers: 'block', ...phone });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  try {
    await p.goto(base);
    assert.equal(await p.isVisible('#upright'), false, 'the note covers the title');
    await p.click('#start');
    assert.equal(await p.isVisible('#upright'), true, 'no note on a phone on its side');
    assert.equal(await p.evaluate(() => document.getElementById('lane').inert && document.activeElement.id), 'uprightSay', 'the lane can be reached behind the note');
    await p.setViewportSize({ width: 390, height: 844 });
    await until(async () => !(await p.isVisible('#upright')), 2000, 'the note stayed up with the phone upright');
    assert.equal(await p.evaluate(() => document.getElementById('lane').inert), false);
    await p.setViewportSize({ width: 844, height: 390 });
    await until(() => p.isVisible('#upright'), 2000, 'no note after turning the phone on its side again');
    // A sheet over the note (Escape opens the menu; a game can end behind it) keeps the lane out of reach.
    await p.keyboard.press('Escape');
    assert.equal(await p.isVisible('#menu'), true, 'Escape did not open the menu');
    assert.equal(await p.isVisible('#upright'), false, 'the note stayed over the menu');
    assert.deepEqual(await p.evaluate(() => ['lane', 'hud', 'hint'].map(id => document.getElementById(id).inert)), [true, true, true], 'the lane could be reached behind the menu');
    await p.click('#menuResume');
    await until(() => p.isVisible('#upright'), 2000, 'no note after the menu');
    await p.click('#sideways');
    assert.equal(await p.isVisible('#upright'), false, 'Bowl sideways anyway left the note up');
    await p.click('#menuBtn'); await p.click('#menuResume');
    assert.equal(await p.isVisible('#upright'), false, 'the note came back after the menu');
  } finally { await c.close(); }
  for (const options of [{ viewport: { width: 1180, height: 820 }, hasTouch: true }, { viewport: { width: 1280, height: 450 }, hasTouch: false }]) {
    const { c, p } = await lane(options);
    try { assert.equal(await p.isVisible('#upright'), false, `a note at ${options.viewport.width}x${options.viewport.height}`); } finally { await c.close(); }
  }
}

// Bowling from the keyboard: Left and Right move the ball a board at a time, H goes from straight to hook left (and
// on to hook right and back), and holding Space winds up the speed, shown in mph with the guide, then throws straight
// down the lane as it's let go, the harder the longer it was held. The hint says the keys once one is pressed. Once
// the keyboard has bowled, Space throws even with the focus on the menu button.
{
  const { c, p } = await lane({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false }, { thrown: { You: 9 } });
  try {
    assert.equal(await p.isVisible('#hint'), false);
    const x0 = await p.evaluate(() => pinDrop.ball.x);
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight');
    await p.keyboard.press('ArrowLeft');
    const x1 = await p.evaluate(() => pinDrop.ball.x);
    assert.ok(Math.abs(x1 - x0 - 2 * 41.5 / 39) < 0.01, `two boards over moved the ball from ${x0} to ${x1}`);
    assert.match(await p.textContent('#hint'), /Left and Right move the ball, H hooks.*hold Space and let go to roll/);
    await p.keyboard.press('h');
    assert.equal(await p.textContent('#readout'), 'Hook left');
    const wind = async ms => {
      await p.keyboard.down(' ');
      await wait(ms);
      const during = await p.evaluate(() => ({ phase: pinDrop.phase, guide: !!pinDrop.view.guideKey, readout: document.getElementById('readout').textContent, hint: document.getElementById('hint').hidden }));
      await p.keyboard.up(' ');
      return { during, shot: await p.evaluate(() => pinDrop.shot), phase: await p.evaluate(() => pinDrop.phase) };
    };
    await p.evaluate(() => { pinDrop.speed = 10; });
    const soft = await wind(300);
    assert.equal(soft.during.phase, 'aim', 'holding Space threw before it was let go');
    assert.match(soft.during.readout, /^\d+\.\d mph · hook left$/);
    assert.ok(soft.during.guide && soft.during.hint, 'no guide while winding up, or the hint stayed up');
    assert.equal(soft.phase, 'rolling', 'letting go of Space threw nothing');
    assert.ok(soft.shot.angle === 0 && soft.shot.hook < 0 && Math.abs(soft.shot.x - x1) < 1e-9, `the keyboard threw ${JSON.stringify(soft.shot)}`);
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await p.focus('#menuBtn');
    const hard = await wind(1500);
    assert.equal(await p.isVisible('#menu'), false, 'Space on the menu button opened the menu after bowling from the keyboard');
    assert.equal(hard.phase, 'rolling');
    assert.ok(hard.shot.speed > soft.shot.speed + 80, `held 1.5 s it threw at ${hard.shot.speed}, held 0.3 s at ${soft.shot.speed}`);
    // A ball thrown another way (a click and flick) while Space is held ends the wind-up: letting go of Space once the
    // ball is back throws nothing.
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await p.keyboard.down(' ');
    await wait(200);
    await p.evaluate(() => pinDrop.throw({ speed: 300, angle: 0, hook: 0 }));
    await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, 'never ready for the next ball');
    await wait(300);
    assert.doesNotMatch(await p.textContent('#readout'), /mph/, 'the wind-up came back with the ball');
    await p.keyboard.up(' ');
    await wait(200);
    assert.equal(await p.evaluate(() => pinDrop.phase), 'aim', 'letting go of Space threw a ball after one was thrown another way');
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

// The rumble of a rolling ball stops behind the menu (the roll stands still there), nothing plays while the page is
// out of sight, and the rumble drops back as the ball hits the pins. Every gain node is watched; the rumble is the one
// that isn't a fixed level.
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
    // As the ball reaches the pins, the rumble drops back (a gain holds at 0.4 for a few tenths of a second; the
    // knocks' own gains are gone in less than 0.2 s), so the crash rides over it.
    await until(() => p.evaluate(() => pinDrop.pins.some(q => q.vx || q.vy)), 5000, 'the ball never reached the pins');
    const ducked = () => p.evaluate(() => gains.map((g, i) => (Math.abs(g.gain.value - 0.4) < 0.01 ? i : -1)).filter(i => i >= 0));
    await wait(80);
    const early = await ducked();
    await wait(200);
    const held = (await ducked()).filter(i => early.includes(i));
    assert.ok(held.length > 0, 'the rumble did not drop back as the ball hit the pins');
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

// With Reduce Motion on, the view doesn't fly down the lane: it stays behind the ball for the first two thirds of the
// way to the head pin (480 in of 720), then cuts to the pins, and once the pinsetter is done cuts straight back for the
// next ball. Without it, the camera moves through every place in between.
for (const motion of ['reduce', 'no-preference']) {
  const { c, p } = await lane({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: motion });
  try {
    const seen = await p.evaluate(() => new Promise(done => {
      const aimY = pinDrop.view.aimView.y, pinY = pinDrop.view.pinView.y, out = { between: 0, cutAt: null, returns: 0, back: null };
      pinDrop.throw({ x: 0, speed: 290, angle: 0, hook: 0 });
      (function frame() {
        const cy = pinDrop.view.cam.y, ph = pinDrop.phase;
        if (Math.abs(cy - aimY) > 0.01 && Math.abs(cy - pinY) > 0.01) out.between++;
        if (ph === 'rolling' && out.cutAt === null && Math.abs(cy - pinY) < 0.01) out.cutAt = pinDrop.ball.y;
        if (ph === 'return') out.returns++;
        if (ph === 'aim') { out.back = Math.abs(cy - aimY) < 0.01; done(out); } else requestAnimationFrame(frame);
      })();
    }));
    if (motion === 'reduce') {
      assert.equal(seen.between, 0, `with Reduce Motion the camera was somewhere between the ball and the pins for ${seen.between} frames`);
      assert.ok(seen.cutAt >= 480 && seen.cutAt < 500, `the view cut to the pins with the ball ${seen.cutAt} in down the lane`);
      assert.ok(seen.returns <= 1, `the camera came back over ${seen.returns} frames`);
      assert.equal(seen.back, true, 'the view is not back behind the ball for the next one');
    } else assert.ok(seen.between > 30 && seen.returns > 10, `the camera did not fly: ${JSON.stringify(seen)}`);
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
    assert.equal(await p.getAttribute('#end', 'aria-describedby'), 'endBadge endLine');   // the badge, when there's a new best
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

assert.deepEqual(problems.filter(p => !p.startsWith('failed with the network down:')), [], 'problems while using it');
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

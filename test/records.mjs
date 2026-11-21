// The records kept around a game, through the real page in Chromium:  node test/records.mjs  (needs Playwright)
// How each game went on the end card, the scorecard of a kept game, each player's numbers over time, sharing a result
// and spare practice.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

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
const base = `http://localhost:${server.address().port}/`;
const until = async (ok, ms, what) => {
  for (const end = Date.now() + ms; !(await ok());) { assert.ok(Date.now() < end, what); await new Promise(r => setTimeout(r, 100)); }
};

const browser = await pw.chromium.launch();
const problems = [];
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
// A page with what's kept on this device set to `k`, on the title.
async function kept(k, options = {}) {
  const c = await browser.newContext({ serviceWorkers: 'block', ...PHONE, ...options });
  const p = await c.newPage();
  p.on('pageerror', e => problems.push(e.message));
  p.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  p.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
  await p.addInitScript(k => { if (!sessionStorage.getItem('set')) { sessionStorage.setItem('set', '1'); localStorage.setItem('pin-drop.v1', JSON.stringify(k)); } }, k);
  await p.goto(base);
  await p.evaluate(() => document.fonts.ready);
  return { c, p };
}
const saved = p => p.evaluate(() => JSON.parse(localStorage.getItem('pin-drop.v1')));
// A ball into the right gutter: it knocks nothing over.
const gutter = p => p.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 14, speed: 300, angle: 0.02, hook: 0 }); });
const nineAndMiss = Array.from({ length: 18 }, (_, i) => (i % 2 ? 0 : 9));   // nine frames of 9 and a miss: 81

// ---- How the game went, on the end card ------------------------------------------------------------------------

// Under each name at the end, one quiet line: its strikes, spares and open frames, the parts that are nothing left
// out. Four players still fit across a phone, every line on one line of its own.
{
  const strikes = [10, 10, 10, 7, 3, 9, 0, 10, 8, 2, 6, 2, 10];   // nine frames: 5 strikes, 2 spares and 2 open
  const { c, p } = await kept({ names: ['Ana', 'Ben', 'Cy', 'Dee'], current: { players: [
    { name: 'Ana', rolls: [...strikes, 10, 7, 3], x: 0, c: 0 },
    { name: 'Ben', rolls: [...nineAndMiss, 9, 0], x: 0, c: 1 },
    { name: 'Cy', rolls: [10, ...Array(18).fill(0)], x: 0, c: 2 },
    { name: 'Dee', rolls: [5, 5, ...Array(16).fill(0), 0], x: 0, c: 3 },
  ], turn: 3, leftover: null } });
  try {
    await p.click('#resume');
    await gutter(p);
    await until(() => p.isVisible('#end'), 30000, 'no end of the game');
    const lines = await p.$$eval('#endCards .count', els => els.map(e => e.textContent));
    assert.deepEqual(lines, ['6 strikes · 3 spares · 2 open', '10 open', '1 strike · 9 open', '1 spare · 9 open']);
    const tall = await p.$$eval('#endCards .count', els => els.map(e => e.getBoundingClientRect().height));
    assert.ok(tall.every(h => h < 22), `a count ran onto two lines: ${tall}`);
    const wide = await p.evaluate(() => document.querySelector('#end').scrollWidth <= innerWidth);
    assert.ok(wide, 'the end card is wider than the phone');
    // Not on the Scorecard during a game, which has the most each player can still reach there instead.
    assert.equal(await p.locator('#boardCards .count').count(), 0);
  } finally { await c.close(); }
}

// ---- A kept game's scorecard ------------------------------------------------------------------------------------

// Each recent game on the title opens its scorecard, frame by frame, with who won: after a reload, the end of the
// game is gone but its cards aren't. Two games on the same day show their times; a game on a day of its own, its date.
{
  const at = new Date(2026, 10, 21, 20, 40).getTime(), earlier = new Date(2026, 10, 21, 19, 5).getTime(), before = new Date(2026, 10, 18, 12, 0).getTime();
  const ana = [...nineAndMiss, 10, 7, 3], ben = [10, 10, 10, ...Array(12).fill(0), 9, 0];
  const { c, p } = await kept({ names: ['Ana', 'Ben'], games: [
    { at, scores: [{ name: 'Ana', score: 101, rolls: ana, splits: [2], c: 0 }, { name: 'Ben', score: 69, rolls: ben, splits: [], c: 1 }] },
    { at: earlier, scores: [{ name: 'Ana', score: 90, rolls: nineAndMiss.concat([9, 0]), splits: [], c: 0 }] },
    { at: before, scores: [{ name: 'Ana', score: 120 }] },   // kept with only its score: no scorecard to show
  ] });
  try {
    const whens = await p.$$eval('#record li .when', els => els.map(e => e.textContent));
    assert.deepEqual(whens, ['Nov 21 · 8:40 pm', 'Nov 21 · 7:05 pm', 'Nov 18']);
    assert.equal(await p.locator('#record .game').count(), 2, 'a game kept without its balls opens nothing');
    // A thumb's worth of line to tap.
    const h = await p.$$eval('#record .game', els => els.map(e => e.getBoundingClientRect().height));
    assert.ok(h.every(x => x >= 44), `the recent games' lines are ${h} px tall`);
    await p.reload();   // as after the end of a game
    await p.click('#record .game >> nth=0');
    assert.equal(await p.isVisible('#past'), true, 'the scorecard did not open');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'pastTitle');
    assert.equal(await p.textContent('#pastTitle'), 'Nov 21 · 8:40 pm');
    assert.equal(await p.textContent('#pastLine'), 'Ana won, 101 to 69.');
    assert.deepEqual(await p.$$eval('#pastCards .row .name em', els => els.map(e => e.textContent)), ['Winner']);
    assert.deepEqual(await p.$$eval('#pastCards .f.sum', els => els.map(e => e.textContent)), ['101', '69']);
    // Frame by frame, with the ring for Ana's split and the tenth's marks.
    assert.equal(await p.$eval('#pastCards .row:nth-child(1) .f:nth-child(2) .split', e => e.textContent), '9');
    assert.equal(await p.$eval('#pastCards .row:nth-child(1) .f:nth-child(10) .balls', e => e.textContent), 'X7/');
    assert.deepEqual(await p.$$eval('#pastCards .count', els => els.map(e => e.textContent)), ['1 strike · 1 spare · 9 open', '3 strikes · 7 open']);
    // Back to the title, the focus on the line it came from; Escape does the same.
    await p.click('#pastDone');
    assert.equal(await p.isVisible('#title'), true);
    assert.equal(await p.evaluate(() => document.activeElement.dataset.at), String(at));
    await p.click('#record .game >> nth=1');
    assert.equal(await p.textContent('#pastLine'), 'Ana bowled 90.');
    await p.keyboard.press('Escape');
    assert.equal(await p.isVisible('#title'), true, 'Escape did not close the scorecard');
  } finally { await c.close(); }
}

assert.deepEqual(problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('the records all good');

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

// ---- Each player's numbers over time ------------------------------------------------------------------------------

// The best game on the title opens each player's averages: games played, the average of the last 10, the high game,
// and strikes and spares made. Forget these scores takes a second tap, then every game and best goes, here and from a
// second window that still had them; the names stay.
{
  const nine = nineAndMiss.concat([9, 0]);   // 90
  const games = [
    { at: 3000, scores: [{ name: 'Ana', score: 300, rolls: Array(12).fill(10), splits: [], c: 0 }, { name: 'Ben', score: 90, rolls: nine, splits: [], c: 1 }] },
    { at: 2000, scores: [{ name: 'Ana', score: 90, rolls: nine, splits: [], c: 0 }, { name: 'Computer (Pro)', cpu: 'pro', score: 200, rolls: [], splits: [], c: 1 }] },
    { at: 1000, scores: [{ name: 'Ben', score: 150, rolls: Array(21).fill(5), splits: [], c: 0, bumpers: true }] },
  ];
  const { c, p } = await kept({ names: ['Ana', 'Ben'], best: 300, bestBy: 'Ana', bestAt: 3000, bests: { Ana: 300, Ben: 90 }, bestsAt: { Ana: 3000, Ben: 3000 }, games });
  const p2 = await c.newPage();   // a second window, open on the title all along
  await p2.goto(base);
  try {
    assert.equal(await p.getAttribute('#bestBtn', 'aria-label'), 'Best game · Ana 300. Show each player’s averages');
    await p.click('#bestBtn');
    assert.equal(await p.isVisible('#numbers'), true, 'the averages did not open');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'numbersTitle');
    const rows = await p.$$eval('#numbersRows tbody tr', els => els.map(tr => [...tr.children].map(td => td.textContent)));
    // Ana: 2 games, (300 + 90) / 2; 12 of 22 strike chances and none of 10 spare chances. Ben's bumpers game and the
    // computer's aren't counted.
    assert.deepEqual(rows, [['Ana', '2', '195', '300', '55%', '0%'], ['Ben', '1', '90', '90', '0%', '0%']]);
    assert.deepEqual(await p.$$eval('#numbersRows thead th', els => els.map(e => e.textContent)), ['Player', 'Games', 'Average', 'High', 'Strikes', 'Spares']);
    const wide = await p.evaluate(() => document.querySelector('#numbersRows table').getBoundingClientRect().width <= document.querySelector('#numbersRows').clientWidth);
    assert.ok(wide, 'the averages are wider than the phone');
    // Back to the best game.
    await p.click('#numbersDone');
    assert.equal(await p.evaluate(() => document.activeElement.id), 'bestBtn');
    // Forget these scores: one tap only asks.
    await p.click('#bestBtn');
    await p.click('#forget');
    assert.equal(await p.textContent('#forget'), 'Tap again to forget them');
    assert.equal((await saved(p)).games.length, 3, 'one tap forgot the scores');
    await p.click('#forget');
    assert.equal(await p.isVisible('#title'), true);
    assert.equal(await p.locator('#record li, #bestBtn').count(), 0, 'the title still shows games or a best');
    const s = await saved(p);
    assert.deepEqual([s.games, s.best, s.bests, s.names], [[], 0, {}, ['Ana', 'Ben']]);
    // The other window took that in, and its next save doesn't bring them back.
    await until(() => p2.evaluate(() => !document.querySelector('#record li')), 3000, 'the second window still lists the forgotten games');
    await p2.click('#start');
    await p2.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
    await until(() => p2.evaluate(() => pinDrop.phase === 'aim' && pinDrop.game.players[0].rolls.length === 1), 15000, 'the ball never finished');
    const s2 = await saved(p2);
    assert.deepEqual([s2.games, s2.best], [[], 0], 'the second window brought the forgotten scores back');
  } finally { await c.close(); }
}

// ---- Sharing a result -----------------------------------------------------------------------------------------

// Share on the end card: the phone's share sheet, with the result (the winner first, You as Me) and the game's link;
// where there's no share sheet, the same copied, and the button says so for a moment.
{
  const game = { names: ['You', 'Ben'], current: { players: [
    { name: 'You', rolls: [...nineAndMiss, 9, 0], x: 0, c: 0 },
    { name: 'Ben', rolls: [10, ...nineAndMiss.slice(2), 9], x: 0, c: 1 },
  ], turn: 1, leftover: null } };
  for (const sheet of [true, false]) {
    const { c, p } = await kept(game);
    try {
      if (sheet) await p.evaluate(() => { navigator.share = async d => { window.shared = d; }; });
      else {
        await c.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
        await p.evaluate(() => { delete Navigator.prototype.share; });
      }
      await p.click('#resume');
      await gutter(p);
      await until(() => p.isVisible('#end'), 30000, 'no end of the game');
      assert.equal(await p.isVisible('#share'), true, 'no Share button');
      await p.click('#share');
      if (sheet) {
        await until(() => p.evaluate(() => !!window.shared), 2000, 'nothing went to the share sheet');
        assert.deepEqual(await p.evaluate(() => window.shared), { text: 'Pin Drop: Ben 100, Me 90', url: 'https://pin-drop.junkdrawer.works/' });
      } else {
        await until(async () => (await p.textContent('#share')) === 'Copied', 2000, 'the button never said Copied');
        assert.equal(await p.evaluate(() => navigator.clipboard.readText()), 'Pin Drop: Ben 100, Me 90 https://pin-drop.junkdrawer.works/');
        await until(async () => (await p.textContent('#share')) === 'Share', 4000, 'the button still says Copied');
      }
    } finally { await c.close(); }
  }
}

// ---- Spare practice ------------------------------------------------------------------------------------------

// Practise spares under Bowl: ten leaves, one ball each, for the first person on the title. Each is set up as a second
// ball would face it (the pins left shown under the scorecard), the card along the top marks each one made or missed,
// and the end says how many were made. Nothing of it is kept, and a game left half-way still carries on afterwards.
{
  const LEAVES = ['10', '7', '3,6,10', '2,4,5,8', '6,10', '4,7', '3,10', '5', '2,8', '3,5,6,9'];
  const current = { players: [{ name: 'Ana', rolls: [7, 2], x: 0, c: 0 }, { name: 'Ben', rolls: [], x: 0, c: 1 }], turn: 1, leftover: null };
  const { c, p } = await kept({ names: ['Ana', 'Ben'], games: [{ at: 5, scores: [{ name: 'Ana', score: 90, rolls: nineAndMiss.concat([9, 0]), splits: [] }] }], current });
  try {
    assert.equal(await p.isVisible('#practice'), true, 'no Practise spares on the title');
    await p.click('#practice');
    assert.equal(await p.evaluate(() => pinDrop.phase), 'aim');
    assert.equal(await p.evaluate(() => pinDrop.game.players.map(q => q.name).join()), 'Ana');
    // Good lines at the 10 pin (from the left, across the lane) and the 5 (straight at it); the rest in the gutter.
    const good = { 0: { x: -12, speed: 280, angle: 0.0402, hook: 0 }, 7: { x: 0, speed: 280, angle: 0, hook: 0 } };
    const seen = [];
    for (let i = 0; i < 10; i++) {
      await until(() => p.evaluate(() => pinDrop.phase === 'aim'), 20000, `never ready for leave ${i + 1}`);
      seen.push({
        pins: await p.evaluate(() => pinDrop.pins.filter(q => q.state === 'up').map(q => q.id).join()),
        dots: await p.getAttribute('#leave', 'aria-label'),
        where: await p.textContent('#where'),
      });
      await p.evaluate(shot => { pinDrop.speed = 10; pinDrop.seed = 1; pinDrop.throw(shot); }, good[i] || { x: 14, speed: 300, angle: 0.02, hook: 0 });
    }
    assert.deepEqual(seen.map(v => v.pins), LEAVES);
    assert.equal(seen[2].dots, 'Pins left: 3, 6 and 10');
    assert.deepEqual([seen[0].where, seen[9].where], ['Spare practice · 1 of 10', 'Spare practice · 10 of 10']);
    await until(() => p.isVisible('#end'), 20000, 'no end of practice');
    assert.equal(await p.textContent('#endTitle'), '2 of 10');
    assert.equal(await p.textContent('#endLine'), 'Ana made 2 of 10.');
    assert.deepEqual(await p.$$eval('#endCards .leaves li b', els => els.map(e => e.textContent)),
      ['Made', 'Missed', 'Missed', 'Missed', 'Missed', 'Missed', 'Missed', 'Made', 'Missed', 'Missed']);
    assert.deepEqual([await p.textContent('#again'), await p.textContent('#toTitle'), await p.isVisible('#share')], ['Practise again', 'Done', false]);
    // Not a game: nothing new kept, and the game left half-way is still there to carry on.
    const s = await saved(p);
    assert.deepEqual([s.games.length, s.current.players[0].rolls, s.current.turn], [1, [7, 2], 1]);
    // Practise again starts over; Done goes back to the title, with Carry on.
    await p.click('#again');
    assert.deepEqual(await p.evaluate(() => [pinDrop.phase, pinDrop.game.practice.i, pinDrop.pins.length]), ['aim', 0, 1]);
    await p.click('#menuBtn');
    assert.equal(await p.isVisible('#menuBoard'), false, 'a Scorecard in the menu in practice');
    await p.click('#menuQuit');
    assert.equal(await p.isVisible('#title'), true, 'End practice did not go back to the title');
    assert.match(await p.textContent('#resume'), /Carry on · Ben’s turn, frame 1/);
    // And a game afterwards has its own buttons back.
    await p.click('#resume');
    assert.equal(await p.evaluate(() => pinDrop.game.players.length), 2);
  } finally { await c.close(); }
}

assert.deepEqual(problems, [], 'problems while using it');
await browser.close();
server.close();
console.log('the records all good');

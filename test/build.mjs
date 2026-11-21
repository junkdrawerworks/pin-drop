// The one-file copy, built and played from file://, as someone who double-clicks it would:  node test/build.mjs
// (needs Playwright, and esbuild from npm install). The bundle is one script with no modules, so a top-level await, a
// file loaded by its address or a font that isn't inlined would break it without breaking the site.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

await import('../tools/build.mjs');
const url = pathToFileURL(join(root, 'dist/pin-drop.html')).href;

const browser = await pw.chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('requestfailed', r => problems.push('failed: ' + r.url().slice(0, 100)));
  // Nothing but the page itself and what's inside it: no other file, and nothing from the web.
  page.on('request', r => { if (r.url() !== url && !r.url().startsWith('data:')) problems.push('asked for ' + r.url().slice(0, 100)); });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => [...document.fonts].map(f => `${f.family} ${f.status}`));
  assert.deepEqual(fonts.filter(f => f.endsWith(' loaded')).sort(), ['Figtree loaded', 'Shrikhand loaded'], `the fonts: ${fonts.join(', ')}`);
  await page.click('#start');
  await page.evaluate(() => { pinDrop.speed = 10; pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }); });
  for (const end = Date.now() + 20000; await page.evaluate(() => pinDrop.phase) !== 'settle';) {
    assert.ok(Date.now() < end, `the ball never finished: ${await page.evaluate(() => pinDrop.phase)}`);
    await new Promise(r => setTimeout(r, 100));
  }
  assert.equal(await page.evaluate(() => pinDrop.game.players[0].rolls.length), 1, 'the ball was not counted');
  assert.deepEqual(problems, [], 'problems in the one-file copy');
  console.log('the one-file copy plays from file://');
} finally { await browser.close(); }

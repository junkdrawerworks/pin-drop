// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded, and each strike shown is the first seeded throw that really struck.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js'); // npm install, for 256-colour PNGs a quarter the size
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const SEED = 4;
async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(join(root, path), Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function open(viewport, deviceScaleFactor, names = ['You']) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.addInitScript(([seed, names]) => {
    let a = seed; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    localStorage.setItem('pin-drop.v1', JSON.stringify({ names, sound: false, best: 0, games: [], current: null, throws: 99, thrown: Object.fromEntries(names.map(n => [n, 99])) }));
  }, [SEED, names]);
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// A hooked ball into the pocket from the right; returns a picture of the pins flying, taken `after` seconds
// after the ball reaches them, from the first seed that strikes.
async function strike(page, after, shoot) {
  for (let seed = 1; seed < 40; seed++) {
    await page.evaluate(s => { pinDrop.seed = s; pinDrop.throw({ x: 10, speed: 290, angle: 0.0286, hook: -40 }); }, seed);
    await page.waitForFunction(() => pinDrop.ball.y > 711 || pinDrop.ball.state !== 'lane', null, { timeout: 10000 });
    await page.waitForTimeout(after * 1000);
    const pic = await shoot();
    await page.waitForFunction(() => pinDrop.phase === 'settle' || pinDrop.phase === 'over', null, { timeout: 15000 });
    const rolls = await page.evaluate(() => pinDrop.game.players[0].rolls);
    if (rolls[rolls.length - 1] === 10) return pic;
    // Not a strike: finish the frame quickly and try again.
    await page.evaluate(() => { pinDrop.speed = 20; });
    await page.waitForFunction(() => pinDrop.phase === 'aim', null, { timeout: 15000 });
    if (await page.evaluate(() => pinDrop.pins.length < 10)) {
      await page.evaluate(() => pinDrop.throw({ x: 0, speed: 300, angle: 0, hook: 0 }));
      await page.waitForFunction(() => pinDrop.phase === 'aim' && pinDrop.pins.length === 10, null, { timeout: 15000 });
    }
    await page.evaluate(() => { pinDrop.speed = 1; });
  }
  throw new Error('no strike in 40 tries');
}

// Phone screenshots for the README.
{
  // Aiming: part way through a curved swipe, with the guide showing.
  const page = await open({ width: 390, height: 844 }, 2);
  await page.click('#start');
  await page.waitForTimeout(200);
  const m = page.mouse;
  await m.move(195, 665); await m.down();
  for (let i = 1; i <= 8; i++) { await m.move(195 + i * 10, 666); await page.waitForTimeout(16); }
  await m.up();
  await m.move(276, 662); await m.down();
  for (let i = 1; i <= 9; i++) { const t = i / 14; await m.move(276 + 38 * Math.sin(t * Math.PI), 662 - 300 * t); await page.waitForTimeout(18); }
  await page.waitForTimeout(60);
  await save(await page.screenshot(), 'docs/phone-aim.png');
  await m.up();
  await page.context().close();
}
{
  // The pins flying.
  const page = await open({ width: 390, height: 844 }, 2);
  await page.click('#start');
  await page.waitForTimeout(200);
  const pic = await strike(page, 0.13, () => page.screenshot());
  await save(pic, 'docs/phone-strike.png');
  await page.context().close();
}
{
  // The end of a two-player game.
  const page = await open({ width: 390, height: 844 }, 2, ['Ana', 'Ben']);
  await page.click('#start');
  await page.evaluate(() => { pinDrop.speed = 14; });
  while (!(await page.isVisible('#end'))) {
    await page.evaluate(() => {
      if (pinDrop.phase !== 'aim') return;
      const up = pinDrop.pins.filter(p => p.state === 'up'), full = up.length === 10;
      const t = full ? 1.5 : up.reduce((s, p) => s + p.x, 0) / up.length, x = full ? 10 : Math.max(-14, Math.min(14, t));
      pinDrop.throw({ x, speed: 290, angle: full ? 0.0286 + (Math.random() - 0.5) * 0.004 : (t - x) / 720, hook: full ? -40 : 0 });
    });
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(500);
  await save(await page.screenshot(), 'docs/phone-card.png');
  await page.context().close();
}

// Link preview, 1200 x 630: the name and a line on the left, the pins flying on the right.
{
  const page = await open({ width: 470, height: 630 }, 2);
  await page.click('#start');
  await page.evaluate(() => { document.getElementById('hud').style.display = 'none'; document.getElementById('others').style.display = 'none'; });
  await page.addStyleTag({ content: '.call, .readout, .hint { display: none !important; }' });
  await page.waitForTimeout(200);
  const shot = await strike(page, 0.16, () => page.evaluate(() => document.getElementById('lane').toDataURL('image/png')));
  await page.context().close();

  const font = async f => `data:font/woff2;base64,${(await readFile(join(root, 'fonts', f))).toString('base64')}`;
  const card = await open({ width: 1200, height: 630 }, 1);
  await card.setContent(`<!doctype html><html><head><style>
    @font-face { font-family: Shrikhand; src: url(${await font('shrikhand.woff2')}); }
    @font-face { font-family: Figtree; src: url(${await font('figtree.woff2')}); font-weight: 400 800; }
    html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
    body { background: radial-gradient(circle at 20% 30%, #26315c, #0d1222 70%); display: flex; align-items: center; font-family: Figtree, sans-serif; color: #f6eedc; }
    .text { flex: 1; padding: 0 30px 0 80px; }
    h1 { font-family: Shrikhand, serif; font-weight: 400; font-size: 132px; line-height: 1; margin: 0 0 26px; color: #ffc94a; text-shadow: 0 6px 0 #a3461c, 0 0 40px rgba(255,140,50,.35); transform: rotate(-4deg); transform-origin: left; white-space: nowrap; }
    p { font-size: 38px; line-height: 1.25; margin: 0; color: #f6eedc; font-weight: 600; }
    p span { color: #a1a9c4; font-weight: 500; font-size: 30px; display: block; margin-top: 14px; }
    .shot { width: 470px; height: 630px; background: url(${shot}) center / cover; flex: none; -webkit-mask-image: linear-gradient(to right, transparent, #000 16%); }
  </style></head><body>
    <div class="text"><h1>Pin Drop</h1><p>Ten-pin bowling<br>with one swipe.<span>Curve it to hook into the pocket.</span></p></div>
    <div class="shot"></div>
  </body></html>`);
  await card.evaluate(() => document.fonts.ready);
  await card.waitForTimeout(100);
  await save(await card.screenshot(), 'og.png');
  await card.context().close();
}

await browser.close();
server.close();
console.log('screenshots written');

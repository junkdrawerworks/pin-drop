// Pin Drop: the game around the lane. Turns and frames, the swipe, the pinsetter, the scorecards and the sheets.
import { Sim, rack, LANE, BALL_R } from './physics.js';
import { Renderer, BALL_COLOURS } from './render.js';
import { frames, next, total, isSplit } from './scoring.js';
import * as sound from './sound.js';
import { load, save } from './store.js';

const $ = id => document.getElementById(id);
const canvas = $('lane');
const view = new Renderer(canvas);
const store = load();
sound.setSound(store.sound);

const MAX_PLAYERS = 4;
const SETTLE = 1.2, SWEEP = 1.75, RETURN = 0.85;   // seconds
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };

let game = null;          // { players: [{ name, rolls, x }], turn, leftover }
let phase = 'title';      // title, aim, rolling, settle, sweep, return, over
let phaseT = 0, camT = 0;
let pins = rack(), ball = idle(0), sim = null;
let guide = null, sweep = null;
let before = 10, sawGutter = false, wasSplit = false, felt = false;
let paused = false;
let timeScale = 1, fixedSeed = null;

function idle(x) { return { x, y: 6, state: 'lane', roll: 0, vx: 0, vy: 0 }; }
const current = () => game.players[game.turn];
const colourOf = i => BALL_COLOURS[i % BALL_COLOURS.length];

// ---- The lane, every frame -------------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  const dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  if (!paused) update(dt * timeScale);
  view.draw({ t: now / 1000, pins, ball: phase === 'sweep' ? null : ball, guide, sweep, colour: colourOf(game ? game.turn : 0) });
  requestAnimationFrame(loop);
}

function update(dt) {
  phaseT += dt;
  if (phase === 'rolling') {
    sim.step(dt);
    ball = sim.ball;
    for (const e of sim.events) {
      if (e.kind === 'gutter') { sawGutter = true; sound.gutter(); }
      else if (e.kind !== 'pit') sound.hit(e.kind, e.power);
      if (e.kind === 'ball' && !felt) { felt = true; buzz(25); }
    }
    sim.events.length = 0;
    // Follow the ball down the lane.
    camT = Math.max(camT, ease((ball.y - 140) / (LANE.head - 110 - 140)));
    view.setCamera(camT, ball.state === 'lane' ? ball.x : 0);
    const moving = ball.state === 'lane' || (ball.state === 'gutter' && ball.y < LANE.deck);
    sound.roll(moving ? clamp(Math.hypot(ball.vx, ball.vy) / 380) * (1 - camT * 0.4) : 0);
    if (sim.settled) { sound.roll(0); scoreBall(); }
  } else if (phase === 'settle') {
    view.setCamera(1, 0);
    if (phaseT > SETTLE) startSweep();
  } else if (phase === 'over') {
    view.setCamera(1, 0);
    if (phaseT > 1.9 && $('end').hidden) showEnd();
  } else if (phase === 'sweep') {
    runSweep();
    view.setCamera(1, 0);
  } else if (phase === 'return') {
    camT = 1 - ease(phaseT / RETURN);
    view.setCamera(camT, 0);
    if (phaseT >= RETURN) aim();
  } else {
    view.setCamera(0, 0);
  }
}

// ---- A game --------------------------------------------------------------------------------------------

function startGame(names) {
  hush();
  game = { players: names.map(name => ({ name, rolls: [], x: 0 })), turn: 0, leftover: null };
  store.names = names;
  keep();
  show(null);
  $('hud').hidden = false;
  pins = rack();
  aim();
  if (names.length > 1) say(`${names[0]}’s turn`, '', 'small');
}

function resumeGame() {
  game = store.current;
  show(null);
  $('hud').hidden = false;
  pins = rack(game.leftover || undefined);
  aim();
  say(`${current().name}`, `Frame ${next(current().rolls).frame + 1}`, 'small');
}

// Ready for the next ball: the rack it faces, the ball where this player last stood.
function aim() {
  phase = 'aim'; phaseT = 0; camT = 0;
  view.setCamera(0);
  ball = idle(current().x || 0);
  sim = null; guide = null; sweep = null;
  before = pins.filter(p => p.state === 'up').length;
  hud();
  $('hint').hidden = store.throws >= 6;
}

function throwBall(shot) {
  guide = null;
  felt = false; sawGutter = false;
  before = pins.filter(p => p.state === 'up').length;
  wasSplit = !next(current().rolls).fresh && isSplit(pins.filter(p => p.state === 'up').map(p => p.id));
  sim = new Sim(pins, shot, fixedSeed ?? ((Math.random() * 2 ** 31) | 0));
  phase = 'rolling'; phaseT = 0; camT = 0;
  $('hint').hidden = true;
  const mph = (shot.speed * 0.0568).toFixed(1);
  const hook = Math.abs(shot.hook) < 3 ? 'straight' : shot.hook < 0 ? 'hook left' : 'hook right';
  readout(`${mph} mph · ${hook}`);
  sound.wake();
}

// The ball's done: count the pins, mark the card, say something, and work out who's next.
function scoreBall() {
  const standing = sim.standing;
  const p = current();
  const st = next(p.rolls);
  const knocked = Math.max(0, before - standing.length);
  p.rolls.push(knocked);
  store.throws = (store.throws || 0) + 1;
  callout(st, p, knocked, standing.map(q => q.id).sort((a, b) => a - b));
  const st2 = next(p.rolls);
  if (!st2.done && st2.frame === st.frame) {
    game.leftover = st2.fresh ? null : standing;
  } else {
    game.leftover = null;
    const n = game.players.length;
    let k = game.turn;
    for (let i = 1; i <= n; i++) { const j = (game.turn + i) % n; if (!next(game.players[j].rolls).done) { k = j; break; } }
    game.nextTurn = next(game.players[k].rolls).done ? -1 : k;
  }
  hud();
  if (game.players.every(q => next(q.rolls).done)) {
    phase = 'over'; phaseT = 0;
    finish();
  } else {
    phase = 'settle'; phaseT = 0;
  }
  keep();
}

function callout(st, p, knocked, left) {
  readout('');
  const cleared = left.length === 0;
  if (st.fresh) {
    if (cleared) {
      // Strikes in a row: count back through this player's balls.
      let run = 0;
      for (let k = p.rolls.length; k > 0; k--) {
        if (p.rolls[k - 1] === 10 && next(p.rolls.slice(0, k - 1)).fresh) run++; else break;
      }
      const name = run === 1 ? 'Strike!' : run === 2 ? 'Double!' : run === 3 ? 'Turkey!' : `${run} in a row!`;
      const perfect = run === 12 ? 'A perfect game' : '';
      say(perfect ? 'Perfect!' : name, perfect, '');
      sound.chime(true); buzz([30, 50, 60]);
    } else if (knocked === 0) say(sawGutter ? 'Gutter ball' : 'Missed', '', 'small');
    else if (isSplit(left)) say('Split', `the ${left.join('–')}`, 'small');
    else say(String(knocked), left.length <= 3 ? `the ${left.join('–')} left` : 'pins', 'small');
  } else if (cleared) {
    say(wasSplit ? 'Picked up!' : 'Spare!', wasSplit ? 'the split' : '', 'teal');
    sound.chime(false); buzz(30);
  } else {
    const st2 = next(p.rolls);
    say(knocked === 0 ? (sawGutter ? 'Gutter ball' : 'Missed') : String(knocked), st2.frame !== st.frame || st2.done ? 'open frame' : '', 'small');
  }
}

// ---- The pinsetter -------------------------------------------------------------------------------------

function startSweep() {
  phase = 'sweep'; phaseT = 0;
  sweep = { on: false, y: LANE.head - 28, z: 26, swapped: false };
  for (const p of pins) if (p.state === 'gutter') p.state = 'pit';
  sound.sweep();
}

function runSweep() {
  const u = phaseT;
  // Standing pins go up into the machine, the bar drops and sweeps the deadwood into the pit, and the pins come
  // back down: the same ones where they stood, or a fresh rack.
  if (!sweep.swapped) for (const p of pins) if (p.state === 'up') p.lift = 22 * ease(u / 0.35);
  sweep.on = u > 0.3 && u < 1.4;
  sweep.z = u < 0.55 ? 26 * (1 - ease((u - 0.3) / 0.25)) : u < 1.1 ? 0 : 26 * ease((u - 1.1) / 0.28);
  sweep.y = u < 0.55 ? LANE.head - 28 : LANE.head - 28 + (LANE.deck + 14 - LANE.head + 28) * ease((u - 0.55) / 0.55);
  if (sweep.z < 4) {
    for (const p of pins) {
      if (p.state !== 'down' && p.state !== 'falling') continue;
      const front = p.y - Math.abs(Math.sin(p.a)) * 7.5;
      if (front < sweep.y + 2) p.y += sweep.y + 2 - front;
      if (p.y > LANE.deck + 4) p.state = 'pit';
    }
  }
  if (u >= 1.3 && !sweep.swapped) {
    sweep.swapped = true;
    pins = rack(game.leftover || undefined);
    for (const p of pins) p.lift = 22;
  }
  if (sweep.swapped) for (const p of pins) p.lift = 22 * (1 - ease((u - 1.3) / 0.4));
  if (u >= SWEEP) {
    for (const p of pins) p.lift = 0;
    sweep = null;
    const changing = game.nextTurn !== undefined && game.nextTurn !== null;
    if (changing) { if (game.nextTurn >= 0) game.turn = game.nextTurn; game.nextTurn = null; }
    phase = 'return'; phaseT = 0;
    ball = idle(current().x || 0);
    hud();
    keep();
    if (changing && game.players.length > 1) say(`${current().name}’s turn`, '', 'small');
  }
}

// ---- The swipe -----------------------------------------------------------------------------------------

let touch = null;
canvas.addEventListener('pointerdown', e => {
  sound.wake();
  if (phase !== 'aim' || paused) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* fine without */ }
  touch = { id: e.pointerId, pts: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }], mode: null, x0: ball.x };
});
canvas.addEventListener('pointermove', e => {
  if (!touch || e.pointerId !== touch.id) return;
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const c of evs.length ? evs : [e]) touch.pts.push({ x: c.clientX, y: c.clientY, t: c.timeStamp || e.timeStamp });
  const a = touch.pts[0], dx = e.clientX - a.x, dy = e.clientY - a.y;
  if (!touch.mode && Math.hypot(dx, dy) > 10) touch.mode = Math.abs(dx) > Math.abs(dy) ? 'move' : dy < 0 ? 'throw' : 'none';
  if (touch.mode === 'move') {
    // Slide the ball across the approach, under the finger.
    const perInch = view.cam.f / (ball.y - view.cam.y);
    ball.x = clamp(touch.x0 + dx / perInch, -LANE.half + BALL_R + 0.5, LANE.half - BALL_R - 0.5);
    current().x = ball.x;
  } else if (touch.mode === 'throw') {
    guide = shotFrom(touch.pts, false);
  }
});
const lift = e => {
  if (!touch || e.pointerId !== touch.id) return;
  const t = touch; touch = null;
  if (t.mode === 'throw' && e.type === 'pointerup') {
    t.pts.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    const shot = shotFrom(t.pts, true);
    if (shot) { throwBall(shot); return; }
  }
  if (t.mode === 'move') keep();
  guide = null;
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);

// A swipe, read as a throw: its direction is the aim, its speed at the end is how hard, and how much it bends
// is the hook.
function shotFrom(pts, final) {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (-dy < (final ? 40 : 12)) return final ? null : guide;
  const len = Math.hypot(dx, dy);
  // Speed over the last tenth of a second or so.
  let k = pts.length - 1;
  while (k > 0 && b.t - pts[k - 1].t < 110) k--;
  const s = pts[Math.max(0, k - 1)];
  const v = Math.hypot(b.x - s.x, b.y - s.y) / Math.max(16, b.t - s.t);
  const vn = v * 800 / clamp(view.H, 500, 1100);
  const speed = clamp(175 + (vn - 0.5) * 95, 170, 390);
  const angle = clamp(Math.atan(dx / -dy * 0.08), -0.07, 0.07);
  // The bend: how far the swipe bows out from a straight line, as a share of its length. Bowing out to the right
  // (so it finishes turning left) hooks left.
  let bow = 0;
  for (const p of pts) {
    const right = -((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    if (Math.abs(right) > Math.abs(bow)) bow = right;
  }
  const c = bow / len;
  const hook = Math.abs(c) < 0.025 ? 0 : -Math.sign(c) * Math.min(65, (Math.abs(c) - 0.025) * 380);
  return { x: ball.x, speed, angle, hook };
}

// ---- What's on screen ----------------------------------------------------------------------------------

function cardHTML(rolls, now, big) {
  const fs = frames(rolls);
  let h = `<span class="frames${big ? ' roomy' : ''}">`;
  for (let i = 0; i < 10; i++) {
    const f = fs[i], boxes = i < 9 ? 2 : 3;
    let spans = '';
    for (let k = 0; k < boxes; k++) {
      const v = f?.marks[k] ?? '';
      spans += `<span class="${v === 'X' ? 'x' : v === '/' ? 's' : ''}">${v}</span>`;
    }
    h += `<span class="f${i === now ? ' now' : ''}"><span class="balls">${spans}</span><span class="tot">${f && f.total !== null ? f.total : ''}</span></span>`;
  }
  return h + `<span class="f sum">${total(rolls)}</span></span>`;
}

function hud() {
  if (!game) return;
  const p = current(), st = next(p.rolls);
  $('who').innerHTML = `<i style="background:${colourOf(game.turn)[1]}"></i>${esc(p.name)}`;
  $('where').textContent = st.done ? 'Done' : `Frame ${st.frame + 1} · ball ${st.ball + 1}`;
  $('frames').outerHTML = cardHTML(p.rolls, st.done ? -1 : st.frame).replace('<span class="frames', '<span id="frames" class="frames');
  const others = game.players.map((q, i) => ({ q, i })).filter(o => o.i !== game.turn);
  $('others').hidden = others.length === 0;
  $('others').innerHTML = others.map(({ q, i }) =>
    `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colourOf(i)[1]};margin-right:5px"></i>${esc(q.name)} <b>${total(q.rolls)}</b></span>`).join('');
}

function boardHTML(withBest) {
  const best = Math.max(...game.players.map(q => total(q.rolls)));
  return game.players.map((q, i) => `<div class="row"><div class="name"><span><i style="background:${colourOf(i)[1]}"></i>${esc(q.name)}</span>${withBest && game.players.length > 1 && total(q.rolls) === best ? '<em>Winner</em>' : ''}</div>${cardHTML(q.rolls, -1, true)}</div>`).join('');
}

let callTimer = 0;
function say(big, small, kind) {
  const el = $('call');
  el.className = 'call';
  el.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}`;
  void el.offsetWidth;
  el.className = `call go ${kind || ''}`;
  clearTimeout(callTimer);
  callTimer = setTimeout(() => { el.className = 'call'; }, 1800);
}

function hush() { clearTimeout(callTimer); $('call').className = 'call'; }

function readout(text) {
  $('readout').textContent = text;
}

function buzz(p) { try { navigator.vibrate?.(p); } catch { /* not on this device */ } }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Sheets --------------------------------------------------------------------------------------------

const sheets = ['title', 'menu', 'howSheet', 'board', 'end'];
function show(id) {
  for (const s of sheets) $(s).hidden = s !== id;
  paused = id === 'menu' || id === 'howSheet' || id === 'board';
}

function titleScreen() {
  phase = 'title';
  hush();
  game = null;
  $('hud').hidden = true; $('others').hidden = true; $('hint').hidden = true;
  readout('');
  pins = rack(); ball = idle(0); sweep = null; guide = null;
  view.setCamera(0);
  const c = store.current;
  const going = c && c.players?.some(q => !next(q.rolls).done);
  $('resume').hidden = !going;
  if (going) {
    const f = Math.min(...c.players.map(q => next(q.rolls).frame)) + 1;
    $('resume').textContent = `Carry on · frame ${f}`;
  }
  drawPlayers(store.names?.length ? store.names : ['You']);
  record();
  show('title');
}

function drawPlayers(names) {
  const ol = $('players');
  ol.innerHTML = names.map((n, i) => `<li><span class="ball" style="background:radial-gradient(circle at 35% 30%, ${colourOf(i)[0]}, ${colourOf(i)[1]} 55%, ${colourOf(i)[2]})"></span>`
    + `<input type="text" maxlength="14" value="${esc(n)}" aria-label="Player ${i + 1}’s name" autocomplete="off" spellcheck="false">`
    + (names.length > 1 ? `<button type="button" aria-label="Remove ${esc(n)}">×</button>` : '') + '</li>').join('');
  ol.querySelectorAll('button').forEach((b, i) => b.addEventListener('click', () => drawPlayers(readNames().filter((_, j) => j !== i))));
  $('addPlayer').hidden = names.length >= MAX_PLAYERS;
}
const readNames = () => [...$('players').querySelectorAll('input')].map((el, i) => el.value.trim() || `Player ${i + 1}`);

function record() {
  const games = store.games || [];
  let h = '';
  if (store.best) h += `<div class="best"><span>Best game${store.bestBy ? ` · ${esc(store.bestBy)}` : ''}</span><b>${store.best}</b></div>`;
  if (games.length) {
    h += '<ol>' + games.slice(0, 5).map(g => {
      const d = new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      return `<li><span>${d}</span><span>${g.scores.map(s => `${esc(s.name)} <b>${s.score}</b>`).join(' · ')}</span></li>`;
    }).join('') + '</ol>';
  }
  $('record').innerHTML = h;
}

function finish() {
  const scores = game.players.map(q => ({ name: q.name, score: total(q.rolls) }));
  const top = Math.max(...scores.map(s => s.score));
  game.newBest = top > (store.best || 0);
  if (game.newBest) { store.best = top; store.bestBy = scores.find(s => s.score === top).name; }
  store.games = [{ at: Date.now(), scores }, ...(store.games || [])].slice(0, 20);
  store.current = null;
  save(store);
}

function showEnd() {
  const scores = game.players.map(q => ({ name: q.name, score: total(q.rolls) }));
  const top = Math.max(...scores.map(s => s.score));
  const winners = scores.filter(s => s.score === top);
  $('endTitle').textContent = scores.length === 1 ? `${top}` : winners.length > 1 ? 'A tie!' : `${winners[0].name} wins!`;
  $('endTitle').classList.toggle('score', scores.length === 1);
  const line = scores.length === 1
    ? (top === 300 ? 'A perfect game.' : game.newBest ? 'Your best game yet.' : store.best ? `Your best is ${store.best}.` : '')
    : (game.newBest ? `${top} is a new best on this phone.` : `with ${top}`);
  $('endLine').textContent = line;
  $('endCards').innerHTML = boardHTML(true);
  show('end');
  $('hud').hidden = true; $('others').hidden = true;
}

// Saves after every ball, as the next ball will find things: whose turn, and the pins left standing.
function keep() {
  if (game && !game.players.every(q => next(q.rolls).done)) {
    const pending = game.nextTurn != null;
    store.current = { players: game.players, turn: pending && game.nextTurn >= 0 ? game.nextTurn : game.turn, leftover: pending ? null : game.leftover };
  }
  save(store);
}

$('addPlayer').addEventListener('click', () => {
  const names = readNames();
  if (names.length < MAX_PLAYERS) drawPlayers([...names, `Player ${names.length + 1}`]);
  const inputs = $('players').querySelectorAll('input');
  inputs[inputs.length - 1]?.select();
});
$('start').addEventListener('click', () => { sound.wake(); startGame(readNames()); });
$('resume').addEventListener('click', () => { sound.wake(); resumeGame(); });
$('menuBtn').addEventListener('click', () => { touch = null; guide = null; quitArmed = false; $('menuQuit').textContent = 'End this game'; show('menu'); });
$('menuResume').addEventListener('click', () => show(null));
$('menuBoard').addEventListener('click', () => { $('boardCards').innerHTML = boardHTML(false); show('board'); });
$('card').addEventListener('click', () => { $('boardCards').innerHTML = boardHTML(false); show('board'); });
$('boardDone').addEventListener('click', () => show(null));
$('menuHow').addEventListener('click', () => show('howSheet'));
$('howDone').addEventListener('click', () => show(game ? null : 'title'));
const soundLabel = () => { $('menuSound').textContent = `Sound: ${store.sound ? 'on' : 'off'}`; };
soundLabel();
$('menuSound').addEventListener('click', () => { store.sound = !store.sound; sound.setSound(store.sound); soundLabel(); save(store); });
let quitArmed = false;
$('menuQuit').addEventListener('click', () => {
  if (!quitArmed) { quitArmed = true; $('menuQuit').textContent = 'Tap again to end it'; return; }
  store.current = null; save(store);
  titleScreen();
});
$('again').addEventListener('click', () => startGame(game.players.map(q => q.name)));
$('toTitle').addEventListener('click', titleScreen);

addEventListener('resize', () => { view.resize(); view.setCamera(camT, 0); });

// For the tests and the screenshot tool.
window.pinDrop = {
  get phase() { return phase; },
  get game() { return game; },
  get pins() { return pins; },
  get ball() { return ball; },
  throw(shot) { if (phase === 'aim') throwBall({ x: ball.x, ...shot }); },
  set speed(v) { timeScale = v; },
  set seed(v) { fixedSeed = v; },
  camera(t) { camT = t; view.setCamera(t, 0); },
  shotFrom,
  view,
};

titleScreen();
requestAnimationFrame(loop);

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.pinDropNoWorker) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// Pin Drop: the game around the lane. Turns and frames, the swipe, the pinsetter, the scorecards and the sheets.
import { Sim, rack, LANE, BALL_R } from './physics.js';
import { Renderer, BALL_COLOURS } from './render.js';
import { frames, next, total, pending, isSplit, callFor, cardText } from './scoring.js';
import * as sound from './sound.js';
import { load, save as write, parse, merge, int, keeping, KEY } from './store.js';
import { stroke, addPoints, readStroke, throwPoints, liftAs, throwOf } from './swipe.js';

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
let before = 10, sawGutter = false, wasSplit = false, felt = false, slow = false;
let called = false, clearedAt = null;   // Strike! or Spare! said as the last pin went, and when that was
let told = new Set();     // the players (by turn) already told a ball was slow, this game
let toldHook = new Set(); // and told why a ball hooked into the gutter
let lastShot = null;      // the ball being bowled, as it was thrown
let paused = false;
let followX = 0;          // how far across the lane the camera follows the ball, eased so it never jumps
let timeScale = 1, fixedSeed = null;

function idle(x) { return { x, y: 6, state: 'lane', roll: 0, vx: 0, vy: 0 }; }
const current = () => game.players[game.turn];
const colourOf = i => BALL_COLOURS[i % BALL_COLOURS.length];

// ---- The lane, every frame -------------------------------------------------------------------------------

let last = performance.now();
function loop(now) {
  // Up to a tenth of a second a frame, so a phone that can't keep up still rolls at full speed (the physics steps in
  // fixed slices however long the frame, so it plays out the same); a longer gap, as after a stall, is held back.
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) update(dt * timeScale);
  // A hand over the lane while there's a ball to pick up, closed while it's held.
  document.body.classList.toggle('aiming', phase === 'aim' && !paused);
  document.body.classList.toggle('dragging', !!touch);
  view.draw({ t: now / 1000, pins, ball: phase === 'sweep' ? null : ball, guide, sweep, colour: colourOf(game ? game.turn : 0) });
  requestAnimationFrame(loop);
}

function update(dt) {
  phaseT += dt;
  if (phase === 'rolling') {
    sim.step(dt);
    ball = sim.ball;
    for (const e of sim.events) {
      if (e.kind === 'gutter') { sawGutter = true; sound.gutter(); buzz(15); }
      else if (e.kind !== 'pit') sound.hit(e.kind, e.power);
      if (e.kind === 'ball' && !felt) { felt = true; buzz(25); sound.duck(); }
    }
    sim.events.length = 0;
    // Every pin the ball faced has gone over: a strike or a spare, whatever the deadwood does next (a pin that's going
    // over never stands up again, and one that's only wobbling still counts as standing). It's called a moment after
    // the last one goes, with the crash, rather than once everything has stopped sliding half a second later.
    if (!called && sim.hitPins && sim.pins.every(q => q.state !== 'up')) {
      clearedAt ??= phaseT;
      if (phaseT - clearedAt >= 0.12) { called = true; callCleared(); }
    }
    // Follow the ball down the lane, and into the gutter; once it's in the pit, stay where it went in.
    camT = Math.max(camT, ease((ball.y - 140) / (LANE.head - 110 - 140)));
    view.setCamera(camT, follow(ball.state === 'pit' ? followX : ball.x, dt));
    const moving = ball.state === 'lane' || (ball.state === 'gutter' && ball.y < LANE.deck);
    sound.roll(moving ? clamp(Math.hypot(ball.vx, ball.vy) / 380) * (1 - camT * 0.4) : 0);
    if (sim.settled) { sound.roll(0); scoreBall(); }
  } else if (phase === 'settle') {
    view.setCamera(1, follow(0, dt));
    if (phaseT > SETTLE) startSweep();
  } else if (phase === 'over') {
    view.setCamera(1, follow(0, dt));
    if (phaseT > 1.9 && $('end').hidden) showEnd();
  } else if (phase === 'sweep') {
    runSweep();
    view.setCamera(1, follow(0, dt));
  } else if (phase === 'return') {
    camT = 1 - ease(phaseT / RETURN);
    view.setCamera(camT, follow(0, dt));
    if (phaseT >= RETURN) aim();
  } else {
    view.setCamera(0, 0);
  }
}

// Eases the camera's follow towards x, a quarter of a second behind.
function follow(x, dt) {
  followX += (x - followX) * (1 - Math.exp(-dt / 0.25));
  return followX;
}

// ---- A game --------------------------------------------------------------------------------------------

// A new game for these players, each standing where `spots` says (Bowl again keeps where each one stood).
function startGame(names, spots = []) {
  hush();
  game = { players: names.map((name, i) => ({ name, rolls: [], x: spots[i] || 0 })), turn: 0, leftover: null };
  told = new Set(); toldHook = new Set();
  store.names = names;
  keep();
  $('hud').hidden = false;
  show(null);
  pins = rack();
  aim();
  if (names.length > 1) say(turnLine(names[0]), '', 'small', '', 'aim');
  tell(names.length > 1 ? `${turnLine(names[0])}, frame 1.` : 'Frame 1.');
}

function resumeGame() {
  game = store.current;
  told = new Set(); toldHook = new Set();
  $('hud').hidden = false;
  show(null);
  pins = rack(game.leftover || undefined);
  aim();
  say(`${current().name}`, `Frame ${next(current().rolls).frame + 1}`, 'small', '', 'aim');
  tell(`${current().name}, frame ${next(current().rolls).frame + 1}.`);
}

// Ready for the next ball: the rack it faces, the ball where this player last stood.
function aim() {
  phase = 'aim'; phaseT = 0; camT = 0; followX = 0;
  view.setCamera(0);
  ball = idle(current().x || 0);
  sim = null; guide = null; sweep = null;
  before = pins.filter(p => p.state === 'up').length;
  hud();
  hint();
  if (blockedDue) { blockedDue = false; nudge(BLOCKED, 6000, true); }
}

function throwBall(shot) {
  guide = null;
  felt = false; sawGutter = false; called = false; clearedAt = null;
  before = pins.filter(p => p.state === 'up').length;
  wasSplit = !next(current().rolls).fresh && isSplit(pins.filter(p => p.state === 'up').map(p => p.id));
  sim = new Sim(pins, shot, fixedSeed ?? ((Math.random() * 2 ** 31) | 0));
  lastShot = shot;
  phase = 'rolling'; phaseT = 0; camT = 0;
  slow = shot.speed <= 185;   // the slowest a swipe throws is 170
  nudgeText = '';
  hint();
  const mph = (shot.speed * 0.0568).toFixed(1);
  // Straight only when it is: the slightest hook still carries the ball inches over by the pins.
  const hook = shot.hook === 0 ? 'straight' : shot.hook < 0 ? 'hook left' : 'hook right';
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
  store.thrown[p.name] = (store.thrown[p.name] || 0) + 1;
  callout(p, knocked, standing.map(q => q.id).sort((a, b) => a - b));
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

function callout(p, knocked, left) {
  readout('');
  const cleared = left.length === 0;
  // A ball at about the slowest speed there is: say how to throw harder, once a game for each player. With a mouse or
  // trackpad, a flick with a finger while another holds the click is quicker than dragging with the one pressing.
  const faster = clicking() ? 'Flick faster: on a trackpad, hold with one finger and flick with another' : 'Flick faster for a harder throw';
  // A ball that hooked into the gutter on the side it was hooking to: the swipe curved, maybe without meaning to. That
  // comes first, once a game for each player too. (The readout said which way it hooked, but it's gone by now.) A slow
  // ball with more hook than its speed can carry to the pocket from anywhere is told so, rather than to stand somewhere
  // else; and nobody is told to stand further over who's already at the edge.
  const way = Math.sign(lastShot?.hook || 0);
  let tip = '';
  if (sawGutter && Math.abs(lastShot.hook) >= 3 && sim.ball.side === way && !toldHook.has(game.turn)) {
    toldHook.add(game.turn);
    if (lastShot.speed < 250 && Math.abs(lastShot.hook) > carries(lastShot.speed)) {
      told.add(game.turn);   // it says to flick faster, so the word about a slow ball isn't needed as well
      tip = `Too much hook for a ball that slow: flick faster or curve less${clicking() ? '. On a trackpad, hold with one finger and flick with another' : ''}`;
    } else {
      const atEdge = Math.abs(lastShot.x + way * (LANE.half - BALL_R - 0.5)) < 2;
      tip = `Your swipe curved, so it hooked ${way > 0 ? 'right' : 'left'}: swipe straighter${atEdge ? '' : ` or stand further ${way > 0 ? 'left' : 'right'}`}`;
    }
  } else if (slow && !cleared && !told.has(game.turn)) {
    told.add(game.turn);
    tip = faster;
  }
  const [big, small, kind] = callFor(p.rolls.slice(0, -1), knocked, left, { wasSplit, sawGutter });
  // A strike or spare was called as the last pin went (see update), and is still on screen.
  if (!called) { say(big, small, kind, kind === 'small' ? tip : ''); cheer(kind); }
  tell(ballWords(p, big, small, kind === 'small' ? tip : ''));
}

// Strike! or Spare! (or Double!, Picked up! and the rest), with its chime and buzz, before the ball has been counted.
function callCleared() {
  const [big, small, kind] = callFor(current().rolls, before, [], { wasSplit, sawGutter });
  readout('');
  say(big, small, kind, '');
  cheer(kind);
}
function cheer(kind) {
  if (kind === '') { sound.chime(true); buzz([30, 50, 60]); }
  else if (kind === 'teal') { sound.chime(false); buzz(30); }
}

// The most hook (in/s) a ball thrown this fast (in/s) can carry through the pocket from any spot at any angle without
// touching the gutter, worked out by trying them all. It's in in/s of sideways speed whatever the ball's speed, so a
// slower ball, longer on the dry back end, hooks further: at 200 in/s a hook past 30 can't reach the pocket from anywhere.
const CARRY = [[170, 20], [200, 30], [230, 40], [250, 65]];
function carries(speed) {
  if (speed <= CARRY[0][0]) return CARRY[0][1];
  for (let i = 1; i < CARRY.length; i++) {
    const [s0, h0] = CARRY[i - 1], [s1, h1] = CARRY[i];
    if (speed <= s1) return h0 + (h1 - h0) * (speed - s0) / (s1 - s0);
  }
  return CARRY.at(-1)[1];
}

// The ball in one plain sentence, for a screen reader: "Ana: 8, open frame. 15 after frame 2." The pins left are
// read as "the 4, 7 and 10 left", not with dashes, and a frame that's over says its total, or its number while a strike
// or spare waits.
function ballWords(p, big, small, tip) {
  const st = next(p.rolls.slice(0, -1)), st2 = next(p.rolls);
  const said = small.replace(/\d+(?:–\d+)+/g, m => { const ns = m.split('–'); return `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`; });
  let words = `${p.name}: ${big}`;
  if (said) words += big.endsWith('!') ? ` ${said[0].toUpperCase()}${said.slice(1)}.` : `, ${said}.`;
  else if (!big.endsWith('!')) words += '.';
  if (st2.done || st2.frame !== st.frame) {
    const t = frames(p.rolls)[st.frame].total;
    words += t !== null ? ` ${t} after frame ${st.frame + 1}.` : ` Frame ${st.frame + 1}.`;
  }
  return tip ? `${words} ${tip}.` : words;
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
    if (changing && game.players.length > 1) {
      say(turnLine(current().name), '', 'small', '', 'aim');
      tell(`${turnLine(current().name)}, frame ${next(current().rolls).frame + 1}.`);
    }
  }
}

// ---- The hint under the ball ----------------------------------------------------------------------------

// It says how to throw with whatever is being used on the lane: a mouse or trackpad, where the click has to be held
// down, or a finger or pen. Each player sees it for their first three balls on this device. Anything tried on the
// lane that throws nothing gets a word in its place for a few seconds (see nudge()), whoever is bowling.
const HINTS = {
  touch: ['Swipe up from the ball to roll', 'drag it sideways to move'],
  mouse: ['Drag the ball to move it', 'hold the click and flick up to roll'],
};
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let pointer = null;   // what was last used on the lane: 'mouse', 'touch' or 'pen' (null before anything is)
const clicking = () => (pointer ? pointer === 'mouse' : finePointer.matches);
const hintDue = () => !!game && (store.thrown[current().name] || 0) < 3;
let nudgeText = '', nudgeAt = -Infinity, nudgeTimer = 0;

function hint() {
  const el = $('hint');
  const [a, b] = HINTS[clicking() ? 'mouse' : 'touch'];
  // On a dark pill, to read over the light wood of the approach.
  el.innerHTML = nudgeText ? `<span class="pill">${esc(nudgeText)}</span>`
    : `<span class="pill"><span>${a}</span><span class="dot"> · </span><span>${b}</span></span>`;
  el.classList.toggle('nudge', !!nudgeText);
  el.hidden = !(nudgeText || hintDue()) || phase !== 'aim' || touch?.mode === 'throw';
  if (!el.hidden) placeHint(el);
}

// Just under the ball, where it says to swipe from, if there's room between the ball and the bottom of the screen
// (never lower than the bottom edge, clear of a phone's home bar); otherwise just above it. On a phone on its side
// with a home bar, the pill sat over the bottom of the ball.
function placeHint(el) {
  el.style.bottom = '';
  const low = parseFloat(getComputedStyle(el).bottom), pill = el.firstElementChild.offsetHeight;
  const top = view.p(ball.x, ball.y, 2 * BALL_R), foot = view.p(ball.x, ball.y, 0);
  if (!top || !foot) return;
  const under = view.H - foot[1] - pill - 8;
  el.style.bottom = `${Math.round(under >= low ? under : low + pill <= view.H - foot[1] ? low : view.H - top[1] + 10)}px`;
}

// A word for three seconds (or `ms`) in the hint's place, at most one every four unless it `must` show.
function nudge(text, ms = 3000, must = false) {
  const now = performance.now();
  if (now - nudgeAt < 4000 && !must) return;
  nudgeAt = now; nudgeText = text;
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(() => { nudgeText = ''; hint(); }, ms);
  hint();
}

// What to do on a trackpad: one finger holds the click down while another flicks. (Pressing with the finger that
// flicks is awkward. Two fingers pressed together are a right click, which throws too, but only on a trackpad set up
// that way, so it isn't what the game says.)
const TRACKPAD = 'On a trackpad, press with one finger and flick up with another';
const HOLD = 'Hold the click as you flick up (on a trackpad, hold with one finger, flick with another)';

// Two fingers sliding on a trackpad scroll (wheel events), which does nothing here. Only a trackpad or a mouse
// wheel sends them. (Pinching to zoom sends wheel events with ctrlKey set: that's the browser's business.)
canvas.addEventListener('wheel', e => {
  if (phase === 'aim' && !paused && !e.ctrlKey) nudge(TRACKPAD);
}, { passive: true });

// One finger gliding up a trackpad without pressing, or a mouse moved up with its button let go: the pointer flies up
// the lane from the ball (120 px within 300 ms, from within two ball widths of it) with no button held. Only while the
// player still has the hint. Heading for the menu or the scorecard does the same, so the word waits until the pointer
// has stopped for 150 ms, and doesn't come if by then it has gone over the scorecard or a button, or off the lane.
let glide = [], glideTimer = 0;
function stopGlide() { glide = []; clearTimeout(glideTimer); glideTimer = 0; }
function gliding(e) {
  if (e.pointerType !== 'mouse' || e.buttons !== 0 || strokes.size || phase !== 'aim' || paused
    || e.clientY < $('hud').getBoundingClientRect().bottom) { stopGlide(); return; }
  const now = performance.now(), x = e.clientX, y = e.clientY;
  glide.push({ x, y, t: now });
  while (now - glide[0].t > 300) glide.shift();
  const low = glide.reduce((a, g) => (g.y > a.y ? g : a)), b = view.p(ball.x, ball.y, BALL_R);
  const fromBall = b && Math.hypot(low.x - b[0], low.y - b[1]) <= 4 * BALL_R * b[2];
  if (!glideTimer && !(low.y - y >= 120 && fromBall && hintDue())) return;
  clearTimeout(glideTimer);
  glideTimer = setTimeout(() => {
    stopGlide();
    if (phase === 'aim' && !paused && !strokes.size && document.elementFromPoint(x, y) === canvas) nudge(HOLD);
  }, 150);
}
canvas.addEventListener('pointerleave', stopGlide);

function seen(e) {
  if (!e.pointerType || e.pointerType === pointer) return;
  pointer = e.pointerType;
  if (phase === 'aim') hint();
}

// ---- The swipe -----------------------------------------------------------------------------------------

// Each finger (or the mouse) on the lane is a stroke of its own, so a second finger landing mid-swipe (a palm, a thumb
// holding the phone, a child's finger) doesn't take the swipe's place. The one that has moved furthest is `touch`:
// the ball, the guide and the hint follow it. Whichever reads as a throw when it lifts throws, and the rest are
// dropped.
const strokes = new Map();   // by pointerId
let touch = null;
const reach = t => { const a = t.pts[0], b = t.pts[t.pts.length - 1]; return Math.hypot(b.x - a.x, b.y - a.y); };
function leading() {
  let lead = touch && strokes.has(touch.id) ? touch : null;
  for (const t of strokes.values()) if (!lead || reach(t) > reach(lead)) lead = t;
  if (lead === touch) return;
  // The ball carries on from where it is, not from where it was when the new lead began.
  if (lead) lead.x0 = ball.x - (lead.mode === 'move' ? lead.pts[lead.pts.length - 1].x - lead.pts[0].x : lead.mode === 'throw' ? lead.slid || 0 : 0) / perInch();
  touch = lead;
  guide = null;
  hint();
}
function dropStrokes() { strokes.clear(); touch = null; guide = null; }
canvas.addEventListener('pointerdown', e => {
  sound.wake();
  seen(e);
  // The main button, or the right one: pressing a trackpad down with two fingers is a right click, and some people
  // hold the ball that way. (The menu that would pop up is kept shut, below.) Not the middle button.
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  // A flick at the end of the camera's way back, once the ball is coming onto the screen (0.65 s in, on a phone or a
  // tablet either way up): the camera jumps the rest of the way so the flick throws. Before then there's no ball to
  // flick at yet.
  if (phase === 'return' && !paused && phaseT >= 0.65) aim();
  if (phase !== 'aim' || paused) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* fine without */ }
  // `extra`: another finger was already down, so this one tapping or brushing the lane gets no word about it.
  strokes.set(e.pointerId, { ...stroke(e, performance.now()), id: e.pointerId, x0: ball.x, extra: strokes.size > 0 });
  leading();
});
// Each finger position an event brings, with the times it happened (see addPoints in swipe.js).
function track(t, e) {
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  addPoints(t, evs.length ? evs : [e], performance.now());
}
// Slides the ball across the approach, dx px on screen from where it stood when the stroke began.
const perInch = () => view.cam.f / (ball.y - view.cam.y);
function slide(t, dx) {
  ball.x = clamp(t.x0 + dx / perInch(), -LANE.half + BALL_R + 0.5, LANE.half - BALL_R - 0.5);
  current().x = ball.x;
}
canvas.addEventListener('pointermove', e => {
  seen(e);
  gliding(e);
  const t = strokes.get(e.pointerId);
  if (!t) return;
  track(t, e);
  const was = t.mode;
  readStroke(t);
  leading();
  if (t !== touch) return;
  if ((touch.mode === 'throw') !== (was === 'throw')) hint();   // out of the way of a throw, and back for a move
  if (touch.mode === 'move') {
    // The ball follows the finger, from where it stood when the stroke began (a stroke that started with a wobble
    // down or up takes it from there as soon as it's clearly sideways).
    slide(touch, touch.pts[touch.pts.length - 1].x - touch.pts[0].x);
    guide = null;
  } else if (touch.mode === 'throw') {
    // From a move: the ball stays where it was slid to for a slide then a swipe up, or goes back where it stood for a
    // hook swipe that started sideways (see readStroke).
    if (was === 'move') slide(touch, touch.slid || 0);
    const p = throwPoints(touch), a = p[0], b = p[p.length - 1];
    // The guide shows only while letting go would throw, so pulling back down calls it off where you can see it.
    guide = -(b.y - a.y) < 12 || Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? null : shotFrom(p, false);
  }
});
const lift = e => {
  const t = strokes.get(e.pointerId);
  if (!t) return;
  strokes.delete(e.pointerId);
  const led = t === touch;   // only the lead stroke moves the ball
  if (led) { touch = null; guide = null; leading(); }
  hint();
  if (e.type !== 'pointerup') { if (t.mode === 'move' && led) keep(); return; }
  const end = t.pts[t.pts.length - 1];
  if (Math.hypot(e.clientX - end.x, e.clientY - end.y) > 2) { track(t, e); readStroke(t); }
  const as = liftAs(t), p = throwPoints(t);
  if (as === 'throw') {
    if (led) slide(t, t.slid || 0);
    const shot = shotFrom(p, true);
    if (shot) { dropStrokes(); throwBall(shot); return; }
  } else if (as === 'move') {
    if (led) slide(t, t.pts[t.pts.length - 1].x - t.pts[0].x);
    keep();
  } else if (as === 'short' || (as !== 'cancel' && !t.extra && !strokes.size)) {
    // A tap, a stroke that only went down, or a flick too short to throw. (Not a tap or a brush from a finger that
    // came down while another was on the lane, or that lifts while one still is: that's a hand holding the phone.)
    const mouse = e.pointerType === 'mouse';
    nudge(as === 'short' ? (mouse ? 'Flick further up to roll' : 'Swipe further up to roll')
      : mouse ? 'Hold the click and flick up to roll' : 'Swipe up to roll');
  }
};
canvas.addEventListener('pointerup', lift);
canvas.addEventListener('pointercancel', lift);
canvas.addEventListener('contextmenu', e => e.preventDefault());   // no menu popping up over the lane

// A swipe, read as a throw (see throwOf), from where the ball stands; or nothing, for a swipe too short to throw
// (and while swiping, the guide as it was until the swipe is long enough to show one).
function shotFrom(pts, final) {
  const a = pts[0], b = pts[pts.length - 1];
  if (-(b.y - a.y) < (final ? 40 : 12)) return final ? null : guide;
  return { x: ball.x, ...throwOf(pts) };
}

// ---- What's on screen ----------------------------------------------------------------------------------

// A scorecard: the boxes to look at, and the same in words for a screen reader (left out on the scorecard along the
// top, which says it its own way).
function cardHTML(rolls, now, big, words = true) {
  const fs = frames(rolls);
  let h = `<span class="frames${big ? ' roomy' : ''}" aria-hidden="true">`;
  for (let i = 0; i < 10; i++) {
    const f = fs[i], boxes = i < 9 ? 2 : 3;
    let spans = '';
    for (let k = 0; k < boxes; k++) {
      const v = f?.marks[k] ?? '';
      spans += `<span class="${v === 'X' ? 'x' : v === '/' ? 's' : ''}">${v}</span>`;
    }
    h += `<span class="f${i === now ? ' now' : ''}"><span class="balls">${spans}</span><span class="tot">${f && f.total !== null ? f.total : ''}</span></span>`;
  }
  return h + `<span class="f sum${pending(rolls) > total(rolls) ? ' waiting' : ''}"><span>${sumHTML(rolls)}</span></span></span>${words ? `<span class="sr">${cardText(rolls)}</span>` : ''}`;
}

// A player's total, and while a strike or spare waits for its bonus balls, the pins so far with a plus ("10+"): a
// plain 0 after a first strike read as a strike scoring nothing. Once a game is over it's exact.
function sumHTML(rolls) {
  const t = total(rolls), p = pending(rolls);
  return p > t ? `${p}<i>+</i>` : `${t}`;
}

function hud() {
  if (!game) return;
  const p = current(), st = next(p.rolls);
  // Each player's dot in the light shade of their ball, to stand out on the dark card.
  $('who').innerHTML = `<i style="background:${colourOf(game.turn)[0]}"></i>${esc(p.name)}`;
  // In the tenth, a ball earned by a strike or spare is a bonus ball: the second after a strike, and the third.
  const bonus = st.frame === 9 && (st.ball === 2 || (st.ball === 1 && st.fresh));
  // While the turn passes (the pins settling and the sweep), who's next rather than this player's next frame; at
  // the end of the game, Done.
  const up = game.nextTurn ?? null, passing = up !== null && up !== game.turn;
  const upName = passing && up >= 0 ? game.players[up].name : '';
  $('where').textContent = passing ? (up < 0 ? 'Done' : `Up next: ${isYou(upName) ? 'you' : upName}`)
    : st.done ? 'Done' : `Frame ${st.frame + 1} · ${bonus ? 'bonus ball' : `ball ${st.ball + 1}`}`;
  $('frames').outerHTML = cardHTML(p.rolls, st.done ? -1 : st.frame, false, false).replace('<span class="frames', '<span id="frames" class="frames');
  // The button's name carries what it shows (the name, the frame and the total), then what it does.
  const t = total(p.rolls), pend = pending(p.rolls);
  $('cardSay').textContent = `total ${pend > t ? `at least ${pend}` : t}. Show the scorecard`;
  const others = game.players.map((q, i) => ({ q, i })).filter(o => o.i !== game.turn);
  $('others').hidden = others.length === 0;
  $('others').innerHTML = others.map(({ q, i }) =>
    `<span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colourOf(i)[0]};margin-right:5px"></i>${esc(q.name)} <b>${sumHTML(q.rolls)}</b></span>`).join('');
}

function boardHTML(withBest) {
  const best = Math.max(...game.players.map(q => total(q.rolls)));
  const tied = game.players.filter(q => total(q.rolls) === best).length > 1;
  return game.players.map((q, i) => `<div class="row"><div class="name"><span><i style="background:${colourOf(i)[0]}"></i>${esc(q.name)}</span>${withBest && game.players.length > 1 && total(q.rolls) === best ? `<em>${tied ? 'Tied' : 'Winner'}</em>` : ''}</div>${cardHTML(q.rolls, -1, true)}</div>`).join('');
}

let callTimer = 0;
// A callout. A ball's goes just above the sign over the pins, where there's room under the scorecard, or else over
// the lane in front of the pins (a tablet on its side). A turn's (at 'aim') goes over the lane in front of the pins
// as the next player sees them, so it doesn't hide them while they aim.
function say(big, small, kind, tip, at = 'pins') {
  const el = $('call');
  el.className = 'call';
  el.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}${tip ? `<small class="tip">${esc(tip)}</small>` : ''}`;
  void el.offsetWidth;
  el.style.fontSize = '';
  el.className = `call go ${kind || ''}${tip ? ' long' : ''}`;   // longer, to read the tip
  // A long name in the big letters is made smaller until it fits across the screen.
  if (el.scrollWidth > el.clientWidth + 1) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * 0.97 * (el.clientWidth - 24) / (el.scrollWidth - 24)}px`;
  const s = view.spots(), h = el.offsetHeight, grow = h * 0.04;  // it pops up to 8% bigger
  const below = $('hud').hidden ? 0 : $('hud').getBoundingClientRect().bottom + 6;
  let top = at === 'aim' ? s.aimDeckFront + 12 + grow : s.signTop - 12 - grow - h;
  if (at !== 'aim' && top < below) top = s.deckFront + 12 + grow;
  el.style.top = `${Math.round(Math.max(below, Math.min(top, view.H - h - grow - 8)))}px`;
  clearTimeout(callTimer);
  // Gone once it has faded, so a screen reader reading the page doesn't come across it later.
  callTimer = setTimeout(() => { el.className = 'call'; el.innerHTML = ''; }, tip ? 2900 : 1800);
}

// The first player is called You until they type a name, and "You’s turn" won't do.
const isYou = name => name.trim().toLowerCase() === 'you';
const turnLine = name => (isYou(name) ? 'Your turn' : `${name}’s turn`);
const winLine = name => (isYou(name) ? 'You win!' : `${name} wins!`);

function hush() { clearTimeout(callTimer); $('call').className = 'call'; $('call').innerHTML = ''; }

// One sentence for a screen reader to say (the callouts come and go too fast, and say less): what each ball did and
// whose turn it is, read out by the polite live region #said.
function tell(text) { $('said').textContent = text; }

function readout(text) {
  $('readout').innerHTML = text ? `<span class="pill">${esc(text)}</span>` : '';
}

function buzz(p) { try { navigator.vibrate?.(p); } catch { /* not on this device */ } }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Sheets --------------------------------------------------------------------------------------------

const sheets = ['title', 'menu', 'howSheet', 'board', 'end'];
const dialogs = ['menu', 'howSheet', 'board', 'end'];
// Everything behind a sheet, out of reach of Tab and a screen reader while one is up.
const behind = ['lane', 'hud', 'others', 'call', 'hint', 'readout'];
// One How to play: the title's folded-up copy is the sheet's list.
document.querySelector('#title .how ul').innerHTML = document.querySelector('#howSheet .howlist').innerHTML;
let shown = null;    // the sheet that's up
let opener = null;   // what had the focus when a sheet opened over the lane (or the menu), to go back to after it
const visible = el => !!el?.isConnected && el.getClientRects().length > 0;
// Shows one sheet, or none (the lane). A sheet is a dialog: the focus goes to its heading, so a screen reader reads
// "Paused", "Scorecard" or "Ana wins!", and back to whatever opened it when it closes (the menu button, if that's
// gone with the menu). The title, opened from another sheet, starts at its heading too.
function show(id) {
  const was = shown;
  shown = id;
  if (dialogs.includes(id) && (was === null || was === 'menu')) opener = document.activeElement;
  for (const s of sheets) $(s).hidden = s !== id;
  for (const s of behind) $(s).inert = !!id;
  if (dialogs.includes(id)) $(id).querySelector('h2').focus({ preventScroll: true });
  else if (id === 'title') { opener = null; if (was) $('title').querySelector('h1').focus({ preventScroll: true }); }
  // From the title to the lane, the focus is let go rather than handed to the menu button: coming from a name just
  // typed (Go on a phone's keyboard, or a tap on Bowl that leaves the name focused, as Safari does), the browser would
  // draw a focus ring round the menu button for the whole game, and a swipe on the lane never takes it away.
  else if (was === 'title') document.activeElement?.blur?.();
  else if (!visible(document.activeElement) || document.activeElement === document.body) {
    const back = visible(opener) ? opener : game ? $('menuBtn') : null;
    back?.focus({ preventScroll: true });
  }
  if (!id) opener = null;
  paused = id === 'menu' || id === 'howSheet' || id === 'board';
  // The rumble only changes as the ball rolls, which stops behind a sheet: so it stops too, and the next step of
  // the roll starts it again. Back on the lane, the sound carries on if it was put to sleep while the page was hidden.
  if (id) sound.roll(0);
  else sound.wake(false);
}

// Out of sight (another app, another tab), nothing plays; back again, it carries on unless a sheet is up.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) sound.sleep();
  else if (!paused) sound.wake(false);
});

function titleScreen() {
  phase = 'title';
  hush();
  game = null;
  nudgeText = '';
  $('hud').hidden = true; $('others').hidden = true; $('hint').hidden = true;
  readout('');
  pins = rack(); ball = idle(0); sweep = null; guide = null;
  view.setCamera(0);
  resumeButton();
  blockedDue = false;   // the title says it
  drawPlayers(store.names?.length ? store.names : ['You']);
  disarmStart();
  record();
  show('title');
}

// Carry on, when there's a game left half-way: whose turn it is and their frame, so on a phone passed round you can
// tell whether it's your game ("Carry on · Gwendolyn’s turn, frame 3"; "Carry on · frame 3" for one player).
function resumeButton() {
  const c = store.current;
  const going = !!c && Array.isArray(c.players) && c.players.some(q => !next(q.rolls).done);
  $('resume').hidden = !going;
  if (going) {
    const up = c.players[c.turn] ?? c.players.find(q => !next(q.rolls).done);
    const f = next(up.rolls).frame + 1;
    $('resume').textContent = c.players.length === 1 ? `Carry on · frame ${f}`
      : `Carry on · ${isYou(up.name) ? 'your turn' : `${up.name}’s turn`}, frame ${f}`;
  } else if (startArmed) disarmStart();
}

function drawPlayers(names) {
  const ol = $('players');
  ol.innerHTML = names.map((n, i) => `<li><span class="ball" style="background:radial-gradient(circle at 35% 30%, ${colourOf(i)[0]}, ${colourOf(i)[1]} 55%, ${colourOf(i)[2]})"></span>`
    + `<input type="text" maxlength="14" value="${esc(n)}" aria-label="Player ${i + 1}’s name" autocomplete="off" spellcheck="false">`
    + (names.length > 1 ? `<button type="button" aria-label="Remove ${esc(n)}">×</button>` : '') + '</li>').join('');
  // Each remove button is named for the player as their name is typed. Removing one from the keyboard puts the focus
  // on the name now in its place; with a finger or a mouse, on the remove button there (focusing a name would bring
  // up a phone's keyboard).
  ol.querySelectorAll('li').forEach((li, i) => {
    const input = li.querySelector('input'), b = li.querySelector('button');
    if (!b) return;
    input.addEventListener('input', () => b.setAttribute('aria-label', `Remove ${input.value.trim() || `Player ${i + 1}`}`));
    b.addEventListener('click', e => {
      drawPlayers(readNames().filter((_, j) => j !== i));
      const rows = ol.querySelectorAll('li'), row = rows[Math.min(i, rows.length - 1)];
      (e.detail === 0 ? row.querySelector('input') : row.querySelector('button') || $('addPlayer')).focus();
    });
  });
  $('addPlayer').hidden = names.length >= MAX_PLAYERS;
}
const readNames = () => [...$('players').querySelectorAll('input')].map((el, i) => el.value.trim() || `Player ${i + 1}`);

function record() {
  const games = store.games || [];
  let h = '';
  const by = store.bestBy && !isYou(store.bestBy) ? ` · ${esc(store.bestBy)}` : '';
  if (store.best) h += `<div class="best"><span>Best game${by}</span><b>${int(store.best)}</b></div>`;
  if (games.length) {
    h += '<ol>' + games.slice(0, 5).map(g => {
      const d = new Date(g.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      // Each name with its score, never parted at the end of a line, and the winner's score in gold (each top score, in
      // a tie), with the same said in words for a screen reader.
      const top = Math.max(...g.scores.map(q => int(q.score)));
      const tied = g.scores.filter(q => int(q.score) === top).length > 1;
      const pairs = g.scores.map((q, i) => {
        const won = g.scores.length > 1 && int(q.score) === top;
        const sep = i < g.scores.length - 1 ? ' ·' : '';
        return `<span class="pair">${esc(q.name)} <b${won ? ' class="won"' : ''}>${int(q.score)}</b>${won ? `<span class="sr"> ${tied ? 'tied' : 'won'}</span>` : ''}${sep}</span>`;
      });
      return `<li><span class="when">${d}</span><span class="scores">${pairs.join(' ')}</span></li>`;
    }).join('') + '</ol>';
  }
  if (!keeping()) h += `<p class="blocked">${BLOCKED}</p>`;
  $('record').innerHTML = h;
}

// The game's over: keep it, with every player's balls as well as their score (for working out averages and the
// like later), and any new bests.
function finish() {
  const scores = game.players.map(q => ({ name: q.name, score: total(q.rolls), rolls: q.rolls.slice() }));
  const top = Math.max(...scores.map(s => s.score));
  // Whether there was a best here to beat, and each player's own best before this game (null for a first game).
  game.hadBest = !!store.best;
  game.newBest = top > (store.best || 0);
  game.before = scores.map(s => (Object.hasOwn(store.bests, s.name) ? store.bests[s.name] : null));
  if (game.newBest) { store.best = top; store.bestBy = [...new Set(scores.filter(s => s.score === top).map(s => s.name))].join(' & '); }
  for (const s of scores) if (!Object.hasOwn(store.bests, s.name) || s.score > store.bests[s.name]) store.bests[s.name] = s.score;
  store.games = [{ at: Date.now(), scores }, ...(store.games || [])].slice(0, 20);
  store.current = null;
  put();
}

// "Ana and Cal": names in a line ("You and Ana" when one is still called You, who comes first).
const both = names => {
  const sorted = [...names.filter(isYou), ...names.filter(n => !isYou(n))];
  return sorted.length < 3 ? sorted.join(' and ') : `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`;
};

// The end of the game: its title and the line under it. One player hears about their own best (by name, not
// whoever's best is the best here); several hear who won and by how much, or who tied.
function endWords() {
  const scores = game.players.map(q => ({ name: q.name, score: total(q.rolls) }));
  const top = Math.max(...scores.map(s => s.score));
  const winners = scores.filter(s => s.score === top);
  if (scores.length === 1) {
    const was = game.before?.[0] ?? null;
    return [`${top}`, top === 300 ? 'A perfect game.' : was === null ? 'Your first game here.' : top > was ? 'Your best game yet.'
      : top === was ? 'That equals your best.' : `Your best is ${was}.`, top === 300 || (was !== null && top > was)];
  }
  const title = winners.length === 1 ? winLine(winners[0].name) : winners.length === 2 ? `${both(winners.map(w => w.name))} tie!`
    : `A ${winners.length === 3 ? 'three' : 'four'}-way tie!`;
  let line = winners.length === 1 ? `${top} to ${Math.max(...scores.filter(s => s !== winners[0]).map(s => s.score))}` : `${top} each`;
  if (top === 300) {
    const names = winners.map(w => w.name);
    line = names.length === 1 ? `${names[0]} bowled a perfect game.` : `${both(names)} bowled perfect games.`;
  } else if (game.newBest && game.hadBest) line += ' · a new best here';
  return [title, line, top === 300 || (game.newBest && game.hadBest)];
}

function showEnd() {
  hush();   // the last ball's callout, which can outlast the wait for this card
  const [title, line, best] = endWords();
  $('endTitle').textContent = title;
  $('endTitle').classList.toggle('score', game.players.length === 1);
  $('endLine').textContent = line;
  $('endCards').innerHTML = boardHTML(true);
  show('end');
  $('hud').hidden = true; $('others').hidden = true;
  if (best) buzz([40, 60, 40]);   // a best, or a perfect game
}

// What's on this device, saved; the first time the browser won't keep it, a word about that, once: in a game, in the
// hint's place as the next ball is aimed (the title says it under the record, from the start if loading found out).
const BLOCKED = 'This browser isn’t letting Pin Drop keep games, so a reload starts over.';
let blockedSaid = !keeping(), blockedDue = false;
function put() {
  if (write(store) || blockedSaid) return;
  blockedSaid = true;
  if (game) blockedDue = true; else record();
}

// Saves after every ball, as the next ball will find things: whose turn, and the pins left standing.
function keep() {
  if (game && !game.players.every(q => next(q.rolls).done)) {
    const pending = game.nextTurn != null;
    store.current = { players: game.players, turn: pending && game.nextTurn >= 0 ? game.nextTurn : game.turn, leftover: pending ? null : game.leftover };
  }
  put();
}

$('addPlayer').addEventListener('click', () => {
  const names = readNames();
  if (names.length < MAX_PLAYERS) drawPlayers([...names, `Player ${names.length + 1}`]);
  const inputs = $('players').querySelectorAll('input');
  inputs[inputs.length - 1]?.select();
});
// With a game still going, Bowl starts over only on a second tap, so one tap can't throw the saved game away.
let startArmed = false, startTimer = 0;
function disarmStart() {
  startArmed = false; clearTimeout(startTimer);
  $('start').textContent = 'Bowl';
}
// Bowl, or Enter in a name: the players are a form.
$('lineup').addEventListener('submit', e => {
  e.preventDefault();
  sound.wake();
  if (!$('resume').hidden && !startArmed) {
    startArmed = true; $('start').textContent = 'Tap again to start over';
    startTimer = setTimeout(disarmStart, 4000);
    return;
  }
  disarmStart();
  startGame(readNames());
});
// Anything else done on the title calls it off (but Enter in a name is a second go at Bowl).
for (const type of ['pointerdown', 'keydown', 'input']) {
  $('title').addEventListener(type, e => {
    if (startArmed && !e.target.closest?.('#start') && !(e.key === 'Enter' && e.target.closest?.('#lineup'))) disarmStart();
  });
}
$('resume').addEventListener('click', () => { sound.wake(); resumeGame(); });
// Once the last ball is in, the game's over: the menu button and the scorecard go straight to the end of it (who won,
// any new best) rather than pausing a game that's finished, which could then be ended without ever seeing that.
function openMenu() {
  if (phase === 'over') { showEnd(); return; }
  dropStrokes(); stopGlide(); quitArmed = false; $('menuQuit').textContent = 'End this game'; show('menu');
}
$('menuBtn').addEventListener('click', openMenu);
$('menuResume').addEventListener('click', () => show(null));
$('menuBoard').addEventListener('click', () => { $('boardCards').innerHTML = boardHTML(false); show('board'); });
$('card').addEventListener('click', () => {
  if (phase === 'over') { showEnd(); return; }
  $('boardCards').innerHTML = boardHTML(false); show('board');
});
$('boardDone').addEventListener('click', () => show(null));
$('menuHow').addEventListener('click', () => show('howSheet'));
$('howDone').addEventListener('click', () => show(game ? null : 'title'));
const soundLabel = () => {
  $('menuSound').textContent = `Sound: ${store.sound ? 'on' : 'off'}`;
  $('menuSound').setAttribute('aria-pressed', String(!!store.sound));
};
soundLabel();
$('menuSound').addEventListener('click', () => { store.sound = !store.sound; sound.setSound(store.sound); soundLabel(); put(); });
let quitArmed = false;
$('menuQuit').addEventListener('click', () => {
  if (phase === 'over') { showEnd(); return; }
  if (!quitArmed) { quitArmed = true; $('menuQuit').textContent = 'Tap again to end it'; return; }
  store.current = null; put();
  titleScreen();
});
$('again').addEventListener('click', () => startGame(game.players.map(q => q.name), game.players.map(q => q.x)));
$('toTitle').addEventListener('click', titleScreen);
// Escape closes the menu, How to play and the scorecard as their buttons do, and on the lane it opens the menu.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (shown === 'menu' || shown === 'board') show(null);
  else if (shown === 'howSheet') show(game ? null : 'title');
  else if (!shown && game && phase !== 'over') openMenu();
  else return;
  e.preventDefault();
});

// Another window of Pin Drop kept something (see merge in store.js): take in its records, so this one shows them and
// never writes over them. The game in progress stays this window's while it's being played; on the title, or at the
// end of a game, Carry on picks up the other window's.
addEventListener('storage', e => {
  if (e.key !== KEY || e.newValue === null) return;
  const theirs = parse(e.newValue);
  merge(store, theirs);
  if (phase === 'title' || phase === 'over') store.current = theirs.current;
  if (phase === 'title') { resumeButton(); record(); }
});

addEventListener('resize', () => { view.resize(); view.setCamera(camT, followX); if (phase === 'aim') hint(); });

// For the tests and the screenshot tool.
window.pinDrop = {
  get phase() { return phase; },
  get phaseT() { return phaseT; },
  get game() { return game; },
  get pins() { return pins; },
  get ball() { return ball; },
  get shot() { return lastShot; },
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

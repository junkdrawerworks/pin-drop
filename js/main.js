// Pin Drop: the game around the lane. Turns and frames, the swipe, the pinsetter, the scorecards and the sheets.
import { Sim, rack, rng, LANE, BALL_R, BOARD, SPOTS } from './physics.js';
import { plan, cpuName, LEVELS, LEVEL_KEYS } from './computer.js';
import { Renderer } from './render.js';
import { LOOKS, PLAIN, CPU_LOOK, lookById, lookFor, isPlain, picture, practiceEarns } from './balls.js';
import { frames, next, total, pending, isSplit, callFor, cardText, boxes, best as most, statsLine, PRACTICE } from './scoring.js';
import * as sound from './sound.js';
import { load, save as write, parse, merge, forget, numbers, catchUp, earn, int, keeping, KEY, GAMES } from './store.js';
import { stroke, addPoints, readStroke, throwPoints, liftAs, throwOf, MOUSE } from './swipe.js';
import { drive } from './sync.js';
import { guardEdges } from './edge-guard.js';

const $ = id => document.getElementById(id);
const canvas = $('lane');
const view = new Renderer(canvas);
const store = load();
catchUp(store);   // balls earned in games kept from before there were balls to earn
sound.setSound(store.sound);

const MAX_PLAYERS = 4;
const SETTLE = 1.2, SWEEP = 1.75, RETURN = 0.85;   // seconds
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const ease = t => { t = clamp(t); return t * t * (3 - 2 * t); };

let game = null;          // { players: [{ name, rolls, x, ball, splits, bumpers, head, cpu (its level) }], turn, leftover }
let phase = 'title';      // title, aim, rolling, settle, sweep, return, over
let phaseT = 0, camT = 0;
let pins = rack(), ball = idle(0), sim = null;
let guide = null, sweep = null;
let before = 10, sawGutter = false, wasSplit = false, felt = false, slow = false;
let called = false, clearedAt = null;   // Strike! or Spare! said as the last pin went, and when that was
let told = new Set();     // the players (by turn) already told a ball was slow, this game
let toldHook = new Set(); // and told why a ball hooked into the gutter
let lastShot = null;      // the ball being bowled, as it was thrown
let throwPins = null, throwSeed = 0;   // and the pins it faced and its seed, to play it again (see watchAgain)
let replay = null;        // while a ball is played again: { then (the phase to go back to), felt }
let paused = false;
let followX = 0;          // how far across the lane the camera follows the ball, eased so it never jumps
let timeScale = 1, fixedSeed = null;
// A tap on the lane after a ball plays the rest of the wait (the pins settling, the sweep and the camera coming back)
// HURRY times as fast, until the next ball is aimed.
const HURRY = 4;
// On the computer's turn, the whole of it, its aim and its rolls included.
let hurry = false, hurryTurn = -1;
const waiting = () => phase === 'settle' || phase === 'sweep' || phase === 'return' || phase === 'replay' || (cpuUp() && (phase === 'aim' || phase === 'rolling'));
const hurrying = () => hurry && waiting();

function idle(x) { return { x, y: 6, state: 'lane', roll: 0, vx: 0, vy: 0 }; }
const current = () => game.players[game.turn];
// A player's ball, by their place in the game: the look they chose (`ball`, which stays with them when Bowl again
// changes who leads off; see lookFor in balls.js for games from before there were looks). The computer's is silver.
const lookOf = i => lookFor(game?.players[i], i);
// The class that shows a look's picture on an element (a dot on a scorecard, a ball on the title): each look's picture
// is drawn once, into a rule of its own, the first time it's wanted.
const lookRules = document.head.appendChild(document.createElement('style'));
const ruled = new Set();
function lk(look) {
  if (!ruled.has(look.id)) {
    ruled.add(look.id);
    lookRules.sheet.insertRule(`.lk-${look.id} { background-color: ${look.ink}; background-image: url("${picture(look, 96)}"); }`);
  }
  return `lk lk-${look.id}`;
}

// ---- The lane, every frame -------------------------------------------------------------------------------

let last = performance.now();
// The lane is drawn every frame while anything on it moves. Behind a sheet (the title, the menu, How to play, the
// scorecard, the end of the game) nothing does, so it's drawn once as the sheet opens, or the screen changes size, and
// then left alone; while a ball waits to be thrown, only the sign's stars twinkle, so it's drawn about twelve times a
// second. (Repainting the whole canvas every frame kept a phone's main thread busy behind the title and the menu.)
let stale = true, drawnAt = -Infinity, drawnPhase = null;
const redraw = () => { stale = true; };
function loop(now) {
  // Up to a tenth of a second a frame, so a phone that can't keep up still rolls at full speed (the physics steps in
  // fixed slices however long the frame, so it plays out the same); a longer gap, as after a stall, is held back.
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!paused) update(dt * timeScale * (hurrying() ? HURRY : 1));
  // A hand over the lane while there's a ball to pick up, closed while it's held.
  document.body.classList.toggle('aiming', phase === 'aim' && !paused);
  document.body.classList.toggle('dragging', !!touch);
  const shownLesson = teaching();
  // A lesson's fingertip moves for 1.6 s of every 2.4 (see lesson in render.js), and is drawn every frame meanwhile.
  const moving = shownLesson && !shownLesson.still && shownLesson.u >= 0 && shownLesson.u % 2.4 < 1.65;
  const resting = shown !== null || (phase === 'aim' && !strokes.size && !guide && !moving && !cpuUp());
  if (stale || phase !== drawnPhase || !resting || (shown === null && now - drawnAt >= 80)) {
    view.draw({ t: now / 1000, pins, ball: phase === 'sweep' ? null : ball, guide, sweep, look: lookOf(game ? game.turn : 0), marks: marks(), lesson: shownLesson,
      bumpers: !!game?.players[game.turn].bumpers });
    stale = false; drawnAt = now; drawnPhase = phase;
  }
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
    chase(dt);
    const moving = ball.state === 'lane' || (ball.state === 'gutter' && ball.y < LANE.deck);
    sound.roll(moving ? clamp(Math.hypot(ball.vx, ball.vy) / 380) * (1 - camT * 0.4) : 0);
    if (sim.settled) { sound.roll(0); scoreBall(); }
  } else if (phase === 'replay') {
    // The ball again at half speed, with the camera following and its sounds, then on as before.
    sim.step(dt / 2);
    ball = sim.ball;
    for (const e of sim.events) {
      if (e.kind === 'gutter') sound.gutter();
      else if (e.kind !== 'pit') sound.hit(e.kind, e.power);
      if (e.kind === 'ball' && !replay.felt) { replay.felt = true; sound.duck(); }
    }
    sim.events.length = 0;
    chase(dt);
    const moving = ball.state === 'lane' || (ball.state === 'gutter' && ball.y < LANE.deck);
    sound.roll(moving ? clamp(Math.hypot(ball.vx, ball.vy) / 380) * (1 - camT * 0.4) : 0);
    if (sim.settled) { sound.roll(0); readout(''); phase = replay.then; phaseT = 0; replay = null; }
  } else if (phase === 'settle') {
    view.setCamera(1, follow(0, dt));
    if (phaseT > SETTLE) startSweep();
  } else if (phase === 'over') {
    view.setCamera(1, follow(0, dt));
    // A perfect game's call (or a turkey's) has its say before the end of the game covers it.
    if (phaseT > 1.9 && performance.now() > callUntil - 250 && $('end').hidden) showEnd();
  } else if (phase === 'sweep') {
    runSweep();
    view.setCamera(1, follow(0, dt));
  } else if (phase === 'return') {
    if (reduced.matches) { aim(); return; }   // a cut back to the ball, not a flight
    camT = 1 - ease(phaseT / RETURN);
    view.setCamera(camT, follow(0, dt));
    if (phaseT >= RETURN) aim();
  } else {
    view.setCamera(0, 0);
    if (windAt !== null) winding();
    if (phase === 'aim' && cpuShot) cpuStep();
  }
}

// The camera as a ball rolls: following it down the lane, and into the gutter; once it's in the pit, staying where it
// went in. With Reduce Motion on, it doesn't fly: the view stays behind the ball for the first two thirds of the way
// to the head pin, then cuts to the pins (and cuts back once the pinsetter is done: see update).
const CUT = LANE.head * 2 / 3;
function chase(dt) {
  if (reduced.matches) {
    if (camT < 1 && ball.y >= CUT) { camT = 1; followX = ball.x; }
  } else camT = Math.max(camT, ease((ball.y - 140) / (LANE.head - 110 - 140)));
  view.setCamera(camT, follow(ball.state === 'pit' ? followX : ball.x, dt));
}

// Eases the camera's follow towards x, a quarter of a second behind.
function follow(x, dt) {
  followX += (x - followX) * (1 - Math.exp(-dt / 0.25));
  return followX;
}

// ---- A game --------------------------------------------------------------------------------------------

// A new game for these players ([{ name, bumpers, head, ball, x }]), each with their own ball (`ball`, or their place's)
// and standing where they last stood (Bowl again keeps it). Begun from the title, the players and their switches are
// kept for next time.
function startGame(lineup, fromTitle = false) {
  hush();
  $('handoff').hidden = true;
  game = { players: lineup.map((q, i) => ({ name: q.cpu ? cpuName(q.cpu) : q.name, rolls: [], x: q.x || 0, ...(q.cpu ? {} : { ball: lookFor(q, i).id }), ...extras(q) })), turn: 0, leftover: null };
  told = new Set(); toldHook = new Set();
  if (fromTitle) {
    store.names = lineup.filter(q => !q.cpu).map(q => q.name);
    store.cpu = lineup.find(q => q.cpu)?.cpu ?? null;
    store.opts = Object.fromEntries(lineup.filter(q => q.bumpers || q.head).map(q => [q.name, extras(q)]));
    store.lineupAt = Date.now();
  }
  keep();
  if (fromTitle) drive.changed();
  $('hud').hidden = false;
  show(null);
  pins = rack();
  aim();
  const first = game.players[0].name;
  if (game.players.length > 1) say(turnLine(first), '', 'small', '', 'aim');
  tell(game.players.length > 1 ? `${turnLine(first)}, frame 1.` : 'Frame 1.');
}

// A player's bumpers and head start, as kept on them (only what's switched on), and the computer's level.
const extras = q => ({ ...(q.bumpers ? { bumpers: true } : {}), ...(int(q.head) ? { head: int(q.head) } : {}), ...(LEVELS[q.cpu] ? { cpu: q.cpu } : {}) });

function resumeGame() {
  $('handoff').hidden = true;
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
  // Hurried on, a ball's callout can still be up, over the pins (or the ball) being aimed at: it goes.
  if (hurry && callAt === 'pins' && performance.now() < callUntil) hush();
  phase = 'aim'; phaseT = 0; camT = 0; followX = 0;
  hurry = hurry && cpuUp() && hurryTurn === game.turn;   // a tap on the computer's turn hurries all of it
  $('replay').hidden = true;
  view.setCamera(0);
  ball = idle(current().x || 0);
  sim = null; guide = null; sweep = null;
  before = pins.filter(p => p.state === 'up').length;
  lesson = cpuUp() ? null : lessonDue();
  cpuShot = null;
  if (cpuUp()) cpuAim();
  hud();
  hint();
  if (blockedDue) { blockedDue = false; nudge(BLOCKED, 6000, true); }
}

function throwBall(shot) {
  shot = { ...shot, ...rails() };
  unwind();   // Space held as a ball goes another way (a click and flick) would throw again once it's back
  guide = null;
  learnt(shot);
  felt = false; sawGutter = false; called = false; clearedAt = null;
  before = pins.filter(p => p.state === 'up').length;
  wasSplit = !next(current().rolls).fresh && isSplit(pins.filter(p => p.state === 'up').map(p => p.id));
  throwPins = pins.map(p => ({ ...p }));
  throwSeed = fixedSeed ?? ((Math.random() * 2 ** 31) | 0);
  sim = new Sim(pins, shot, throwSeed);
  lastShot = shot;
  phase = 'rolling'; phaseT = 0; camT = 0;
  leaveCard();
  slow = shot.speed <= 185;   // the slowest a swipe throws is 170
  nudgeText = '';
  hint();
  const mph = (shot.speed * 0.0568).toFixed(1);
  // Straight only when it is: the slightest hook still carries the ball inches over by the pins.
  const hook = shot.hook === 0 ? 'straight' : shot.hook < 0 ? 'hook left' : 'hook right';
  readout(`${mph} mph · ${hook}`);
  sound.wake();
  sound.thud(shot.speed);
}

// The ball's done: count the pins, mark the card, say something, and work out who's next.
function scoreBall() {
  if (game.practice) { practiceBall(); return; }
  const standing = sim.standing;
  const p = current();
  const st = next(p.rolls);
  const knocked = Math.max(0, before - standing.length);
  p.rolls.push(knocked);
  // A ball at a full rack that left a split is ringed on the card (kept by its place in the list of balls; a game
  // kept before there were rings has none).
  if (st.fresh && isSplit(standing.map(q => q.id))) p.splits = [...(p.splits || []), p.rolls.length - 1];
  if (!p.cpu) {
    store.throws = (store.throws || 0) + 1;
    store.thrown[p.name] = (store.thrown[p.name] || 0) + 1;
  }
  callout(p, knocked, standing.map(q => q.id).sort((a, b) => a - b));
  if (knocked >= 9) $('replay').hidden = false;
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
  // trackpad, a flick with a finger while another holds the click is quicker than dragging with the one pressing; from
  // the keyboard, Space is held longer.
  const keys = !!lastShot?.keys;
  const faster = keys ? 'Hold Space longer for a harder throw'
    : clicking() ? 'Flick faster: on a trackpad, hold with one finger and flick with another' : 'Flick faster for a harder throw';
  // A ball that hooked into the gutter on the side it was hooking to: the swipe curved, maybe without meaning to. That
  // comes first, once a game for each player too. (The readout said which way it hooked, but it's gone by now.) A slow
  // ball with more hook than its speed can carry to the pocket from anywhere is told so, rather than to stand somewhere
  // else; and nobody is told to stand further over who's already at the edge.
  const way = Math.sign(lastShot?.hook || 0);
  let tip = '';
  if (p.cpu) {
    // The computer needs no tips.
  } else if (sawGutter && Math.abs(lastShot.hook) >= 3 && sim.ball.side === way && !toldHook.has(game.turn)) {
    toldHook.add(game.turn);
    const atEdge = Math.abs(lastShot.x + way * (LANE.half - BALL_R - 0.5)) < 2;
    const further = atEdge ? '' : ` or stand further ${way > 0 ? 'left' : 'right'}`;
    // From the keyboard, the hook was chosen with H.
    if (keys) tip = `It hooked ${way > 0 ? 'right' : 'left'}: press H for a straight ball${further}`;
    else if (lastShot.speed < 250 && Math.abs(lastShot.hook) > carries(lastShot.speed)) {
      told.add(game.turn);   // it says to flick faster, so the word about a slow ball isn't needed as well
      tip = `Too much hook for a ball that slow: flick faster or curve less${clicking() ? '. On a trackpad, hold with one finger and flick with another' : ''}`;
    } else tip = `Your swipe curved, so it hooked ${way > 0 ? 'right' : 'left'}: swipe straighter${further}`;
  } else if (slow && !cleared && !told.has(game.turn)) {
    told.add(game.turn);
    tip = faster;
  }
  const [big, small, kind] = callFor(p.rolls.slice(0, -1), knocked, left, { wasSplit, sawGutter });
  // A strike or spare was called as the last pin went (see update), and is still on screen.
  if (!called) { say(big, small, kind, kind === 'small' ? tip : ''); cheer(kind, big); }
  tell(ballWords(p, big, small, kind === 'small' ? tip : ''));
}

// Strike! or Spare! (or Double!, Picked up! and the rest), with its chime and buzz, before the ball has been counted.
function callCleared() {
  const [big, small, kind] = callFor(current().rolls, before, [], { wasSplit, sawGutter });
  readout('');
  if (before >= 9) $('replay').hidden = false;
  say(big, small, kind, '');
  cheer(kind, big);
}
// Strikes build: 1 for a strike, 2 a double, 3 a turkey or a longer run, 4 a perfect game. Each step up is bigger on
// screen, stays longer, and has a longer fanfare and buzz.
const level = big => (big === 'Perfect!' ? 4 : big === 'Turkey!' || / in a row!$/.test(big) ? 3 : big === 'Double!' ? 2 : 1);
const BUZZ = [null, [30, 50, 60], [30, 40, 30, 40, 60], [30, 40, 30, 40, 30, 40, 80], [40, 50, 40, 50, 40, 50, 40, 50, 160]];
function cheer(kind, big) {
  if (kind === '') { const n = level(big); sound.fanfare(n); buzz(BUZZ[n]); }
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
  const said = small.replace(/\d+(?:–\d+)+/g, m => { const ns = m.split('–'); return `${ns.slice(0, -1).join(', ')} and ${ns.at(-1)}`; }).replaceAll(' · ', ', ');
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
  $('replay').hidden = true;
  sweep = { on: false, y: LANE.head - 28, z: 26, swapped: false };
  for (const p of pins) if (p.state === 'gutter') p.state = 'pit';
  sound.sweep(hurry ? HURRY : 1);
}

function runSweep() {
  const u = phaseT;
  // Standing pins go up into the machine, the bar drops and sweeps the deadwood into the pit, and the pins come
  // back down: the same ones where they stood, or a fresh rack.
  if (!sweep.swapped) for (const p of pins) if (p.state === 'up') p.lift = 22 * ease(u / 0.35);
  sweep.on = u > 0.3 && u < 1.4;
  sweep.z = u < 0.55 ? 26 * (1 - ease((u - 0.3) / 0.25)) : u < 1.1 ? 0 : 26 * ease((u - 1.1) / 0.28);
  sweep.y = u < 0.55 ? LANE.head - 28 : LANE.head - 28 + (LANE.deck + 14 - LANE.head + 28) * ease((u - 0.55) / 0.55);
  // A clunk as the bar lands on the deck, and another as the pins are set down.
  if (u >= 0.55 && !sweep.landed) { sweep.landed = true; sound.clunk(); }
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
  if (u >= 1.7 && !sweep.set) { sweep.set = true; sound.clunk(); }
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
      // The card is for passing the phone: not for the computer, nor back to the one person playing it.
      if (!current().cpu && game.players.filter(q => !q.cpu).length > 1) handOff();
      else say(turnLine(current().name), '', 'small', '', 'aim');
      tell(`${turnLine(current().name)}, frame ${next(current().rolls).frame + 1}.`);
    }
  }
}

// ---- Passing the phone ---------------------------------------------------------------------------------
// As the turn passes to another player (never between two balls of one turn): a card over the lane, "Ben’s turn ·
// Tap to bowl", in their ball's colours, and nothing can be thrown until it's tapped. Without it, whoever still held
// the phone (often the last bowler, after a strike) could throw the next player's ball, and the turn's call sat over
// the pins while they aimed.
const handoffUp = () => !$('handoff').hidden;
let handoffFrom = null;   // what had the focus before the card took it, to go back to
function handOff() {
  const el = $('handoff'), look = lookOf(game.turn);
  $('handoffWho').textContent = turnLine(current().name);
  el.style.setProperty('--who', look.ink);
  el.querySelector('.orb').className = `orb ${lk(look)}`;
  el.hidden = false;
  hush();   // the last ball's callout, if it's still fading, would sit over the card
  dropStrokes(); unwind(); hint();
  if (!shown) { handoffFrom = document.activeElement; el.focus({ preventScroll: true }); }
}
function takeTurn() {
  if (!handoffUp()) return;
  const had = document.activeElement === $('handoff');
  $('handoff').hidden = true;
  if (had && visible(handoffFrom) && handoffFrom !== document.body) handoffFrom.focus({ preventScroll: true });
  handoffFrom = null;
  redraw(); hint();
}
$('handoff').addEventListener('click', takeTurn);

// ---- Watch again ---------------------------------------------------------------------------------------
// After a strike, or any ball that knocks down 9 or more, a button stays up until the pinsetter comes: it plays the
// ball again at half speed from the same pins and seed, which play out exactly the same way (the physics steps in
// fixed slices whatever the frame rate), so nothing needs recording. A strike is called before the deadwood has
// stopped: pressed then, the ball is finished off first, in no time, and counted.
function watchAgain() {
  if (paused || replay || !throwPins) return;
  if (phase === 'rolling') {
    while (!sim.settled) sim.step(1 / 60);
    sim.events.length = 0;
    sound.roll(0);
    pins = sim.pins; ball = sim.ball;
    scoreBall();
  }
  if (phase !== 'settle' && phase !== 'over') return;
  $('replay').hidden = true;
  hush();
  replay = { then: phase, felt: false };
  sim = new Sim(throwPins.map(p => ({ ...p })), lastShot, throwSeed);
  pins = sim.pins; ball = sim.ball;
  phase = 'replay'; phaseT = 0; camT = 0; followX = ball.x;
  view.setCamera(0, 0);
  readout('Again, at half speed');
}
$('replay').addEventListener('click', watchAgain);

// ---- The computer's turn ------------------------------------------------------------------------------------
// The computer bowls its own balls, through the same physics as a swipe (see plan in computer.js): it walks the ball
// over to where it stands, shows its line with the guide for a moment, as a swipe does, and throws. The camera,
// the callouts and the scorecard go as for anyone, and a tap hurries the rest of its turn on.
let cpuShot = null, cpuFrom = 0;
const cpuUp = () => !!game && !!current().cpu;
function cpuAim() {
  const p = current();
  const standing = pins.filter(q => q.state === 'up').map(q => ({ id: q.id, x: q.x, y: q.y }));
  // Its misses are random, or with a seed set for the tests, the same each time for each of its balls.
  cpuShot = plan(standing, p.cpu, rng(fixedSeed !== null ? fixedSeed * 977 + p.rolls.length + 1 : (Math.random() * 2 ** 31) | 0));
  cpuFrom = ball.x;
}
function cpuStep() {
  // Behind the note asking for a phone on its side to be turned upright, it waits.
  if (!$('upright').hidden) { phaseT = Math.min(phaseT, 0.3); return; }
  ball.x = cpuFrom + (cpuShot.x - cpuFrom) * ease((phaseT - 0.3) / 0.6);
  current().x = ball.x;
  guide = phaseT >= 1 ? cpuShot : null;
  if (phaseT >= 1.7) { const shot = cpuShot; cpuShot = null; throwBall(shot); }
}

// ---- Where to stand and aim, and the hint under the ball -----------------------------------------------------

// Each player's first ball of a game, while it waits to be thrown: a ring on the lane where to stand and the arrow to
// roll over lit up (see marks in render.js). From the dot on board 8 (12.8 in right of the middle) over the second
// arrow from the right, a straight ball comes into the pocket at an angle and strikes about one time in four.
const STAND = LANE.half - 7.5 * BOARD, TARGET = 10;
function marks() {
  if (phase !== 'aim' || !game || cpuUp()) return null;
  const st = next(current().rolls);
  return st.frame === 0 && st.ball === 0 ? { stand: STAND, target: TARGET } : null;
}

// It says how to throw with whatever is being used on the lane: a mouse or trackpad, where the click has to be held
// down, or a finger or pen. Each player sees it for their first three balls on this device. Anything tried on the
// lane that throws nothing gets a word in its place for a few seconds (see nudge()), whoever is bowling.
const HINTS = {
  touch: ['Swipe up from the ball to roll', 'drag it sideways to move'],
  mouse: ['Drag the ball to move it', 'hold the click and flick up to roll'],
  keys: ['Left and Right move the ball, H hooks', 'hold Space and let go to roll'],
};
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
let pointer = null;   // what was last used on the lane: 'mouse', 'touch', 'pen' or 'keys' (null before anything is)
const clicking = () => (pointer ? pointer === 'mouse' : finePointer.matches);
const hintDue = () => !!game && (store.thrown[current().name] || 0) < 3;
let nudgeText = '', nudgeAt = -Infinity, nudgeTimer = 0;

function hint() {
  const el = $('hint');
  const how = pointer === 'keys' ? 'keys' : clicking() ? 'mouse' : 'touch';
  const [a, b] = HINTS[how];
  // A lesson's words, for the ball it's shown on.
  const words = lesson && LESSONS[lesson.kind]?.[how];
  // On a dark pill, to read over the light wood of the approach.
  el.innerHTML = nudgeText ? `<span class="pill">${esc(nudgeText)}</span>` : words ? `<span class="pill">${words}</span>`
    : `<span class="pill"><span>${a}</span><span class="dot"> · </span><span>${b}</span></span>`;
  el.classList.toggle('nudge', !!nudgeText);
  // From the keyboard, the keys are said until the first ball they bowl, whoever's bowling.
  el.hidden = !(nudgeText || words || hintDue() || (how === 'keys' && !keyed)) || phase !== 'aim' || touch?.mode === 'throw' || windAt !== null || handoffUp() || cpuUp();
  if (!el.hidden) placeHint(el);
}

// ---- Lessons ----------------------------------------------------------------------------------------------

// A fingertip on the lane shows a new player what to do (see lesson in render.js), going round until they touch the
// screen, and the last two have words in the hint's place for that ball:
// - 'swipe', on a player's very first ball here: up from the ball (the hint says it in words).
// - 'slide', the first time a first ball leaves pins: drag the ball sideways to line up with them.
// - 'hook', on the first two full racks after their first ball (just the one, if they hook it), but not on a first
//   ball of a game: curve the end.
// Like the hint, each is for a player by name on this device (store.slideShown and store.hookShown).
const LESSONS = {
  hook: { touch: 'Curve the end of your swipe to hook into the pocket', mouse: 'Curve the end of your flick to hook into the pocket',
    keys: 'Press H to hook into the pocket' },
  slide: { touch: 'Drag the ball sideways to line up the pins left', mouse: 'Drag the ball sideways to line up the pins left',
    keys: 'Press Left or Right to line up the pins left' },
};
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let lesson = null;   // { kind, at (when the fingertip starts, ms), playing, side (which way a slide goes) }
function lessonDue() {
  const name = current().name, at = performance.now() + 400;
  if (!(store.thrown[name] || 0)) return { kind: 'swipe', at, playing: true };
  // Not with the first ball's marks, which show a straight ball's line.
  if (before === 10) return (store.hookShown[name] || 0) < 2 && !marks() ? { kind: 'hook', at, playing: true } : null;
  if (before === 0 || store.slideShown[name]) return null;
  // Towards the pins left, to line up with them.
  const left = pins.filter(p => p.state === 'up'), mid = left.reduce((t, p) => t + p.x, 0) / left.length;
  return { kind: 'slide', at, playing: true, side: mid < ball.x ? -1 : 1 };
}
// What's drawn this frame: nothing once they've touched the lane or pressed a key (the keys have only words), or while
// a sheet is up.
function teaching() {
  if (!lesson?.playing || phase !== 'aim' || paused || strokes.size || pointer === 'keys' || handoffUp()) return null;
  return { kind: lesson.kind, u: (performance.now() - lesson.at) / 1000, still: reduced.matches, side: lesson.side };
}
// A ball thrown with a lesson up: that one's been shown.
function learnt(shot) {
  if (!lesson) return;
  const name = current().name;
  if (lesson.kind === 'hook') store.hookShown[name] = shot.hook ? 2 : (store.hookShown[name] || 0) + 1;
  if (lesson.kind === 'slide') store.slideShown[name] = 1;
  lesson = null;
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
  if (lesson) lesson.playing = false;   // its words stay until the ball goes
  // The main button, or the right one: pressing a trackpad down with two fingers is a right click, and some people
  // hold the ball that way. (The menu that would pop up is kept shut, below.) Not the middle button.
  if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
  // A tap while the pins settle, the pinsetter sweeps or the camera comes back (or a ball is played again) hurries the
  // rest of it on.
  if (!paused && !hurry && waiting()) { hurry = true; hurryTurn = game.turn; sound.hurry(); }
  // A flick at the end of the camera's way back, once the ball is coming onto the screen (0.65 s in, on a phone or a
  // tablet either way up): the camera jumps the rest of the way so the flick throws. One started earlier on its way
  // back is followed all the same, and counts once aiming begins (see lift).
  if (cpuUp()) return;   // the computer's turn: nothing to throw
  if (phase === 'return' && !paused && phaseT >= 0.65) aim();
  if ((phase !== 'aim' && phase !== 'return') || paused) return;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* fine without */ }
  // `extra`: another finger was already down, so this one tapping or brushing the lane gets no word about it.
  // `gain`: a mouse or trackpad flick counts harder (see MOUSE in swipe.js).
  // `early`: it began as the camera came back, so a tap that only hurried things on gets no word about how to throw.
  strokes.set(e.pointerId, { ...stroke(e, performance.now()), id: e.pointerId, x0: ball.x, extra: strokes.size > 0, early: phase === 'return', gain: e.pointerType === 'mouse' ? MOUSE : 1 });
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
  // Begun as the camera came back: followed, but the ball doesn't move (with the camera still down the lane, a drag
  // right slid it left) until aiming begins, or the finger lifts (see lift).
  if (phase !== 'aim') return;
  if ((touch.mode === 'throw') !== (was === 'throw')) hint();  // out of the way of a throw, and back for a move
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
    guide = -(b.y - a.y) < 12 || Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? null : shotFrom(p, false, touch.gain);
  }
});
const lift = e => {
  const t = strokes.get(e.pointerId);
  if (!t) return;
  redraw();   // where the ball was left
  strokes.delete(e.pointerId);
  const led = t === touch;   // only the lead stroke moves the ball
  if (led) { touch = null; guide = null; leading(); }
  hint();
  if (e.type !== 'pointerup') { if (t.mode === 'move' && led) keep(); return; }
  const end = t.pts[t.pts.length - 1];
  if (Math.hypot(e.clientX - end.x, e.clientY - end.y) > 2) { track(t, e); readStroke(t); }
  const as = liftAs(t), p = throwPoints(t);
  if (phase !== 'aim' && phase !== 'return') return;   // thrown already, by another finger
  // A flick or a drag begun as the camera came back, ended before it got there: the camera jumps the rest of the way.
  if (phase === 'return' && (as === 'throw' || as === 'move')) aim();
  if (as === 'throw') {
    if (led) slide(t, t.slid || 0);
    const shot = shotFrom(p, true, t.gain);
    if (shot) { dropStrokes(); throwBall(shot); return; }
  } else if (as === 'move') {
    if (led) slide(t, t.pts[t.pts.length - 1].x - t.pts[0].x);
    keep();
  } else if (!t.early && (as === 'short' || (as !== 'cancel' && !t.extra && !strokes.size))) {
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
// A swipe that starts near the screen's side can set off Android's back gesture (or Chrome's swipe to go back), which
// takes the touch (pointercancel) and then goes Back, leaving the game. A Back that comes while a finger is on the lane,
// or within a second of the lane's touch being taken, is a slip, and the game stays as it was. Pin Drop has no history
// of its own, so the guard keeps one extra entry for it; a deliberate Back still leaves in one press.
guardEdges({ surfaces: [canvas] });

// A swipe, read as a throw (see throwOf), from where the ball stands; or nothing, for a swipe too short to throw
// (and while swiping, the guide as it was until the swipe is long enough to show one). `gain` is MOUSE for a mouse
// or trackpad.
function shotFrom(pts, final, gain = 1) {
  const a = pts[0], b = pts[pts.length - 1];
  if (-(b.y - a.y) < (final ? 40 : 12)) return final ? null : guide;
  return { x: ball.x, ...throwOf(pts, gain), ...rails() };
}
// A player with bumpers up throws with them (and the guide shows the ball coming off them).
const rails = () => (game?.players[game.turn].bumpers ? { bumpers: true } : {});

// ---- The keyboard -------------------------------------------------------------------------------------------

// While aiming: Left and Right move the ball a board at a time, H changes the hook (none, left, right), and holding
// Space winds the throw up from the slowest speed to the fastest over two seconds, shown in mph with the guide, and
// letting go throws it, straight down the lane. Its hook bends it about 10 inches by the pins at any speed (KEY_HOOK,
// worked out with the physics), so from the first ball's ring a hook left comes into the pocket.
const KEY_HOOK = [[170, 2.6], [230, 3.8], [290, 5.4], [330, 7.5], [390, 12.5]];
const WIND = 2;
let keyHook = 0;       // -1 left, 0 none, 1 right
let windAt = null;     // when Space went down
let keyed = false;     // the keyboard has bowled a ball, in this page
const hookAt = speed => {
  const i = Math.max(1, KEY_HOOK.findIndex(([s]) => s >= speed));
  const [s0, h0] = KEY_HOOK[i - 1], [s1, h1] = KEY_HOOK[i];
  return h0 + (h1 - h0) * clamp((speed - s0) / (s1 - s0));
};
const windSpeed = () => 170 + 220 * clamp((performance.now() - windAt) / 1000 / WIND);
const keyShot = () => { const speed = windSpeed(); return { x: ball.x, speed, angle: 0, hook: keyHook * hookAt(speed), keys: true, ...rails() }; };
const hookWord = () => (keyHook === 0 ? 'straight' : keyHook < 0 ? 'hook left' : 'hook right');
function winding() {
  guide = keyShot();
  const text = `${(guide.speed * 0.0568).toFixed(1)} mph · ${hookWord()}`;
  if ($('readout').textContent !== text) readout(text);
}
function unwind() {
  if (windAt === null) return;
  windAt = null; guide = null; readout('');
}

document.addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || shown || paused || !game || phase !== 'aim' || !$('upright').hidden || handoffUp() || cpuUp()) return;
  const k = e.key, onButton = !!e.target.closest?.('button, a, input, summary');
  if (k === 'ArrowLeft' || k === 'ArrowRight') {
    if (windAt !== null) return;
    ball.x = clamp(ball.x + (k === 'ArrowLeft' ? -BOARD : BOARD), -LANE.half + BALL_R + 0.5, LANE.half - BALL_R - 0.5);
    current().x = ball.x;
    redraw(); keep();
  } else if (k === 'h' || k === 'H') {
    if (windAt !== null) return;
    keyHook = keyHook === 0 ? -1 : keyHook < 0 ? 1 : 0;
  } else if (k === ' ') {
    // On the menu button or the scorecard, Space presses it, until the keyboard has bowled (Left, Right or H first take
    // the focus off it).
    if (onButton && !keyed) return;
    if (!e.repeat && windAt === null) windAt = performance.now();
  } else return;
  e.preventDefault();
  if (onButton && k !== ' ') e.target.blur();
  pointer = 'keys';
  if (lesson) lesson.playing = false;
  dropStrokes();
  if (windAt === null) readout(hookWord()[0].toUpperCase() + hookWord().slice(1));
  hint();
});
document.addEventListener('keyup', e => {
  if (e.key !== ' ' || windAt === null) return;
  e.preventDefault();
  const shot = keyShot();
  windAt = null;
  if (phase !== 'aim' || paused || shown) { guide = null; return; }
  keyed = true;
  throwBall(shot);
});
// Space let go of in another window never comes back as a keyup here.
addEventListener('blur', unwind);

// ---- What's on screen ----------------------------------------------------------------------------------

// A scorecard: the boxes to look at, and the same in words for a screen reader (left out on the scorecard along the
// top, which says it its own way). A count that left a split has a ring round it, as on a real card. A head start has
// a box of its own before the total ("+20"), never in the frames, and the total counts it.
function cardHTML(rolls, now, big, words = true, splits = [], head = 0) {
  const fs = frames(rolls), at = boxes(rolls);
  const ringed = new Set(splits.filter(k => at[k]).map(k => at[k].join()));
  let h = `<span class="frames${big ? ' roomy' : ''}${head ? ' head' : ''}" aria-hidden="true">`;
  for (let i = 0; i < 10; i++) {
    const f = fs[i], boxes = i < 9 ? 2 : 3;
    let spans = '';
    for (let k = 0; k < boxes; k++) {
      const v = f?.marks[k] ?? '';
      spans += `<span class="${v === 'X' ? 'x' : v === '/' ? 's' : ringed.has(`${i},${k}`) ? 'split' : ''}">${v}</span>`;
    }
    h += `<span class="f${i === now ? ' now' : ''}"><span class="balls">${spans}</span><span class="tot">${f && f.total !== null ? f.total : ''}</span></span>`;
  }
  if (head) h += `<span class="f start"><span>+${head}</span></span>`;
  const said = head ? cardText(rolls, splits).replace(/Total (at least )?(\d+)\.$/, (_, more, n) => `Head start ${head}. Total ${more || ''}${+n + head}.`) : cardText(rolls, splits);
  return h + `<span class="f sum${pending(rolls) > total(rolls) ? ' waiting' : ''}"><span>${sumHTML(rolls, head)}</span></span></span>${words ? `<span class="sr">${said}</span>` : ''}`;
}

// A player's total, and while a strike or spare waits for its bonus balls, the pins so far with a plus ("10+"): a
// plain 0 after a first strike read as a strike scoring nothing. Once a game is over it's exact. A head start counts.
function sumHTML(rolls, head = 0) {
  const t = total(rolls) + head, p = pending(rolls) + head;
  return p > t ? `${p}<i>+</i>` : `${t}`;
}
// A player's total with their head start: what decides who wins.
const scoreOf = q => total(q.rolls) + int(q.head);

function hud() {
  if (!game) return;
  if (game.practice) { practiceHud(); return; }
  const p = current(), st = next(p.rolls);
  // Each player's dot: a little picture of their ball.
  $('who').innerHTML = `<i class="${lk(lookOf(game.turn))}"></i>${esc(p.name)}`;
  // In the tenth, a ball earned by a strike or spare is a bonus ball: the second after a strike, and the third.
  const bonus = st.frame === 9 && (st.ball === 2 || (st.ball === 1 && st.fresh));
  // While the turn passes (the pins settling and the sweep), who's next rather than this player's next frame; at
  // the end of the game, Done.
  const up = game.nextTurn ?? null, passing = up !== null && up !== game.turn;
  const upName = passing && up >= 0 ? game.players[up].name : '';
  $('where').textContent = passing ? (up < 0 ? 'Done' : `Up next: ${isYou(upName) ? 'you' : upName}`)
    : st.done ? 'Done' : `Frame ${st.frame + 1} · ${bonus ? 'bonus ball' : `ball ${st.ball + 1}`}`;
  $('frames').outerHTML = cardHTML(p.rolls, st.done ? -1 : st.frame, false, false, p.splits, int(p.head)).replace('<span class="frames', '<span id="frames" class="frames');
  // The button's name carries what it shows (the name, the frame and the total), then what it does.
  const t = scoreOf(p), pend = pending(p.rolls) + int(p.head);
  $('cardSay').textContent = `total ${pend > t ? `at least ${pend}` : t}. Show the scorecard`;
  const others = game.players.map((q, i) => ({ q, i })).filter(o => o.i !== game.turn);
  $('others').hidden = others.length === 0;
  $('others').innerHTML = others.map(({ q, i }) =>
    `<span><i class="${lk(lookOf(i))}"></i>${esc(q.name)} <b>${sumHTML(q.rolls, int(q.head))}</b></span>`).join('');
  leaveCard();
}

// While a second ball (or a ball in the tenth that doesn't face a fresh rack) is aimed: the pins as ten dots, the way
// an alley's screen shows them, the standing ones filled in and the fallen ones as rings, the head pin nearest.
const ROWS = [0, 1, 1, 2, 2, 2, 3, 3, 3, 3];
function leaveCard() {
  const el = $('leave'), st = game && next(current().rolls);
  el.hidden = !(phase === 'aim' && st && !st.fresh && !st.done);
  if (el.hidden) return;
  const up = pins.filter(p => p.state === 'up').map(p => p.id).sort((a, b) => a - b);
  el.firstElementChild.innerHTML = SPOTS.map((s, i) => `<circle cx="${s.x}" cy="${(3 - ROWS[i]) * 6}" r="2.6"${up.includes(i + 1) ? ' class="up"' : ''}/>`).join('');
  el.setAttribute('aria-label', up.length ? `Pins left: ${up.length === 1 ? up[0] : `${up.slice(0, -1).join(', ')} and ${up.at(-1)}`}` : 'No pins left');
}

// The scorecards of everyone in the game: at the end, with the winner marked and under each card how the game went
// ("3 strikes · 2 spares · 4 open", as an alley's screen sums it up); on the Scorecard sheet during a game, with the
// most each player can still reach under their total ("max 212"), as a league's screen shows it, so in a close finish
// everyone can see whether the player behind can still catch up.
// A kept game's are drawn the same way from its scores (see past). `extra` adds anything more under a player's card
// (at the end of a game, a ball they earned).
function boardHTML(withBest, players = game.players, extra = () => '') {
  const best = Math.max(...players.map(scoreOf));
  const tied = players.filter(q => scoreOf(q) === best).length > 1;
  const under = q => (withBest ? `<p class="count">${statsLine(q.rolls)}</p>`
    : next(q.rolls).done ? ''
      : `<p class="max"><span aria-hidden="true">max </span><span class="sr">${esc(q.name)} can still reach </span>${most(q.rolls) + int(q.head)}</p>`);
  return players.map((q, i) => `<div class="row"><div class="name"><span><i class="${lk(lookFor(q, i))}"></i>${esc(q.name)}</span>${withBest && players.length > 1 && scoreOf(q) === best ? `<em>${tied ? 'Tied' : 'Winner'}</em>` : ''}</div>${cardHTML(q.rolls, -1, true, true, q.splits, int(q.head))}${under(q)}${extra(q)}</div>`).join('');
}

let callTimer = 0, callUntil = 0, callAt = null;   // when the callout on screen goes, and where it is ('pins' or 'aim')
// A callout. A ball's goes just above the sign over the pins, where there's room under the scorecard, or else over
// the lane in front of the pins (a tablet on its side). A turn's (at 'aim') goes over the lane in front of the pins
// as the next player sees them, so it doesn't hide them while they aim.
function say(big, small, kind, tip, at = 'pins') {
  const el = $('call');
  callAt = at;
  el.className = 'call';
  el.innerHTML = `${esc(big)}${small ? `<small>${esc(small)}</small>` : ''}${tip ? `<small class="tip">${esc(tip)}</small>` : ''}`;
  void el.offsetWidth;
  el.style.fontSize = '';
  // A double, a turkey or more, and a perfect game, each bigger and longer than the last (see level).
  const n = kind === '' ? level(big) : 1;
  el.className = `call go ${kind || ''}${tip ? ' long' : ''}${n > 1 ? ` x${n}` : ''}`;   // longer, to read the tip
  // A long name in the big letters is made smaller until it fits across the screen.
  if (el.scrollWidth > el.clientWidth + 1) el.style.fontSize = `${parseFloat(getComputedStyle(el).fontSize) * 0.97 * (el.clientWidth - 24) / (el.scrollWidth - 24)}px`;
  // From a turkey on, a burst of the sign's gold and teal stars behind the word.
  if (n >= 3) {
    const stars = Array.from({ length: 14 }, (_, i) => `<i style="--a:${Math.round(i * 360 / 14 + (i % 2) * 9)}deg;--d:${(i % 3 === 0 ? 1.5 : i % 3 === 1 ? 1.15 : 1.85).toFixed(2)}em"${i % 2 ? ' class="teal"' : ''}></i>`).join('');
    el.insertAdjacentHTML('afterbegin', `<span class="burst" aria-hidden="true">${stars}</span>`);
  }
  const s = view.spots(), h = el.offsetHeight, grow = h * 0.04;  // it pops up to 8% bigger
  const below = $('hud').hidden ? 0 : $('hud').getBoundingClientRect().bottom + 6;
  let top = at === 'aim' ? s.aimDeckFront + 12 + grow : s.signTop - 12 - grow - h;
  if (at !== 'aim' && top < below) top = s.deckFront + 12 + grow;
  el.style.top = `${Math.round(Math.max(below, Math.min(top, view.H - h - grow - 8)))}px`;
  clearTimeout(callTimer);
  // Gone once it has faded, so a screen reader reading the page doesn't come across it later.
  const ms = tip ? 2900 : [0, 1800, 2300, 2700, 3600][n];
  callUntil = performance.now() + ms;
  callTimer = setTimeout(() => { el.className = 'call'; el.innerHTML = ''; }, ms);
}

// The first player is called You until they type a name, and "You’s turn" won't do.
const isYou = name => name.trim().toLowerCase() === 'you';
// The computer's turn is called by a short name: "Computer (Regular)’s turn" ran onto two lines on a phone.
const turnLine = name => (isYou(name) ? 'Your turn' : LEVEL_KEYS.some(k => cpuName(k) === name) ? 'Computer’s turn' : `${name}’s turn`);
const winLine = name => (isYou(name) ? 'You win!' : `${name} wins!`);

function hush() { clearTimeout(callTimer); callUntil = 0; $('call').className = 'call'; $('call').innerHTML = ''; }

// One sentence for a screen reader to say (the callouts come and go too fast, and say less): what each ball did and
// whose turn it is, read out by the polite live region #said.
function tell(text) { $('said').textContent = text; }

function readout(text) {
  $('readout').innerHTML = text ? `<span class="pill">${esc(text)}</span>` : '';
}

// A buzz on a phone that can (never on an iPhone or iPad, where a web page can't): Sound off in the menu stops it too.
function buzz(p) { if (!store.sound) return; try { navigator.vibrate?.(p); } catch { /* not on this device */ } }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ---- Spare practice -----------------------------------------------------------------------------------------
// "Practise spares" under Bowl: ten common leaves (PRACTICE in scoring.js), one ball at each, with the same aim, roll
// and pinsetter as a game, for the first person on the title. Each comes as a second ball would (the pins left under
// the scorecard, and a new player is shown how to line up with them), and the end says how many were made. Nothing of
// it is kept: it never counts toward the games or the bests, and a game left half-way still carries on afterwards.
const leaveOf = i => rack().filter(q => PRACTICE[i].includes(q.id));
const leaveName = ids => (ids.length === 1 ? `the ${ids[0]} pin` : `the ${ids.join('–')}`);
function startPractice(who) {
  hush();
  $('handoff').hidden = true;
  game = { players: [{ name: who.name, rolls: [10 - PRACTICE[0].length], x: who.x || 0, ball: lookFor(who, 0).id, ...(who.bumpers ? { bumpers: true } : {}) }], turn: 0,
    leftover: leaveOf(0), practice: { i: 0, made: [] } };
  told = new Set(); toldHook = new Set(); tonight = null;
  $('hud').hidden = false;
  show(null);
  pins = leaveOf(0);
  aim();
  say('Spare practice', 'Ten leaves, one ball each', 'small', '', 'aim');
  tell(`Spare practice: ten leaves, one ball each. First, ${leaveName(PRACTICE[0])}.`);
}
$('practice').addEventListener('click', () => { sound.wake(); disarmStart(); startPractice(readPlayers().find(q => !q.cpu)); });

// A practice ball's done: made or not, called out, and on to the next leave, or the end.
function practiceBall() {
  const standing = sim.standing, p = current(), pr = game.practice;
  const made = standing.length === 0, knocked = Math.max(0, before - standing.length);
  pr.made.push(made);
  store.throws = (store.throws || 0) + 1;
  store.thrown[p.name] = (store.thrown[p.name] || 0) + 1;
  readout('');
  const count = `${pr.made.filter(Boolean).length} of ${pr.made.length}`;
  if (made) { if (!called) { say(wasSplit ? 'Picked up!' : 'Spare!', count, 'teal'); cheer('teal'); } }
  else say(knocked === 0 ? (sawGutter ? 'Gutter ball' : 'Missed') : String(knocked), count, 'small');
  pr.i++;
  const more = pr.i < PRACTICE.length;
  tell(`${made ? 'Made it' : 'Missed it'}: ${count}.${more ? ` Next, ${leaveName(PRACTICE[pr.i])}.` : ''}`);
  if (more) {
    game.leftover = leaveOf(pr.i);
    p.rolls = [10 - PRACTICE[pr.i].length];
    phase = 'settle';
  } else {
    phase = 'over';
    // The Target, for making enough of them: the one ball practice can earn.
    game.newBalls = practiceEarns(pr.made.filter(Boolean).length).filter(id => earn(store, p.name, id)).map(id => ({ name: p.name, id }));
    if (game.newBalls.length) drive.changed();
  }
  phaseT = 0;
  hud();
  put();   // the balls thrown, for the hint on how to throw
}

// The scorecard along the top in practice: a box for each leave, / when it was made and - when it wasn't, and the
// number made.
function practiceHud() {
  const p = current(), pr = game.practice, n = pr.made.filter(Boolean).length;
  $('who').innerHTML = `<i class="${lk(lookOf(0))}"></i>${esc(p.name)}`;
  $('where').textContent = pr.i < PRACTICE.length ? `Spare practice · ${pr.i + 1} of ${PRACTICE.length}` : 'Done';
  const boxes = PRACTICE.map((_, i) => {
    const m = i < pr.made.length ? (pr.made[i] ? '/' : '-') : '';
    return `<span class="f${i === pr.i && phase !== 'over' ? ' now' : ''}"><span class="tot${m === '/' ? ' s' : ''}">${m}</span></span>`;
  }).join('');
  $('frames').outerHTML = `<span id="frames" class="frames practice" aria-hidden="true">${boxes}<span class="f sum"><span>${n}</span></span></span>`;
  $('cardSay').textContent = `spare practice, ${n} made of ${pr.made.length}. Show the menu`;
  $('others').hidden = true;
  leaveCard();
}

// The end of practice: how many were made, and each leave with whether it was.
const pinsSVG = ids => `<svg viewBox="-22 -4 44 26" aria-hidden="true">${SPOTS.map((q, i) => `<circle cx="${q.x}" cy="${(3 - ROWS[i]) * 6}" r="2.6"${ids.includes(i + 1) ? ' class="up"' : ''}/>`).join('')}</svg>`;
function practiceEnd() {
  const p = current(), made = game.practice.made, n = made.filter(Boolean).length;
  $('endTitle').textContent = `${n} of ${made.length}`;
  $('endTitle').classList.add('score');
  $('endLine').textContent = `${isYou(p.name) ? 'You' : p.name} made ${n} of ${made.length}.`;
  $('endCards').innerHTML = `<ul class="leaves">${PRACTICE.map((ids, i) => `<li class="${made[i] ? 'made' : 'missed'}">${pinsSVG(ids)}`
    + `<span>${ids.join('–')}</span><b>${made[i] ? 'Made' : 'Missed'}</b><span class="sr">: ${leaveName(ids)}</span></li>`).join('')}</ul>${newBallsHTML(p)}`;
  show('end');
  $('hud').hidden = true; $('others').hidden = true;
}

// The end card's buttons, for a game or for practice.
function endFor(practice) {
  $('again').textContent = practice ? 'Practise again' : 'Bowl again';
  $('toTitle').textContent = practice ? 'Done' : 'Change players';
  $('share').hidden = practice || (!navigator.share && !navigator.clipboard?.writeText);
  $('endBadge').hidden = true; $('endTally').hidden = true;
}

// ---- Sheets --------------------------------------------------------------------------------------------

const sheets = ['title', 'menu', 'howSheet', 'board', 'end', 'past', 'numbers', 'balls'];
const dialogs = ['menu', 'howSheet', 'board', 'end', 'past', 'numbers', 'balls'];
// Everything behind a sheet, out of reach of Tab and a screen reader while one is up.
const behind = ['lane', 'handoff', 'hud', 'others', 'call', 'hint', 'readout', 'replay'];
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
  redraw();
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
  if (id) { sound.roll(0); unwind(); }
  else sound.wake(false);
  upright();
}

// A phone held on its side: the pins are a thin strip under the scorecard and every firm flick throws at the top
// speed, so a note over the lane asks for it upright (not over a sheet, and never on a tablet, which is tall enough
// either way). "Bowl sideways anyway" puts it away until the page is loaded again.
const sideways = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
let sidewaysOk = false;
function upright() {
  const on = sideways.matches && !sidewaysOk && !!game && shown === null;
  if ($('upright').hidden === !on) return;
  $('upright').hidden = !on;
  for (const s of behind) $(s).inert = on || shown !== null;   // a sheet that hid it keeps them out of reach
  if (on) { dropStrokes(); unwind(); $('uprightSay').focus({ preventScroll: true }); }
  else if (document.activeElement?.closest?.('#upright')) document.activeElement.blur();
}
sideways.addEventListener('change', upright);
$('sideways').addEventListener('click', () => { sidewaysOk = true; upright(); });

// Out of sight (another app, another tab), nothing plays; back again, it carries on unless a sheet is up.
document.addEventListener('visibilitychange', () => {
  redraw();   // a phone may have thrown the canvas away while the page was out of sight
  if (document.hidden) sound.sleep();
  else if (!paused) sound.wake(false);
});

function titleScreen() {
  phase = 'title';
  tonight = null;
  hush();
  $('handoff').hidden = true;
  game = null;
  nudgeText = '';
  $('hud').hidden = true; $('others').hidden = true; $('hint').hidden = true;
  readout('');
  pins = rack(); ball = idle(0); sweep = null; guide = null; lesson = null; replay = null; cpuShot = null;
  $('replay').hidden = true;
  view.setCamera(0);
  resumeButton();
  blockedDue = false;   // the title says it
  drawPlayers(lineup());
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

// The players as they were last set up on the title: [{ name, bumpers, head }], and the computer last ([{ cpu }]).
const lineup = () => [...(store.names?.length ? store.names : ['You'])
  .map(name => ({ name, ...(Object.hasOwn(store.opts, name) ? extras(store.opts[name] || {}) : {}) })),
...(LEVELS[store.cpu] ? [{ cpu: store.cpu }] : [])];

// The head starts on offer in a player's balls sheet.
const HEADS = [0, 10, 20, 30, 50];
const ballSay = (name, id, head) => `Ball and head start for ${name}: ${lookById(id)?.name || 'a ball'}, ${head ? `${head} pins` : 'no head start'}`;

// The players on the title, each with their ball (tapped for their balls and a head start, the head start shown on it
// as "+20"), a name, and a Bumpers switch (pressed or not); then the computer, if there is one, with its level. Up to
// four in all, at least one of them a person, and one computer at most.
function drawPlayers(list) {
  const ol = $('players');
  const people = list.filter(q => !q.cpu);
  let k = 0;
  ol.innerHTML = list.map(q => {
    if (q.cpu) {
      return `<li class="cpu"><span class="ball"><span class="orb ${lk(CPU_LOOK)}"></span></span>`
        + `<label class="robot"><span>Computer</span><select aria-label="The computer’s level">${LEVEL_KEYS.map(l => `<option value="${l}"${l === q.cpu ? ' selected' : ''}>${LEVELS[l].name}</option>`).join('')}</select></label>`
        + '<button type="button" class="remove" aria-label="Remove the computer">×</button></li>';
    }
    const i = k++;
    return `<li><button type="button" class="ball" data-head="${int(q.head)}" aria-haspopup="dialog">`
      + `<span class="orb"></span>`
      + `<span class="plus" aria-hidden="true">${int(q.head) ? `+${int(q.head)}` : ''}</span></button>`
      + `<input type="text" maxlength="14" value="${esc(q.name)}" aria-label="Player ${i + 1}’s name" autocomplete="off" spellcheck="false">`
      + `<button type="button" class="bump" aria-pressed="${!!q.bumpers}" aria-label="Bumpers for ${esc(q.name)}">Bumpers</button>`
      + (people.length > 1 ? `<button type="button" class="remove" aria-label="Remove ${esc(q.name)}">×</button>` : '') + '</li>';
  }).join('');
  // Each remove button is named for the player as their name is typed. Removing one from the keyboard puts the focus
  // on the name now in its place; with a finger or a mouse, on the remove button there (focusing a name would bring
  // up a phone's keyboard).
  let n = 0;
  ol.querySelectorAll('li').forEach((li, j) => {
    const b = li.querySelector('.remove');
    b?.addEventListener('click', e => {
      drawPlayers(readPlayers().filter((_, m) => m !== j));
      const rows = ol.querySelectorAll('li'), row = rows[Math.min(j, rows.length - 1)];
      (e.detail === 0 ? row.querySelector('input, select') : row.querySelector('.remove') || $('addPlayer')).focus();
    });
    if (li.classList.contains('cpu')) return;
    const i = n++;
    const input = li.querySelector('input'), bump = li.querySelector('.bump'), orb = li.querySelector('.ball');
    const named = () => input.value.trim() || `Player ${i + 1}`;
    bump.addEventListener('click', () => bump.setAttribute('aria-pressed', String(bump.getAttribute('aria-pressed') !== 'true')));
    orb.addEventListener('click', () => openBalls(i));
    // A name typed that has a ball of its own brings it back.
    input.addEventListener('input', () => {
      b?.setAttribute('aria-label', `Remove ${named()}`); bump.setAttribute('aria-label', `Bumpers for ${named()}`);
      paintBalls();
    });
  });
  paintBalls();
  $('addPlayer').hidden = list.length >= MAX_PLAYERS;
  $('addCpu').hidden = list.length >= MAX_PLAYERS || people.length < list.length;
}

// The people's rows on the title, and each one's name (as Bowl would call them).
const personRows = () => [...$('players').querySelectorAll('li:not(.cpu)')];
const rowName = (li, i) => li.querySelector('input').value.trim() || `Player ${i + 1}`;
// Whether a player has earned a ball (by name), or it's a plain one anyone can have.
const earnedBy = name => (Object.hasOwn(store.earned, name) ? store.earned[name] : Object.create(null));
const has = (name, id) => isPlain(id) || (!!lookById(id) && Object.hasOwn(earnedBy(name), id));
// Each person's ball on the title: the one they last picked here, if it's theirs to use; otherwise their row's plain
// colour, as each row always had, or if someone else on the title has that, the next plain ball nobody has.
function paintBalls() {
  const rows = personRows(), names = rows.map(rowName);
  const picked = names.map(n => (Object.hasOwn(store.picks, n) && has(n, store.picks[n].id) ? store.picks[n].id : null));
  const used = new Set(picked.filter(Boolean));
  rows.forEach((li, i) => {
    let id = picked[i];
    if (!id) {
      const free = PLAIN.map((_, k) => PLAIN[(i + k) % PLAIN.length]).find(l => !used.has(l.id));
      id = (free || PLAIN[i % PLAIN.length]).id;
      used.add(id);
    }
    const b = li.querySelector('.ball'), head = int(b.dataset.head);
    b.dataset.look = id;
    b.querySelector('.orb').className = `orb ${lk(lookById(id))}`;
    b.querySelector('.plus').textContent = head ? `+${head}` : '';
    // A ball earned since they last looked: a dot on theirs, until they do.
    const since = Object.hasOwn(store.seen, names[i]) ? int(store.seen[names[i]]) : 0;
    const fresh = Object.entries(earnedBy(names[i])).some(([k, at]) => lookById(k) && at > since);
    b.classList.toggle('fresh', fresh);
    b.setAttribute('aria-label', `${ballSay(names[i], id, head)}${fresh ? '. A new ball to see' : ''}`);
  });
}

// ---- A player's balls ------------------------------------------------------------------------------------------
// Tapping a player's ball on the title opens their balls: every ball there is, the ones they can have to pick from
// (the one they're using marked) and the rest dimmed with a lock and how to earn each, and the head start below. A ball
// earned since they last looked is marked New. What they pick is kept by their name, for next time, here and on every
// device that saves to Drive.
let ballsRow = -1, ballsSince = 0;   // the row the sheet is for, and when that player last looked before this
const LOCK = '<svg class="lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
function openBalls(i) {
  const li = personRows()[i];
  if (!li) return;
  ballsRow = i;
  const name = rowName(li, i), b = li.querySelector('.ball');
  ballsSince = Object.hasOwn(store.seen, name) ? int(store.seen[name]) : 0;
  $('ballsTitle').textContent = isYou(name) ? 'Your ball' : `${name}’s ball`;
  const mine = LOOKS.filter(l => has(name, l.id)).length;
  $('ballsCount').textContent = `${mine} of ${LOOKS.length} balls`;
  $('locker').innerHTML = LOOKS.map(l => {
    const ok = has(name, l.id), fresh = ok && !isPlain(l.id) && earnedBy(name)[l.id] > ballsSince;
    const say = ok ? `${l.name}${fresh ? ', new' : ''}` : `${l.name}, locked. ${l.how}`;
    return `<li><button type="button" class="pick${ok ? '' : ' locked'}" data-id="${l.id}" aria-pressed="${l.id === b.dataset.look}"${ok ? '' : ' aria-disabled="true"'} aria-label="${esc(say)}">`
      + `<span class="orb ${lk(l)}">${ok ? '' : LOCK}</span><span class="nm">${esc(l.name)}</span>`
      + (fresh ? '<span class="new">New</span>' : ok ? '' : `<span class="earn">${esc(l.how)}</span>`) + '</button></li>';
  }).join('');
  showHead(int(b.dataset.head));
  show('balls');
  store.seen[name] = Math.max(Date.now(), ballsSince);
  put();
  drive.changed();
}
function showHead(head) {
  for (const h of $('heads').querySelectorAll('button')) h.setAttribute('aria-pressed', String(+h.dataset.head === head));
}
$('locker').addEventListener('click', e => {
  const btn = e.target.closest('.pick'), li = personRows()[ballsRow];
  if (!btn || !li || btn.getAttribute('aria-disabled') === 'true') return;
  const name = rowName(li, ballsRow);
  store.picks[name] = { id: btn.dataset.id, at: Date.now() };
  put();
  drive.changed();
  paintBalls();
  for (const p of $('locker').querySelectorAll('.pick')) p.setAttribute('aria-pressed', String(p.dataset.id === li.querySelector('.ball').dataset.look));
});
$('heads').addEventListener('click', e => {
  const btn = e.target.closest('button'), li = personRows()[ballsRow];
  if (!btn || !li) return;
  li.querySelector('.ball').dataset.head = btn.dataset.head;
  showHead(+btn.dataset.head);
  paintBalls();
});
function closeBalls() {
  const li = personRows()[ballsRow];
  ballsRow = -1;
  show('title');
  li?.querySelector('.ball').focus({ preventScroll: true });
}
$('ballsDone').addEventListener('click', closeBalls);
// What's on the title: each person (named "Player 2" if left blank) and the computer.
const readPlayers = () => {
  let n = 0;
  return [...$('players').querySelectorAll('li')].map(li => {
    if (li.classList.contains('cpu')) return { cpu: li.querySelector('select').value };
    const i = n++;
    return {
      name: li.querySelector('input').value.trim() || `Player ${i + 1}`,
      bumpers: li.querySelector('.bump').getAttribute('aria-pressed') === 'true',
      head: int(li.querySelector('.ball').dataset.head),
      ball: li.querySelector('.ball').dataset.look,
    };
  });
};

function record() {
  const games = store.games || [];
  let h = '';
  const by = store.bestBy && !isYou(store.bestBy) ? ` · ${esc(store.bestBy)}` : '';
  // The best game opens each player's numbers (or with no best yet, a line of its own does, once anyone's game counts).
  const open = say => `<button type="button" class="best" id="bestBtn" aria-label="${say}. Show each player’s averages">`;
  if (store.best) h += `${open(`Best game${by} ${int(store.best)}`)}<span>Best game${by}</span><b>${int(store.best)}</b></button>`;
  else if (numbers(games).length) h += `${open('Averages')}<span>Averages</span><b></b></button>`;
  if (games.length) {
    const listed = games.slice(0, 5);
    h += '<ol>' + listed.map((g, k) => {
      // The day, and the time too for a game on the same day as another in the list.
      const d = when(g.at, listed.some((o, j) => j !== k && day(o.at) === day(g.at)));
      // Each name with its score, never parted at the end of a line, and the winner's score in gold (each top score, in
      // a tie), with the same said in words for a screen reader.
      const top = Math.max(...g.scores.map(q => int(q.score)));
      const tied = g.scores.filter(q => int(q.score) === top).length > 1;
      // A score bowled with bumpers or a head start says so ("(bumpers, +20)").
      const pairs = g.scores.map((q, i) => {
        const won = g.scores.length > 1 && int(q.score) === top;
        const sep = i < g.scores.length - 1 ? ' ·' : '';
        const how = q.bumpers || q.head ? ` <small>(${[q.bumpers ? 'bumpers' : '', q.head ? `+${int(q.head)}` : ''].filter(Boolean).join(', ')})</small>` : '';
        return `<span class="pair">${esc(q.name)} <b${won ? ' class="won"' : ''}>${int(q.score)}</b>${how}${won ? `<span class="sr"> ${tied ? 'tied' : 'won'}</span>` : ''}${sep}</span>`;
      });
      // A game kept with its balls opens its scorecard.
      const inner = `<span class="when">${d}</span><span class="scores">${pairs.join(' ')}</span>`;
      return g.scores.every(q => Array.isArray(q.rolls)) ? `<li><button type="button" class="game" data-at="${int(g.at)}">${inner}<span class="sr">. Show the scorecard</span></button></li>` : `<li>${inner}</li>`;
    }).join('') + '</ol>';
  }
  if (!keeping()) h += `<p class="blocked">${BLOCKED}</p>`;
  $('record').innerHTML = h;
}

// "Nov 21", or "Nov 21 · 8:40 pm" with the time.
const day = at => new Date(at).toDateString();
function when(at, withTime) {
  const d = new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (!withTime) return d;
  return `${d} · ${new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(/\s?([AaPp])\.?[Mm]\.?$/, (_, a) => ` ${a.toLowerCase()}m`)}`;
}

// A kept game's scorecard, frame by frame, opened from the recent games on the title: who won, and each card as it
// was at the end of the game. (Before, a reload at the end of a game, or Change players, lost the cards for good.)
let pastFrom = null;   // the line it was opened from, for the focus to go back to
function past(at) {
  const g = (store.games || []).find(o => int(o.at) === at);
  if (!g) return;
  const players = g.scores.map(q => ({ ...q, rolls: q.rolls.slice(), splits: q.splits || [] }));
  const top = Math.max(...players.map(scoreOf)), winners = players.filter(q => scoreOf(q) === top);
  $('pastTitle').textContent = when(g.at, true);
  const who = name => (isYou(name) ? 'You' : name);
  $('pastLine').textContent = players.length === 1 ? `${who(players[0].name)} bowled ${top}.`
    : winners.length === 1 ? `${who(winners[0].name)} won, ${top} to ${Math.max(...players.filter(q => q !== winners[0]).map(scoreOf))}.`
      : `${both(winners.map(q => q.name))} tied, ${top} each.`;
  $('pastCards').innerHTML = boardHTML(true, players);
  pastFrom = document.activeElement;
  show('past');
}
function closePast() {
  show('title');
  const back = pastFrom?.id === 'bestBtn' ? $('bestBtn') : pastFrom?.dataset?.at && $('record').querySelector(`[data-at="${pastFrom.dataset.at}"]`);
  back?.focus({ preventScroll: true });
  pastFrom = null;
}
$('record').addEventListener('click', e => {
  const b = e.target.closest('.game, #bestBtn');
  if (b?.id === 'bestBtn') averages(); else if (b) past(+b.dataset.at);
});

// Each player's numbers over the games kept here, from the best game on the title: games played, the average of the
// last 10, the high game, and the strikes and spares made out of the chances at them. Under them, Forget these scores
// (a second tap to be sure, like End this game) takes every game and best away.
const pct = v => (v === null ? '–' : `${Math.round(v * 100)}%`);
let forgetArmed = false, forgetTimer = 0;
function disarmForget() { forgetArmed = false; clearTimeout(forgetTimer); $('forget').textContent = 'Forget these scores'; }
function averages() {
  const rows = numbers(store.games);
  $('numbersRows').innerHTML = `<table><thead><tr><th scope="col"><span class="sr">Player</span></th><th scope="col">Games</th><th scope="col">Average</th><th scope="col">High</th>`
    + '<th scope="col">Strikes</th><th scope="col">Spares</th></tr></thead><tbody>'
    + rows.map(r => `<tr><th scope="row">${esc(r.name)}</th><td>${r.games}</td><td class="avg">${r.avg}</td><td>${r.high}</td><td>${pct(r.strikes)}</td><td>${pct(r.spares)}</td></tr>`).join('')
    + '</tbody></table>';
  disarmForget();
  pastFrom = document.activeElement;
  show('numbers');
}
$('numbersDone').addEventListener('click', closePast);
$('forget').addEventListener('click', () => {
  if (!forgetArmed) {
    forgetArmed = true; $('forget').textContent = drive.isOn() ? 'Tap again to forget them on every device' : 'Tap again to forget them';
    forgetTimer = setTimeout(disarmForget, 4000); return;
  }
  disarmForget();
  forget(store);
  put();
  drive.changed();
  record();
  pastFrom = null;
  show('title');
});
$('pastDone').addEventListener('click', closePast);

// Whether a player's game counts toward the bests: not with bumpers or a head start, and never the computer's.
const counts = q => !q.bumpers && !int(q.head) && !q.cpu;

// The game's over: keep it, with every player's balls as well as their score (for working out averages and the
// like later), and any new bests. A game bowled with bumpers or a head start is kept marked (its score with the head
// start counted, as it was played), and never counts toward a best.
// Tonight's games with the same players, one after another with Bowl again: { games, wins (by name) }, kept until
// Change players (or the end of a game from the menu) or a reload. A tie wins nobody a game.
let tonight = null;
function tally() {
  if (game.players.length < 2) return;
  tonight ??= { games: 0, wins: Object.create(null) };
  tonight.games++;
  const top = Math.max(...game.players.map(scoreOf)), won = game.players.filter(q => scoreOf(q) === top);
  if (won.length === 1) tonight.wins[won[0].name] = (tonight.wins[won[0].name] || 0) + 1;
}
// "Tonight: Ben 2 · Ana 1", most wins first, from the second game on (after one, it only says who won).
function tallyLine() {
  if (!tonight || tonight.games < 2 || game.players.length < 2) return '';
  const wins = q => tonight.wins[q.name] || 0;
  return `Tonight: ${[...game.players].sort((a, b) => wins(b) - wins(a)).map(q => `${q.name} ${wins(q)}`).join(' · ')}`;
}

function finish() {
  tally();
  const scores = game.players.map((q, i) => ({ name: q.name, score: scoreOf(q), rolls: q.rolls.slice(), splits: (q.splits || []).slice(), ...(q.cpu ? {} : { ball: lookFor(q, i).id }), ...extras(q) }));
  const counted = scores.filter((_, i) => counts(game.players[i]));
  const top = Math.max(-1, ...counted.map(s => s.score));
  // Whether there was a best here to beat, and each player's own best before this game (null for a first game).
  game.hadBest = !!store.best;
  game.newBest = counted.length > 0 && top > (store.best || 0);
  game.before = scores.map(s => (Object.hasOwn(store.bests, s.name) ? store.bests[s.name] : null));
  // When each best was bowled, so Forget these scores knows which came before it (see merge in store.js). Always after
  // the last Forget known here: one tapped on a device whose clock runs a little ahead mustn't take this game too.
  const at = Math.max(Date.now(), int(store.forgot) + 1);
  if (game.newBest) { store.best = top; store.bestBy = [...new Set(counted.filter(s => s.score === top).map(s => s.name))].join(' & '); store.bestAt = at; }
  for (const s of counted) if (!Object.hasOwn(store.bests, s.name) || s.score > store.bests[s.name]) { store.bests[s.name] = s.score; store.bestsAt[s.name] = at; }
  store.games = [{ at, scores }, ...(store.games || [])].slice(0, GAMES);
  // The balls this game earned its players (the computer earns none), said on the end card.
  game.newBalls = catchUp(store).filter(b => b.at === at && game.players.some(q => !q.cpu && q.name === b.name)).map(({ name, id }) => ({ name, id }));
  store.current = null;
  put();
  drive.changed();
}

// "Ana and Cal": names in a line ("You and Ana" when one is still called You, who comes first).
const both = names => {
  const sorted = [...names.filter(isYou), ...names.filter(n => !isYou(n))];
  return sorted.length < 3 ? sorted.join(' and ') : `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)}`;
};

// The end of the game: its title and the line under it. One player hears about their own best (by name, not
// whoever's best is the best here); several hear who won and by how much, or who tied.
function endWords() {
  const scores = game.players.map(q => ({ name: q.name, score: scoreOf(q) }));
  const top = Math.max(...scores.map(s => s.score));
  const winners = scores.filter(s => s.score === top);
  if (scores.length === 1) {
    const was = game.before?.[0] ?? null;
    const q = game.players[0];
    const helped = [q.bumpers ? 'bumpers' : '', int(q.head) ? 'a head start' : ''].filter(Boolean).join(' and ');
    const perfect = total(q.rolls) === 300;
    if (helped && !perfect) return [`${top}`, `With ${helped}, so it doesn’t count toward your best.`, false, false];
    return [`${top}`, perfect ? 'A perfect game.' : was === null ? 'Your first game here.' : top > was ? 'Your best game yet.'
      : top === was ? 'That equals your best.' : `Your best is ${was}.`, perfect || (was !== null && top > was), was !== null && top > was];
  }
  const title = winners.length === 1 ? winLine(winners[0].name) : winners.length === 2 ? `${both(winners.map(w => w.name))} tie!`
    : `A ${winners.length === 3 ? 'three' : 'four'}-way tie!`;
  let line = winners.length === 1 ? `${top} to ${Math.max(...scores.filter(s => s !== winners[0]).map(s => s.score))}` : `${top} each`;
  // A perfect game is twelve strikes, whatever head start anyone had.
  const perfect = game.players.filter(q => total(q.rolls) === 300).map(q => q.name);
  if (perfect.length) {
    line = perfect.length === 1 ? `${perfect[0]} bowled a perfect game.` : `${both(perfect)} bowled perfect games.`;
  } else if (game.newBest && game.hadBest) line += ' · a new best here';
  return [title, line, perfect.length > 0 || (game.newBest && game.hadBest), game.newBest && game.hadBest];
}

function showEnd() {
  hush();   // the last ball's callout, which can outlast the wait for this card
  $('replay').hidden = true;
  endFor(!!game.practice);
  if (game.practice) { practiceEnd(); newBallChime(false); return; }
  // The fourth: a best beaten (a player's own, playing alone; the best here, with others), with a gold badge and a chime.
  const [title, line, best, beaten] = endWords();
  $('endTitle').textContent = title;
  $('endBadge').hidden = !beaten;
  $('endTitle').classList.toggle('score', game.players.length === 1);
  $('endLine').textContent = line;
  $('endTally').textContent = tallyLine();
  $('endTally').hidden = !$('endTally').textContent;
  $('endCards').innerHTML = boardHTML(true, game.players, newBallsHTML);
  clearTimeout(sharedTimer); $('share').textContent = 'Share';
  show('end');
  $('hud').hidden = true; $('others').hidden = true;
  if (best) buzz([40, 60, 40]);   // a best, or a perfect game
  if (beaten && !game.cheered) { game.cheered = true; sound.best(); }   // once, not each time the card is opened again
  newBallChime(beaten);
}

// Under a player's card at the end of a game (or of spare practice), each ball it earned them: "New ball for Ana:
// Marble · your first strike", with a little picture of it; and a chime as the card comes up, once, after any for a
// new best.
function newBallsHTML(q) {
  const order = id => LOOKS.findIndex(l => l.id === id);
  return (game.newBalls || []).filter(b => b.name === q.name).sort((a, b) => order(a.id) - order(b.id)).map(b => {
    const l = lookById(b.id);
    return l ? `<p class="earned"><span class="orb ${lk(l)}" aria-hidden="true"></span><span>New ball for ${esc(isYou(q.name) ? 'you' : q.name)}: <b>${esc(l.name)}</b> · ${esc(l.why)}</span></p>` : '';
  }).join('');
}
function newBallChime(after) {
  if (!game.newBalls?.length || game.chimed) return;
  game.chimed = true;
  sound.newBall(after ? 1.3 : 0.35);
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
  if (game && !game.practice && !game.players.every(q => next(q.rolls).done)) {
    const pending = game.nextTurn != null;
    store.current = { players: game.players, turn: pending && game.nextTurn >= 0 ? game.nextTurn : game.turn, leftover: pending ? null : game.leftover };
  }
  put();
}

$('addPlayer').addEventListener('click', () => {
  const list = readPlayers(), people = list.filter(q => !q.cpu);
  if (list.length < MAX_PLAYERS) drawPlayers([...people, { name: `Player ${people.length + 1}` }, ...list.filter(q => q.cpu)]);
  const inputs = $('players').querySelectorAll('input');
  inputs[inputs.length - 1]?.select();
});
// One computer, after the people, at Regular unless it was something else last time.
$('addCpu').addEventListener('click', () => {
  const list = readPlayers();
  if (list.length >= MAX_PLAYERS || list.some(q => q.cpu)) return;
  drawPlayers([...list, { cpu: LEVELS[store.cpu] ? store.cpu : 'regular' }]);
  $('players').querySelector('select').focus();
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
  startGame(readPlayers(), true);
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
  dropStrokes(); stopGlide(); quitArmed = false;
  // Practice has no scorecard, and ending it loses nothing, so it ends with one tap.
  $('menuQuit').textContent = game.practice ? 'End practice' : 'End this game';
  $('menuBoard').hidden = !!game.practice;
  show('menu');
}
$('menuBtn').addEventListener('click', openMenu);
$('menuResume').addEventListener('click', () => show(null));
$('menuBoard').addEventListener('click', () => { $('boardCards').innerHTML = boardHTML(false); show('board'); });
$('card').addEventListener('click', () => {
  if (phase === 'over') { showEnd(); return; }
  if (game.practice) { openMenu(); return; }   // no scorecard to show
  $('boardCards').innerHTML = boardHTML(false); show('board');
});
$('boardDone').addEventListener('click', () => show(null));
$('menuHow').addEventListener('click', () => show('howSheet'));
$('howDone').addEventListener('click', () => show(game ? null : 'title'));
// On a phone that can buzz, the switch says it's for the buzz too.
const canBuzz = typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches;
const soundLabel = () => {
  $('menuSound').textContent = `${canBuzz ? 'Sound and buzz' : 'Sound'}: ${store.sound ? 'on' : 'off'}`;
  $('menuSound').setAttribute('aria-pressed', String(!!store.sound));
};
soundLabel();
$('menuSound').addEventListener('click', () => { store.sound = !store.sound; sound.setSound(store.sound); soundLabel(); put(); });
let quitArmed = false;
$('menuQuit').addEventListener('click', () => {
  if (phase === 'over') { showEnd(); return; }
  if (game.practice) { titleScreen(); return; }
  if (!quitArmed) { quitArmed = true; $('menuQuit').textContent = 'Tap again to end it'; return; }
  store.current = null; put();
  titleScreen();
});
// Bowl again: the same players, the second leading off this time (and the first going last), each with their own ball
// and spot on the approach.
$('again').addEventListener('click', () => {
  if (game.practice) { startPractice(game.players[0]); return; }
  const lineup = game.players.map((q, i) => ({ name: q.name, x: q.x, ball: lookFor(q, i).id, ...extras(q) }));   // the computer too
  startGame([...lineup.slice(1), lineup[0]]);
});
$('toTitle').addEventListener('click', titleScreen);

// Share: the result in a line, "Pin Drop: Ben 131, Ana 121", the winner first, and the game's link, through the phone's
// share sheet, or where there's none, copied ("Copied" on the button for a moment). Someone still called You is "Me".
const LINK = 'https://pin-drop.junkdrawer.works/';
let sharedTimer = 0;
function shareLine() {
  const names = game.players.map(q => ({ name: isYou(q.name) ? 'Me' : q.name, score: scoreOf(q) })).sort((a, b) => b.score - a.score);
  return `Pin Drop: ${names.map(q => `${q.name} ${q.score}`).join(', ')}`;
}
async function share() {
  const text = shareLine();
  if (navigator.share) {
    try { await navigator.share({ text, url: LINK }); } catch { /* closed without sharing */ }
    return;
  }
  try { await navigator.clipboard.writeText(`${text} ${LINK}`); } catch { return; }
  $('share').textContent = 'Copied';
  clearTimeout(sharedTimer);
  sharedTimer = setTimeout(() => { $('share').textContent = 'Share'; }, 2000);
}
$('share').addEventListener('click', share);
$('share').hidden = !navigator.share && !navigator.clipboard?.writeText;
// Escape closes the menu, How to play and the scorecard as their buttons do, and on the lane it opens the menu.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (shown === 'menu' || shown === 'board') show(null);
  else if (shown === 'howSheet') show(game ? null : 'title');
  else if (shown === 'past' || shown === 'numbers') closePast();
  else if (shown === 'balls') closeBalls();
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
  catchUp(store);
  if (phase === 'title' || phase === 'over') store.current = theirs.current;
  if (phase === 'title') { resumeButton(); record(); paintBalls(); }
});

// Google Drive, at pin-drop.junkdrawer.works only (see sync.js): the block under the record on the title, and the cloud
// in the title's corner once it's on. Not offered in a browser that won't keep anything, which couldn't keep it on.
drive.chip($('cloud'));
if (keeping()) drive.card($('drive')); else $('drive').hidden = true;
// A sync brought games, bests or players from another device: take them in, as from another window.
drive.onUpdate(() => {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch { return; }
  merge(store, parse(raw));
  catchUp(store);
  if (phase === 'title') {
    resumeButton(); record();
    // Not under a player's balls sheet, which is for one of these rows.
    if (shown === 'title' && !$('players').contains(document.activeElement)) drawPlayers(lineup());
    else paintBalls();
  }
});

addEventListener('resize', () => { view.resize(); view.setCamera(camT, followX); redraw(); if (phase === 'aim') hint(); });
// The sign's lettering, once its font has come (drawn before then, it would stay in the stand-in font behind a sheet).
document.fonts?.addEventListener?.('loadingdone', redraw);

// For the tests and the screenshot tool.
window.pinDrop = {
  get phase() { return phase; },
  get phaseT() { return phaseT; },
  get game() { return game; },
  get pins() { return pins; },
  get ball() { return ball; },
  get shot() { return lastShot; },
  get lesson() { return lesson && { kind: lesson.kind, playing: lesson.playing }; },
  // As a player would after tapping their card, if the turn has just passed.
  throw(shot) { if (phase === 'aim') { takeTurn(); throwBall({ x: ball.x, ...shot }); } },
  set speed(v) { timeScale = v; },
  set seed(v) { fixedSeed = v; },
  camera(t) { camT = t; view.setCamera(t, 0); redraw(); },
  shotFrom,
  view,
};

titleScreen();
requestAnimationFrame(loop);

if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.pinDropNoWorker) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

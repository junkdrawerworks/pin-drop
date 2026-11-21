// The computer player, without a browser:  node --test test/computer.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { next, total } from '../js/scoring.js';
import { play, rack, rng, Sim, SPOTS } from '../js/physics.js';

const left = ids => rack(ids.map(id => ({ id, ...SPOTS[id - 1] })));
import { plan, LEVELS, cpuName } from '../js/computer.js';

// A whole game by the computer at a level, as the page plays it: each ball planned at the pins standing, then played
// with its own seed.
function game(level, g) {
  const rand = rng(g * 7919 + 13), rolls = [];
  let standing = null;
  while (!next(rolls).done) {
    const pins = rack(next(rolls).fresh ? undefined : standing);
    const sim = play(pins, plan(pins.map(p => ({ id: p.id, x: p.x, y: p.y })), level, rand), g * 1000 + rolls.length);
    rolls.push(pins.length - sim.standing.length);
    standing = sim.standing;
  }
  return total(rolls);
}

// The levels' averages over 20 seeded games each (in the tuning, 60 games of each came to 97, 152 and 197): Rookie about
// 100, Regular about 150, Pro about 200, each clearly above the one before.
test('the levels average about 100, 150 and 200', () => {
  const avg = {};
  for (const level of Object.keys(LEVELS)) {
    let sum = 0;
    for (let g = 1; g <= 20; g++) sum += game(level, g);
    avg[level] = sum / 20;
  }
  const said = JSON.stringify(avg);
  assert.ok(avg.rookie >= 80 && avg.rookie <= 120, said);
  assert.ok(avg.regular >= 130 && avg.regular <= 170, said);
  assert.ok(avg.pro >= 180 && avg.pro <= 220, said);
  assert.ok(avg.rookie + 30 < avg.regular && avg.regular + 30 < avg.pro, said);
});

// Its first ball is the pocket ball: from the right of the lane, hooking left into the pocket, just right of the head
// pin. With none of its misses (every random draw the middle) and none of the lane's wander, it crosses the head pin's
// line within half an inch of where it aims.
test('a first ball hooks into the pocket, and a straight ball goes at pins left from across the lane', () => {
  // Draws that make every miss 0 (see normal in computer.js: the second of each pair at a quarter is cos(π/2)).
  const steady = (() => { let k = 0; return () => (k++ % 2 ? 0.25 : 0.5); })();
  const shot = plan(rack().map(p => ({ id: p.id, x: p.x, y: p.y })), 'pro', steady);
  assert.ok(shot.x > 5 && shot.hook < -30, JSON.stringify(shot));
  const s = new Sim([], shot);
  s.rand = () => 0.5;
  while (s.ball.y < 720) s.step(1 / 240);
  assert.ok(Math.abs(s.ball.x - LEVELS.pro.at) < 0.5, `it crossed the head pin's line at ${s.ball.x.toFixed(2)}`);
  // The 10 pin alone: a straight ball from the left of the lane.
  const ten = plan(left([10]).map(p => ({ id: p.id, x: p.x, y: p.y })), 'pro', steady);
  assert.ok(ten.x < -5 && ten.hook === 0 && ten.angle > 0, JSON.stringify(ten));
});

// At pins left, a Pro picks up the corner pins and the usual leaves nearly every time, and a Rookie far less often.
test('a Pro picks up spares, and a Rookie misses more of them', () => {
  const leaves = [[10], [7], [2, 4, 5, 8], [3, 6, 10], [1, 2, 4], [6, 10]];
  const made = level => {
    let n = 0, of = 0;
    for (const leave of leaves) {
      const rand = rng(leave.length * 31 + leave[0]);
      for (let seed = 1; seed <= 10; seed++) {
        const pins = left(leave);
        if (play(pins, plan(pins.map(p => ({ id: p.id, x: p.x, y: p.y })), level, rand), seed).standing.length === 0) n++;
        of++;
      }
    }
    return n / of;
  };
  const pro = made('pro'), rookie = made('rookie');
  assert.ok(pro >= 0.75, `a Pro picked up ${pro.toFixed(2)} of them`);
  assert.ok(rookie < pro - 0.3, `a Rookie ${rookie.toFixed(2)}, a Pro ${pro.toFixed(2)}`);
});

test('the computer is named for its level', () => {
  assert.deepEqual(Object.keys(LEVELS).map(cpuName), ['Computer (Rookie)', 'Computer (Regular)', 'Computer (Pro)']);
});

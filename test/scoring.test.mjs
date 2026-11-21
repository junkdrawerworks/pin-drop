// The scoring rules and the physics, without a browser:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { frames, next, total, best, isSplit } from '../js/scoring.js';
import { play, rack, Sim, rng } from '../js/physics.js';

test('an all-gutter game is 0 and a perfect game is 300', () => {
  assert.equal(total(Array(20).fill(0)), 0);
  assert.equal(total(Array(12).fill(10)), 300);
  assert.equal(next(Array(12).fill(10)).done, true);
  assert.equal(next(Array(11).fill(10)).done, false);
});

test('all spares of 5 and a 5 at the end make 150', () => {
  assert.equal(total(Array(21).fill(5)), 150);
});

test('strikes and spares wait for their bonus balls', () => {
  const fs = frames([10, 7]);
  assert.equal(fs[0].total, null);
  assert.deepEqual(fs[0].marks, ['', 'X']);
  assert.equal(frames([10, 7, 2])[0].total, 19);
  assert.equal(frames([10, 7, 2])[1].total, 28);
  assert.equal(frames([6, 4])[0].total, null);
  assert.deepEqual(frames([6, 4, 3])[0].marks, ['6', '/']);
  assert.equal(frames([6, 4, 3])[0].total, 13);
  assert.deepEqual(frames([0, 0])[0].marks, ['-', '-']);
});

test('a known game adds up', () => {
  // A real scorecard: X 7/ 9- X -8 8/ -6 X X X81
  const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  assert.deepEqual(frames(rolls).map(f => f.total), [20, 39, 48, 66, 74, 84, 90, 120, 148, 167]);
  assert.deepEqual(frames(rolls)[9].marks, ['X', '8', '1']);
  assert.equal(next(rolls).done, true);
});

test('the tenth frame: bonus balls, and fresh racks when earned', () => {
  const nine = Array(18).fill(0);
  assert.deepEqual(next(nine), { frame: 9, ball: 0, fresh: true, done: false });
  assert.deepEqual(next([...nine, 10]), { frame: 9, ball: 1, fresh: true, done: false });
  assert.deepEqual(next([...nine, 10, 3]), { frame: 9, ball: 2, fresh: false, done: false });
  assert.deepEqual(next([...nine, 10, 10]), { frame: 9, ball: 2, fresh: true, done: false });
  assert.deepEqual(next([...nine, 4, 6]), { frame: 9, ball: 2, fresh: true, done: false });
  assert.equal(next([...nine, 4, 5]).done, true);
  assert.deepEqual(frames([...nine, 10, 3, 7])[9].marks, ['X', '3', '/']);
  assert.deepEqual(frames([...nine, 4, 6, 10])[9].marks, ['4', '/', 'X']);
  assert.equal(total([...nine, 10, 10, 10]), 30);
});

test('frames 1 to 9: a second ball faces what the first left', () => {
  assert.deepEqual(next([7]), { frame: 0, ball: 1, fresh: false, done: false });
  assert.deepEqual(next([7, 2]), { frame: 1, ball: 0, fresh: true, done: false });
  assert.deepEqual(next([10]), { frame: 1, ball: 0, fresh: true, done: false });
});

test('the best a game can still reach', () => {
  assert.equal(best([]), 300);
  assert.equal(best([9, 0]), 9 + 270);
});

// USBC Playing Rules, Rule 3g: a split is what stands after the first ball when the head pin is down and at least
// one pin is down between two or more standing pins (7-9, 3-10), or immediately ahead of two or more (5-6).
test('splits', () => {
  for (const left of [[7, 10], [2, 7], [3, 10], [4, 6, 7, 10], [7, 9], [5, 6], [4, 5], [9, 10], [7, 8], [5, 6, 10]]) {
    assert.equal(isSplit(left), true, `the ${left.join('-')} is a split`);
  }
  for (const left of [[2, 8], [3, 9], [2, 4, 5], [1, 7], [1, 7, 10], [10], [6, 10], [2, 4, 7], [3, 6, 9, 10]]) {
    assert.equal(isSplit(left), false, `the ${left.join('-')} is not a split`);
  }
});

test('the same throw plays out the same way every time', () => {
  const shot = { x: 8, speed: 290, angle: 0.004, hook: -35 };
  assert.deepEqual(play(rack(), shot, 42).standing, play(rack(), shot, 42).standing);
});

// The page steps the lane once a frame, and frames never come exactly 1/60 s apart: the same seed and throw still
// play out the same way, as they do in play() (pinDrop.seed relies on it).
test('the same throw plays out the same way whatever the frame times', () => {
  const shot = { x: 10, speed: 290, angle: 0.0286, hook: -40 };
  const jitter = rng(7);
  for (let seed = 1; seed <= 20; seed++) {
    const sim = new Sim(rack(), shot, seed);
    while (!sim.settled) sim.step(1 / 60 + (jitter() - 0.5) * 0.004);
    assert.deepEqual(sim.standing, play(rack(), shot, seed).standing, `seed ${seed}`);
  }
});

test('a ball down the middle of the gutter knocks nothing over, and runs on into the pit', () => {
  const sim = play(rack(), { x: 14, speed: 300, angle: 0.02, hook: 0 }, 1);
  assert.equal(sim.standing.length, 10);
  // Not left lying in the channel beside the 7 pin while the pins are counted.
  assert.equal(sim.ball.state, 'pit');
});

test('hooking into the pocket strikes far more often than a straight ball at the head pin', () => {
  // Find the angle that takes the ball through x at the head pin line.
  const through = (x0, xh, hook) => {
    let lo = -0.08, hi = 0.08;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2, s = new Sim([], { x: x0, speed: 290, angle: m, hook }, 1);
      while (s.ball.y < 720 && s.ball.state === 'lane') s.step(1 / 240);
      if (s.ball.x < xh) lo = m; else hi = m;
    }
    return (lo + hi) / 2;
  };
  const rate = (x0, xh, hook) => {
    const angle = through(x0, xh, hook);
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) if (play(rack(), { x: x0, speed: 290, angle, hook }, seed).standing.length === 0) n++;
    return n / 40;
  };
  const pocket = rate(10, 1.5, -40), head = rate(0, 0, 0);
  assert.ok(pocket >= 0.3, `pocket strikes ${pocket}`);
  assert.ok(head <= 0.1, `head-on strikes ${head}`);
  assert.ok(pocket > head + 0.25);
});

test('a second ball can pick up a leftover pin', () => {
  // The 10 pin alone, and a ball sent straight at it.
  const pins = rack([{ id: 10, x: 18, y: 751.18 }]);
  const sim = play(pins, { x: 18, speed: 280, angle: 0, hook: 0 }, 3);
  assert.equal(sim.standing.length, 0);
});

test('a swipe\'s speed: its fastest stretch at the end, whatever the points arrive like', async () => {
  const { swipeSpeed } = await import('../js/swipe.js');
  const line = (n, step, dt) => Array.from({ length: n + 1 }, (_, i) => ({ x: 0, y: -i * step, t: i * dt }));
  assert.ok(Math.abs(swipeSpeed(line(10, 30, 16)) - 30 / 16) < 0.01, 'a steady fling');
  // A finger that slows for the last few points still counts its fast stretch.
  const slowing = [...line(10, 30, 16), { x: 0, y: -305, t: 176 }, { x: 0, y: -307, t: 196 }, { x: 0, y: -308, t: 216 }];
  assert.ok(swipeSpeed(slowing) > 1.5, `slowing at the end read as ${swipeSpeed(slowing)}`);
  // A gentle push is slower than a fling.
  assert.ok(swipeSpeed(line(10, 8, 16)) < swipeSpeed(line(10, 30, 16)) / 3);
});

test('a stroke on the lane: a move, a throw, or a throw that started as something else', async () => {
  const { readStroke, liftAs, throwPoints } = await import('../js/swipe.js');
  // Feeds a stroke's points in one at a time, the way pointermove does, and says what it was read as.
  const stroke = moves => {
    const s = { pts: [{ x: 0, y: 0, t: 0 }], mode: null };
    let x = 0, y = 0;
    for (const [dx, dy, n = 1] of moves) for (let i = 1; i <= n; i++) { s.pts.push({ x: x + dx * i / n, y: y + dy * i / n, t: s.pts.length * 16 }); readStroke(s); if (i === n) { x += dx; y += dy; } }
    return s;
  };
  // Straight up throws; straight across moves.
  assert.equal(liftAs(stroke([[0, -300, 10]])), 'throw');
  assert.equal(liftAs(stroke([[80, 3, 8]])), 'move');
  // A backswing: 13 px down, then a fling up. The throw starts from the lowest point.
  const back = stroke([[0, 13, 2], [0, -280, 8]]);
  assert.equal(liftAs(back), 'throw');
  assert.equal(throwPoints(back)[0].y, 13);
  // A hook swipe that starts sideways, then goes well up.
  assert.equal(liftAs(stroke([[15, 0, 2], [0, -330, 10]])), 'throw');
  // ...but a sideways drag that drifts up a little stays a move.
  assert.equal(stroke([[60, 0, 6], [0, -50, 4]]).mode, 'move');
  // Moving the ball: 12 px up, then 80 px across and 33 px up. Lifting there moves the ball, it doesn't throw it
  // into the gutter.
  assert.equal(liftAs(stroke([[0, -12, 1], [80, -33, 8]])), 'move');
  // Too short, a tap, heading down, and pulled back to where it started.
  assert.equal(liftAs(stroke([[0, -30, 3]])), 'short');
  assert.equal(liftAs(stroke([])), 'tap');
  assert.equal(liftAs(stroke([[0, 60, 4]])), 'none');
  assert.equal(liftAs(stroke([[0, -80, 4], [0, 85, 4]])), 'cancel');
});

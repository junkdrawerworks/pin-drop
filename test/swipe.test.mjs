// Reading a stroke on the lane, point by point, the way the page reads it as the finger moves:  node --test test/swipe.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readStroke, liftAs, throwPoints, throwOf } from '../js/swipe.js';

// Feeds a stroke's points in one at a time, as pointermove does, 16 ms apart. `moves` is a list of [dx, dy, steps];
// [0, 0, 0, ms] holds the finger still for that long (a touch screen sends nothing while it's still). Each step can be
// `seen`, with the stroke as it is after that point.
function stroke(moves, seen = () => {}) {
  const s = { pts: [{ x: 0, y: 0, t: 0 }], mode: null };
  let x = 0, y = 0, t = 0;
  for (const [dx, dy, n = 1, hold = 0] of moves) {
    t += hold;
    for (let i = 1; i <= n; i++) {
      t += 16;
      s.pts.push({ x: x + dx * i / n, y: y + dy * i / n, t });
      readStroke(s);
      seen(s);
    }
    x += dx; y += dy;
  }
  return s;
}

test('a sideways drag that starts with a little wobble moves the ball, all the way', () => {
  // 11 px down as the thumb settles, then 100 px across: a move from the moment it's clearly sideways, not a stroke
  // heading down (which said "Swipe up to roll").
  const modes = [];
  const down = stroke([[0, 11, 1], [100, 0, 10]], s => modes.push(s.mode));
  assert.equal(down.mode, 'move');
  assert.equal(liftAs(down), 'move');
  assert.ok(modes.indexOf('move') > 0 && modes.indexOf('move') <= 3, `it read as ${modes.join(' ')}`);
  // 8 down and 4 across, then 80 across.
  assert.equal(liftAs(stroke([[4, 8, 1], [80, 0, 8]])), 'move');
  // 11 px up first: it slides while dragging, not only once the finger lifts.
  const up = [];
  const across = stroke([[0, -11, 1], [100, 0, 10]], s => up.push(s.mode));
  assert.equal(across.mode, 'move');
  assert.ok(up.slice(4).every(m => m === 'move'), `it read as ${up.join(' ')}`);
  assert.equal(liftAs(across), 'move');
});

test('a backswing, a sideways-start hook and a diagonal stay as they were', () => {
  // Down 30, then up 200: a throw from the lowest point.
  const back = stroke([[0, 30, 3], [0, -200, 8]]);
  assert.equal(liftAs(back), 'throw');
  assert.equal(throwPoints(back)[0].y, 30);
  // Hook swipes that start sideways (15 px, and 30), then go up: thrown from where they began, the 30 px one hooking.
  for (const side of [15, 30]) {
    const hook = stroke([[side, 0, 2], [0, -330, 10]]);
    assert.equal(liftAs(hook), 'throw');
    assert.equal(throwPoints(hook)[0].x, 0);
  }
  const hook = throwOf(throwPoints(stroke([[30, 0, 3], [0, -330, 10]]))).hook;
  assert.ok(hook < -10, `the sideways-start hook hooked ${hook}`);
  // A sideways drag that drifts up a little stays a move.
  assert.equal(stroke([[60, 0, 6], [0, -50, 4]]).mode, 'move');
  // A fling that goes up first stays a throw however much it curves.
  assert.equal(liftAs(stroke([[0, -20, 2], [40, -260, 10]])), 'throw');
});

test('sliding the ball over, then swiping up in the same stroke, throws from where it was slid', () => {
  const shot = s => throwOf(throwPoints(s));
  for (const [what, moves] of [
    ['80 px across, a 150 ms stop, then 250 up', [[80, 0, 8], [0, -250, 10, 150]]],
    ['80 px across, a 150 ms stop with the finger shaking a little, then 250 up', [[80, 0, 8], [1, 1, 5], [-1, -1, 5], [0, -250, 10]]],
    ['a sharp turn: 80 px across, then 250 up', [[80, 0, 8], [0, -250, 10]]],
    ['a sharp turn the other way: 60 px across, then 300 up', [[-60, 0, 6], [0, -300, 10]]],
    ['a turn rounded off over 15 px: 70 across, then 250 up', [[70, 0, 7], [10, -4, 1], [5, -11, 1], [0, -235, 10]]],
    ['120 px across, then 250 up (more than twice as far up as the whole stroke is across never comes)', [[120, 0, 10], [0, -250, 10]]],
    ['a wobble down, 80 across, a stop, then 250 up', [[0, 11, 1], [80, 0, 8], [0, -250, 10, 200]]],
  ]) {
    const s = stroke(moves);
    assert.equal(liftAs(s), 'throw', `${what}: no throw`);
    const p = throwPoints(s), side = moves.reduce((x, m) => (m[1] < -100 ? x : x + m[0]), 0);
    assert.ok(Math.abs(s.slid - side) <= 6, `${what}: the ball stays ${s.slid} px over, not ${side}`);
    assert.ok(Math.abs(p[0].x - side) <= 6, `${what}: thrown from ${p[0].x} px over`);
    const { hook, angle } = shot(s);
    assert.ok(Math.abs(hook) < 5 && Math.abs(angle) < 0.005, `${what}: hook ${hook.toFixed(1)}, angle ${angle.toFixed(4)}`);
  }
});

test('a hook swipe that starts sideways and curves up is never read as sliding then throwing', () => {
  // A curve: `side` px across (heading right), turning up through a quarter circle of radius r, then `up` px up.
  const curve = (side, r, up) => {
    const moves = [[side, 0, Math.max(1, Math.round(side / 10))]];
    let px = side, py = 0;
    for (let i = 1; i <= 12; i++) {
      const a = i / 12 * Math.PI / 2, x = side + r * Math.sin(a), y = -r * (1 - Math.cos(a));
      moves.push([x - px, y - py, 1]); px = x; py = y;
    }
    moves.push([0, -up, 10]);
    return stroke(moves);
  };
  for (const [side, r, up] of [[40, 60, 250], [60, 50, 250], [80, 80, 300], [20, 150, 150], [50, 120, 200], [100, 45, 300]]) {
    const s = curve(side, r, up);
    assert.ok(!s.from && !s.slid, `${side} px across and a ${r} px turn read as sliding, then throwing`);
    // (One that goes further across than half the way up moves the ball, as it always has.)
    if (side + r > (r + up) / 2) { assert.equal(liftAs(s), 'move'); continue; }
    assert.equal(liftAs(s), 'throw');
    assert.ok(throwOf(throwPoints(s)).hook < -5, `${side} px across and a ${r} px turn hooked ${throwOf(throwPoints(s)).hook}`);
  }
  // The thumb's own arc: a 300 px swipe that leaves heading right and bows out 20% hooks as hard as ever.
  const pts = [];
  for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push([4 * 0.2 * 300 * u * (1 - u), -300 * u]); }
  const s = stroke(pts.slice(1).map((q, i) => [q[0] - pts[i][0], q[1] - pts[i][1], 1]));
  assert.ok(!s.from && !s.slid);
  assert.equal(Math.round(throwOf(throwPoints(s)).hook), -65);
});

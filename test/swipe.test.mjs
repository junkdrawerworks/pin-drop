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

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
  // A 300 px swipe that leaves heading right and bows out 20% hooks as hard as ever (with a mouse, or on a big screen).
  const pts = [];
  for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push([4 * 0.2 * 300 * u * (1 - u), -300 * u]); }
  const s = stroke(pts.slice(1).map((q, i) => [q[0] - pts[i][0], q[1] - pts[i][1], 1]));
  assert.ok(!s.from && !s.slid);
  assert.equal(Math.round(throwOf(throwPoints(s)).hook), -65);
});

// A thumb on a phone, 390 x 844. Its tip swings round the thumb's base, `r` px away (300 to 500), the base to the right
// for a right hand, so a swipe up bows out to the left; `tilt` is the way it heads halfway (radians right of straight
// up: from a base low in the corner it goes up and to the right), and `stretch` how much further the tip is from the
// base by the end (the thumb straightening, or curling in for less than 0). Sampled every `ms` (8 or 16.7) as a
// flick that speeds up to `v` px/ms, with up to half a px of wobble. `curl` adds a deliberate hook at the end:
// the stroke drifting `curl` of its length to its right (left for less than 0) from `from` of the way along, more and
// more to the end. `left` mirrors it all for a left hand.
const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function thumb({ r = 400, len = 280, tilt = 0.2, stretch = 0, v = 2, ms = 8, curl = 0, from = 0.6, left = false, seed = 1 }) {
  const rand = rng(seed), sweep = len / r, t0 = tilt - sweep / 2, sx = 195, sy = 700;
  const px = sx + r * Math.cos(t0), py = sy + r * Math.sin(t0), a0 = Math.atan2(sy - py, sx - px);
  const at = u => { const a = a0 + sweep * u, rr = r * (1 + stretch * u); return [px + rr * Math.cos(a), py + rr * Math.sin(a)]; };
  const path = u => {
    const [x, y] = at(u), [x0, y0] = at(Math.max(0, u - 0.01)), [x1, y1] = at(Math.min(1, u + 0.01)), d = Math.hypot(x1 - x0, y1 - y0);
    const k = curl * len * Math.max(0, (u - from) / (1 - from)) ** 2;
    return [x - (y1 - y0) / d * k, y + (x1 - x0) / d * k];
  };
  const T = len / (0.62 * v), pts = [];
  for (let t = 0; ; t += ms) {
    const q = Math.min(1, t / T), [x, y] = path(q * q * (1.6 - 0.6 * q));
    pts.push({ x: (left ? 390 - x : x) + rand() - 0.5, y: y + rand() - 0.5, t });
    if (q === 1) return pts;
  }
}
// Fed in one point at a time, as the page does: how it reads when the finger lifts, and the points it throws from.
function read(pts) {
  const s = { pts: [pts[0]], mode: null };
  for (const q of pts.slice(1)) { s.pts.push(q); readStroke(s); }
  return { as: liftAs(s), pts: throwPoints(s) };
}
const every = function* (o) {
  const [k, vals] = Object.entries(o)[0], rest = { ...o };
  delete rest[k];
  for (const v of vals) for (const more of Object.keys(rest).length ? every(rest) : [{}]) yield { [k]: v, ...more };
};

test('on a phone, a thumb swiping up throws straight, with either hand', () => {
  let n = 0, seed = 1, bent = 0, off = 0;
  for (const left of [false, true]) {
    for (const c of every({ r: [300, 400, 500], len: [200, 280, 360], tilt: [-0.15, 0.15, 0.4], stretch: [-0.12, 0, 0.12], v: [1, 2.5, 4], ms: [8, 16.7] })) {
      const { as, pts } = read(thumb({ ...c, left, seed: seed++ }));
      if (as !== 'throw') { off++; continue; }   // gone too far over to throw, so it moves the ball
      const { hook } = throwOf(pts, 1, true);
      assert.ok(Math.abs(hook) < 3, `a ${left ? 'left' : 'right'} thumb's arc ${JSON.stringify(c)} hooked ${hook.toFixed(1)}`);
      // Read as the whole swipe's bend, as a mouse's is, nearly all of them hooked away from the hand.
      bent += Math.sign(throwOf(pts).hook) === (left ? -1 : 1);
      n++;
    }
  }
  assert.ok(off < 0.05 * n, `${off} of ${n} thumb arcs didn't throw`);
  assert.ok(bent > 0.8 * n, `read by its bend, only ${bent} of ${n} thumb arcs hooked`);
  // And the guide, shown as the swipe goes, shows no hook on the way either.
  for (const left of [false, true]) {
    for (const c of every({ r: [300, 500], len: [200, 360], tilt: [-0.15, 0.4], stretch: [-0.12, 0.12], v: [1, 4] })) {
      const pts = thumb({ ...c, left, seed: seed++ });
      for (let i = 2; i <= pts.length; i++) {
        const p = pts.slice(0, i), a = p[0], b = p[i - 1];
        if (-(b.y - a.y) < 12) continue;
        const { hook } = throwOf(p, 1, true);
        assert.ok(Math.abs(hook) < 3, `the guide for a ${left ? 'left' : 'right'} thumb's arc ${JSON.stringify(c)} showed a hook of ${hook.toFixed(1)} ${i} points in`);
      }
    }
  }
});

test('on a phone, a thumb that sets off sideways first, or swings back first, still throws straight', () => {
  // Before the arc, `lead` px: across (the thumb settling, or a hook swipe started sideways, which hooked from a mouse
  // and threw a hook the other way from a thumb), or down (a backswing, thrown from its lowest point).
  let seed = 1;
  for (const left of [false, true]) {
    for (const lead of [[15, 0], [30, 0], [-20, -5], [-35, 0], [0, 20], [8, 25], [-12, 14]]) {
      for (const c of [{ r: 350, len: 300 }, { r: 450, len: 220, tilt: 0 }]) {
        const arc = thumb({ ...c, left, seed: seed++ }), x0 = arc[0].x - lead[0], y0 = arc[0].y - lead[1];
        const pts = [0, 1, 2].map(i => ({ x: x0 + lead[0] * i / 3, y: y0 + lead[1] * i / 3, t: i * 8 }));
        pts.push(...arc.map(p => ({ ...p, t: p.t + 24 })));
        const shot = read(pts);
        assert.equal(shot.as, 'throw');
        const { hook } = throwOf(shot.pts, 1, true);
        assert.ok(Math.abs(hook) < 3, `a ${left ? 'left' : 'right'} thumb's arc after ${lead} px ${JSON.stringify(c)} hooked ${hook.toFixed(1)}`);
      }
    }
  }
});

test('on a phone, curling the end of a swipe hooks that way, with either hand', () => {
  let seed = 1;
  for (const left of [false, true]) {
    for (const way of [-1, 1]) {
      for (const c of every({ r: [300, 500], len: [200, 300, 360], curl: [0.12, 0.2], from: [0.5, 0.7], tilt: [-0.1, 0.4], v: [1.2, 3.5], ms: [8, 16.7] })) {
        const what = `a ${left ? 'left' : 'right'} thumb curling ${way < 0 ? 'left' : 'right'} ${JSON.stringify(c)}`;
        const { as, pts } = read(thumb({ ...c, curl: way * (left ? -1 : 1) * c.curl, left, seed: seed++ }));
        assert.equal(as, 'throw', what);
        const { hook } = throwOf(pts, 1, true);
        // A slight curl that starts halfway along hooks less: much of it is in the steady turning the end is read
        // against, and little in the last quarter.
        const want = c.curl > 0.15 || c.from > 0.6 ? 15 : c.len >= 300 ? 5 : 2;
        assert.ok(way * hook >= want, `${what} hooked ${hook.toFixed(1)}`);
      }
    }
  }
  // The lesson's fingertip: straight up, then the last half curling over by a fifth of its length to the left. A hook
  // of 40 to 50, about what the pocket wants.
  for (const len of [200, 300]) {
    const pts = [];
    for (let i = 0; i <= 30; i++) { const u = i / 30; pts.push({ x: 195 - 0.2 * len * Math.max(0, (u - 0.5) / 0.5) ** 2, y: 700 - len * u, t: i * 8 }); }
    const { hook } = throwOf(pts, 1, true);
    assert.ok(hook <= -40 && hook >= -55, `the lesson's curl, ${len} px, hooked ${hook.toFixed(1)}`);
  }
  // A straight swipe is straight, and the speed and aim are read just as they are with a mouse or a big screen.
  const pts = [];
  for (let i = 0; i <= 25; i++) pts.push({ x: 195 + 0.3 * 12 * i, y: 700 - 12 * i, t: i * 8 });
  const phone = throwOf(pts, 1, true), big = throwOf(pts);
  assert.deepEqual(phone, big);
  assert.equal(phone.hook, 0);
  const arc = thumb({ seed: 9 });
  assert.deepEqual({ ...throwOf(arc, 1, true), hook: 0 }, { ...throwOf(arc), hook: 0 });
});

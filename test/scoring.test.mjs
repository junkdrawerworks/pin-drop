// The scoring rules and the physics, without a browser:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { frames, next, total, pending, best, isSplit, callFor, cardText } from '../js/scoring.js';
import { play, rack, Sim, rng } from '../js/physics.js';
import { through } from './aim.mjs';

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

test('the total while a strike or spare waits for its bonus balls: the pins so far, with more to come', () => {
  assert.equal(total([10]), 0);            // the card's frame stays blank, as on a real one
  assert.equal(pending([10]), 10);         // but the sum reads 10+
  assert.equal(pending([10, 7]), 10);      // the 7's frame isn't over, and isn't waiting on anything
  assert.equal(pending([10, 7, 2]), 28);   // resolved: exact again
  assert.equal(pending([10, 10]), 20);
  assert.equal(pending([10, 10, 10]), 50); // 30 in the first frame, two strikes waiting
  assert.equal(pending([6, 4]), 10);
  assert.equal(pending([9, 0, 10]), 19);
  assert.equal(pending([7]), 0);           // no mark waiting: as total()
  assert.equal(pending([7, 2]), 9);
  assert.equal(pending([...Array(18).fill(0), 10, 7]), 17);   // the tenth waits on its third ball
  assert.equal(pending(Array(11).fill(10)), 290);             // 270 and the tenth's two strikes
  // Never more than the game ends up with, ball by ball, and the same as total() once it's over.
  const game = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1];
  for (let k = 0; k <= game.length; k++) assert.ok(pending(game.slice(0, k)) <= total(game), `after ${k} balls`);
  assert.equal(pending(game), total(game));
  assert.equal(pending(Array(12).fill(10)), 300);
});

test('a scorecard in words, for a screen reader', () => {
  assert.equal(cardText([]), 'Frames 1 to 10 to come. Total 0.');
  assert.equal(cardText([8, 1, 8, 2]), 'Frame 1: 8 and 1, 9. Frame 2: 8, spare. Frames 3 to 10 to come. Total at least 19.');
  assert.equal(cardText([8, 1, 8, 2, 10]), 'Frame 1: 8 and 1, 9. Frame 2: 8, spare, 29. Frame 3: strike. Frames 4 to 10 to come. Total at least 39.');
  assert.equal(cardText([0, 7, 7]), 'Frame 1: miss and 7, 7. Frame 2: 7. Frames 3 to 10 to come. Total 7.');
  // A whole game, with a tenth frame of a strike and its two fill balls.
  assert.equal(cardText([...Array(18).fill(0), 10, 7, 2]), 'Frame 1: miss and miss, 0. Frame 2: miss and miss, 0. Frame 3: miss and miss, 0. '
    + 'Frame 4: miss and miss, 0. Frame 5: miss and miss, 0. Frame 6: miss and miss, 0. Frame 7: miss and miss, 0. '
    + 'Frame 8: miss and miss, 0. Frame 9: miss and miss, 0. Frame 10: strike, 7 and 2, 19. Total 19.');
  assert.match(cardText(Array(12).fill(10)), /Frame 10: strike, strike, strike, 300\. Total 300\.$/);
  assert.match(cardText([...Array(18).fill(0), 9, 1, 0]), /Frame 10: 9, spare, miss, 10\. Total 10\.$/);
  assert.match(cardText([...Array(18).fill(0), 10]), /Frame 10: strike\. Total at least 10\.$/);
  // Never an X, a slash or a dash.
  assert.doesNotMatch(cardText([10, 9, 1, 0, 0, 10, 10]), /[X/-]/);
});

// Each ball of a game called out in turn: the callout for each, as [big, small], given the pins each left standing.
const calls = (rolls, leaves = [], opts = []) => rolls.map((n, i) => callFor(rolls.slice(0, i), n, leaves[i] ?? (n === 10 ? [] : [10]), opts[i]).slice(0, 2));
const nines = Array.from({ length: 18 }, (_, i) => (i % 2 ? 0 : 9));   // nine frames of 9 and a miss

test('callouts in frames 1 to 9 say what they always have', () => {
  assert.deepEqual(callFor([], 10, []), ['Strike!', '', '']);
  assert.deepEqual(callFor([10], 10, []), ['Double!', '', '']);
  assert.deepEqual(callFor([10, 10], 10, []), ['Turkey!', '', '']);
  assert.deepEqual(callFor([10, 10, 10], 10, []), ['4 in a row!', '', '']);
  assert.deepEqual(callFor([], 0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { sawGutter: true }), ['Gutter ball', '', 'small']);
  assert.deepEqual(callFor([], 0, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), ['Missed', '', 'small']);
  assert.deepEqual(callFor([], 8, [7, 10]), ['Split', 'the 7–10', 'small']);
  assert.deepEqual(callFor([], 9, [10]), ['9', 'the 10 left', 'small']);
  assert.deepEqual(callFor([], 6, [2, 4, 7, 8]), ['6', 'pins', 'small']);
  assert.deepEqual(callFor([9], 0, [10], { sawGutter: true }), ['Gutter ball', 'open frame', 'small']);
  assert.deepEqual(callFor([7], 2, [10]), ['2', 'open frame', 'small']);
  assert.deepEqual(callFor([9], 1, []), ['Spare!', '', 'teal']);
  assert.deepEqual(callFor([8], 2, [], { wasSplit: true }), ['Picked up!', 'the split', 'teal']);
  // The strike run counts strikes only: a spare's second ball of 10 doesn't start one.
  assert.deepEqual(callFor([0, 10], 10, []), ['Strike!', '', '']);
});

test('callouts in the tenth: open frame only without a mark, nothing about pins left on the last ball', () => {
  // X 7 2: a strike, so not an open frame (the tenth's third ball used to say "open frame").
  assert.deepEqual(calls([...nines, 10, 7, 2], [, , , , , , , , , , , , , , , , , , [], [4, 7, 8], [10]]).slice(18),
    [['Strike!', 'two more balls'], ['7', 'the 4–7–8 left'], ['2', '']]);
  assert.deepEqual(callFor([...nines, 10, 7], 0, [4, 7, 8], { sawGutter: true }), ['Gutter ball', '', 'small']);
  assert.deepEqual(callFor([...nines, 10, 7], 0, [4, 7, 8]), ['Missed', '', 'small']);
  // X X 9: no "the 7 left" when no ball follows.
  assert.deepEqual(calls([...nines, 10, 10, 9], [, , , , , , , , , , , , , , , , , , [], [], [7]]).slice(18),
    [['Strike!', 'two more balls'], ['Double!', 'one more ball'], ['9', '']]);
  // 9 / 7.
  assert.deepEqual(calls([...nines, 9, 1, 7], [, , , , , , , , , , , , , , , , , , [7], [], [2, 4, 5]]).slice(18),
    [['9', 'the 7 left'], ['Spare!', 'one more ball'], ['7', '']]);
  // A split picked up in the tenth still says what it earned.
  assert.deepEqual(callFor([...nines, 8], 2, [], { wasSplit: true }), ['Picked up!', 'the split · one more ball', 'teal']);
  // Eleven strikes, then 9: the 300 just missed, and no "the 10 left".
  const eleven = Array(11).fill(10);
  assert.deepEqual(callFor(eleven.slice(0, 9), 10, []), ['10 in a row!', 'two more balls', '']);
  assert.deepEqual(callFor(eleven.slice(0, 10), 10, []), ['11 in a row!', 'one more ball', '']);
  assert.deepEqual(callFor(eleven, 9, [10]), ['9', '', 'small']);
  // The 300.
  assert.deepEqual(callFor(eleven, 10, []), ['Perfect!', 'A perfect game', '']);
  // A 9 and a miss in the tenth is an open frame, like any other.
  assert.deepEqual(calls([...nines, 9, 0], [, , , , , , , , , , , , , , , , , , [10], [10]]).slice(18), [['9', 'the 10 left'], ['Missed', 'open frame']]);
  // A split in the tenth with a ball to follow is called; on the last ball, only the count.
  assert.deepEqual(callFor([...nines], 8, [7, 10]), ['Split', 'the 7–10', 'small']);
  assert.deepEqual(callFor([...nines, 10, 10], 8, [7, 10]), ['8', '', 'small']);
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

// A ball hooked into the pocket, 2.5 in right of the middle of the head pin, strikes about half the time (19 of these
// 40 seeds); one thrown straight at the middle of the head pin hardly ever does (1 of 40).
test('hooking into the pocket strikes far more often than a straight ball at the head pin', () => {
  const rate = (x0, xh, hook) => {
    const angle = through(x0, xh, hook);
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) if (play(rack(), { x: x0, speed: 290, angle, hook }, seed).standing.length === 0) n++;
    return n / 40;
  };
  const pocket = rate(10, 2.5, -40), head = rate(0, 0, 0);
  assert.ok(pocket >= 0.3, `pocket strikes ${pocket}`);
  assert.ok(head <= 0.1, `head-on strikes ${head}`);
  assert.ok(pocket > head + 0.25);
});

// Strike! and Spare! are called as soon as no pin is left standing, before everything stops: so a pin that has started
// to go over must never stand again, and one that's only wobbling (it may still go, or not) must still count as standing.
test('a pin that has gone over never stands again, so a cleared deck is known before it stops', () => {
  const shots = [{ x: 10, speed: 290, angle: through(10, 2.5, -40), hook: -40 }, { x: 0, speed: 290, angle: 0, hook: 0 },
    { x: -8, speed: 220, angle: through(-8, -2, 30, 220), hook: 30 }, { x: 12, speed: 260, angle: through(12, 5, -20, 260), hook: -20 }];
  let cleared = 0, wobbly = 0;
  for (const shot of shots) {
    for (let seed = 1; seed <= 30; seed++) {
      const sim = new Sim(rack(), shot, seed), went = new Set();
      let early = false;
      while (!sim.settled) {
        sim.step(1 / 60);
        for (const q of sim.pins) {
          if (q.state !== 'up') went.add(q.id);
          else assert.ok(!went.has(q.id), `pin ${q.id} stood up again (seed ${seed})`);
          if (q.state === 'up' && q.fallAt) wobbly++;
        }
        if (sim.hitPins && sim.pins.every(q => q.state !== 'up')) early = true;
      }
      assert.equal(sim.standing.length === 0, early, `seed ${seed}: called ${early ? 'cleared' : 'not cleared'} early, ${sim.standing.length} left`);
      if (early) cleared++;
    }
  }
  assert.ok(cleared >= 10 && wobbly > 0, `only ${cleared} cleared decks and ${wobbly} wobbling frames to check this against`);
});

// Why a slow ball with a lot of hook is told to curve less or throw harder, not to stand somewhere else: from the
// furthest right a player can stand, at 200 in/s with a hook of 60 to the left, no angle reaches a single pin (it goes
// in the left gutter, or straight on into the right one). The slower the ball, the longer it spends on the dry back
// end, so the further the same hook carries it.
test('a slow ball with a big hook reaches no pin from the edge of the lane, whatever the angle', () => {
  for (let k = 0; k <= 7; k++) {
    for (let seed = 1; seed <= 20; seed++) {
      const sim = play(rack(), { x: 16, speed: 200, angle: k / 100, hook: -60 }, seed);
      assert.equal(sim.hitPins, false, `angle ${k / 100}, seed ${seed} hit a pin`);
    }
  }
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

test('how hard a swipe throws: the same as ever on a phone held upright, on any screen', async () => {
  const { throwOf } = await import('../js/swipe.js');
  const mph = v => {
    const pts = [];
    for (let t = 0; t <= 300 / v; t += 8) pts.push({ x: 0, y: -v * t, t });
    return throwOf(pts).speed * 0.0568;
  };
  // 1 px/ms (a gentle swipe) and 2 px/ms, as they threw on a 390 x 844 phone; 3 px/ms and up, the top speed.
  assert.equal(mph(1).toFixed(1), '12.4');
  assert.equal(mph(2).toFixed(1), '17.5');
  assert.equal(mph(3).toFixed(1), '22.2');
  assert.equal(mph(6).toFixed(1), '22.2');
});

test('hook: a thumb\'s natural arc rolls straight, a deliberate curve hooks hard', async () => {
  const { throwOf } = await import('../js/swipe.js');
  // A 300 px swipe up that bows out to the right by `bow` of its length at the middle (so it hooks left).
  const hook = bow => {
    const pts = [];
    for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push({ x: 4 * bow * 300 * u * (1 - u), y: -300 * u, t: i * 12 }); }
    return throwOf(pts).hook;
  };
  // A thumb pivoting at the wrist bows a 300 px swipe by 10% or so, but often less: up to 5% is straight.
  assert.equal(hook(0.03), 0);
  assert.equal(hook(0.045), 0);
  assert.ok(hook(0.08) < 0 && hook(0.08) > -20, `a slight curve hooks ${hook(0.08)}`);
  // A clear curve hooks 40 or more, up to the most there is (65) from a 20% bow.
  assert.ok(hook(0.15) <= -40 && hook(0.15) >= -50, `a 15% bow hooks ${hook(0.15)}`);
  assert.equal(Math.round(hook(0.2)), -65);
  assert.equal(hook(0.3), -65);
  assert.equal(hook(-0.15), -hook(0.15), 'bowing the other way hooks right as much');
});

test('a swipe is timed by its events\' own clock, unless that clock can\'t be trusted', async () => {
  const { stroke, addPoints, throwPoints, throwOf } = await import('../js/swipe.js');
  const mph = s => throwOf(throwPoints(s)).speed * 0.0568;
  // A finger going straight up 300 px at a steady 1.2 px/ms, sampled every 8 ms, each sample stamped with when it was
  // taken (by `clock`, from the page's clock at the time). The page hands the samples over in bursts: at frames
  // (`frame` ms apart) that each come up to `late` ms late, with everything sampled since the last one; or, with
  // `stall`, all at once that long after the swipe began.
  const fling = ({ frame = 16.7, late = 0, stall = 0, seed = 1, clock = t => t, downClock = clock } = {}) => {
    const r = rng(seed), at = i => i * 8, T0 = 1000;
    const s = stroke({ clientX: 0, clientY: 0, timeStamp: downClock(T0) }, T0 + stall);
    let i = 1;
    for (let f = 1; i <= 31; f++) {
      const now = Math.max(T0 + stall, T0 + f * frame + r() * late), burst = [];
      while (i <= 31 && at(i) <= now - T0) { burst.push({ clientX: 0, clientY: -i * 300 / 31, timeStamp: clock(T0 + at(i)) }); i++; }
      if (burst.length) addPoints(s, burst, now);
    }
    return s;
  };
  const steady = mph(fling());
  assert.ok(Math.abs(steady - 13.4) < 0.3, `a steady 1.2 px/ms fling read as ${steady.toFixed(1)} mph`);
  // A busy page gets the same samples late and bunched up, or all at once after a stall: the same speed, within
  // 0.3 mph, every time.
  for (let seed = 1; seed <= 20; seed++) {
    const busy = mph(fling({ frame: 33, late: 25, seed }));
    assert.ok(Math.abs(busy - steady) < 0.3, `seed ${seed}: the same fling on a busy page read as ${busy.toFixed(2)} mph, not ${steady.toFixed(2)}`);
  }
  const stalled = mph(fling({ stall: 300 }));
  assert.ok(Math.abs(stalled - steady) < 0.3, `the same fling after a stall read as ${stalled.toFixed(2)} mph`);
  // Some touch screens stamp the finger's samples on another clock from the page's (every fling on one tablet came out
  // at the slowest speed, 9.7 mph). Then, and with no stamps, or stamps out of order, the swipe is timed by the page's
  // clock as the samples arrive, which reads a steady fling about right.
  for (const [what, opts] of [
    ['on another clock', { downClock: t => t, clock: t => 7e6 + t }],
    ['all on another clock', { clock: t => 9e8 + t }],
    ['ahead of the page', { clock: t => t + 50 }],
    ['with no stamps', { clock: () => 0 }],
    ['out of order', { clock: t => 1000 + ((t - 1000) % 24) }],
  ]) {
    const v = mph(fling(opts));
    assert.ok(Math.abs(v - steady) < 1, `a fling stamped ${what} read as ${v.toFixed(1)} mph`);
    assert.ok(v > 11, `a fling stamped ${what} read as only ${v.toFixed(1)} mph`);
  }
});

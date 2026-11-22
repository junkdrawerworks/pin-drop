// The alley screen's cartoons (js/screen.js): which event a ball calls for, gags never coming round twice running, where
// the monitor goes, and every gag drawing every moment without a slip.  node --test test/screen.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toonFor, eventFor, pick, fit, GAGS, W, H } from '../js/screen.js';
import { TOON_SOUNDS } from '../js/sound.js';

const all = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const ev = (...a) => toonFor(...a)?.event ?? null;

test('a ball calls for the event its callout says', () => {
  assert.deepEqual(toonFor([], 10, []), { event: 'strike', n: 1 });
  assert.deepEqual(toonFor([10], 10, []), { event: 'double', n: 2 });
  assert.deepEqual(toonFor([10, 10], 10, []), { event: 'turkey', n: 3 });
  assert.deepEqual(toonFor([10, 10, 10], 10, []), { event: 'run', n: 4 });
  assert.deepEqual(toonFor(Array(6).fill(10), 10, []), { event: 'run', n: 7 });
  assert.deepEqual(toonFor(Array(11).fill(10), 10, []), { event: 'perfect', n: 12 });
  // A strike after an open frame starts the count again; one after a spare too.
  assert.deepEqual(toonFor([10, 7, 2], 10, []), { event: 'strike', n: 1 });
  assert.deepEqual(toonFor([10, 7, 3], 10, []), { event: 'strike', n: 1 });
  // In the tenth: strikes in a row run on through the fill balls.
  assert.deepEqual(toonFor(Array(10).fill(10), 10, []), { event: 'run', n: 11 });
  assert.equal(ev([7], 3, []), 'spare');
  assert.equal(ev([8], 2, [], { wasSplit: true }), 'pickup');
  assert.equal(ev([], 8, [4, 10]), 'split');
  assert.equal(ev([], 8, [6, 7]), 'split');
  assert.equal(ev([], 8, [7, 10]), 'split710');
  assert.equal(ev([], 0, all, { sawGutter: true }), 'gutter');
  assert.equal(ev([6], 0, [4, 7, 10, 9], { sawGutter: true }), 'gutter');
  assert.equal(ev([7], 0, [4, 7, 10]), 'whiff');
  assert.equal(ev([], 0, all), 'whiff');
  // Ordinary counts get nothing: a first ball that leaves pins together, a second that leaves some, a count after a
  // gutter that still knocked pins down, and a split on the very last ball of a game (its callout is only a count).
  assert.equal(ev([], 7, [1, 2, 4]), null);
  assert.equal(ev([], 9, [10]), null);
  assert.equal(ev([7], 2, [10]), null);
  assert.equal(ev([], 7, [1, 2, 4], { sawGutter: true }), null);
  const nine = Array(9).fill(10);
  assert.equal(ev([...nine, 10, 10], 8, [7, 10]), null);
  assert.equal(ev([...nine], 8, [7, 10]), 'split710');
  assert.equal(eventFor('8'), null);
  assert.equal(eventFor('Ana’s turn'), null);
});

test('every event has gags, the common ones several, and each has its sounds', () => {
  const by = {};
  for (const g of Object.values(GAGS)) (by[g.event] ||= []).push(g.id);
  for (const [e, least] of Object.entries({ strike: 3, double: 1, turkey: 1, run: 1, perfect: 1, spare: 2, split: 2, split710: 1, pickup: 1, gutter: 2, whiff: 1 }))
    assert.ok((by[e] || []).length >= least, `${e} has ${(by[e] || []).length} gags`);
  for (const g of Object.values(GAGS)) {
    assert.ok(g.dur >= 1.5 && g.dur <= 3, `${g.id} runs ${g.dur} s`);
    assert.ok(g.still >= 0 && g.still <= g.dur, `${g.id}'s still is at ${g.still} s`);
    for (const [at, name] of g.cues) {
      assert.ok(TOON_SOUNDS.includes(name), `${g.id} cues a sound there isn't: ${name}`);
      assert.ok(at >= 0 && at < g.dur, `${g.id} cues ${name} at ${at} s`);
    }
  }
});

test('a gag never comes round twice running', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const e of new Set(Object.values(GAGS).map(g => g.event))) {
    const ids = Object.values(GAGS).filter(g => g.event === e).map(g => g.id);
    let last = null;
    const seen = new Set();
    for (let i = 0; i < 300; i++) {
      const id = pick(e, last, rand);
      assert.ok(ids.includes(id), `${id} isn't a ${e} gag`);
      if (ids.length > 1) assert.notEqual(id, last, `${e}: ${id} twice running`);
      seen.add(id); last = id;
    }
    assert.equal(seen.size, ids.length, `${e}: only ${[...seen]} came up`);
  }
  // Even with a random number at the very top of its range.
  assert.ok(pick('strike', 'kapow', () => 0.999999));
  assert.equal(pick('nothing'), null);
});

test('the monitor fits between the scorecard and the pins, with the words across its bottom edge', () => {
  const phone = fit({ top: 90, bottom: 440, width: 390 }, 60, 50);
  assert.ok(phone && phone.x >= 0 && phone.x + phone.w <= 390 && phone.y >= 90, JSON.stringify(phone));
  assert.ok(phone.wordsTop < phone.y + phone.h && phone.wordsTop + 60 <= 440, JSON.stringify(phone));
  assert.ok(Math.abs(phone.w / phone.h - 1.3) < 0.01);
  const big = fit({ top: 90, bottom: 900, width: 1400 }, 100, 90);
  assert.ok(big.w <= 520, 'no bigger than 520 px across');
  assert.equal(fit({ top: 80, bottom: 190, width: 844 }, 60, 50), null, 'a phone on its side has no room for one');
});

// A stand-in for a canvas's 2D context that does nothing, but fails as a browser would on a negative radius or a
// number that isn't one.
function context() {
  const bad = [];
  const fn = name => (...a) => {
    if (a.some(v => typeof v === 'number' && !Number.isFinite(v))) bad.push(`${name}(${a.join(', ')})`);
    if (name === 'arc' && a[2] < 0) bad.push(`arc radius ${a[2]}`);
    if (name === 'ellipse' && (a[2] < 0 || a[3] < 0)) bad.push(`ellipse radius ${a[2]}, ${a[3]}`);
    if (name === 'roundRect' && a[2] < 0) bad.push(`roundRect ${a.join(', ')}`);
    if (name === 'measureText') return { width: String(a[0]).length * 8 };
    if (name.startsWith('create')) return { addColorStop() {} };
    return undefined;
  };
  const g = new Proxy({ canvas: {}, bad, globalAlpha: 1 }, {
    get: (o, k) => (k in o ? o[k] : typeof k === 'string' ? fn(k) : undefined),
    set: (o, k, v) => { if (typeof v === 'number' && !Number.isFinite(v)) bad.push(`${String(k)} = ${v}`); o[k] = v; return true; },
  });
  return g;
}

test('every gag draws every moment', () => {
  assert.deepEqual([W, H], [320, 240]);
  for (const g of Object.values(GAGS)) {
    for (const n of g.event === 'run' ? [4, 5, 6, 9, 11] : [0]) {
      const c = context();
      for (let t = 0; t <= g.dur + 1e-9; t += 1 / 30) g.draw(c, t, n);
      g.draw(c, g.still, n);
      assert.deepEqual(c.bad, [], `${g.id}${n ? ` (${n} in a row)` : ''}`);
    }
  }
});

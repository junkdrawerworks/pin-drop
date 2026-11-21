// Every pin still standing after a ball is standing on the pin deck, where the rules would count it (USBC
// Playing Rules, Rule 6a: a pin knocked or moved off the lane surface is down) and where the next ball can find it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { play, rack, LANE, PIN_R, SPOTS } from '../js/physics.js';

// Throws that used to leave the 10 pin standing in the channel beside the deck: a lying pin shoved it sideways,
// inch by inch, without ever tipping it.
const CASES = [
  [{ x: 0, speed: 290, angle: 0, hook: 0 }, 95028],
  [{ x: 0, speed: 290, angle: 0, hook: 0 }, 308841],
  [{ x: 3, speed: 290, angle: -0.002786, hook: 0 }, 110866],
  [{ x: 10, speed: 290, angle: 0.027314, hook: -40 }, 134623],
  [{ x: 10, speed: 290, angle: 0.028943, hook: -50 }, 118785],
  [{ x: 10, speed: 290, angle: 0.028943, hook: -50 }, 348436],
];

test('nothing is left standing off the deck or inside another pin', () => {
  const bad = [];
  CASES.forEach(([shot, seed], i) => {
    const up = play(rack(), shot, seed).pins.filter(p => p.state === 'up');
    for (const p of up) if (Math.abs(p.x) > LANE.half || p.y > LANE.deck) bad.push(`case ${i}: pin ${p.id} standing at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
    for (let a = 0; a < up.length; a++) for (let b = a + 1; b < up.length; b++)
      if (Math.hypot(up[a].x - up[b].x, up[a].y - up[b].y) < 2 * PIN_R - 0.05) bad.push(`case ${i}: pins ${up[a].id} and ${up[b].id} overlap`);
  });
  assert.deepEqual(bad, []);
});

// The pin deck is as long as a real one: the pit starts 34 3/16 in behind the middle of the head pin's spot and 3 in
// behind the back row's (USBC Equipment Specifications and Certifications Manual, Pin Deck Area, Pin Spots, items 2
// and 7). It used to run a foot further, so pins that should drop into the pit lay on the deck and slid back into play.
test('the pit starts where a real pin deck ends', () => {
  assert.ok(Math.abs(LANE.deck - LANE.head - (34 + 3 / 16)) < 1 / 16, `deck ends ${LANE.deck - LANE.head} in behind the head pin`);
  assert.ok(Math.abs(LANE.deck - SPOTS[6].y - 3) < 1 / 16, `deck ends ${(LANE.deck - SPOTS[6].y).toFixed(2)} in behind the back row`);
});

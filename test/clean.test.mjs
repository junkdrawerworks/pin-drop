// Every ball ends clean: the pins settle before the 9 s cap, nothing is still moving or wobbling, every standing pin
// stands on the deck and clear of the others, and the next ball's rack is exactly what was left standing. Throws
// from every corner of what a swipe can make (the slowest and fastest balls, the most hook from the edge), at full
// racks and at what they leave.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim, rack, rng, LANE, BALL_R, PIN_R } from '../js/physics.js';

const XMAX = LANE.half - BALL_R - 0.5;
function clean(pins, shot, seed, what, bad) {
  const sim = new Sim(pins, shot, seed);
  while (!sim.settled) sim.step(1 / 60);
  if (sim.t > 9) bad.push(`${what}: still going at the 9 s cap`);
  if (sim.ball.state !== 'pit' && !(sim.ball.state === 'gutter' && sim.ball.y >= LANE.deck)) bad.push(`${what}: ball left ${sim.ball.state}`);
  const up = sim.pins.filter(p => p.state === 'up');
  for (const p of sim.pins) if (!['up', 'down', 'gutter', 'pit'].includes(p.state)) bad.push(`${what}: pin ${p.id} ${p.state}`);
  for (const p of up) {
    if (Math.abs(p.x) > LANE.half || p.y < LANE.head - 25 || p.y > LANE.deck) bad.push(`${what}: pin ${p.id} standing off the deck at ${p.x.toFixed(1)}, ${p.y.toFixed(1)}`);
    if (p.wob >= 0.08 || p.fallAt || Math.hypot(p.vx, p.vy) >= 3) bad.push(`${what}: pin ${p.id} still moving`);
  }
  for (let a = 0; a < up.length; a++) for (let b = a + 1; b < up.length; b++)
    if (Math.hypot(up[a].x - up[b].x, up[a].y - up[b].y) < 2 * PIN_R - 0.05) bad.push(`${what}: pins ${up[a].id} and ${up[b].id} overlap`);
  const next = rack(sim.standing);
  if (next.map(p => `${p.id}@${p.x},${p.y}`).join() !== sim.standing.map(p => `${p.id}@${p.x},${p.y}`).join()) bad.push(`${what}: the next rack isn't what was left`);
  return sim.standing;
}

test('every ball ends clean, and the next ball faces what was left', () => {
  const r = rng(2026), bad = [];
  const corners = [];
  for (const x of [-XMAX, 0, XMAX]) for (const speed of [170, 390]) for (const angle of [-0.07, 0, 0.07]) for (const hook of [-65, 0, 65]) corners.push({ x, speed, angle, hook });
  // Anything a swipe can make, and a lot of balls around the pocket, where pins fly hardest.
  const any = () => ({ x: (r() * 2 - 1) * XMAX, speed: 170 + r() * 220, angle: (r() * 2 - 1) * 0.07, hook: (r() * 2 - 1) * 65 });
  const pocket = () => ({ x: r() * 12, speed: 260 + r() * 60, angle: 0.005 + r() * 0.03, hook: -r() * 60 });
  const shots = [...corners, ...Array.from({ length: 40 }, any), ...Array.from({ length: 160 }, pocket)];
  shots.forEach((shot, i) => {
    const left = clean(rack(), shot, (r() * 2 ** 31) | 0, `shot ${i} ${JSON.stringify(shot)}`, bad);
    if (left.length) clean(rack(left), { x: (r() * 2 - 1) * XMAX, speed: 300, angle: (r() * 2 - 1) * 0.05, hook: 0 }, (r() * 2 ** 31) | 0, `shot ${i}, second ball`, bad);
  });
  assert.deepEqual(bad, []);
});

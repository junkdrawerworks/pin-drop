// The computer player: where it stands, and how it throws, through the same physics as a person's swipe.
//
// At a full rack it throws one ball, the way a good bowler does: from its spot on the right, hooking left into the
// pocket. At pins left it throws straight from the other side of the lane at the pin in front, a little to one side
// where that takes more of them (worked out by trying a few lines with the physics, once for each leave). Each level
// misses its line by its own amount, at random: the inches it misses the pins by, its speed and its hook.
import { Sim, LANE, BALL_R, SPOTS } from './physics.js';

// Each level's average, tuned over 60 seeded games of each: Rookie about 100, Regular about 150, Pro about 200 (see
// computer.test.mjs). `x` is where it stands for a first ball and `at` where it aims to cross the head pin's line (in
// inches from the middle, right positive), with its `speed` and `hook` (in/s). `miss` is how far off its line a first
// ball is at the pins (in inches, one standard deviation), `spare` the same for a ball at pins left, and `pace` and
// `bend` how much its speed and hook vary (in/s). A Rookie throws straight, slower, and misses by a lot more.
export const LEVELS = {
  rookie: { name: 'Rookie', x: 12.8, at: 2.5, speed: 245, hook: 0, miss: 10, spare: 11, pace: 22, bend: 0 },
  regular: { name: 'Regular', x: 10, at: 2.5, speed: 285, hook: -40, miss: 3.6, spare: 3.4, pace: 12, bend: 5 },
  pro: { name: 'Pro', x: 10, at: 2.5, speed: 290, hook: -40, miss: 1.1, spare: 1.2, pace: 6, bend: 2 },
};
export const LEVEL_KEYS = Object.keys(LEVELS);
export const levelOf = k => LEVELS[k] || LEVELS.regular;
export const cpuName = k => `Computer (${levelOf(k).name})`;

// The angle (radians) that sends a ball from x0 through xh at the head pin, with the lane's wander left out (as the
// guide shows it), by halving the range.
function through(x0, xh, hook, speed) {
  let lo = -0.08, hi = 0.08;
  for (let k = 0; k < 32; k++) {
    const m = (lo + hi) / 2, s = new Sim([], { x: x0, speed, angle: m, hook });
    s.rand = () => 0.5;
    while (s.ball.y < LANE.head && s.ball.state === 'lane') s.step(1 / 240);
    if (s.ball.x < xh) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}
const lines = new Map();
function firstBall(L) {
  const key = `${L.x},${L.at},${L.hook},${L.speed}`;
  if (!lines.has(key)) lines.set(key, through(L.x, L.at, L.hook, L.speed));
  return lines.get(key);
}

// A standard normal number from two uniform ones.
function normal(rand) {
  const u = Math.max(1e-9, rand()), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// For pins left: where to stand (across the lane from them) and the spot to roll through, the pin in front or a few
// inches to one side of it, whichever knocks most down for a straight ball over a few seeds. Worked out once for each
// leave (by the pins' numbers) and kept.
const OFFSETS = [0, -2, 2, -4, 4, -6, 6];
const spares = new Map();
function spareLine(left) {
  const key = left.map(p => p.id).sort((a, b) => a - b).join();
  if (spares.has(key)) return spares.get(key);
  const at = left.map(p => ({ id: p.id, ...SPOTS[p.id - 1] }));
  const front = at.reduce((a, p) => (p.y < a.y || (p.y === a.y && Math.abs(p.x) < Math.abs(a.x)) ? p : a));
  let best = null;
  for (const o of OFFSETS) {
    const xt = front.x + o, x0 = Math.max(-12, Math.min(12, -xt * 0.7));
    const angle = Math.atan2(xt - x0, front.y - 6);
    let down = 0;
    for (let seed = 1; seed <= 3; seed++) {
      const pins = at.map(p => ({ id: p.id, x: p.x, y: p.y, vx: 0, vy: 0, a: 0, w: 0, state: 'up', ft: 0, wob: 0, wobA: 0, fallAt: 0, fallDir: 0, gx: 0, shove: 0 }));
      const sim = new Sim(pins, { x: x0, speed: 280, angle, hook: 0 }, seed);
      while (!sim.settled) sim.step(1 / 60);
      down += at.length - sim.standing.length;
    }
    if (!best || down > best.down) best = { down, x0, xt, y: front.y };
  }
  spares.set(key, best);
  return best;
}

// The computer's next ball at the pins standing ([{ id, x, y }]), for a level, with `rand` for its misses.
export function plan(standing, level, rand) {
  const L = levelOf(level);
  const edge = LANE.half - BALL_R - 0.5;
  if (standing.length === 10) {
    const speed = L.speed + normal(rand) * L.pace;
    return { x: L.x, speed: Math.max(170, Math.min(390, speed)), angle: firstBall(L) + normal(rand) * L.miss / LANE.head, hook: L.hook + normal(rand) * L.bend };
  }
  const s = spareLine(standing);
  const x = Math.max(-edge, Math.min(edge, s.x0));
  const speed = Math.max(170, Math.min(390, 280 + normal(rand) * L.pace));
  return { x, speed, angle: Math.atan2(s.xt - x, s.y - 6) + normal(rand) * L.spare / s.y, hook: 0 };
}

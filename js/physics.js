// The lane, the ball and the pins, seen from above. Everything is in inches, with x across the lane (0 down the
// middle, right is positive) and y down it (0 at the foul line, the head pin 60 feet away at 720).
//
// The ball slides through the oil on the front two thirds of the lane and grips the dry back end, where its side
// spin turns into hook. Pins stand as circles until something hits them hard enough to tip them over; a falling
// pin swings down along the way it was pushed, and a lying pin is a capsule that slides, spins and takes out its
// neighbours. A soft hit makes a pin wobble, and it may or may not go.

export const LANE = {
  half: 20.75,        // 39 boards, 41.5" wide
  gutter: 9.25,       // each gutter's width; the kickback walls stand at the outer edge, beside the pin deck
  oil: 480,           // the oil pattern ends 40 feet down
  head: 720,          // the head pin
  deck: 754.1875,     // the pin deck ends and the pit begins, 34 3/16" behind the head pin and 3" behind the back row
  pit: 800,
};
export const BOARD = 41.5 / 39;
const ROW = 12 * Math.sqrt(3) / 2;
// The ten spots, numbered the usual way: 1 at the front, 7–10 across the back, 7 on the left.
export const SPOTS = [[0, 0], [-6, 1], [6, 1], [-12, 2], [0, 2], [12, 2], [-18, 3], [-6, 3], [6, 3], [18, 3]]
  .map(([x, r]) => ({ x, y: LANE.head + r * ROW }));

export const BALL_R = 4.25;
export const PIN_R = 2.38;       // at the belly, where the ball meets it
export const PIN_LEN = 15;
const LYING_R = 2.2;             // a lying pin, on average along its length (it tumbles, so a little fat)
const M_BALL = 15, M_PIN = 3.5;
const I_LYING = M_PIN * (PIN_LEN * PIN_LEN / 12 + LYING_R * LYING_R / 2);
// A standing pin turns on its own axis when something rubs past it, as freely as a solid cylinder the belly's width
// (half its mass times the belly's radius squared). No figure is published; a real pin, narrower above and below the
// belly, would turn a little more easily than that.
const I_UP = 0.5 * M_PIN * PIN_R * PIN_R;
const G = 386;                   // in/s²
const FALL_T = 0.14;             // how long a pin takes to go over
const TOPPLE = 65;               // a push this hard (in/s) always tips a pin over
const NUDGE = 7;                 // anything softer than this just rocks it

// A small seeded random generator, so the same throw always plays out the same way.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A full rack, or the pins listed (by number) standing where they were left.
export function rack(standing) {
  return SPOTS.map((s, i) => pin(i + 1, s.x, s.y)).filter(p => !standing || standing.some(q => q.id === p.id))
    .map(p => { const q = standing?.find(q => q.id === p.id); if (q) { p.x = q.x; p.y = q.y; } return p; });
}
function pin(id, x, y) {
  return { id, x, y, vx: 0, vy: 0, a: 0, w: 0, state: 'up', ft: 0, wob: 0, wobA: 0, fallAt: 0, fallDir: 0, gx: 0, shove: 0 };
}

// How a throw leaves the hand: where it's released (x), how fast (in/s), its angle off straight (radians,
// positive towards the right) and its hook (in/s of side spin to turn into sideways speed; negative hooks left).
export class Sim {
  constructor(pins, { x, speed, angle, hook }, seed = 1) {
    this.pins = pins;
    this.ball = { x, y: 6, vx: speed * Math.sin(angle), vy: speed * Math.cos(angle), spin: hook, state: 'lane', roll: 0, hookAt: null };
    this.t = 0;
    this.acc = 0;         // time not yet stepped
    this.rand = rng(seed);
    this.events = [];     // hits and drops since the last read, for the sound
    this.hitPins = false;
    this.release = speed;
  }

  // Moves everything on by dt seconds, in steps of exactly 1/600 s. Whatever doesn't make a whole step waits for the
  // next call, so frames that come at uneven times run the same steps (and draw the same random numbers) as even ones,
  // and the same seed always plays out the same way.
  step(dt) {
    const h = 1 / 600;
    this.acc += dt;
    while (this.acc >= h - 1e-12) { this.tick(h); this.acc -= h; }
  }

  tick(dt) {
    this.t += dt;
    const b = this.ball;
    if (b.state === 'lane') {
      // Grip: almost none in the oil, more and more past the end of the pattern.
      const into = (b.y - LANE.oil) / 90;
      const mu = 0.012 + 0.17 * Math.min(1, Math.max(0, into));
      if (b.spin !== 0) {
        const dv = Math.min(Math.abs(b.spin), mu * G * dt) * Math.sign(b.spin);
        b.vx += dv; b.spin -= dv;
        if (b.hookAt === null && into > 0 && Math.abs(dv) > 0) b.hookAt = { x: b.x, y: b.y };
      }
      // The lane isn't perfect: a ball wanders about an inch either way over 60 feet, whatever its speed. The wander
      // goes with the distance rolled, not the time taken, so a slow ball wanders no more than a fast one: each step
      // nudges the ball's line (vx / vy) by an amount that grows with the square root of the inches it covered. Its
      // size is the one a 16.5 mph ball (290 in/s) always had.
      b.vx += (this.rand() - 0.5) * 40 * dt * Math.pow(b.vy / 290, 1.5);
      b.vy = Math.max(60, b.vy - mu * G * 0.12 * dt);
      b.x += b.vx * dt; b.y += b.vy * dt;
      if (Math.abs(b.x) > LANE.half && b.y < LANE.deck) {
        b.state = 'gutter'; b.side = Math.sign(b.x);
        this.events.push({ kind: 'gutter', x: b.x, y: b.y, power: 1 });
      }
      if (b.y > LANE.deck) { b.state = 'pit'; this.events.push({ kind: 'pit', power: 1 }); }
    } else if (b.state === 'gutter') {
      // Down the gutter to the pit, missing everything.
      const gx = b.side * (LANE.half + LANE.gutter / 2);
      b.x += (gx - b.x) * Math.min(1, dt * 14);
      b.vx = 0;
      b.y += b.vy * dt;
      if (b.y > LANE.pit) b.state = 'pit';
    } else if (b.state === 'pit') {
      b.y += b.vy * dt; b.vy *= 1 - dt * 3;
    }
    b.roll += Math.hypot(b.vx, b.vy) * dt / BALL_R;

    for (const p of this.pins) this.move(p, dt);
    this.collide();
  }

  move(p, dt) {
    if (p.state === 'gutter' || p.state === 'pit') return;
    if (p.state === 'up') {
      slow(p, 520 * dt);
      p.w *= Math.exp(-dt * 6);
      p.wob *= Math.exp(-dt * 3.2);
      p.wobA += dt * 22;
      if (p.fallAt && this.t >= p.fallAt) { p.fallAt = 0; this.topple(p, p.fallDir); }
    } else if (p.state === 'falling') {
      slow(p, 300 * dt);
      p.ft += dt;
      if (p.ft >= FALL_T) {
        // Lying down now: the pin's middle is half its length from where it stood.
        p.state = 'down';
        p.x += Math.cos(p.a) * PIN_LEN / 2; p.y += Math.sin(p.a) * PIN_LEN / 2;
        // Struck pins cartwheel: the harder they were hit, the faster they spin across the deck.
        p.w = (this.rand() < 0.5 ? -1 : 1) * (2 + this.rand() * Math.hypot(p.vx, p.vy) * 0.06);
        this.events.push({ kind: 'thud', x: p.x, y: p.y, power: 0.5 });
      }
    } else {
      slow(p, 170 * dt);
      p.w *= Math.exp(-dt * 2.2);
      p.a += p.w * dt;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;

    // Over the edge of the deck, into the gutter or off the back into the pit. A pin flying sideways hits the
    // kickback wall and comes back into play.
    const wall = LANE.half + LANE.gutter;
    if (p.state !== 'up' && Math.abs(p.x) > wall - LYING_R && p.y > LANE.head - 40) {
      p.x = Math.sign(p.x) * (wall - LYING_R);
      if (Math.sign(p.vx) === Math.sign(p.x)) { this.events.push({ kind: 'wall', x: p.x, y: p.y, power: Math.min(1, Math.abs(p.vx) / 300) }); p.vx *= -0.5; p.w += p.vy * 0.02; }
    }
    // A standing pin goes in as soon as its middle is over the edge: it has nothing left to stand on.
    const onDeck = p.y > LANE.head - 20;
    if (Math.abs(p.x) > LANE.half + (p.state === 'up' ? 0 : onDeck ? 3 : 1) && (Math.hypot(p.vx, p.vy) < (onDeck ? 45 : 90) || p.state === 'up' || !onDeck)) {
      if (p.state === 'up') p.a = Math.atan2(p.vy, p.vx || Math.sign(p.x));
      p.state = 'gutter';
      p.gx = Math.sign(p.x) * (LANE.half + LANE.gutter / 2);
      p.x = p.gx; p.vx = p.vy = 0; p.w = 0; p.a = Math.PI / 2 + (this.rand() - 0.5) * 0.3;
      this.events.push({ kind: 'thud', x: p.x, y: p.y, power: 0.4 });
    } else if (p.y > LANE.deck + (p.state === 'down' ? 4 : 0)) {
      p.state = 'pit';
    } else if (p.y < -20) {
      p.vy = Math.abs(p.vy) * 0.3;
    }
  }

  topple(p, dir) {
    if (p.state !== 'up') return;
    p.state = 'falling'; p.ft = 0; p.a = dir; p.wob = 0; p.fallAt = 0;
  }

  // The parts of the scene that can touch, as capsules: [ax, ay, bx, by, radius].
  shape(o) {
    if (o === this.ball) return [o.x, o.y, o.x, o.y, BALL_R];
    if (o.state === 'up') return [o.x, o.y, o.x, o.y, PIN_R];
    if (o.state === 'falling') {
      const f = fallen(o.ft), l = PIN_LEN * f;
      return [o.x, o.y, o.x + Math.cos(o.a) * l, o.y + Math.sin(o.a) * l, PIN_R + (LYING_R - PIN_R) * f];
    }
    const hx = Math.cos(o.a) * PIN_LEN / 2, hy = Math.sin(o.a) * PIN_LEN / 2;
    return [o.x - hx, o.y - hy, o.x + hx, o.y + hy, LYING_R];
  }

  collide() {
    const bodies = this.pins.filter(p => p.state === 'up' || p.state === 'falling' || p.state === 'down');
    if (this.ball.state === 'lane' && this.ball.y > LANE.head - 30) bodies.unshift(this.ball);
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) this.contact(bodies[i], bodies[j]);
    }
  }

  contact(A, B) {
    const a = this.shape(A), b = this.shape(B);
    const reach = a[4] + b[4];
    // A quick miss before the exact test.
    if (Math.max(a[0], a[2]) + reach < Math.min(b[0], b[2]) || Math.max(b[0], b[2]) + reach < Math.min(a[0], a[2])) return;
    if (Math.max(a[1], a[3]) + reach < Math.min(b[1], b[3]) || Math.max(b[1], b[3]) + reach < Math.min(a[1], a[3])) return;
    const [s, t] = closest(a, b);
    const px = a[0] + (a[2] - a[0]) * s, py = a[1] + (a[3] - a[1]) * s;
    const qx = b[0] + (b[2] - b[0]) * t, qy = b[1] + (b[3] - b[1]) * t;
    let nx = px - qx, ny = py - qy;
    const d = Math.hypot(nx, ny);
    if (d >= reach) return;
    if (d < 1e-6) { nx = 0; ny = -1; } else { nx /= d; ny /= d; }
    // The contact point, and where it sits from each body's middle.
    const cx = qx + nx * b[4], cy = qy + ny * b[4];
    const ka = this.mass(A), kb = this.mass(B);
    const rax = cx - A.x, ray = cy - A.y, rbx = cx - B.x, rby = cy - B.y;
    const wa = A.w ?? 0, wb = B.w ?? 0;
    // A falling pin's top half swings down through the air, faster the further up it: where it meets something, that
    // part of it is moving at the swing's speed as well as the pin's own slide.
    const ua = this.swing(A, s), ub = this.swing(B, t);
    const vax = A.vx - wa * ray * (ka.rot ? 1 : 0) + ua[0], vay = A.vy + wa * rax * (ka.rot ? 1 : 0) + ua[1];
    const vbx = B.vx - wb * rby * (kb.rot ? 1 : 0) + ub[0], vby = B.vy + wb * rbx * (kb.rot ? 1 : 0) + ub[1];
    const rvx = vax - vbx, rvy = vay - vby;
    const vn = rvx * nx + rvy * ny;

    // Push the two apart.
    const pen = reach - d, sum = ka.inv + kb.inv;
    A.x += nx * pen * ka.inv / sum; A.y += ny * pen * ka.inv / sum;
    B.x -= nx * pen * kb.inv / sum; B.y -= ny * pen * kb.inv / sum;
    // A standing pin pushed along like that, by a pin lying against it, is never struck, so nothing tips it: it could
    // slide upright right off the deck. Once it's been shoved an inch, it goes over the way it's being pushed.
    for (const [P, sg, k] of [[A, 1, ka], [B, -1, kb]]) {
      if (P === this.ball || P.state !== 'up') continue;
      P.shove += pen * k.inv / sum;
      if (P.shove > 1) this.topple(P, Math.atan2(sg * ny, sg * nx));
    }
    if (vn >= 0) return;

    const isBall = A === this.ball || B === this.ball;
    const e = isBall ? 0.72 : 0.45 + this.rand() * 0.2;
    const crA = rax * ny - ray * nx, crB = rbx * ny - rby * nx;
    // The swinging top of a falling pin is light: a rod tipping over about its foot meets things a fraction f of the
    // way up with a third of its weight over f squared behind it, so that part gives way more than the pin's slide.
    const den = ka.inv + kb.inv + crA * crA * ka.invI + crB * crB * kb.invI + this.give(A, s, nx, ny) + this.give(B, t, nx, ny);
    const jn = -(1 + e) * vn / den;
    // A little friction along the contact, which is what sets lying pins spinning.
    const tx = -ny, ty = nx, vt = rvx * tx + rvy * ty;
    const ctA = rax * ty - ray * tx, ctB = rbx * ty - rby * tx;
    const dent = ka.inv + kb.inv + ctA * ctA * ka.invI + ctB * ctB * kb.invI;
    const jt = Math.max(-0.2 * jn, Math.min(0.2 * jn, -vt / dent));
    const jx = nx * jn + tx * jt, jy = ny * jn + ty * jt;
    A.vx += jx * ka.inv; A.vy += jy * ka.inv;
    B.vx -= jx * kb.inv; B.vy -= jy * kb.inv;
    if (ka.rot) A.w += (rax * jy - ray * jx) * ka.invI;
    if (kb.rot) B.w -= (rbx * jy - rby * jx) * kb.invI;

    if (isBall) this.hitPins = true;
    this.events.push({ kind: isBall ? 'ball' : 'pin', x: cx, y: cy, power: Math.min(1, -vn / (isBall ? 300 : 260)) });
    this.knock(A, jn * ka.inv);
    this.knock(B, jn * kb.inv);
  }

  // How fast the point a fraction f of the way up a falling pin is swinging, across the deck (in/s, x and y).
  swing(o, f) {
    if (o === this.ball || o.state !== 'falling') return [0, 0];
    const u = f * PIN_LEN * fallRate(o.ft);
    return [Math.cos(o.a) * u, Math.sin(o.a) * u];
  }

  give(o, f, nx, ny) {
    if (o === this.ball || o.state !== 'falling') return 0;
    const c = nx * Math.cos(o.a) + ny * Math.sin(o.a);
    return 3 * f * f * c * c / M_PIN;
  }

  mass(o) {
    if (o === this.ball) return { inv: 1 / M_BALL, invI: 0, rot: false };
    if (o.state === 'down') return { inv: 1 / M_PIN, invI: 1 / I_LYING, rot: true };
    // Free to spin, a standing pin takes little of the rub as the ball goes by, so the ball bounces off it fully: a
    // pin held still against spinning dragged the ball along with it, and the ball came off the head pin at half the
    // angle and never reached the 9 pin.
    if (o.state === 'up') return { inv: 1 / M_PIN, invI: 1 / I_UP, rot: true };
    return { inv: 1 / M_PIN, invI: 0, rot: false };
  }

  // A standing pin that's been pushed: over it goes, or it rocks and might go a moment later.
  knock(p, dv) {
    if (p === this.ball || p.state !== 'up') return;
    const dir = Math.atan2(p.vy, p.vx);
    // Pins tumble as they go, so a hard hit sends one off a little either side of the push.
    if (dv >= TOPPLE) { this.topple(p, dir + (this.rand() - 0.5) * 1.2); return; }
    if (dv < NUDGE * 0.3) return;
    p.wob = Math.min(1, p.wob + dv / TOPPLE);
    if (dv >= NUDGE && !p.fallAt && this.rand() < Math.pow((dv - NUDGE) / (TOPPLE - NUDGE), 1.2)) {
      p.fallAt = this.t + 0.15 + this.rand() * 0.75;
      p.fallDir = dir + (this.rand() - 0.5) * 0.8;
    }
  }

  // Everything has come to rest (or the time's up).
  get settled() {
    if (this.t > 9) return true;
    // A gutter ball runs on past the deck into the pit, rather than stopping in the channel beside the 7 or 10 pin.
    if (this.ball.state === 'lane' || this.ball.state === 'gutter') return false;
    return this.pins.every(p => {
      if (p.state === 'gutter' || p.state === 'pit') return true;
      if (p.state === 'falling' || p.fallAt) return false;
      const v = Math.hypot(p.vx, p.vy);
      return p.state === 'up' ? v < 3 && p.wob < 0.08 : v < 5 && Math.abs(p.w) < 0.6;
    });
  }

  // The pins still standing, and where.
  get standing() { return this.pins.filter(p => p.state === 'up').map(p => ({ id: p.id, x: p.x, y: p.y })); }
}

function slow(o, by) {
  const v = Math.hypot(o.vx, o.vy);
  if (v <= by) { o.vx = 0; o.vy = 0; return; }
  const k = (v - by) / v;
  o.vx *= k; o.vy *= k;
}

// How far over a falling pin is, 0 to 1: slow to start, quick at the end.
export function fallen(t) { const f = Math.min(1, t / FALL_T); return Math.sin(f * f * Math.PI / 2); }
// How fast that goes, per second.
function fallRate(t) { const f = Math.min(1, t / FALL_T); return f >= 1 ? 0 : Math.cos(f * f * Math.PI / 2) * Math.PI * f / FALL_T; }

// The closest points of two segments, as fractions along each (Ericson, Real-Time Collision Detection 5.1.9).
function closest(a, b) {
  const d1x = a[2] - a[0], d1y = a[3] - a[1], d2x = b[2] - b[0], d2y = b[3] - b[1];
  const rx = a[0] - b[0], ry = a[1] - b[1];
  const A = d1x * d1x + d1y * d1y, E = d2x * d2x + d2y * d2y, F = d2x * rx + d2y * ry;
  if (A < 1e-9 && E < 1e-9) return [0, 0];
  if (A < 1e-9) return [0, clamp(F / E)];
  const C = d1x * rx + d1y * ry;
  if (E < 1e-9) return [clamp(-C / A), 0];
  const B = d1x * d2x + d1y * d2y, den = A * E - B * B;
  let s = den > 1e-9 ? clamp((B * F - C * E) / den) : 0;
  let t = (B * s + F) / E;
  if (t < 0) { t = 0; s = clamp(-C / A); } else if (t > 1) { t = 1; s = clamp((B - C) / A); }
  return [s, t];
}
const clamp = v => Math.max(0, Math.min(1, v));

// Where a throw's ball goes down the lane with none of the lane's wander, as points every 6 inches or so, up to `to`
// inches down (or until it reaches the gutter, at the lane's edge): for the guide drawn while swiping.
export function path(shot, to) {
  const sim = new Sim([], shot);
  sim.rand = () => 0.5;
  const b = sim.ball, pts = [{ x: b.x, y: b.y }];
  while (b.state === 'lane' && b.y < to) {
    sim.tick(1 / 600);
    const last = pts[pts.length - 1];
    if (b.state !== 'lane') {
      // Over the edge: end it where it crossed.
      const u = (Math.sign(b.x) * LANE.half - last.x) / (b.x - last.x || 1);
      pts.push({ x: Math.sign(b.x) * LANE.half, y: last.y + (b.y - last.y) * u, edge: true });
    } else if (b.y - last.y >= 6 || b.y >= to) pts.push({ x: b.x, y: Math.min(b.y, to) });
  }
  return pts;
}

// Runs a throw to the end, for tests and for trying things out.
export function play(pins, shot, seed) {
  const sim = new Sim(pins, shot, seed);
  while (!sim.settled) sim.step(1 / 60);
  return sim;
}

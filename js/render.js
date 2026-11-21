// Draws the alley in perspective from behind the ball. The camera starts at the foul line looking down the
// lane and follows the ball to the pins.
import { LANE, SPOTS, BOARD, BALL_R, PIN_LEN, fallen } from './physics.js';

const NEAR = 6;
const NEXT_LANE = 41.5 + LANE.gutter * 2 + 9;   // centre to centre, with the ball return between
// A pin's outline: height up the pin (inches) and its radius there.
const PROFILE = [[0, 1.02], [0.75, 1.41], [2.25, 1.96], [3.4, 2.25], [4.5, 2.38], [5.9, 2.28], [7.25, 1.92], [8.6, 1.4],
  [9.4, 1.02], [10, 0.9], [10.9, 0.93], [11.75, 1.05], [12.5, 1.18], [13.4, 1.26], [14.2, 1.1], [14.7, 0.78], [15, 0]];
export const BALL_COLOURS = [
  ['#5aa8ff', '#1d4fa8', '#0b1d45'],
  ['#ff7a6b', '#c22d2d', '#4a0d14'],
  ['#7be0a4', '#1f8f5c', '#0b3322'],
  ['#c9a0ff', '#6b3fc4', '#24124d'],
];

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.cam = { x: 0, y: -150, h: 70, f: 1000, hor: 0 };
    this.resize();
  }

  resize() {
    const r = this.c.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.c.width = Math.round(this.W * this.dpr); this.c.height = Math.round(this.H * this.dpr);
    this.aimView = this.view('aim');
    this.pinView = this.view('pins');
  }

  // The two camera positions everything moves between.
  view(which) {
    const { W, H } = this;
    const top = Math.min(110, H * 0.13);   // room for the scorecard
    if (which === 'aim') {
      const D = 150;
      const laneW = Math.min(W * 0.9, H * 0.5);
      const f = laneW * D / 41.5;
      const footY = H * 0.86, pinsY = top + (H - top) * 0.13;
      const h = (footY - pinsY) / (f * (1 / D - 1 / (LANE.head + D)));
      return { x: 0, y: -D, h, f, hor: footY - f * h / D };
    }
    // Close to the pins, a little above them.
    const D = 230;
    const deckW = Math.min(W * 1.06, (H - top) * 0.72);
    const f = deckW * (D - 10) / (41.5 + LANE.gutter * 2);
    const h = 34;
    const baseY = top + (H - top) * 0.62;
    return { x: 0, y: LANE.head - D, h, f, hor: baseY - f * h / D };
  }

  setCamera(t, follow = 0) {
    const a = this.aimView, b = this.pinView, e = t * t * (3 - 2 * t);
    const c = this.cam;
    c.y = a.y + (b.y - a.y) * e;
    c.h = a.h + (b.h - a.h) * e;
    c.f = a.f + (b.f - a.f) * e;
    c.hor = a.hor + (b.hor - a.hor) * e;
    c.x = follow * e * 0.25;
  }

  // Lane point to screen: [x, y, pixels per inch], or null if it's behind the camera.
  p(X, Y, Z = 0) {
    const c = this.cam, d = Y - c.y;
    if (d < NEAR) return null;
    const s = c.f / d;
    return [this.W / 2 + (X - c.x) * s, c.hor + (c.h - Z) * s, s];
  }

  // Screen point back to the lane surface.
  toLane(sx, sy) {
    const c = this.cam;
    const d = c.f * c.h / (sy - c.hor);
    return { x: c.x + (sx - this.W / 2) * d / c.f, y: c.y + d };
  }

  // A flat quad on the floor (or any height), clipped at the near plane.
  quad(x0, x1, y0, y1, z = 0) {
    y0 = Math.max(y0, this.cam.y + NEAR + 0.5);
    if (y1 <= y0) return false;
    const a = this.p(x0, y0, z), b = this.p(x1, y0, z), c = this.p(x1, y1, z), d = this.p(x0, y1, z);
    const g = this.g;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
    return true;
  }

  // A wall standing on the line from (x, y0) to (x, y1), between two heights.
  wall(x, y0, y1, z0, z1) {
    y0 = Math.max(y0, this.cam.y + NEAR + 0.5);
    if (y1 <= y0) return false;
    const a = this.p(x, y0, z0), b = this.p(x, y1, z0), c = this.p(x, y1, z1), d = this.p(x, y0, z1);
    const g = this.g;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
    return true;
  }

  draw(s) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // The room: dark, a little warmer towards the floor.
    const bg = g.createLinearGradient(0, 0, 0, this.H);
    bg.addColorStop(0, '#0d1222'); bg.addColorStop(1, '#1a2036');
    g.fillStyle = bg; g.fillRect(0, 0, this.W, this.H);

    this.masking(s.t);
    for (const k of [-2, -1, 1, 2]) this.lane(k * NEXT_LANE, true);
    this.lane(0, false);
    for (const k of [-2, -1, 1, 2]) for (const sp of SPOTS) this.uprightPin(k * NEXT_LANE + sp.x, sp.y, 0, 0, 0.55);
    if (s.guide) this.guide(s.guide);

    // Near things over far ones.
    const things = [];
    for (const p of s.pins) if (p.state !== 'pit') things.push({ y: depthOf(p), draw: () => this.pin(p, s) });
    if (s.ball && s.ball.state !== 'pit') things.push({ y: s.ball.y, draw: () => this.ball(s.ball, s.colour) });
    if (s.sweep && s.sweep.on) things.push({ y: s.sweep.y, draw: () => this.sweepBar(s.sweep) });
    things.sort((a, b) => b.y - a.y);
    for (const o of things) o.draw();

    // Where the light is (a soft vignette).
    const v = g.createRadialGradient(this.W / 2, this.H * 0.45, this.H * 0.25, this.W / 2, this.H * 0.45, this.H * 0.8);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.38)');
    g.fillStyle = v; g.fillRect(0, 0, this.W, this.H);
  }

  // The panel across the back above the pin decks, and the dark pits below it.
  masking(t) {
    const g = this.g, back = LANE.pit + 30;
    const L = -NEXT_LANE * 2.5, R = NEXT_LANE * 2.5;
    // The pit and the curtain behind it.
    if (this.quad(L, R, LANE.deck, back)) { g.fillStyle = '#05070d'; g.fill(); }
    const a = this.p(L, back, 50), c = this.p(R, back, 0), d = this.p(L, back, 0);
    if (!a) return;
    g.fillStyle = '#070a12';
    g.fillRect(0, 0, this.W, c[1]);
    // The masking unit: a lit band over each lane.
    const top = this.p(0, back, 50)[1], bot = this.p(0, back, 24)[1];
    for (let k = -2; k <= 2; k++) {
      const l = this.p(k * NEXT_LANE - 30, back, 0)[0], r = this.p(k * NEXT_LANE + 30, back, 0)[0];
      const grad = g.createLinearGradient(0, top, 0, bot);
      if (k === 0) { grad.addColorStop(0, '#24305a'); grad.addColorStop(1, '#3a2f63'); }
      else { grad.addColorStop(0, '#161d36'); grad.addColorStop(1, '#1d1a38'); }
      g.fillStyle = grad;
      g.fillRect(l, top, r - l, bot - top);
      // Stars and a sweeping arc, like the old alleys.
      g.save(); g.beginPath(); g.rect(l, top, r - l, bot - top); g.clip();
      const w = r - l, hgt = bot - top;
      g.strokeStyle = k === 0 ? 'rgba(255,201,74,0.55)' : 'rgba(255,201,74,0.18)';
      g.lineWidth = Math.max(1, hgt * 0.04);
      g.beginPath(); g.ellipse(l + w / 2, bot + hgt * 0.9, w * 0.62, hgt * 1.25, 0, Math.PI, 2 * Math.PI); g.stroke();
      g.fillStyle = k === 0 ? 'rgba(63,208,201,0.8)' : 'rgba(63,208,201,0.25)';
      for (let i = 0; i < 7; i++) {
        const sx = l + w * ((i * 0.37 + 0.11) % 1), sy = top + hgt * ((i * 0.53 + 0.2) % 0.8);
        const tw = k === 0 ? 0.6 + 0.4 * Math.sin(t * 2 + i * 1.7) : 1;
        star(g, sx, sy, hgt * 0.06 * tw);
      }
      if (k === 0) {
        g.fillStyle = '#ffd36b';
        g.font = `${Math.round(Math.min(hgt * 0.5, w * 0.15))}px Shrikhand, Georgia, serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.shadowColor = 'rgba(255,170,60,0.8)'; g.shadowBlur = hgt * 0.15;
        g.fillText('Pin Drop', l + w / 2, top + hgt * 0.52);
        g.shadowBlur = 0;
      }
      g.restore();
    }
    // The gap under the masking unit, where the pinsetter lives.
    g.fillStyle = '#020306';
    g.fillRect(0, bot, this.W, Math.max(0, d[1] - bot));
  }

  // One lane: approach, lane, gutters, pin deck. The neighbours are drawn dimmer.
  lane(X, dim) {
    const g = this.g;
    const near = Math.max(-80, this.cam.y + NEAR + 0.5);
    const half = LANE.half, gut = LANE.gutter;
    // The ball return / capping between lanes.
    if (this.quad(X - NEXT_LANE / 2, X - half - gut, near, LANE.deck)) { g.fillStyle = dim ? '#151a2a' : '#1b2133'; g.fill(); }
    if (this.quad(X + half + gut, X + NEXT_LANE / 2, near, LANE.deck)) { g.fillStyle = dim ? '#151a2a' : '#1b2133'; g.fill(); }
    // Gutters: a rounded channel, dark at the bottom.
    for (const side of [-1, 1]) {
      const x0 = X + side * half, x1 = X + side * (half + gut);
      if (this.quad(Math.min(x0, x1), Math.max(x0, x1), near, LANE.deck)) {
        const a = this.p(x0, LANE.head), b = this.p(x1, LANE.head);
        const grad = g.createLinearGradient(a[0], 0, b[0], 0);
        grad.addColorStop(0, '#3a4152'); grad.addColorStop(0.5, '#151821'); grad.addColorStop(1, '#2e3443');
        g.fillStyle = dim ? '#1c202b' : grad; g.fill();
      }
    }
    // The wood. The approach is a shade paler than the lane; the pin deck is paler again.
    const wood = (y0, y1, c0, c1) => {
      if (!this.quad(X - half, X + half, y0, y1)) return;
      const a = this.p(X, Math.max(y0, near)), b = this.p(X, y1);
      const grad = g.createLinearGradient(0, a[1], 0, b[1]);
      grad.addColorStop(0, c0); grad.addColorStop(1, c1);
      g.fillStyle = grad; g.fill();
    };
    if (dim) {
      wood(-80, LANE.head - 12, '#5a4632', '#3b2e22');
      wood(LANE.head - 12, LANE.deck, '#5f4a35', '#4a3a2a');
      return;
    }
    wood(-80, 0, '#e8c99a', '#d9b583');
    wood(0, LANE.head - 12, '#e2b47c', '#b9875a');
    wood(LANE.head - 12, LANE.deck, '#e9c491', '#d4a873');
    // Oil: a faint sheen down the front of the lane.
    if (this.quad(X - half, X + half, Math.max(0, near), LANE.oil)) {
      const a = this.p(X, Math.max(0, near)), b = this.p(X, LANE.oil);
      const grad = g.createLinearGradient(0, a[1], 0, b[1]);
      grad.addColorStop(0, 'rgba(255,248,230,0.16)'); grad.addColorStop(0.75, 'rgba(255,248,230,0.07)'); grad.addColorStop(1, 'rgba(255,248,230,0)');
      g.fillStyle = grad; g.fill();
    }
    // Boards.
    g.lineWidth = 1;
    for (let i = 1; i < 39; i++) {
      const x = X - half + i * BOARD;
      const a = this.p(x, Math.max(near, -80)), b = this.p(x, LANE.deck);
      if (!a || !b) continue;
      g.strokeStyle = i % 5 === 0 ? 'rgba(110,62,28,0.22)' : 'rgba(110,62,28,0.11)';
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    // Foul line.
    if (this.quad(X - half - gut, X + half + gut, 0, 0.75)) { g.fillStyle = '#20232c'; g.fill(); }
    // Approach dots, guide dots at 7 feet, arrows at 12–16 feet, and the range finders.
    g.fillStyle = 'rgba(70,40,18,0.55)';
    for (const b of [3, 5, 8, 11, 14]) for (const side of [-1, 1]) {
      this.dot(X + side * (half - (b - 0.5) * BOARD), -24, 0.45);
      this.dot(X + side * (half - (b - 0.5) * BOARD), 84, 0.38);
    }
    this.dot(X, -24, 0.45); this.dot(X, 84, 0.38);
    g.fillStyle = 'rgba(86,46,20,0.75)';
    for (const b of [5, 10, 15, 20, 25, 30, 35]) {
      const x = X + half - (b - 0.5) * BOARD;
      const y = 144 + (b <= 20 ? b : 40 - b) / 5 * 12;
      this.arrow(x, y);
    }
    g.fillStyle = 'rgba(86,46,20,0.45)';
    for (const b of [10, 30]) { const x = X + half - (b - 0.5) * BOARD; if (this.quad(x - 0.3, x + 0.3, 408, 456)) g.fill(); }
    // Pin spots.
    g.fillStyle = 'rgba(80,46,22,0.35)';
    for (const sp of SPOTS) this.dot(X + sp.x, sp.y, 1);
    // Kickbacks, the walls beside the pin deck.
    for (const side of [-1, 1]) {
      if (this.wall(X + side * (half + gut), LANE.head - 40, LANE.pit + 30, 0, 22)) {
        g.fillStyle = '#2a1f1a'; g.fill();
        g.strokeStyle = 'rgba(255,201,74,0.25)'; g.stroke();
      }
    }
  }

  dot(x, y, r) {
    const a = this.p(x, y);
    if (!a) return;
    const g = this.g;
    g.beginPath(); g.ellipse(a[0], a[1], r * a[2], r * a[2] * this.squash(y), 0, 0, Math.PI * 2); g.fill();
  }

  // How much a circle on the floor is flattened, seen from here.
  squash(y) { return Math.min(1, this.cam.h / Math.max(1, y - this.cam.y)); }

  arrow(x, y) {
    const a = this.p(x, y + 9), b = this.p(x - 0.8, y), c = this.p(x + 0.8, y);
    if (!a || !b || !c) return;
    const g = this.g;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill();
  }

  // The line the ball will start along, while a throw is being swiped.
  guide({ x, angle, hook }) {
    const g = this.g;
    const steps = 24, len = 330;
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < steps; i++) {
      const y0 = 10 + (len / steps) * i, y1 = y0 + len / steps * 0.5;
      const a = this.p(x + Math.tan(angle) * y0, y0), b = this.p(x + Math.tan(angle) * y1, y1);
      if (!a || !b) continue;
      g.strokeStyle = `rgba(255,255,255,${0.55 * (1 - i / steps)})`;
      g.lineWidth = Math.max(1, 1.2 * a[2]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    // Which way it'll hook: a short bend off the end of the line.
    if (Math.abs(hook) > 2) {
      const y0 = len + 10, x0 = x + Math.tan(angle) * y0, bend = Math.sign(hook) * Math.min(14, 3 + Math.abs(hook) * 0.18);
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, y = y0 + t * 150;
        const q = this.p(x0 + Math.tan(angle) * t * 150 + bend * t * t, y);
        if (q) pts.push(q);
      }
      if (pts.length > 2) {
        g.strokeStyle = 'rgba(255,211,107,0.9)'; g.fillStyle = 'rgba(255,211,107,0.9)';
        g.lineWidth = Math.max(1.5, pts[0][2] * 1.1);
        g.beginPath(); pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.stroke();
        const e = pts[pts.length - 1], f = pts[pts.length - 3];
        const ang = Math.atan2(e[1] - f[1], e[0] - f[0]), hs = Math.max(5, e[2] * 3.2);
        g.beginPath();
        g.moveTo(e[0] + Math.cos(ang) * hs, e[1] + Math.sin(ang) * hs);
        g.lineTo(e[0] + Math.cos(ang + 2.4) * hs, e[1] + Math.sin(ang + 2.4) * hs);
        g.lineTo(e[0] + Math.cos(ang - 2.4) * hs, e[1] + Math.sin(ang - 2.4) * hs);
        g.closePath(); g.fill();
      }
    }
    g.restore();
  }

  ball(b, colours) {
    const z = BALL_R + (b.z || 0);
    let X = b.x;
    if (b.state === 'gutter' || b.state === 'pit') X = b.x;
    const sinkZ = b.state === 'gutter' ? -1.6 : 0;
    const a = this.p(X, b.y, z + sinkZ);
    if (!a) return;
    const g = this.g, R = BALL_R * a[2];
    // Shadow.
    const sh = this.p(X + 1.2, b.y + 1.5, sinkZ);
    if (sh) {
      g.fillStyle = 'rgba(30,14,4,0.35)';
      g.beginPath(); g.ellipse(sh[0], sh[1], R * 1.05, R * 1.05 * this.squash(b.y) * 0.9, 0, 0, Math.PI * 2); g.fill();
    }
    const [hi, mid, dark] = colours;
    const grad = g.createRadialGradient(a[0] - R * 0.35, a[1] - R * 0.4, R * 0.1, a[0], a[1], R);
    grad.addColorStop(0, hi); grad.addColorStop(0.5, mid); grad.addColorStop(1, dark);
    g.fillStyle = grad;
    g.beginPath(); g.arc(a[0], a[1], R, 0, Math.PI * 2); g.fill();
    // A swirl, so you can see it roll.
    g.save(); g.beginPath(); g.arc(a[0], a[1], R, 0, Math.PI * 2); g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = R * 0.18;
    const ph = b.roll % (Math.PI * 2);
    for (let i = 0; i < 2; i++) {
      const yy = a[1] + R * Math.cos(ph + i * Math.PI);
      if (Math.sin(ph + i * Math.PI) < 0) continue;
      g.beginPath(); g.ellipse(a[0], yy, R * 0.95, R * 0.25, 0.25, 0, Math.PI * 2); g.stroke();
    }
    // Finger holes, rolling round.
    const holes = [[-0.32, 0.55], [0.32, 0.55], [0, -0.1]];
    for (const [hx, hz0] of holes) {
      const ang = Math.atan2(hz0, -0.75) - ph, rad = Math.hypot(hz0, 0.75);
      const ly = Math.cos(ang) * rad, lz = Math.sin(ang) * rad;
      if (ly > -0.15) continue;
      const vis = Math.min(1, -ly);
      g.fillStyle = `rgba(4,6,14,${0.85 * vis})`;
      g.beginPath(); g.ellipse(a[0] + hx * R, a[1] - lz * R, R * 0.11, R * 0.11 * vis, 0, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // Shine.
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(a[0] - R * 0.38, a[1] - R * 0.45, R * 0.22, R * 0.13, -0.6, 0, Math.PI * 2); g.fill();
  }

  // A pin in any state: standing (rocking), falling, lying or in the gutter.
  pin(p, s) {
    const lift = p.lift || 0;
    if (p.state === 'up') {
      const tilt = p.wob ? Math.sin(p.wobA) * p.wob * 0.22 : 0;
      this.uprightPin(p.x, p.y, lift, tilt, 1);
      return;
    }
    let bx, by, ax, ay, az, bz = 0;
    if (p.state === 'falling') {
      const f = fallen(p.ft) * Math.PI / 2;
      bx = p.x; by = p.y;
      ax = Math.cos(p.a) * Math.sin(f); ay = Math.sin(p.a) * Math.sin(f); az = Math.cos(f);
    } else {
      // Lying: its middle at (x, y), its belly on the floor, so it tilts a touch.
      const ux = Math.cos(p.a), uy = Math.sin(p.a);
      bx = p.x - ux * PIN_LEN / 2; by = p.y - uy * PIN_LEN / 2;
      ax = ux * 0.99; ay = uy * 0.99; az = -0.08; bz = 1.4;
      if (p.state === 'gutter') bz = -0.6;
    }
    this.pinAlong(bx, by, bz + lift, ax, ay, az, 1);
  }

  uprightPin(x, y, lift, tilt, alpha) {
    // The shadow first.
    const g = this.g;
    if (lift < 1) {
      const sh = this.p(x + 1.4, y + 1.2);
      if (sh) {
        g.fillStyle = `rgba(30,14,4,${0.28 * alpha})`;
        g.beginPath(); g.ellipse(sh[0], sh[1], 2.6 * sh[2], 2.6 * sh[2] * this.squash(y), 0, 0, Math.PI * 2); g.fill();
      }
    }
    this.pinAlong(x, y, lift, Math.sin(tilt), 0, Math.cos(tilt), alpha);
  }

  // Draws the pin's outline along its axis, from the base at (x, y, z) in the direction (ax, ay, az).
  pinAlong(x, y, z, ax, ay, az, alpha) {
    const pts = [];
    for (const [h, r] of PROFILE) {
      const q = this.p(x + ax * h, y + ay * h, z + az * h);
      if (!q) return;
      pts.push([q[0], q[1], r * q[2]]);
    }
    const g = this.g;
    // The axis on screen and the way across it.
    let dx = pts[pts.length - 1][0] - pts[0][0], dy = pts[pts.length - 1][1] - pts[0][1];
    let len = Math.hypot(dx, dy);
    if (len < 0.5) { dx = 0; dy = -1; len = 1; }
    const nx = -dy / len, ny = dx / len;
    const left = pts.map(([px, py, w]) => [px + nx * w, py + ny * w]);
    const right = pts.map(([px, py, w]) => [px - nx * w, py - ny * w]);
    g.save();
    g.globalAlpha = alpha;
    g.beginPath();
    g.moveTo(left[0][0], left[0][1]);
    for (const q of left) g.lineTo(q[0], q[1]);
    for (let i = right.length - 1; i >= 0; i--) g.lineTo(right[i][0], right[i][1]);
    g.closePath();
    const mid = pts[4];
    const grad = g.createLinearGradient(mid[0] + nx * mid[2], mid[1] + ny * mid[2], mid[0] - nx * mid[2], mid[1] - ny * mid[2]);
    grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.45, '#f4f1ea'); grad.addColorStop(1, '#a9a49c');
    g.fillStyle = grad;
    g.fill();
    g.strokeStyle = 'rgba(60,40,30,0.35)'; g.lineWidth = 0.6; g.stroke();
    // Two red stripes round the neck.
    g.strokeStyle = '#d8323a';
    for (const h of [10.15, 10.95]) {
      const k = PROFILE.findIndex(([ph]) => ph > h);
      const [h0, r0] = PROFILE[k - 1], [h1, r1] = PROFILE[k];
      const f = (h - h0) / (h1 - h0);
      const q = this.p(x + ax * h, y + ay * h, z + az * h);
      const w = (r0 + (r1 - r0) * f) * q[2];
      g.lineWidth = Math.max(0.8, 0.32 * q[2]);
      g.beginPath(); g.moveTo(q[0] + nx * w * 0.98, q[1] + ny * w * 0.98); g.lineTo(q[0] - nx * w * 0.98, q[1] - ny * w * 0.98); g.stroke();
    }
    g.restore();
  }

  sweepBar(sw) {
    const g = this.g, half = LANE.half + LANE.gutter - 0.5;
    const z0 = sw.z, z1 = sw.z + 9;
    const a = this.p(-half, sw.y, z0), b = this.p(half, sw.y, z0), c = this.p(half, sw.y, z1), d = this.p(-half, sw.y, z1);
    if (!a) return;
    const grad = g.createLinearGradient(0, d[1], 0, a[1]);
    grad.addColorStop(0, '#5b6274'); grad.addColorStop(1, '#2c3140');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath(); g.fill();
    g.fillStyle = '#ffc94a';
    const e = this.p(-half, sw.y, z1 - 1.5), f = this.p(half, sw.y, z1 - 1.5);
    g.fillRect(e[0], e[1], f[0] - e[0], Math.max(1, (a[1] - d[1]) * 0.12));
  }
}

function depthOf(p) {
  if (p.state === 'falling' || p.state === 'down' || p.state === 'gutter') return p.y;
  return p.y;
}

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

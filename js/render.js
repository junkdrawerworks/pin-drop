// Draws the alley in perspective from behind the ball. The camera starts at the foul line looking down the
// lane and follows the ball to the pins.
import { LANE, SPOTS, BOARD, BALL_R, PIN_LEN, fallen, path } from './physics.js';

const NEAR = 6;
const GOLD_TO = 600;   // the guide's gold arrow ends 50 feet down
// How far down the lane (inches) the guide's dotted line is lit for a ball thrown at `speed` (in/s): 4 feet at the
// slowest (170), half way to the end of the oil at 15.9 mph, and all 40 feet at the top speed (390). It grows as the
// swipe speeds up, so the speed shows before letting go.
export const litTo = speed => 48 + (LANE.oil - 48) * Math.max(0, Math.min(1, (speed - 170) / 220));
// How far down the lane (inches) the arrow on board b (counted from the right) starts: 13 feet for the two
// outside arrows, on boards 5 and 35, and a foot further for each arrow in, to 16 feet for the middle one.
const arrowY = b => 144 + (b <= 20 ? b : 40 - b) / 5 * 12;
const NEXT_LANE = 41.5 + LANE.gutter * 2 + 9;   // centre to centre, with the ball return between
// A pin's outline: height up the pin (inches) and its radius there.
const PROFILE = [[0, 1.02], [0.75, 1.41], [2.25, 1.96], [3.4, 2.25], [4.5, 2.38], [5.9, 2.28], [7.25, 1.92], [8.6, 1.4],
  [9.4, 1.02], [10, 0.9], [10.9, 0.93], [11.75, 1.05], [12.5, 1.18], [13.4, 1.26], [14.2, 1.1], [14.7, 0.78], [15, 0]];
// The stations a pin is drawn by, with the radius there from PROFILE: every half inch (every inch for the neighbours'
// pins, which are small, and every three quarters for a pin drawn slice by slice, which costs more), and close
// together over the two red stripes round the neck.
const radiusAt = h => {
  const k = Math.max(1, PROFILE.findIndex(([ph]) => ph >= h));
  const [h0, r0] = PROFILE[k - 1], [h1, r1] = PROFILE[k];
  return r0 + (r1 - r0) * (h - h0) / (h1 - h0 || 1);
};
const STRIPES = [[10, 10.3], [10.8, 11.1]];
const stationsEvery = step => {
  const hs = new Set();
  for (let h = 0; h <= 15 + 1e-9; h += step) hs.add(+h.toFixed(2));
  for (const [a, b] of STRIPES) for (let h = a; h <= b + 1e-9; h += 0.15) hs.add(+h.toFixed(2));
  return [...hs].sort((a, b) => a - b).map(h => [h, Math.max(0.05, radiusAt(h))]);
};
const STATIONS = stationsEvery(0.5), STATIONS_FAR = stationsEvery(1), STATIONS_SLICED = stationsEvery(0.75);
// The pin in pieces along its length, white and red, base to head.
const PIECES = [[0, 10, false], [10, 10.3, true], [10.3, 10.8, false], [10.8, 11.1, true], [11.1, 15, false]];
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

  // Where a callout can go without covering the sign or the pins, in px down the screen: the top and bottom of the
  // lit masking unit, and the front of the pin deck (with room for a pin that fell forward), in the close view of
  // the pins; and the front of the pin deck seen from the foul line, while the next ball is aimed.
  spots() {
    const at = (v, Y, Z) => v.hor + (v.h - Z) * v.f / (Y - v.y);
    const back = LANE.pit + 30, front = LANE.head - 24;
    return {
      signTop: at(this.pinView, back, 50), signBottom: at(this.pinView, back, 24),
      deckFront: at(this.pinView, front, 0), aimDeckFront: at(this.aimView, front, 0),
    };
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
    if (s.bumpers) this.bumpers();
    // The neighbours' pins, dimmer, the back row first so the front ones stand in front of them.
    for (const k of [-2, -1, 1, 2]) for (let i = SPOTS.length - 1; i >= 0; i--) this.uprightPin(k * NEXT_LANE + SPOTS[i].x, SPOTS[i].y, 0, 0, true);
    this.marked = s.marks || null;
    if (s.marks) this.marks(s.marks, s.ball);
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
    this.taught = null;
    if (s.lesson && s.ball) this.lesson(s.lesson, s.ball);
  }

  // A fingertip showing what to do, from the ball (see lessons in main.js): 'swipe' slides up from it, 'hook' slides
  // up with the end curling left and a small gold arrow, 'slide' drags the ball sideways (`side` says which way) with a
  // ghost of it following. Each leaves a fading trail. `u` is the seconds since it began: it presses on the ball, moves
  // from 0.35 s to 1.05 s, holds, fades by 1.6 s and goes again every 2.4 s. `still` draws it where it ends and keeps it
  // there, for Reduce Motion.
  lesson({ kind, u, still, side = 1 }, ball) {
    const g = this.g, c = this.p(ball.x, ball.y, BALL_R);
    if (!c) return;
    const R = BALL_R * c[2], L = Math.min(this.H * 0.3, 280), tip = Math.max(12, Math.min(19, this.H * 0.018));
    const at = s => (kind === 'slide' ? [c[0] + side * s * Math.min(this.W * 0.28, 5 * R), c[1]]
      : [c[0] - (kind === 'hook' ? L * 0.2 * Math.max(0, (s - 0.5) / 0.5) ** 2 : 0), c[1] - L * s]);
    const k = still ? 1.2 : u % 2.4;
    const s = smooth((k - 0.35) / 0.7), alpha = still ? 1 : Math.min(unit(k / 0.3), 1 - unit((k - 1.2) / 0.4));
    if (alpha <= 0) return;
    const end = at(s);
    this.taught = { kind, at: end, alpha };
    g.save();
    g.lineCap = 'round';
    // The trail: a dark edge under it for the light wood, then white, fading out towards where it began.
    const start = at(0);
    if (s > 0.02) {
      for (const [colour, width, a] of [['13,18,34', tip * 1.25, 0.22], ['255,255,255', tip * 0.85, 0.55]]) {
        const fade = g.createLinearGradient(start[0], start[1], end[0], end[1]);
        fade.addColorStop(0, `rgba(${colour},0)`); fade.addColorStop(1, `rgba(${colour},${alpha * a})`);
        g.strokeStyle = fade; g.lineWidth = width;
        g.beginPath(); g.moveTo(start[0], start[1]);
        for (let j = 1; j <= 24; j++) { const q = at(s * j / 24); g.lineTo(q[0], q[1]); }
        g.stroke();
      }
    }
    // The ball coming along with a slide.
    if (kind === 'slide') {
      g.fillStyle = `rgba(255,255,255,${0.14 * alpha})`; g.strokeStyle = `rgba(255,255,255,${0.7 * alpha})`;
      g.lineWidth = 2; g.setLineDash([5, 4]);
      g.beginPath(); g.arc(end[0], end[1], R, 0, Math.PI * 2); g.fill(); g.stroke();
      g.setLineDash([]);
    }
    // Which way a hook goes, once the curl is drawn.
    if (kind === 'hook' && s > 0.97) {
      const b = at(0.93), ang = Math.atan2(end[1] - b[1], end[0] - b[0]), h = tip * 1.1;
      const head = [end[0] + Math.cos(ang) * tip * 1.6, end[1] + Math.sin(ang) * tip * 1.6];
      g.fillStyle = `rgba(255,201,74,${alpha})`;
      g.beginPath();
      g.moveTo(head[0] + Math.cos(ang) * h, head[1] + Math.sin(ang) * h);
      g.lineTo(head[0] + Math.cos(ang + 2.4) * h, head[1] + Math.sin(ang + 2.4) * h);
      g.lineTo(head[0] + Math.cos(ang - 2.4) * h, head[1] + Math.sin(ang - 2.4) * h);
      g.closePath(); g.fill();
    }
    // The fingertip, with a ring that spreads as it presses on the ball.
    const press = still ? 1 : unit(k / 0.35);
    g.strokeStyle = `rgba(255,255,255,${0.45 * alpha * (still ? 1 : 1 - press * 0.6)})`; g.lineWidth = 2;
    g.beginPath(); g.arc(end[0], end[1], tip * (1.15 + 0.5 * press), 0, Math.PI * 2); g.stroke();
    g.fillStyle = `rgba(255,255,255,${0.9 * alpha})`; g.strokeStyle = `rgba(13,18,34,${0.45 * alpha})`; g.lineWidth = 1.5;
    g.beginPath(); g.arc(end[0], end[1], tip, 0, Math.PI * 2); g.fill(); g.stroke();
    g.restore();
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
      this.arrow(x, arrowY(b));
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

  // Bumpers: a padded rail along each side of the lane, over the edge of the gutter, from the foul line to the end of
  // the pin deck (where the physics has them: see BUMPER).
  bumpers() {
    const g = this.g;
    for (const side of [-1, 1]) {
      const x = side * (LANE.half + 1);
      if (this.wall(x - side, 0, LANE.deck, 0, 4.5)) { g.fillStyle = '#1d6b6b'; g.fill(); }
      if (this.quad(Math.min(x, x - side * 2), Math.max(x, x - side * 2), 0, LANE.deck, 4.5)) { g.fillStyle = '#3fd0c9'; g.fill(); }
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

  // For a player's first frame: a ring where to stand, on the line of the dots at the start of the lane, and the arrow
  // to roll over lit up gold, each with a word on a dark pill. The ring sits where the ball rests, so the ball covers
  // it once it's there (and its word goes).
  marks({ stand, target }, ball) {
    const g = this.g, gold = 'rgba(255,201,74,0.95)';
    g.save();
    // The arrow: gold and glowing, drawn over the brown one twice its size.
    const tx = LANE.half - (target - 0.5) * BOARD, ty = arrowY(target);
    const a = this.p(tx, ty + 20), b = this.p(tx - 2, ty - 2), c = this.p(tx + 2, ty - 2);
    if (a && b && c) {
      g.fillStyle = gold; g.shadowColor = 'rgba(255,170,60,1)'; g.shadowBlur = 14;
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.closePath(); g.fill();
      g.shadowBlur = 0;
      this.tag('Aim here', a[0], a[1] - 8);
    }
    // The ring, dashed, the ball's size.
    const r = this.p(stand, ball ? ball.y : 6, 0);
    if (r) {
      const R = BALL_R * r[2];
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = Math.max(1.5, R * 0.09);
      g.setLineDash([R * 0.32, R * 0.22]);
      g.beginPath(); g.ellipse(r[0], r[1] - R * 0.15, R, R * Math.max(0.35, this.squash(ball ? ball.y : 6)), 0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      if (!ball || Math.abs(ball.x - stand) > 1.5) this.tag('Stand here', r[0], r[1] - R * 1.25);
    }
    g.restore();
  }

  // A few words on a dark pill, centred over (x, bottom).
  tag(text, x, bottom) {
    const g = this.g, size = Math.round(Math.max(12, Math.min(15, this.H * 0.017)));
    g.font = `700 ${size}px Figtree, system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + size * 1.3, h = size * 1.75;
    const x0 = Math.max(4, Math.min(this.W - 4 - w, x - w / 2)), y0 = bottom - h;
    g.fillStyle = 'rgba(13,18,34,0.78)';
    g.beginPath(); g.roundRect(x0, y0, w, h, h / 2); g.fill();
    g.fillStyle = '#f6eedc';
    g.fillText(text, x0 + w / 2, y0 + h / 2 + 0.5);
  }

  // While a throw is being swiped: the way the ball will go, worked out with the real physics less the lane's small
  // wander (see path in physics.js). A dotted line runs to the end of the oil, 40 feet down, lit as far as the swipe's
  // speed reaches (from 4 feet at the slowest to all 40 at the top speed), faint beyond. Then, for a ball with any
  // hook, a gold arrow bends the way it really will on the dry back end, as far as 50 feet: the last ten feet to the
  // pins are left to the player.
  guide(shot) {
    const key = `${shot.x},${shot.speed},${shot.angle},${shot.hook}`;
    if (this.guideKey !== key) { this.guideKey = key; this.guidePts = path(shot, GOLD_TO); }
    const pts = this.guidePts, g = this.g;
    // Where the path is `y` inches down (null past where it ends).
    const at = y => {
      let i = 1;
      while (i < pts.length && pts[i].y < y) i++;
      if (i >= pts.length) return null;
      const a = pts[i - 1], b = pts[i], u = (y - a.y) / (b.y - a.y || 1);
      return a.x + (b.x - a.x) * u;
    };
    const end = pts[pts.length - 1].y;
    const lit = litTo(shot.speed);
    const steps = 32, from = 10, len = LANE.oil - from;
    g.save();
    g.lineCap = 'round';
    for (let i = 0; i < steps; i++) {
      const y0 = from + (len / steps) * i, y1 = Math.min(end, y0 + len / steps * 0.5);
      if (y0 >= end) break;
      const a = this.p(at(y0), y0), b = this.p(at(y1) ?? at(y0), y1);
      if (!a || !b) continue;
      g.strokeStyle = y0 < lit ? `rgba(255,255,255,${0.62 - 0.27 * i / steps})` : 'rgba(255,255,255,0.16)';
      g.lineWidth = Math.max(1, 1.2 * a[2]);
      g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
    }
    // Which way it'll hook, and how far, for any hook at all (as the readout says): gold, from the end of the oil.
    if (shot.hook && end > LANE.oil + 6) {
      const q = [];
      for (let y = LANE.oil; ; y = Math.min(end, y + 6)) {
        const r = this.p(at(y) ?? pts[pts.length - 1].x, y);
        if (r) q.push(r);
        if (y >= end) break;
      }
      if (q.length > 2) {
        g.strokeStyle = 'rgba(255,211,107,0.9)'; g.fillStyle = 'rgba(255,211,107,0.9)';
        g.lineWidth = Math.max(2, q[0][2] * 1.3);
        g.beginPath(); q.forEach((r, i) => (i ? g.lineTo(r[0], r[1]) : g.moveTo(r[0], r[1]))); g.stroke();
        const e = q[q.length - 1], f = q[q.length - 3];
        const ang = Math.atan2(e[1] - f[1], e[0] - f[0]), hs = Math.max(6.5, e[2] * 3.2);
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
      this.uprightPin(p.x, p.y, lift, tilt, false);
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
    this.pinAlong(bx, by, bz + lift, ax, ay, az, false);
  }

  uprightPin(x, y, lift, tilt, dim) {
    // The shadow first.
    const g = this.g;
    if (lift < 1) {
      const sh = this.p(x + 1.4, y + 1.2);
      if (sh) {
        g.fillStyle = `rgba(30,14,4,${dim ? 0.15 : 0.28})`;
        g.beginPath(); g.ellipse(sh[0], sh[1], 2.6 * sh[2], 2.6 * sh[2] * this.squash(y), 0, 0, Math.PI * 2); g.fill();
      }
    }
    this.pinAlong(x, y, lift, Math.sin(tilt), 0, Math.cos(tilt), dim);
  }

  // Draws a pin as the solid it is, from the base at (x, y, z) along the direction (ax, ay, az): at each station up
  // the pin, the round slice of it there, so it has the right outline from any side, end-on included; and the strip
  // through the slices' edges (as seen side-on, where the slices are thin), so the outline is unbroken. The pieces go
  // from the end farther from the eye to the nearer one, so the nearer end and the red stripes show the way they would.
  pinAlong(x, y, z, ax, ay, az, dim) {
    const c = this.cam, g = this.g;
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; ay /= al; az /= al;
    // Two ways across the pin, square to its length.
    const [hx, hy, hz] = Math.abs(az) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let e1x = ay * hz - az * hy, e1y = az * hx - ax * hz, e1z = ax * hy - ay * hx;
    const el = Math.hypot(e1x, e1y, e1z); e1x /= el; e1y /= el; e1z /= el;
    const e2x = ay * e1z - az * e1y, e2y = az * e1x - ax * e1z, e2z = ax * e1y - ay * e1x;
    const sides = dim ? 10 : 16;
    const at = h => this.p(x + ax * h, y + ay * h, z + az * h);
    const ends = [at(0), at(PIN_LEN)];
    if (!ends[0] || !ends[1]) return;
    // The strip: each station's centre pushed out either side, square to the pin's line on screen.
    let dx = ends[1][0] - ends[0][0], dy = ends[1][1] - ends[0][1], len = Math.hypot(dx, dy);
    if (len < 0.5) { dx = 0; dy = -1; len = 1; }
    const nx = -dy / len, ny = dx / len;
    // Seen side-on, as an upright pin nearly always is, the strip alone is the outline: the slices are only worth
    // their cost when the pin points towards or away from the eye.
    const midQ = at(PIN_LEN / 2);
    const slices = !!midQ && len < 0.9 * PIN_LEN * midQ[2];
    const stations = dim ? STATIONS_FAR : slices ? STATIONS_SLICED : STATIONS;
    const pts = [];
    for (const [h, r] of stations) {
      const q = at(h);
      if (!q) return;
      if (!slices) {
        const w = r * q[2];
        pts.push({ h, q, w, L: [q[0] + nx * w, q[1] + ny * w], R: [q[0] - nx * w, q[1] - ny * w], ring: null });
        continue;
      }
      const ring = [];
      for (let i = 0; i < sides; i++) {
        const t = i / sides * Math.PI * 2, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
        const v = this.p(x + ax * h + e1x * cs + e2x * sn, y + ay * h + e1y * cs + e2y * sn, z + az * h + e1z * cs + e2z * sn);
        if (!v) return;
        ring.push(v);
      }
      // The strip's edges there: the points of the slice that reach farthest either side of the pin's line on screen.
      let L = ring[0], R = ring[0], lo = Infinity, hi = -Infinity;
      for (const v of ring) {
        const d = (v[0] - q[0]) * nx + (v[1] - q[1]) * ny;
        if (d > hi) { hi = d; L = v; }
        if (d < lo) { lo = d; R = v; }
      }
      pts.push({ h, q, w: (hi - lo) / 2, L, R, ring });
    }
    // Fills the pin from h0 to h1: the slices, then the strip. (Apart, as one path they can wind opposite ways and
    // leave slivers unfilled.)
    const piece = (h0, h1) => {
      const sel = pts.filter(o => o.h >= h0 && o.h <= h1);
      if (slices) {
        g.beginPath();
        for (const o of sel) {
          g.moveTo(o.ring[0][0], o.ring[0][1]);
          for (let i = 1; i < o.ring.length; i++) g.lineTo(o.ring[i][0], o.ring[i][1]);
          g.closePath();
        }
        g.fill();
      }
      g.beginPath();
      g.moveTo(sel[0].L[0], sel[0].L[1]);
      for (const o of sel) g.lineTo(o.L[0], o.L[1]);
      for (let i = sel.length - 1; i >= 0; i--) g.lineTo(sel[i].R[0], sel[i].R[1]);
      g.closePath();
      g.fill();
    };
    // White across the pin, shaded from the light side to the dark.
    const mid = pts.find(o => o.h >= 4.5);
    const grad = g.createLinearGradient(mid.q[0] + nx * mid.w, mid.q[1] + ny * mid.w, mid.q[0] - nx * mid.w, mid.q[1] - ny * mid.w);
    if (dim) { grad.addColorStop(0, '#9a968f'); grad.addColorStop(1, '#6e6a64'); }
    else { grad.addColorStop(0, '#ffffff'); grad.addColorStop(0.45, '#f4f1ea'); grad.addColorStop(1, '#a9a49c'); }
    const red = dim ? '#7d3236' : '#d8323a';
    // A soft dark edge round the whole of it (a shadow cast by the whole shape, the inside then painted over), then
    // the pieces over it.
    if (slices) {
      g.save();
      g.shadowColor = 'rgba(60,40,30,0.75)'; g.shadowBlur = 1.6 * this.dpr;
      g.fillStyle = grad;
      piece(0, PIN_LEN);
      g.restore();
    } else {
      // Side-on, a thin line round the strip does it.
      g.beginPath();
      g.moveTo(pts[0].L[0], pts[0].L[1]);
      for (const o of pts) g.lineTo(o.L[0], o.L[1]);
      for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i].R[0], pts[i].R[1]);
      g.closePath();
      g.strokeStyle = dim ? 'rgba(20,14,12,0.45)' : 'rgba(60,40,30,0.35)'; g.lineWidth = dim ? 0.6 : 1.2; g.stroke();
    }
    const eye = h => (x + ax * h - c.x) ** 2 + (y + ay * h - c.y) ** 2 + (z + az * h - c.h) ** 2;
    const order = PIECES.slice();
    if (eye(0) < eye(PIN_LEN)) order.reverse();   // the base is nearer: the head end first
    for (const [h0, h1, stripe] of order) {
      g.fillStyle = stripe ? red : grad;
      piece(h0, h1);
    }
    // The flat base, when it's the end nearer the eye.
    if (slices && eye(0) < eye(PIN_LEN)) {
      const ring = pts[0].ring;
      g.beginPath(); g.moveTo(ring[0][0], ring[0][1]);
      for (const v of ring) g.lineTo(v[0], v[1]);
      g.closePath();
      g.fillStyle = dim ? '#85817b' : '#e4dfd6'; g.fill();
      g.strokeStyle = 'rgba(60,40,30,0.4)'; g.lineWidth = 0.8; g.stroke();
    }
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

// How far down the lane a pin is, for drawing near things over far ones: a pin falling or lying goes by its nearer
// end, so one falling towards the camera is drawn over what stands between its base and its head.
function depthOf(p) {
  if (p.state === 'falling') return Math.min(p.y, p.y + Math.sin(p.a) * Math.sin(fallen(p.ft) * Math.PI / 2) * PIN_LEN);
  if (p.state === 'down' || p.state === 'gutter') return p.y - Math.abs(Math.sin(p.a)) * PIN_LEN / 2;
  return p.y;
}

const unit = v => Math.max(0, Math.min(1, v));
const smooth = v => { v = unit(v); return v * v * (3 - 2 * v); };

function star(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath(); g.fill();
}

// The alley screen: a little monitor that drops in over the pins after a strike, a spare, a split, a gutter ball or a
// miss, and plays a cartoon of it for two or three seconds, the way the overhead screens at old alleys did. Everything
// is drawn here with code: the pins and the ball with faces, a turkey, fireworks, a canyon. Each event has a few gags,
// picked at random but never the same one twice running.
// The cartoon plays in the time the game already waits after a ball (the pins settling and the pinsetter's sweep), and
// main.js moves it on with the game's own clock, so it never makes the game wait; a tap ends it.
import { callFor } from './scoring.js';

// ---- What a ball calls for ------------------------------------------------------------------------------------

// The event for a ball's callout (see callFor in scoring.js): its big words, and the pins it left. Null for an ordinary
// count, which gets no cartoon. `n` is how many strikes in a row.
export function eventFor(big, left = []) {
  if (big === 'Perfect!') return { event: 'perfect', n: 12 };
  if (big === 'Strike!') return { event: 'strike', n: 1 };
  if (big === 'Double!') return { event: 'double', n: 2 };
  if (big === 'Turkey!') return { event: 'turkey', n: 3 };
  const run = /^(\d+) in a row!$/.exec(big);
  if (run) return { event: 'run', n: +run[1] };
  if (big === 'Picked up!') return { event: 'pickup' };
  if (big === 'Spare!') return { event: 'spare' };
  if (big === 'Split') return { event: left.length === 2 && left.includes(7) && left.includes(10) ? 'split710' : 'split' };
  if (big === 'Gutter ball') return { event: 'gutter' };
  if (big === 'Missed') return { event: 'whiff' };
  return null;
}

// The same from a player's balls before this one, the pins it knocked down and the pins it left (as for callFor).
export function toonFor(before, knocked, left, opts = {}) {
  return eventFor(callFor(before, knocked, left, opts)[0], left);
}

// A gag for an event, at random, but not `last` (the one this event played last time) when there's another.
export function pick(event, last = null, rand = Math.random) {
  const ids = Object.keys(GAGS).filter(id => GAGS[id].event === event);
  const pool = ids.length > 1 ? ids.filter(id => id !== last) : ids;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))] ?? null;
}

// ---- Where the screen goes ------------------------------------------------------------------------------------

// The monitor's size and place in `area` ({ top, bottom, width }, px: the room between the scorecard and the tops of
// the pins), with the callout's words (`words` px high, the big line `big` px of it) sitting across its bottom edge.
// Null when there's no room for one worth looking at (a phone on its side).
export const ASPECT = 1.3;   // the case, width to height
export function fit(area, words = 0, big = 0) {
  const lift = big * 0.62;                  // how far the words reach up over the screen's bottom edge
  const room = area.bottom - area.top - Math.max(0, words - lift);
  const w0 = Math.min(area.width - 24, 520);
  const h = Math.min(room, w0 / ASPECT);
  if (h < 120) return null;
  const w = h * ASPECT;
  const top = area.top + Math.max(0, room - h) * 0.4;
  return { x: (area.width - w) / 2, y: top, w, h, wordsTop: top + h - lift };
}

// ---- The look -------------------------------------------------------------------------------------------------

// The cartoons are drawn on a 320 x 240 picture, low enough that its pixels show a little, with a limited palette.
export const W = 320, H = 240;
const C = {
  ink: '#1c1233', night: '#1d1f4f', deep: '#14143a', sky: '#2c3d94', blue: '#3b63d6', purple: '#6a3fb5', violet: '#8c5ad6',
  teal: '#3fd0c9', mint: '#9ff0e0', gold: '#ffc94a', sun: '#ffe08a', orange: '#ff8a3d', coral: '#ff6a55', red: '#e2384d',
  pink: '#ff9fb8', cream: '#fff4dc', white: '#ffffff', grey: '#c9c3d9', brown: '#9a5e3a', dbrown: '#5e3826',
  green: '#4fbf6a', dgreen: '#2f7f4f', wood: '#e9bb7d', wood2: '#c98e52', rock: '#b8613f', rock2: '#7e3b2e', ballc: '#3a4fd0',
};

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const seg = (t, a, b) => clamp((t - a) / (b - a));
const sm = u => u * u * (3 - 2 * u);
const eo = u => 1 - (1 - clamp(u)) ** 3;
const ei = u => clamp(u) ** 3;
const lerp = (a, b, u) => a + (b - a) * u;
const hop = u => Math.sin(Math.PI * clamp(u));
const back = u => { u = clamp(u); const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };
const bounce = u => {
  u = clamp(u);
  if (u < 1 / 2.75) return 7.5625 * u * u;
  if (u < 2 / 2.75) return 7.5625 * (u -= 1.5 / 2.75) * u + 0.75;
  if (u < 2.5 / 2.75) return 7.5625 * (u -= 2.25 / 2.75) * u + 0.9375;
  return 7.5625 * (u -= 2.625 / 2.75) * u + 0.984375;
};
const rnd = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const DEG = Math.PI / 180;

// Fills and outlines the current path.
function inked(g, fill, lw = 2) {
  if (fill) { g.fillStyle = fill; g.fill(); }
  if (lw) { g.lineWidth = lw; g.strokeStyle = C.ink; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
}
function ellipse(g, x, y, rx, ry, fill, lw = 2, rot = 0) {
  g.beginPath(); g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, Math.PI * 2); inked(g, fill, lw);
}
function line(g, pts, lw = 2, color = C.ink) {
  g.beginPath(); g.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.lineWidth = lw; g.strokeStyle = color; g.lineCap = 'round'; g.lineJoin = 'round'; g.stroke();
}
// Words in the cartoon's own lettering, outlined in ink.
function words(g, text, x, y, size, fill = C.gold, rot = 0, alpha = 1) {
  if (alpha <= 0) return;
  g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha *= clamp(alpha);
  g.font = `${size}px Shrikhand, Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = Math.max(1.6, size * (size < 20 ? 0.15 : 0.24)); g.strokeStyle = C.ink; g.strokeText(text, 0, 0);
  g.fillStyle = fill; g.fillText(text, 0, 0);
  g.restore();
}

// ---- Backgrounds ----------------------------------------------------------------------------------------------

// Bands of colour top to bottom, the way an old screen shows a sky.
function bands(g, cols, y0 = 0, y1 = H) {
  const h = (y1 - y0) / cols.length;
  cols.forEach((c, i) => { g.fillStyle = c; g.fillRect(0, y0 + i * h, W, h + 0.5); });
}
// Rays turning round a point.
function sunburst(g, cx, cy, rot, a, b, n = 16) {
  g.fillStyle = a; g.fillRect(0, 0, W, H);
  g.fillStyle = b;
  for (let i = 0; i < n; i++) {
    const a0 = rot + i * 2 * Math.PI / n, a1 = a0 + Math.PI / n;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a0) * 500, cy + Math.sin(a0) * 500); g.lineTo(cx + Math.cos(a1) * 500, cy + Math.sin(a1) * 500); g.fill();
  }
}
// A floor seen from a little above, its boards running away from us.
function boards(g, y, top = C.wood, lines = C.wood2) {
  g.fillStyle = top; g.fillRect(0, y, W, H - y);
  g.strokeStyle = lines; g.lineWidth = 1.5;
  for (let i = -8; i <= 8; i++) { g.beginPath(); g.moveTo(W / 2 + i * 14, y); g.lineTo(W / 2 + i * 48, H); g.stroke(); }
  line(g, [0, y, W, y], 2.5);
}
function twinkles(g, t, n = 18, color = C.mint, y1 = H * 0.6) {
  g.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const x = rnd(i) * W, y = rnd(i + 50) * y1, s = 1 + (Math.sin(t * 5 + i * 2.1) > 0.3 ? 1 : 0);
    g.fillRect(Math.round(x), Math.round(y), s, s);
  }
}
// A row of little pins in the stands, standing up one after another for the wave. `wave` is where the wave is (0 to 1
// across), or null.
function crowd(g, y, h, t, wave, { faces = true, n = 11, x0 = 10, x1 = W - 10, offset = 0 } = {}) {
  for (let i = 0; i < n; i++) {
    const x = lerp(x0, x1, n === 1 ? 0.5 : i / (n - 1)) + offset;
    const near = wave === null ? 0 : Math.max(0, 1 - Math.abs(x / W - wave) * 6);
    const up = sm(near) * h * 0.45;
    pin(g, x, y - up, { h, face: near > 0.4 ? 'cheer' : 'happy', arms: near > 0.3 ? [70, 70] : [-50, -50], plain: !faces, sway: Math.sin(t * 6 + i) * 0.04 });
  }
}

// ---- The cast -------------------------------------------------------------------------------------------------

// A pin, 54 high, standing on (0, 0).
function pinPath(g) {
  g.beginPath();
  g.moveTo(-6.5, 0);
  g.bezierCurveTo(-11, -4, -12.8, -12, -11.2, -20);
  g.bezierCurveTo(-9.6, -27.5, -5, -29, -4.9, -34);
  g.bezierCurveTo(-4.7, -37.5, -8, -39, -8, -45.5);
  g.bezierCurveTo(-8, -51.5, -4.2, -54, 0, -54);
  g.bezierCurveTo(4.2, -54, 8, -51.5, 8, -45.5);
  g.bezierCurveTo(8, -39, 4.7, -37.5, 4.9, -34);
  g.bezierCurveTo(5, -29, 9.6, -27.5, 11.2, -20);
  g.bezierCurveTo(12.8, -12, 11, -4, 6.5, 0);
  g.closePath();
}

// A pin with a face, standing on (x, y) (its feet, with legs). o: h (its height), rot (radians, tipping about its base),
// spin (radians, turning about its middle), face, look ([dx, dy], where its eyes look), arms ([left, right], degrees up
// from level, or null for none), legs (a stride phase in radians, or null for none), kick (a leg's kick, -1 to 1), squash,
// sweat, blush, alpha, plain (no face), sway, flag (a white flag in its right hand), glasses.
function pin(g, x, y, o = {}) {
  const s = (o.h || 54) / 54;
  g.save();
  g.translate(x, y);
  if (o.alpha !== undefined) g.globalAlpha *= clamp(o.alpha);
  g.scale(s * (o.flip ? -1 : 1), s);
  g.rotate((o.rot || 0) + (o.sway || 0));
  if (o.spin) { g.translate(0, -30); g.rotate(o.spin); g.translate(0, 30); }
  if (o.squash) g.scale(1 + o.squash * 0.6, 1 - o.squash);
  if (o.turn !== undefined) g.scale(Math.sign(o.turn) * Math.max(0.08, Math.abs(o.turn)), 1);
  const lw = Math.max(1.6, 2.4 / Math.sqrt(s));
  if (o.legs != null) {
    // Little legs, and the pin stands on them.
    const sw = Math.sin(o.legs) * 0.7, kick = o.kick || 0;
    for (const [side, a] of [[-1, sw + (kick < 0 ? kick : 0)], [1, -sw + (kick > 0 ? kick : 0)]]) {
      const fx = side * 3.5 + Math.sin(a) * 9, fy = -Math.cos(a) * 9 + 9;
      line(g, [side * 3.5, -9, fx, fy - 0.5], lw * 1.3);
      ellipse(g, fx + 2, fy, 4.2, 2.4, C.ink, 0);
    }
    g.translate(0, -9);
  }
  const arms = o.arms;
  const drawArms = () => {
    for (const side of [-1, 1]) {
      const a = (side < 0 ? arms[0] : arms[1]) * DEG, sx = side * 9.6, sy = -22, len = 14 * (Array.isArray(o.reach) ? o.reach[side < 0 ? 0 : 1] : side > 0 && o.reach ? o.reach : 1);
      const ex = sx + side * Math.cos(a) * len, ey = sy - Math.sin(a) * len;
      const mx = (sx + ex) / 2 + side * 2, my = (sy + ey) / 2 + 2;
      g.beginPath(); g.moveTo(sx, sy); g.quadraticCurveTo(mx, my, ex, ey);
      g.lineWidth = lw * 1.25; g.strokeStyle = C.ink; g.lineCap = 'round'; g.stroke();
      if (o.flag && side > 0) flag(g, ex, ey, o.flag);
      ellipse(g, ex, ey, 3, 3, C.white, lw * 0.7);
    }
  };
  if (arms && !o.front) drawArms();
  pinPath(g);
  inked(g, C.cream, 0);
  // A shadow down its right side and the two red stripes round its neck, kept inside its outline.
  g.save(); pinPath(g); g.clip();
  g.fillStyle = C.grey; g.beginPath(); g.ellipse(9, -22, 6, 26, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = C.red; g.fillRect(-12, -36.4, 24, 1.8); g.fillRect(-12, -33.2, 24, 1.8);
  g.restore();
  pinPath(g); inked(g, null, lw);
  if (!o.plain && !(o.turn < 0.15)) face(g, 0, -45.5, o.face || 'happy', o.look || [0, 0], lw, o);
  if (o.glasses) glasses(g, 0, -46.5, lw);
  if (arms && o.front) drawArms();
  g.restore();
}

function flag(g, x, y, u) {
  line(g, [x, y + 6, x, y - 18], 1.6);
  const wv = Math.sin(u * 9) * 2;
  g.beginPath(); g.moveTo(x, y - 18); g.quadraticCurveTo(x + 7, y - 21 + wv, x + 14, y - 18); g.lineTo(x + 14, y - 10); g.quadraticCurveTo(x + 7, y - 13 - wv, x, y - 10); g.closePath();
  inked(g, C.white, 1.4);
}

function glasses(g, x, y, lw) {
  g.fillStyle = C.ink;
  g.beginPath(); g.roundRect(x - 8, y - 2.6, 7, 5, 2); g.roundRect(x + 1, y - 2.6, 7, 5, 2); g.fill();
  line(g, [x - 1, y - 1.5, x + 1, y - 1.5], lw * 0.7);
  g.fillStyle = C.white; g.fillRect(x - 6.5, y - 1.6, 2, 1.2); g.fillRect(x + 2.5, y - 1.6, 2, 1.2);
}

// A face: two eyes and a mouth round (cx, cy), and brows for some.
const FACES = {
  happy: ['eye', 'smile'], cheer: ['happy', 'grin'], scared: ['wide', 'wobble', 'worried'], shock: ['wide', 'o', 'up'],
  dizzy: ['x', 'wobble'], sad: ['eye', 'frown', 'worried'], laugh: ['happy', 'grin'], sleep: ['shut', 'small'],
  smug: ['lid', 'smile', 'up1'], nervous: ['eye', 'wobble', 'worried'], strain: ['squeeze', 'teeth', 'angry'],
  wince: ['squeeze', 'wobble'], gulp: ['wide', 'flat', 'worried'], swoon: ['shut', 'o', 'worried'], wink: ['wink', 'grin'],
  peek: ['eye', 'flat'], ow: ['squeeze', 'o', 'worried'], proud: ['happy', 'smile'], blank: ['dot', 'flat'], yell: ['eye', 'big', 'up'],
};
function face(g, cx, cy, kind, look, lw, o = {}) {
  const [eye, mouth, brow] = FACES[kind] || FACES.happy;
  const ew = lw * 0.62;
  for (const side of [-1, 1]) {
    const x = cx + side * 3.4, y = cy;
    if (eye === 'eye' || eye === 'wide' || eye === 'lid' || (eye === 'wink' && side < 0) || eye === 'dot') {
      const big = eye === 'wide' ? 1.3 : 1;
      if (eye === 'dot') { ellipse(g, x + look[0] * 0.8, y, 1.2, 1.5, C.ink, 0); continue; }
      ellipse(g, x, y, 2.9 * big, 3.5 * big, C.white, ew);
      const pr = eye === 'wide' ? 1.05 : 1.45;
      ellipse(g, x + look[0] * 1.3, y + look[1] * 1.4 + (eye === 'lid' ? 0.8 : 0), pr, pr, C.ink, 0);
      if (eye === 'lid') { g.fillStyle = C.cream; g.fillRect(x - 3.2, y - 4, 6.4, 3.4); line(g, [x - 3, y - 0.8, x + 3, y - 0.8], ew); }
    } else if (eye === 'happy' || (eye === 'wink' && side > 0)) {
      line(g, [x - 2.4, y + 0.8, x, y - 1.6, x + 2.4, y + 0.8], ew * 1.4);
    } else if (eye === 'shut') {
      g.beginPath(); g.arc(x, y - 0.6, 2.4, 0.15 * Math.PI, 0.85 * Math.PI); g.lineWidth = ew * 1.4; g.strokeStyle = C.ink; g.stroke();
    } else if (eye === 'x') {
      line(g, [x - 2, y - 2, x + 2, y + 2], ew * 1.4); line(g, [x - 2, y + 2, x + 2, y - 2], ew * 1.4);
    } else if (eye === 'squeeze') {
      line(g, [x - side * 2.4, y - 2, x + side * 1.6, y, x - side * 2.4, y + 2], ew * 1.4);
    }
  }
  const my = cy + 5.6;
  if (mouth === 'smile') { g.beginPath(); g.arc(cx, my - 2.4, 3, 0.2 * Math.PI, 0.8 * Math.PI); g.lineWidth = ew * 1.3; g.strokeStyle = C.ink; g.stroke(); }
  else if (mouth === 'grin') {
    g.beginPath(); g.moveTo(cx - 3.6, my - 1); g.quadraticCurveTo(cx, my + 4.8, cx + 3.6, my - 1); g.closePath(); inked(g, C.ink, ew);
    ellipse(g, cx, my + 1.6, 1.6, 0.9, C.coral, 0);
  } else if (mouth === 'o' || mouth === 'small') { const r = mouth === 'o' ? 1.6 : 1; ellipse(g, cx, my, r, r * 1.25, C.ink, 0); }
  else if (mouth === 'big') { ellipse(g, cx, my + 0.5, 2.6, 2.4, C.ink, 0); ellipse(g, cx, my + 1.6, 1.4, 0.8, C.coral, 0); }
  else if (mouth === 'frown') { g.beginPath(); g.arc(cx, my + 2.6, 2.6, 1.2 * Math.PI, 1.8 * Math.PI); g.lineWidth = ew * 1.3; g.strokeStyle = C.ink; g.stroke(); }
  else if (mouth === 'flat') line(g, [cx - 2, my, cx + 2, my], ew * 1.3);
  else if (mouth === 'wobble') line(g, [cx - 3, my, cx - 1.5, my - 1, cx, my, cx + 1.5, my - 1, cx + 3, my], ew * 1.1);
  else if (mouth === 'teeth') { g.beginPath(); g.rect(cx - 3.2, my - 1.4, 6.4, 2.8); inked(g, C.white, ew); line(g, [cx, my - 1.4, cx, my + 1.4], ew * 0.7); }
  if (brow === 'worried') for (const side of [-1, 1]) line(g, [cx + side * 1.4, cy - 5.6, cx + side * 4.6, cy - 4.4], ew * 1.2);
  if (brow === 'angry') for (const side of [-1, 1]) line(g, [cx + side * 1.4, cy - 4.4, cx + side * 4.6, cy - 5.8], ew * 1.2);
  if (brow === 'up') for (const side of [-1, 1]) line(g, [cx + side * 1.6, cy - 6.6, cx + side * 4.6, cy - 6.8], ew * 1.2);
  if (brow === 'up1') line(g, [cx + 1.6, cy - 6.4, cx + 4.8, cy - 7.2], ew * 1.2);
  if (o.blush) { g.fillStyle = 'rgba(255,110,140,0.55)'; for (const side of [-1, 1]) { g.beginPath(); g.ellipse(cx + side * 5.4, cy + 4.2, 1.8, 1.1, 0, 0, Math.PI * 2); g.fill(); } }
  if (o.sweat) drop(g, cx + 8.5, cy - 3 + (o.sweat % 1) * 4, 1);
}

// A drop of sweat.
function drop(g, x, y, s = 1) {
  g.beginPath(); g.moveTo(x, y - 3.2 * s); g.quadraticCurveTo(x + 2.6 * s, y + 0.4 * s, x, y + 1.6 * s); g.quadraticCurveTo(x - 2.6 * s, y + 0.4 * s, x, y - 3.2 * s);
  inked(g, C.mint, 1);
}

// The ball, with eyes looking out of its finger holes and its thumb hole for a mouth. o: rot (radians, its face turning
// as it rolls), face, look, brow, blush, sweat, color, squash, glasses, cape (a flutter phase), mask, hat (a party hat's
// colour), arms ([left, right] degrees up, or null).
function ball(g, x, y, r, o = {}) {
  g.save();
  g.translate(x, y);
  if (o.alpha !== undefined) g.globalAlpha *= clamp(o.alpha);
  if (o.squash) g.scale(1 + o.squash * 0.5, 1 - o.squash);
  const lw = Math.max(1.6, r * 0.11);
  if (o.cape !== undefined) cape(g, r, o.cape, lw);
  if (o.arms) {
    for (const side of [-1, 1]) {
      const a = (side < 0 ? o.arms[0] : o.arms[1]) * DEG, sx = side * r * 0.9, sy = r * 0.1;
      const ex = sx + side * Math.cos(a) * r * 0.75, ey = sy - Math.sin(a) * r * 0.75;
      line(g, [sx, sy, ex, ey], lw * 1.3);
      ellipse(g, ex, ey, r * 0.17, r * 0.17, C.white, lw * 0.7);
    }
  }
  ellipse(g, 0, 0, r, r, o.color || C.ballc, 0);
  // A darker crescent down its lower right, and a shine top left.
  g.save(); g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(20,10,60,0.35)'; g.beginPath(); g.arc(-r * 0.25, -r * 0.25, r * 1.05, 0, Math.PI * 2); g.arc(0, 0, r * 1.2, 0, Math.PI * 2, true); g.fill('evenodd');
  g.restore();
  ellipse(g, 0, 0, r, r, null, lw);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(-r * 0.45, -r * 0.5, r * 0.22, r * 0.12, -0.7, 0, Math.PI * 2); g.fill();
  g.save(); g.rotate(o.rot || 0);
  const kind = o.face || 'happy', look = o.look || [0, 0];
  const wide = kind === 'shock' || kind === 'scared' || kind === 'gulp';
  for (const side of [-1, 1]) {
    const hx = side * r * 0.3, hy = -r * 0.16, hr = r * (wide ? 0.2 : 0.17);
    ellipse(g, hx, hy, hr, hr * 1.15, C.deep, 0);
    if (kind === 'happy2' || kind === 'laugh') { line(g, [hx - hr * 0.6, hy + hr * 0.3, hx, hy - hr * 0.4, hx + hr * 0.6, hy + hr * 0.3], lw * 0.9, C.white); continue; }
    if (kind === 'shut') { line(g, [hx - hr * 0.6, hy, hx + hr * 0.6, hy], lw * 0.9, C.white); continue; }
    ellipse(g, hx + look[0] * hr * 0.25, hy + look[1] * hr * 0.25, hr * 0.72, hr * 0.85, C.white, 0);
    ellipse(g, hx + look[0] * hr * 0.45, hy + look[1] * hr * 0.45, hr * (wide ? 0.3 : 0.4), hr * (wide ? 0.3 : 0.45), C.ink, 0);
  }
  const my = r * 0.36;
  g.fillStyle = C.deep;
  if (kind === 'shock' || kind === 'gulp') ellipse(g, 0, my, r * 0.11, r * 0.14, C.deep, 0);
  else if (kind === 'laugh' || kind === 'grin') { g.beginPath(); g.moveTo(-r * 0.24, my - r * 0.05); g.quadraticCurveTo(0, my + r * 0.3, r * 0.24, my - r * 0.05); g.closePath(); g.fill(); }
  else if (kind === 'sheepish') { line(g, [-r * 0.18, my + r * 0.02, -r * 0.06, my - r * 0.04, r * 0.06, my + r * 0.02, r * 0.18, my - r * 0.04], lw * 1.1, C.deep); }
  else if (kind === 'sad') { g.beginPath(); g.arc(0, my + r * 0.16, r * 0.16, 1.2 * Math.PI, 1.8 * Math.PI); g.lineWidth = lw * 1.2; g.strokeStyle = C.deep; g.stroke(); }
  else if (kind === 'flat') line(g, [-r * 0.12, my, r * 0.12, my], lw * 1.2, C.deep);
  else { g.beginPath(); g.arc(0, my - r * 0.12, r * 0.2, 0.2 * Math.PI, 0.8 * Math.PI); g.lineWidth = lw * 1.3; g.strokeStyle = C.deep; g.stroke(); }
  const brow = o.brow || (kind === 'sheepish' || kind === 'sad' ? 'worried' : kind === 'shock' ? 'up' : kind === 'determined' ? 'angry' : null);
  for (const side of [-1, 1]) {
    const hx = side * r * 0.3, by = -r * 0.42;
    if (brow === 'worried') line(g, [hx - side * r * 0.12, by - r * 0.04, hx + side * r * 0.12, by + r * 0.04], lw * 1.1, C.deep);
    if (brow === 'angry') line(g, [hx - side * r * 0.12, by + r * 0.05, hx + side * r * 0.14, by - r * 0.04], lw * 1.1, C.deep);
    if (brow === 'up') line(g, [hx - r * 0.12, by - r * 0.08, hx + r * 0.12, by - r * 0.08], lw * 1.1, C.deep);
  }
  if (o.mask) {
    g.fillStyle = C.red; g.beginPath(); g.roundRect(-r * 0.62, -r * 0.34, r * 1.24, r * 0.34, r * 0.15); g.fill();
    for (const side of [-1, 1]) { const hx = side * r * 0.3, hy = -r * 0.16; ellipse(g, hx, hy, r * 0.13, r * 0.13, C.white, 0); ellipse(g, hx, hy, r * 0.06, r * 0.06, C.ink, 0); }
  }
  if (o.glasses) {
    g.fillStyle = C.ink; g.beginPath(); g.roundRect(-r * 0.58, -r * 0.3, r * 0.5, r * 0.3, r * 0.1); g.roundRect(r * 0.08, -r * 0.3, r * 0.5, r * 0.3, r * 0.1); g.fill();
    line(g, [-r * 0.1, -r * 0.24, r * 0.1, -r * 0.24], lw);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(-r * 0.5, -r * 0.25, r * 0.12, r * 0.06); g.fillRect(r * 0.16, -r * 0.25, r * 0.12, r * 0.06);
  }
  if (o.blush) { g.fillStyle = 'rgba(255,110,140,0.6)'; for (const side of [-1, 1]) { g.beginPath(); g.ellipse(side * r * 0.5, r * 0.2, r * 0.13, r * 0.07, 0, 0, Math.PI * 2); g.fill(); } }
  if (o.hat) { g.beginPath(); g.moveTo(-r * 0.3, -r * 0.9); g.lineTo(0, -r * 1.65); g.lineTo(r * 0.3, -r * 0.9); g.closePath(); inked(g, o.hat, lw); ellipse(g, 0, -r * 1.68, r * 0.12, r * 0.12, C.gold, lw * 0.6); }
  g.restore();
  if (o.sweat !== undefined) drop(g, r * 0.95, -r * 0.55 + (o.sweat % 1) * r * 0.3, r / 14);
  g.restore();
}

function cape(g, r, u, lw) {
  const f = Math.sin(u * 14), f2 = Math.sin(u * 14 + 1.4);
  g.beginPath();
  g.moveTo(-r * 0.6, -r * 0.5);
  g.bezierCurveTo(-r * 1.6, -r * 0.2 + f * 3, -r * 2.4, r * 0.2 + f2 * 4, -r * 3, -r * 0.1 + f * 5);
  g.lineTo(-r * 2.7, r * 0.9 + f2 * 5);
  g.bezierCurveTo(-r * 2, r * 0.9 + f * 3, -r * 1.3, r * 0.9, -r * 0.4, r * 0.6);
  g.closePath();
  inked(g, C.red, lw);
}

// The turkey, standing on (x, y), facing right. o: s (its size), fan (its tail, 0 shut to 1 spread), step (a stride
// phase in radians, or null standing), bob (its head pushed forward, 0 to 1), beak (open, 0 to 1), look, crown,
// glasses, flip (facing left), blink.
function turkey(g, x, y, o = {}) {
  const s = o.s || 1;
  g.save(); g.translate(x, y); g.scale(s * (o.flip ? -1 : 1), s);
  const lw = 2.4;
  // Its tail: feathers fanning out behind it.
  const fan = clamp(o.fan ?? 0.25), cols = [C.red, C.orange, C.gold, C.teal, C.gold, C.orange, C.red];
  for (let i = 0; i < 7; i++) {
    const a = (-90 + (i - 3) * lerp(8, 24, fan)) * DEG - 0.25, L = lerp(26, 44, fan);
    g.save(); g.translate(-8, -36); g.rotate(a);
    g.beginPath(); g.ellipse(L * 0.55, 0, L * 0.55, lerp(6, 9, fan), 0, 0, Math.PI * 2); inked(g, cols[i], lw * 0.9);
    g.beginPath(); g.ellipse(L * 0.78, 0, L * 0.18, 3.2, 0, 0, Math.PI * 2); inked(g, i === 3 ? C.gold : C.cream, 0);
    g.restore();
  }
  // Legs.
  const st = o.step ?? null;
  for (const side of [-1, 1]) {
    const a = st === null ? 0 : Math.sin(st + (side > 0 ? Math.PI : 0)) * 0.55;
    const lift = st === null ? 0 : Math.max(0, Math.sin(st + (side > 0 ? Math.PI : 0))) * 4;
    const hx = side * 6, hy = -18, fx = hx + Math.sin(a) * 16, fy = hy + Math.cos(a) * 18 - lift;
    line(g, [hx, hy, fx, fy], lw * 1.3, C.orange);
    line(g, [fx - 4, fy, fx + 6, fy, fx + 3, fy - 3], lw, C.orange);
    line(g, [hx, hy, fx, fy], 0.01);
  }
  // Body, wing and a chest.
  ellipse(g, 0, -34, 23, 20, C.brown, lw);
  g.beginPath(); g.ellipse(-4, -32, 13, 10, -0.3, 0, Math.PI * 2); inked(g, C.dbrown, lw * 0.8);
  line(g, [-12, -30, -2, -28], lw * 0.6); line(g, [-11, -34, -1, -33], lw * 0.6);
  // Neck and head, pushed forward with each gobble.
  const bob = clamp(o.bob || 0), hx = 17 + bob * 7, hy = -62 + bob * 6;
  g.beginPath(); g.moveTo(10, -48); g.quadraticCurveTo(hx - 6, hy + 14, hx - 3, hy + 4); g.lineTo(hx + 4, hy + 6); g.quadraticCurveTo(hx + 2, hy + 16, 18, -42); g.closePath();
  inked(g, C.brown, lw);
  ellipse(g, hx, hy, 9.5, 9, C.brown, lw);
  // Beak, open as it gobbles, and the red wattle.
  const open = clamp(o.beak || 0) * 4;
  g.beginPath(); g.moveTo(hx + 7, hy - 2); g.lineTo(hx + 17, hy + 0.5 - open * 0.3); g.lineTo(hx + 7, hy + 2.5); g.closePath(); inked(g, C.gold, lw * 0.8);
  if (open > 0.3) { g.beginPath(); g.moveTo(hx + 7, hy + 2.5); g.lineTo(hx + 15, hy + 3 + open); g.lineTo(hx + 7, hy + 4.5); g.closePath(); inked(g, C.orange, lw * 0.8); }
  const wob = Math.sin((o.t || 0) * 18) * 1.5 * (0.4 + bob);
  g.beginPath(); g.moveTo(hx + 8, hy + 1); g.quadraticCurveTo(hx + 12 + wob, hy + 10, hx + 8 + wob, hy + 15); g.quadraticCurveTo(hx + 4 + wob, hy + 10, hx + 6, hy + 2); g.closePath(); inked(g, C.red, lw * 0.8);
  // Eye.
  const look = o.look || [1, 0];
  if (o.blink) line(g, [hx - 1, hy - 3, hx + 5, hy - 3], lw * 0.8);
  else { ellipse(g, hx + 2, hy - 3, 3.6, 4.2, C.white, lw * 0.6); ellipse(g, hx + 2.6 + look[0] * 1.2, hy - 3 + look[1] * 1.2, 1.8, 1.8, C.ink, 0); }
  if (o.glasses) {
    g.fillStyle = C.ink; g.beginPath(); g.roundRect(hx - 3, hy - 6.5, 11, 6, 2.5); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(hx - 1, hy - 5.5, 3, 1.4);
  }
  if (o.crown) {
    g.beginPath(); g.moveTo(hx - 8, hy - 8); g.lineTo(hx - 9, hy - 19); g.lineTo(hx - 4, hy - 13); g.lineTo(hx, hy - 21); g.lineTo(hx + 4, hy - 13); g.lineTo(hx + 9, hy - 19); g.lineTo(hx + 8, hy - 8); g.closePath();
    inked(g, C.gold, lw * 0.8);
    ellipse(g, hx, hy - 11, 1.6, 1.6, C.red, 0);
  }
  g.restore();
}

// ---- Effects --------------------------------------------------------------------------------------------------

// A comic burst with a word in it.
function kapow(g, x, y, r, text, u = 1, fill = C.gold, inner = C.orange) {
  if (u <= 0) return;
  const k = back(u) * r;
  g.save(); g.translate(x, y); g.rotate(-0.12);
  for (const [rr, col] of [[k, fill], [k * 0.72, inner]]) {
    g.beginPath();
    for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, q = i % 2 ? 0.62 + rnd(i) * 0.12 : 1 + rnd(i + 9) * 0.12;
      g.lineTo(Math.cos(a) * rr * q * 1.25, Math.sin(a) * rr * q * 0.9);
    }
    g.closePath(); inked(g, col, 2.4);
  }
  g.restore();
  if (text) words(g, text, x, y, r * 0.55 * back(u), C.white, -0.12);
}

function sparkle(g, x, y, r, color = C.white) {
  g.beginPath();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, q = i % 2 ? 0.3 : 1; g.lineTo(x + Math.cos(a) * r * q, y + Math.sin(a) * r * q); }
  g.closePath(); g.fillStyle = color; g.fill();
}
function star5(g, x, y, r, fill = C.gold, rot = 0, lw = 1.6) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = rot - Math.PI / 2 + i * Math.PI / 5, q = i % 2 ? 0.45 : 1; g.lineTo(x + Math.cos(a) * r * q, y + Math.sin(a) * r * q); }
  g.closePath(); inked(g, fill, lw);
}

// A firework `u` (0 to 1) of the way through its burst.
function firework(g, x, y, u, color, seed = 0, R = 46) {
  if (u <= 0 || u >= 1) return;
  if (u < 0.22) {
    // The rocket going up.
    const k = u / 0.22;
    line(g, [x, y + (1 - k) * 90 + 10, x, y + (1 - k) * 90], 2, C.sun);
    return;
  }
  const k = (u - 0.22) / 0.78, rr = eo(k) * R, fall = k * k * 18;
  if (k < 0.15) { g.fillStyle = C.white; g.beginPath(); g.arc(x, y, 10 * (1 - k / 0.15) + 2, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1 - k * k;
  for (let i = 0; i < 22; i++) {
    const a = i * Math.PI * 2 / 22 + seed, px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr + fall;
    g.fillStyle = i % 4 === 0 ? C.white : color;
    const sz = 4 - k * 1.5;
    g.fillRect(Math.round(px - sz / 2), Math.round(py - sz / 2), sz, sz);
    for (const f of [0.78, 0.58]) { const tx = x + Math.cos(a) * rr * f, ty = y + Math.sin(a) * rr * f + fall * f; g.fillRect(Math.round(tx - 1), Math.round(ty - 1), 2, 2); }
  }
  g.globalAlpha = 1;
}

// Dust kicked up, `u` of the way through.
function puff(g, x, y, r, u) {
  if (u <= 0 || u >= 1) return;
  g.save(); g.globalAlpha *= 1 - u;
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + i * Math.PI / 4, d = eo(u) * r;
    ellipse(g, x + Math.cos(a) * d, y + Math.sin(a) * d * 0.5, r * (0.35 + 0.3 * u), r * (0.3 + 0.25 * u), C.cream, 1.4);
  }
  g.restore();
}

function speedLines(g, x, y, len, n = 4, dir = -1, color = C.white) {
  for (let i = 0; i < n; i++) {
    const yy = y + (i - (n - 1) / 2) * 7, l = len * (0.6 + rnd(i + 3) * 0.4);
    line(g, [x + dir * 6, yy, x + dir * (6 + l), yy], 2, color);
  }
}

// "!" over a head.
function bang(g, x, y, u, text = '!') {
  if (u <= 0) return;
  words(g, text, x, y - back(seg(u, 0, 0.4)) * 6, 18, C.gold, 0, Math.min(1, u * 4));
}

function note(g, x, y, s = 1, color = C.white) {
  g.save(); g.translate(x, y); g.scale(s, s);
  ellipse(g, 0, 0, 3.4, 2.6, color, 1.4, -0.4);
  line(g, [3, -1, 3, -13, 8, -10], 1.8);
  g.restore();
}

function bubble(g, x, y, text, size, tx, ty, u = 1) {
  if (u <= 0) return;
  g.save();
  g.font = `${size}px Shrikhand, Georgia, serif`;
  const w = g.measureText(text).width + size * 1.1, h = size * 1.6, k = back(seg(u, 0, 0.5));
  g.translate(x, y); g.scale(k, k);
  g.beginPath(); g.roundRect(-w / 2, -h / 2, w, h, h / 2);
  g.moveTo(tx - x - 4, -h / 2 + h - 1);
  inked(g, C.white, 2);
  g.beginPath(); g.moveTo(-6, h / 2 - 1); g.lineTo((tx - x) / k, (ty - y) / k); g.lineTo(6, h / 2 - 1); g.closePath(); inked(g, C.white, 2);
  g.fillStyle = C.white; g.fillRect(-7, h / 2 - 3.5, 14, 4);
  g.fillStyle = C.ink; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 0, 1);
  g.restore();
}

// A tumbleweed rolling.
function tumbleweed(g, x, y, r, rot) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.strokeStyle = C.wood; g.lineWidth = 1.8;
  for (let i = 0; i < 7; i++) { g.beginPath(); g.ellipse(0, 0, r, r * 0.45, i * Math.PI / 7, 0, Math.PI * 2); g.stroke(); }
  g.strokeStyle = C.dbrown; g.lineWidth = 1.4; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
  g.restore();
}

// Confetti falling, `u` of the way.
function confetti(g, t, n = 40, from = 0) {
  const cols = [C.gold, C.teal, C.coral, C.pink, C.white, C.violet];
  for (let i = 0; i < n; i++) {
    const sp = 50 + rnd(i) * 60, x = rnd(i + 7) * W + Math.sin(t * 3 + i) * 8, y = -10 + ((t - from) * sp + rnd(i + 3) * H * 1.2) % (H + 20) - (t < from ? 999 : 0);
    g.fillStyle = cols[i % cols.length];
    const flip = Math.abs(Math.sin(t * 6 + i));
    g.fillRect(Math.round(x), Math.round(y), 4, Math.max(1, Math.round(4 * flip)));
  }
}

// A light bulb in a marquee.
function bulb(g, x, y, on) {
  ellipse(g, x, y, 3.2, 3.2, on ? C.sun : C.dbrown, 1.2);
  if (on) { g.fillStyle = 'rgba(255,224,138,0.35)'; g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); }
}

// ---- The gags -------------------------------------------------------------------------------------------------
// Each: the event it's for, how long it plays (s), the moment drawn for a still with Reduce Motion on, its sounds (each
// [when, name], see cartoon() in sound.js), and how to draw it at t seconds in.

export const GAGS = {};
const gag = (id, event, dur, still, cues, draw) => { GAGS[id] = { id, event, dur, still, cues, draw }; };

// -- Strikes ---------------------------------------------------------------------------------------------------

// Kapow: the ball bowls into a crowd of pins, who fly everywhere, and one flies at the screen and splats on the glass.
gag('kapow', 'strike', 2.6, 1.75, [[0.62, 'bonk'], [0.66, 'whoosh'], [1.38, 'splat'], [1.75, 'squeak']], (g, t) => {
  sunburst(g, 160, 150, t * 0.4, C.sky, C.blue, 14);
  boards(g, 178);
  const hitAt = 0.6;
  // The pins: three rows, back to front, looking at the ball as it comes.
  const spots = [[205, 150, 40], [229, 150, 40], [253, 150, 40], [277, 150, 40], [217, 164, 46], [241, 164, 46], [265, 164, 46], [229, 180, 52], [253, 180, 52], [241, 196, 58]];
  const bx = lerp(-30, 214, eo(seg(t, 0, hitAt) ** 1.3)), by = 182;
  spots.forEach(([x, y, h], i) => {
    if (t < hitAt) {
      const scared = t > 0.32;
      pin(g, x, y, { h, face: scared ? 'scared' : 'happy', look: [-1, 0], arms: scared ? [50, 50] : [-60, -60], sway: scared ? Math.sin(t * 40 + i) * 0.05 : 0 });
      if (i === 9 && scared) bang(g, x, y - h - 6, t - 0.32);
    } else if (i !== 6) {
      // Off they fly, spinning.
      const u = t - hitAt, a = (-70 + rnd(i) * 70) * DEG, sp = 260 + rnd(i + 4) * 160;
      const px = x + Math.cos(a) * sp * u, py = y + Math.sin(a) * sp * u + 300 * u * u;
      pin(g, px, py, { h, face: i % 2 ? 'dizzy' : 'shock', spin: u * (8 + rnd(i) * 8) * (i % 2 ? 1 : -1), arms: [80, 30] });
    }
  });
  if (t < hitAt + 0.25) ball(g, bx, by, 17, { rot: bx / 17, face: 'determined', brow: 'angry' });
  else ball(g, lerp(214, 180, eo(seg(t, hitAt, 1.2))), by, 17, { face: t > 1.9 ? 'wink' : 'grin', look: [1, -1] });
  if (t > hitAt - 0.02 && t < hitAt + 0.5) kapow(g, 225, 150, 46, 'KAPOW!', seg(t, hitAt - 0.02, hitAt + 0.15));
  // The one that flies at us, getting bigger, then flat against the glass and sliding down it.
  if (t > hitAt) {
    const u = seg(t, hitAt, 1.36), splat = t >= 1.36;
    if (!splat) pin(g, lerp(265, 150, u), lerp(160, 120, u) - hop(u) * 30, { h: lerp(46, 260, ei(u)), face: 'shock', spin: u * 9, arms: [80, 80] });
    else {
      const slide = ei(seg(t, 1.75, 2.6)) * 150, wob = Math.sin(seg(t, 1.36, 1.7) * 18) * 0.06 * (1 - seg(t, 1.36, 1.7));
      g.save(); g.translate(166, 268 + slide); g.rotate(-0.18 + wob);
      pin(g, 0, 0, { h: 200, face: 'ow', squash: 0.14 - wob, arms: [125, 125], look: [0, 0] });
      g.restore();
      // A crack in the glass where it hit.
      for (let i = 0; i < 7; i++) { const a = i * 0.9 + 0.3; line(g, [146, 92, 146 + Math.cos(a) * 24, 92 + Math.sin(a) * 24, 146 + Math.cos(a + 0.25) * 46, 92 + Math.sin(a + 0.25) * 46], 1.6, 'rgba(255,255,255,0.85)'); }
      words(g, 'SPLAT!', 248, 52, 26, C.white, 0.12, seg(t, 1.36, 1.42) * (1 - seg(t, 2.1, 2.3)));
    }
  }
});

// The getaway: the pins see the ball coming and run for it, all but one little one who has to work up to it.
gag('getaway', 'strike', 2.6, 1.15, [[0.42, 'eek'], [0.72, 'zip'], [1.6, 'zip'], [2.1, 'boing']], (g, t) => {
  bands(g, [C.night, C.deep, C.sky, C.purple, C.violet], 0, 170);
  twinkles(g, t, 20);
  boards(g, 170);
  const run = 0.7;
  const pins = [[200, 168, 46], [224, 168, 46], [248, 168, 46], [272, 168, 46], [212, 182, 50], [236, 182, 50], [260, 182, 50], [224, 196, 54], [248, 196, 54], [236, 210, 58]];
  pins.forEach(([x, y, h], i) => {
    const last = i === 9;
    const go = last ? 1.6 : run + rnd(i) * 0.18;
    const u = Math.max(0, t - go), dx = u * u * 900 + u * 120;
    const legs = t > go - 0.15 || (t > 0.4 && !last) ? t * 30 + i : null;
    const face = t < 0.38 ? 'happy' : last && t < go ? (t > 1.15 ? 'gulp' : 'scared') : 'scared';
    if (x + dx < W + 40) pin(g, x + dx, y, { h, face, look: t < go ? [-1, 0] : [1, 0], arms: t > 0.38 ? [60 + Math.sin(t * 30 + i) * 30, 60 - Math.sin(t * 30 + i) * 30] : [-55, -55], legs: legs, sway: t > go ? 0.18 : 0 });
    if (t > go && u < 0.4) puff(g, x - 6, y, 14, u / 0.4);
    if (last && t > 0.42 && t < go) bang(g, x, y - h - 18, t - 0.42, t > 1.15 ? '?!' : '!');
  });
  // Every head turns: here it comes.
  const bx = lerp(-40, 236, eo(seg(t, 1.2, 2.2)));
  ball(g, bx, 194, 18, { rot: t < 2.2 ? bx / 18 : 0, face: t > 2.2 ? 'shock' : 'determined', look: [1, 0] });
  if (t > 2.2) bang(g, bx, 160, t - 2.2, '?');
});

// Dominoes: the ball nudges the first of ten pins in a row, and they go one after another, all but the last, who
// windmills, wobbles, nearly holds on, and goes over with a thud.
gag('dominoes', 'strike', 2.75, 2.05, [[0.42, 'tock'], [2.3, 'thud'], [2.0, 'whistleDown']], (g, t) => {
  bands(g, [C.deep, C.night, C.sky, C.purple], 0, 194);
  twinkles(g, t, 14);
  boards(g, 194);
  const y = 196, h = 64, gap = 25, x0 = 46;
  const fallAt = i => 0.4 + i * 0.12;
  ball(g, lerp(-20, x0 - 28, eo(seg(t, 0, 0.4))), 182, 15, { rot: t < 0.4 ? lerp(-20, x0 - 28, eo(seg(t, 0, 0.4))) / 15 : 0, face: t > 1.0 ? 'grin' : 'happy', look: [1, 0] });
  for (let i = 9; i >= 0; i--) {
    const x = x0 + i * gap;
    let rot = 0, face = 'happy', arms = [-55, -55];
    if (i < 9) {
      const u = seg(t, fallAt(i), fallAt(i) + 0.22);
      // Leaning on the next until it goes too, then flat.
      const lean = 0.52, nu = i < 8 ? seg(t, fallAt(i + 1), fallAt(i + 1) + 0.22) : seg(t, 2.25, 2.5);
      rot = lerp(0, lean, ei(u)) + (Math.PI / 2 - 0.08 - lean) * ei(nu);
      face = u > 0 ? (nu > 0.6 ? 'dizzy' : 'shock') : t > fallAt(i) - 0.35 ? 'gulp' : 'happy';
      if (u > 0) arms = [120, 120];
    } else {
      // The last one: wobbling, arms going round, then over.
      const w = seg(t, 1.45, 2.25), fall = seg(t, 2.25, 2.5);
      rot = Math.sin(w * 18) * 0.22 * hop(w) * (1 - fall) + ei(fall) * (Math.PI / 2 - 0.08);
      face = fall > 0.5 ? 'dizzy' : w > 0 ? 'scared' : t > 1.2 ? 'gulp' : 'happy';
      if (w > 0 && fall === 0) arms = [Math.sin(t * 22) * 70 + 40, Math.cos(t * 22) * 70 + 40];
      if (fall > 0) arms = [110, 110];
      if (t > 2.5) puff(g, x + 34, y, 16, seg(t, 2.5, 2.75));
    }
    pin(g, x, y, { h, rot, face, arms, look: i === 9 ? [-1, 0] : [1, 0] });
  }
  if (t > 2.38) words(g, 'TIMBER!', 230, 70, 30, C.gold, -0.1, seg(t, 2.38, 2.45));
});

// -- Two and three in a row -------------------------------------------------------------------------------------

// The double take: a pin reads the paper as a ball rolls by, looks up, looks back down, looks again with its eyes on
// stalks, and a second ball bowls it over.
gag('doubletake', 'double', 2.7, 1.38, [[0.95, 'boing'], [1.75, 'bonk'], [2.0, 'whistleDown']], (g, t) => {
  bands(g, [C.purple, C.violet, C.purple, C.sky], 0, 186);
  // A window with the moon in it, for a bit of a room.
  g.fillStyle = C.deep; g.fillRect(36, 34, 60, 70); line(g, [36, 34, 96, 34, 96, 104, 36, 104, 36, 34], 3); line(g, [66, 34, 66, 104], 2.5); line(g, [36, 69, 96, 69], 2.5);
  ellipse(g, 52, 52, 8, 8, C.sun, 0);
  boards(g, 186);
  const fall = seg(t, 1.75, 2.15);
  const looking = t > 0.5 && t < 0.8 ? 1 : 0, again = t > 0.92;
  const px = 176, py = 196;
  // Eyes on stalks.
  g.save(); g.translate(px, py); g.rotate(fall * 1.45); g.translate(-px, -py);
  pin(g, px, py, { h: 130, face: again ? 'shock' : looking ? 'eye' : 'peek', look: looking ? [-1, 0.3] : again ? [-1, 0] : [0, 1], arms: fall > 0 ? [140, 140] : null, plain: again && fall === 0 });
  if (again && fall === 0) {
    const pop = back(seg(t, 0.92, 1.1)) * 26;
    for (const side of [-1, 1]) {
      const ex = px + side * (8 + pop * 0.5), ey = py - 106 - pop;
      line(g, [px + side * 6, py - 104, ex, ey], 2.6);
      ellipse(g, ex, ey, 12, 14, C.white, 2.2);
      ellipse(g, ex - 4, ey + 1, 4.4, 4.4, C.ink, 0);
    }
    ellipse(g, px, py - 95, 5, 6, C.ink, 0);
  }
  g.restore();
  // The paper: held up to read, then flung away.
  const fling = seg(t, 0.95, 1.6);
  if (fling < 1) {
    const nx = px - 2 + fling * -60, ny = py - 62 - hop(fling) * 90 - fling * 40;
    g.save(); g.translate(nx, ny); g.rotate(fling * 5);
    g.beginPath(); g.rect(-30, -24, 60, 46); inked(g, C.cream, 2.2);
    g.fillStyle = C.ink; g.font = '11px Shrikhand, Georgia, serif'; g.textAlign = 'center'; g.fillText('PIN NEWS', 0, -11);
    for (let i = 0; i < 4; i++) g.fillRect(-24, -2 + i * 5, i === 1 ? 22 : 48, 2);
    g.fillRect(4, -2, 20, 7);
    g.restore();
    if (fling === 0) for (const side of [-1, 1]) ellipse(g, px + side * 32, py - 62, 4.5, 4.5, C.white, 2);
  }
  // The first ball rolling by, and the second coming for it.
  const b1 = lerp(-30, 360, seg(t, 0.15, 1.0));
  ball(g, b1, 196, 14, { rot: b1 / 14, face: 'happy' });
  const b2 = lerp(-30, 186, ei(seg(t, 1.35, 1.75)));
  if (t > 1.35) ball(g, fall > 0 ? lerp(150, 70, eo(fall)) : b2 - 36, 194, 17, { rot: b2 / 17, face: fall > 0 ? 'grin' : 'determined', brow: fall > 0 ? null : 'angry' });
  if (t > 1.75 && t < 2.1) kapow(g, 160, 150, 30, 'BONK', seg(t, 1.75, 1.85));
  if (fall >= 1) for (let i = 0; i < 4; i++) { const a = t * 6 + i * Math.PI / 2; star5(g, 292 + Math.cos(a) * 18, 160 + Math.sin(a) * 6, 5, C.gold, t * 4); }
});

// The bump: two balls roll in from either side, leap, and bump in the air with a burst of stars.
gag('bump', 'double', 2.4, 1.0, [[0.86, 'clap'], [0.9, 'sparkle']], (g, t) => {
  sunburst(g, 160, 120, -t * 0.6, C.purple, C.violet, 16);
  boards(g, 190);
  const meet = 0.86, u = seg(t, 0, meet);
  for (const side of [-1, 1]) {
    const x = 160 + side * lerp(200, 24, eo(u) ** 0.8), jump = hop(seg(t, 0.5, 1.25)) * 70;
    const land = seg(t, 1.25, 1.5);
    const y = 168 - jump - (land > 0 ? hop(land) * 10 : 0);
    const squash = t > 1.25 && t < 1.35 ? 0.15 : 0;
    ball(g, x - side * (t > meet ? Math.sin(seg(t, meet, 1.1) * Math.PI) * 6 : 0), y, 22, { rot: t < 0.5 ? side * (x - 160) / 22 : 0, face: t > meet ? 'laugh' : 'grin', look: [-side, 0], arms: t > 0.45 ? [side < 0 ? 40 : 120, side < 0 ? 120 : 40] : null, squash, hat: side < 0 ? C.teal : C.coral });
  }
  if (t > meet) {
    const k = seg(t, meet, meet + 0.6);
    kapow(g, 160, 62, 20, '', k < 0.5 ? k * 2 : 1, C.white, C.gold);
    for (let i = 0; i < 10; i++) { const a = i * Math.PI / 5, d = eo(k) * 80; star5(g, 160 + Math.cos(a) * d, 70 + Math.sin(a) * d * 0.7, 6 * (1 - k * 0.5), i % 2 ? C.teal : C.gold, t * 3); }
  }
  if (t > 1.5) words(g, 'x2', 160, 34, 34, C.gold, -0.08, seg(t, 1.5, 1.6));
});

// The turkey struts in, stops, puffs up, and throws its tail open with a gobble.
gag('strut', 'turkey', 2.8, 1.6, [[1.25, 'gobble'], [1.15, 'tada']], (g, t) => {
  const open = seg(t, 1.1, 1.35);
  sunburst(g, 160, 150, t * 0.5, open > 0 ? C.orange : C.purple, open > 0 ? C.gold : C.violet, 18);
  boards(g, 200);
  const walk = seg(t, 0, 1.0), x = lerp(-50, 150, walk);
  const gob = t > 1.25 && t < 2.1 ? Math.abs(Math.sin((t - 1.25) * 11)) : 0;
  turkey(g, x, 212, { s: 1.45, fan: lerp(0.15, 1, back(open)), step: walk < 1 ? t * 13 : null, bob: walk < 1 ? Math.abs(Math.sin(t * 13)) * 0.6 : gob, beak: gob, t, look: t > 2.2 ? [1, 0] : [1, 0], blink: t > 2.45 && t < 2.55 });
  if (t > 1.25) bubble(g, 232, 64, 'GOBBLE!', 15, 200, 100, seg(t, 1.25, 1.5));
  if (open > 0) for (let i = 0; i < 6; i++) sparkle(g, 40 + rnd(i) * 240, 30 + rnd(i + 3) * 100, 4 + 3 * Math.sin(t * 9 + i), C.white);
});

// The turkey leads three pins in a conga line across the screen, kicking; it stops short and they pile into it.
gag('conga', 'turkey', 2.8, 1.3, [[0.2, 'kazoo'], [1.95, 'honk'], [2.0, 'bonk'], [2.15, 'gobble']], (g, t) => {
  bands(g, [C.coral, C.orange, C.gold, C.sun], 0, 196);
  // Bunting along the top.
  for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(i * 40 - 4, 8); g.lineTo(i * 40 + 16, 8); g.lineTo(i * 40 + 6, 26); g.closePath(); inked(g, [C.teal, C.purple, C.red][i % 3], 1.6); }
  line(g, [0, 8, W, 8], 2);
  boards(g, 196);
  const stop = 1.9, u = Math.min(t, stop);
  const lead = lerp(-40, 250, u / stop);
  const beat = Math.floor(t * 4) % 4 === 3;
  for (let i = 3; i >= 1; i--) {
    // Each a step behind; after the stop they bunch up.
    let x = lead - i * 46;
    if (t > stop) x = lerp(x, lead - 14 - i * 22, eo(seg(t, stop, stop + 0.15)));
    const hit = t > stop + 0.05;
    pin(g, x, 202, { h: 62, face: hit ? (i === 1 ? 'ow' : 'dizzy') : 'cheer', legs: t < stop ? t * 16 + i : null, kick: beat && t < stop ? (i % 2 ? 1.1 : -1.1) : 0, arms: [20, 20], spin: hit ? -0.15 * (4 - i) : 0, look: [1, 0] });
  }
  turkey(g, lead, 208, { s: 1.1, fan: t > stop + 0.2 ? 1 : 0.5, step: t < stop ? t * 16 : null, bob: t > stop + 0.2 ? Math.abs(Math.sin(t * 12)) : Math.abs(Math.sin(t * 16)) * 0.4, beak: t > stop + 0.2 ? Math.abs(Math.sin(t * 12)) : 0, t, look: t > stop ? [-1, 0] : [1, 0] });
  if (t < stop) for (let i = 0; i < 3; i++) note(g, ((t * 60 + i * 100) % 340) - 10, 50 + Math.sin(t * 6 + i * 2) * 10, 1.2, C.white);
  if (t > stop + 0.05 && t < stop + 0.5) kapow(g, lead - 18, 140, 20, '', seg(t, stop + 0.05, stop + 0.15), C.white, C.gold);
});

// Four, five, six in a row: as many balls as strikes roll across in a row in party hats, over a crowd of pins doing the
// wave, under a marquee lighting an X for each, with more fireworks the longer the run.
gag('parade', 'run', 2.8, 1.5, [[0.1, 'kazoo'], [1.0, 'cheer']], (g, t, n = 4) => {
  bands(g, [C.deep, C.night, C.sky, C.purple], 0, H);
  twinkles(g, t, 26);
  const fw = Math.min(8, n - 2);
  for (let i = 0; i < fw; i++) firework(g, 40 + rnd(i + 2) * 240, 50 + rnd(i + 5) * 40, seg(t, 0.2 + i * 0.28, 1.3 + i * 0.28), [C.gold, C.teal, C.coral, C.pink][i % 4], i, 34 + n * 2);
  if (n >= 6) for (const side of [-1, 1]) {
    const a = Math.PI / 2 + side * (0.35 + Math.sin(t * 2.4 + side) * 0.3);
    g.fillStyle = 'rgba(255,240,180,0.18)'; g.beginPath(); g.moveTo(160 + side * 150, 250); g.lineTo(160 + side * 150 + Math.cos(a - 0.12) * -400, 250 - Math.sin(a - 0.12) * 400); g.lineTo(160 + side * 150 + Math.cos(a + 0.12) * -400, 250 - Math.sin(a + 0.12) * 400); g.fill();
  }
  // The marquee.
  const k = Math.min(n, 12);
  g.fillStyle = C.ink; g.beginPath(); g.roundRect(160 - k * 11 - 6, 14, k * 22 + 12, 24, 6); g.fill();
  for (let i = 0; i < k; i++) {
    const on = t > 0.15 + i * 0.08, x = 160 - k * 11 + 11 + i * 22;
    words(g, 'X', x, 27, 14, on ? (Math.floor(t * 8 + i) % 2 ? C.gold : C.sun) : C.dbrown);
  }
  // The balls in a row.
  const step = Math.min(36, 270 / n), lead = lerp(-20, 160 + (n - 1) * step / 2, eo(seg(t, 0.05, 1.5)));
  for (let i = 0; i < n; i++) {
    const x = lead - i * step;
    if (x < -20) continue;
    const y = 122 - Math.abs(Math.sin(t * 9 + i * 0.7)) * 8;
    ball(g, x, y, 15, { rot: t < 1.5 ? x / 12 : Math.sin(t * 6 + i) * 0.2, face: 'grin', hat: [C.teal, C.coral, C.gold, C.pink][i % 4] });
  }
  // The crowd: two rows, the wave going along them twice.
  const wave = (t * 0.85) % 1.15 - 0.075;
  crowd(g, 200, 34, t, wave, { n: 12, x0: 14, x1: 306 });
  crowd(g, 236, 38, t, wave - 0.08, { n: 11, x0: 28, x1: 292 });
});

// A perfect game: the turkey in a crown on top of a gold trophy, fireworks, the crowd doing the wave and confetti.
gag('perfect', 'perfect', 3.0, 2.0, [[0.3, 'firework'], [0.9, 'firework'], [1.4, 'gobble'], [1.7, 'firework'], [2.1, 'tada']], (g, t) => {
  sunburst(g, 160, 120, t * 0.5, C.purple, C.violet, 20);
  for (let i = 0; i < 9; i++) firework(g, 30 + rnd(i + 11) * 260, 40 + rnd(i + 21) * 60, seg(t, 0.1 + i * 0.3, 1.2 + i * 0.3), [C.gold, C.teal, C.coral, C.pink, C.white][i % 5], i, 48);
  // The trophy rising.
  const rise = eo(seg(t, 0.2, 1.1)), ty = lerp(300, 158, rise);
  g.save(); g.translate(160, ty);
  g.beginPath(); g.rect(-34, 10, 68, 22); inked(g, C.dbrown, 2.4);
  g.beginPath(); g.moveTo(-20, 10); g.lineTo(-10, -12); g.lineTo(10, -12); g.lineTo(20, 10); g.closePath(); inked(g, C.gold, 2.4);
  for (const side of [-1, 1]) { g.beginPath(); g.ellipse(side * 36, -46, 11, 16, 0, 0, Math.PI * 2); g.lineWidth = 6; g.strokeStyle = C.ink; g.stroke(); g.lineWidth = 3; g.strokeStyle = C.gold; g.stroke(); }
  g.beginPath(); g.moveTo(-38, -72); g.lineTo(38, -72); g.quadraticCurveTo(36, -20, 0, -14); g.quadraticCurveTo(-36, -20, -38, -72); g.closePath(); inked(g, C.gold, 2.4);
  g.save(); g.clip(); g.fillStyle = 'rgba(255,255,255,0.55)'; const gx = lerp(-80, 80, seg(t, 1.9, 2.4)); g.beginPath(); g.moveTo(gx - 6, -80); g.lineTo(gx + 8, -80); g.lineTo(gx - 10, -10); g.lineTo(gx - 24, -10); g.fill(); g.restore();
  words(g, '300', 0, -46, 22, C.white);
  g.restore();
  // The turkey hops up on top of it.
  if (t > 1.0) {
    const k = seg(t, 1.0, 1.35), j = hop(k) * 40;
    const gob = t > 1.4 && t < 2.2 ? Math.abs(Math.sin((t - 1.4) * 12)) : 0;
    turkey(g, 162, ty - 72 - j + (1 - k) * 0, { s: 0.85, fan: 1, crown: true, bob: gob, beak: gob, t, step: k < 1 ? t * 10 : null, blink: t > 2.6 && t < 2.7 });
  }
  const wave = (t * 0.9) % 1.15 - 0.075;
  crowd(g, 214, 34, t, wave, { n: 12, x0: 12, x1: 308 });
  crowd(g, 246, 38, t, wave - 0.08, { n: 11, x0: 26, x1: 294 });
  confetti(g, t, 46, 0.4);
});

// -- Spares -----------------------------------------------------------------------------------------------------

// The faint: the last pin whistles, trying to look casual; the ball creeps up and taps it, and it swoons, slowly.
gag('faint', 'spare', 2.6, 1.85, [[0.15, 'whistleTune'], [1.0, 'tink'], [1.25, 'whistleDown'], [2.15, 'thud']], (g, t) => {
  bands(g, [C.violet, C.purple, C.sky, C.night], 0, 196);
  // A spotlight on it.
  g.fillStyle = 'rgba(255,240,190,0.2)'; g.beginPath(); g.moveTo(150, 0); g.lineTo(190, 0); g.lineTo(240, 205); g.lineTo(100, 205); g.fill();
  boards(g, 196);
  ellipse(g, 170, 202, 60, 9, 'rgba(255,240,190,0.25)', 0);
  const tap = 1.0, fall = seg(t, 1.25, 2.15);
  const rot = ei(fall) * (Math.PI / 2 - 0.1);
  const face = t < tap ? 'nervous' : t < 1.25 ? 'shock' : fall < 1 ? 'swoon' : 'dizzy';
  const arms = t < tap ? [-50, -50] : t < 1.25 ? [60, 60] : [104, -40];
  pin(g, 150, 204, { h: 120, rot, face, arms, front: t > 1.25, reach: t > 1.25 ? [2, 1] : 1, look: t < tap ? [Math.sin(t * 5) > 0 ? 1 : -1, 0] : [-1, 0], sweat: t < tap ? t * 2 : undefined });
  if (t < tap) for (let i = 0; i < 2; i++) { const u = (t * 1.4 + i * 0.5) % 1; note(g, 165 + u * 30, 90 - u * 40, 1, C.white); }
  if (t > tap && t < 1.25) bang(g, 185, 70, t - tap);
  if (fall >= 1) puff(g, 270, 200, 22, seg(t, 2.15, 2.6));
  // The ball, creeping in on tiptoe.
  const bx = lerp(-30, 118, sm(seg(t, 0.15, 1.0)));
  ball(g, t > 1.25 ? lerp(118, 70, eo(seg(t, 1.25, 1.8))) : bx, 186, 16, { rot: t < 1.0 ? Math.sin(t * 20) * 0.1 : 0, face: t > 1.8 ? 'grin' : 'flat', look: [1, 0], brow: t < 1.0 ? 'angry' : null });
  if (t > 0.98 && t < 1.2) words(g, 'tap', 128, 150, 14, C.white, -0.2, 1);
});

// The sweep: the ball in a janitor's cap sweeps up to the pins left, gives them a nudge or two with the broom, then
// one big swish sends them flying off the screen, and it's spotless.
gag('sweep', 'spare', 2.5, 1.32, [[0.6, 'swish'], [0.85, 'swish'], [1.25, 'whoosh'], [1.75, 'sparkle']], (g, t) => {
  bands(g, [C.teal, C.mint, C.teal, C.dgreen], 0, 190);
  // Dust on the floor, swept away.
  boards(g, 190);
  const bx = lerp(-60, 136, eo(seg(t, 0, 0.55)));
  const strokes = t > 0.55 && t < 1.2 ? Math.sin((t - 0.55) * 26) : 0;
  const swish = seg(t, 1.2, 1.36);
  // The pins: fidgeting, nudged, then flung.
  for (const [i, px] of [[0, 214], [1, 250]]) {
    const nudge = Math.max(0, strokes) * 4 * (1 - i * 0.4);
    const u = Math.max(0, t - 1.25);
    if (u === 0) pin(g, px + nudge, 196, { h: 72, face: t > 0.5 ? 'gulp' : 'happy', arms: t > 0.5 ? [40, 40] : [-50, -50], look: [-1, 0], sway: nudge * 0.03 });
    else pin(g, px + u * (420 + i * 80), 196 - u * 260 + u * u * 300, { h: 72, face: 'dizzy', spin: u * 16, arms: [100, 100] });
  }
  if (t > 1.2 && t < 1.7) speedLines(g, 300, 150, 60, 4, -1);
  // The broom: little strokes, then a big swish.
  const ang = t < 1.2 ? 0.6 + strokes * 0.18 : lerp(0.6, 1.9, eo(swish)) - sm(seg(t, 1.5, 1.9)) * 1.3;
  g.save(); g.translate(bx + 16, 176); g.rotate(-ang);
  line(g, [0, 0, 0, 44], 4, C.dbrown);
  g.beginPath(); g.moveTo(-10, 40); g.lineTo(10, 40); g.lineTo(14, 58); g.lineTo(-14, 58); g.closePath(); inked(g, C.gold, 2);
  for (let i = -2; i <= 2; i++) line(g, [i * 4.5, 47, i * 5.5, 57], 1.2);
  g.restore();
  if (strokes > 0.5) puff(g, bx + 70, 198, 12, (t * 3) % 1);
  ball(g, bx, 176, 18, { face: t > 1.5 ? 'grin' : 'determined', brow: t > 1.5 ? null : 'angry', arms: [20, 30 + strokes * 10], look: [1, 0], sweat: t > 1.5 && t < 2.0 ? t * 2 : undefined });
  // The cap.
  g.beginPath(); g.ellipse(bx, 162, 15, 8, 0, Math.PI, 0); inked(g, C.teal, 2); line(g, [bx + 4, 162, bx + 22, 163], 3);
  if (t > 1.6) {
    for (const [x, y, a] of [[220, 186, 1.6], [250, 160, 1.75], [196, 150, 1.9]]) sparkle(g, x, y, hop(seg(t, a, a + 0.5)) * 11, C.white);
    words(g, 'SPOTLESS!', 222, 70, 22, C.white, -0.1, seg(t, 1.7, 1.8));
  }
});

// The white flag: the last pin waves a little white flag; the ball rolls up, considers it, and nudges it over anyway.
gag('flag', 'spare', 2.5, 1.2, [[1.6, 'tink'], [1.75, 'honk'], [2.1, 'thud']], (g, t) => {
  bands(g, [C.sky, C.blue, C.sky, C.purple], 0, 194);
  boards(g, 194);
  const fall = seg(t, 1.65, 2.1);
  pin(g, 210, 200, { h: 110, rot: ei(fall) * (Math.PI / 2 - 0.1), face: fall > 0 ? 'ow' : 'nervous', arms: [-60, 70], flag: t, sway: fall === 0 ? Math.sin(t * 30) * 0.02 : 0, look: [-1, 0], sweat: fall === 0 ? t * 2 : undefined });
  const bx = lerp(-30, 160, eo(seg(t, 0.2, 1.0)));
  const think = t > 1.0 && t < 1.55;
  ball(g, t > 1.55 ? lerp(160, 176, seg(t, 1.55, 1.65)) : bx, 182, 18, { rot: t < 1.0 ? bx / 18 : 0, face: t > 2.1 ? 'grin' : think ? 'flat' : 'happy', look: think ? (t < 1.3 ? [1, -1] : [0, 1]) : [1, 0] });
  if (think) bubble(g, 136, 118, '...', 14, 150, 158, seg(t, 1.0, 1.2));
  if (fall >= 1) puff(g, 300, 196, 18, seg(t, 2.1, 2.5));
});

// -- Splits -----------------------------------------------------------------------------------------------------

// The splits: a pin tries the splits, its legs going further and further apart, until something rips.
gag('splits', 'split', 2.6, 1.55, [[0.3, 'stretch'], [1.45, 'rip'], [1.9, 'squeak']], (g, t) => {
  bands(g, [C.pink, C.coral, C.pink, C.violet], 0, 200);
  // Gym mat.
  g.fillStyle = C.blue; g.beginPath(); g.moveTo(40, 200); g.lineTo(280, 200); g.lineTo(300, 222); g.lineTo(20, 222); g.fill(); line(g, [40, 200, 280, 200, 300, 222, 20, 222, 40, 200], 2.5);
  g.fillStyle = C.deep; g.fillRect(0, 222, W, 18);
  const u = sm(seg(t, 0.2, 1.4)), rip = t > 1.45;
  const spread = lerp(0.1, Math.PI / 2 - 0.02, u), legLen = 58;
  const hipY = 204 - Math.cos(spread) * legLen;
  const shake = rip ? Math.sin(t * 60) * 1.5 * (1 - seg(t, 1.45, 1.8)) : 0;
  for (const side of [-1, 1]) {
    const fx = 160 + side * Math.sin(spread) * legLen, fy = hipY + Math.cos(spread) * legLen;
    line(g, [160 + side * 4, hipY - 4, fx, fy - 2], 4.4);
    ellipse(g, fx + side * 4, fy - 3, 7, 4, C.ink, 0);
  }
  pin(g, 160 + shake, hipY + 2, { h: 96, face: rip ? 'ow' : u > 0.6 ? 'strain' : 'proud', arms: rip ? [140, 140] : [lerp(-40, 90, u), lerp(-40, 90, u)], sweat: u > 0.5 && !rip ? t * 2 : undefined });
  if (rip) { words(g, 'RRRIP!', 160, 54, 34, C.gold, -0.08, seg(t, 1.45, 1.52)); }
  if (t > 1.85) words(g, 'ow...', 222, 110, 20, C.white, 0.2, seg(t, 1.85, 1.95));
});

// Mind the gap: the floor cracks between two pins and the halves pull apart; they reach for each other, nearly touch
// fingers, and drift apart.
gag('gap', 'split', 2.6, 1.6, [[0.25, 'rumble'], [0.6, 'crack'], [1.9, 'sadHorn']], (g, t) => {
  bands(g, [C.night, C.sky, C.blue, C.sky], 0, 190);
  twinkles(g, t, 16);
  const crack = seg(t, 0.6, 2.4), gap = sm(crack) * 110;
  const shake = t > 0.25 && t < 0.9 ? Math.sin(t * 70) * 2 : 0;
  // The pit underneath.
  g.fillStyle = C.ink; g.fillRect(0, 190, W, 50);
  for (const side of [-1, 1]) {
    const edge = 160 + side * (gap / 2 + 1) + shake;
    g.fillStyle = C.wood;
    if (side < 0) g.fillRect(0, 190, edge, 50); else g.fillRect(edge, 190, W - edge, 50);
    g.fillStyle = C.wood2; for (let i = 0; i < 5; i++) { const x = side < 0 ? edge - 20 - i * 36 : edge + 14 + i * 36; g.fillRect(x, 190, 2, 50); }
    // A jagged edge.
    g.beginPath(); g.moveTo(edge, 190);
    for (let k = 0; k <= 6; k++) g.lineTo(edge + side * (k % 2 ? 5 : 0), 190 + k * 8.4);
    g.lineTo(side < 0 ? 0 : W, 240); g.lineTo(side < 0 ? 0 : W, 190); g.closePath();
    g.fillStyle = C.wood; g.fill(); line(g, [0, 190, W, 190], 2.5);
    line(g, [edge, 190, edge + side * 5, 198.4, edge, 206.8, edge + side * 5, 215.2, edge, 223.6, edge + side * 5, 232, edge, 240.4], 2.2);
  }
  g.fillStyle = C.ink; g.fillRect(160 - gap / 2 + shake, 186, gap, 4);
  const reach = seg(t, 0.9, 1.4), apart = seg(t, 1.6, 2.4);
  for (const side of [-1, 1]) {
    const x = 160 + side * (gap / 2 + 24) + shake;
    const arm = reach > 0 ? lerp(-40, 8, sm(reach)) : -50;
    pin(g, x, 192, { h: 96, flip: side > 0, face: apart > 0 ? 'sad' : t > 0.6 ? 'scared' : 'happy', arms: [-50, arm], look: [-side, 0] });
  }
  if (apart > 0) for (const side of [-1, 1]) drop(g, 160 + side * (gap / 2 + 18), 120 + apart * 30, 1.4);
  if (t > 0.6) words(g, 'CRACK!', 160, 50, 30, C.gold, -0.06, seg(t, 0.6, 0.66) * (1 - seg(t, 1.3, 1.5)));
});

// The 7-10: two tiny pins on the far edges of a canyon at sunset. One waves; the other waves back. The wind blows a
// tumbleweed across, and a call goes out and echoes back.
gag('canyon', 'split710', 2.9, 1.9, [[0.1, 'wind'], [1.0, 'hello'], [1.55, 'echo']], (g, t) => {
  bands(g, [C.purple, C.violet, C.coral, C.orange, C.gold], 0, 150);
  ellipse(g, 160, 150, 34, 34, C.sun, 0);
  // Far mesas.
  g.fillStyle = C.rock2; g.beginPath(); g.moveTo(60, 150); g.lineTo(70, 118); g.lineTo(110, 118); g.lineTo(118, 150); g.moveTo(200, 150); g.lineTo(212, 126); g.lineTo(250, 126); g.lineTo(262, 150); g.fill();
  // The canyon: deep, in layers.
  bands(g, [C.rock, C.rock2, C.dbrown, C.ink], 150, H);
  for (const side of [-1, 1]) {
    const x = side < 0 ? 0 : W;
    g.beginPath(); g.moveTo(x, 120); g.lineTo(x + side * -46, 120); g.lineTo(x + side * -40, 160); g.lineTo(x + side * -52, 200); g.lineTo(x + side * -44, 240); g.lineTo(x, 240); g.closePath();
    inked(g, C.rock, 2.4);
    g.fillStyle = C.rock2; g.fillRect(side < 0 ? 0 : W - 44, 150, 44, 4); g.fillRect(side < 0 ? 0 : W - 48, 190, 48, 4);
  }
  const wave = t > 0.5 && t < 1.6 ? Math.sin(t * 16) * 30 + 70 : -50;
  const back2 = t > 1.0 && t < 2.2 ? Math.sin(t * 13) * 30 + 70 : -50;
  pin(g, 24, 121, { h: 40, arms: [-50, wave], face: t > 1.6 ? 'sad' : 'happy', look: [1, 0] });
  pin(g, 296, 121, { h: 40, flip: true, arms: [-50, back2], face: t > 2.2 ? 'sad' : 'happy', look: [1, 0] });
  // The tumbleweed down below, and the wind.
  const tw = lerp(-30, 360, seg(t, 0.4, 2.6));
  tumbleweed(g, tw, 208 - Math.abs(Math.sin(t * 7)) * 14, 14, t * 9);
  for (let i = 0; i < 3; i++) { const x = ((t * 140 + i * 120) % 400) - 40; line(g, [x, 60 + i * 30, x + 30, 60 + i * 30], 1.5, 'rgba(255,255,255,0.6)'); }
  if (t > 1.0) bubble(g, 76, 66, 'HELLO?', 13, 34, 92, seg(t, 1.0, 1.2));
  if (t > 1.55) words(g, 'hello...', 220, 62, 12, C.cream, 0, 1 - seg(t, 2.3, 2.9));
  if (t > 1.9) words(g, 'hello...', 250, 88, 9, C.cream, 0, 0.7 - seg(t, 2.3, 2.9));
});

// -- Picked up --------------------------------------------------------------------------------------------------

// The hero: the ball, in a cape and mask, flies in, bops one pin, ricochets to the other, and lands in a pose.
gag('hero', 'pickup', 2.7, 1.9, [[0.1, 'whoosh'], [0.62, 'bonk'], [1.05, 'bonk'], [1.45, 'tada']], (g, t) => {
  bands(g, [C.sky, C.blue, C.sky, C.teal], 0, 200);
  // Clouds going by.
  for (let i = 0; i < 4; i++) { const x = ((-t * 60 + i * 110) % 440 + 440) % 440 - 60; for (const [dx, r] of [[0, 14], [16, 18], [34, 13]]) ellipse(g, x + dx, 50 + i % 2 * 40 + (dx === 16 ? -6 : 0), r * 1.3, r * 0.9, C.white, 0); }
  boards(g, 200);
  const hit1 = 0.6, hit2 = 1.03, land = 1.4;
  // The two pins, each flying off when hit.
  for (const [i, px, at] of [[0, 70, hit1], [1, 260, hit2]]) {
    const u = t - at;
    if (u < 0) pin(g, px, 204, { h: 70, face: t > at - 0.3 ? 'shock' : 'happy', look: [i ? -1 : 1, -1], arms: t > at - 0.3 ? [60, 60] : [-50, -50] });
    else pin(g, px + (i ? 1 : -1) * u * 260, 204 - u * 300 + u * u * 400, { h: 70, face: 'dizzy', spin: u * 14 * (i ? 1 : -1), arms: [90, 90] });
    if (u > 0 && u < 0.3) kapow(g, px, 150, 22, 'POW', seg(u, 0, 0.1));
  }
  let bx, by;
  if (t < hit1) { const u = seg(t, 0, hit1); bx = lerp(340, 92, u); by = lerp(40, 168, u); }
  else if (t < hit2) { const u = seg(t, hit1, hit2); bx = lerp(92, 238, u); by = 168 - hop(u) * 70; }
  else { const u = seg(t, hit2, land); bx = lerp(238, 160, eo(u)); by = lerp(168, 176, bounce(u)) - hop(u) * 60; }
  if (t < land) for (let i = 1; i < 5; i++) ellipse(g, bx + (t < hit1 ? i * 9 : -i * 9), by - (t < hit1 ? i * 4 : 0), 2, 2, C.white, 0);
  ball(g, bx, by, 18, { cape: t, mask: true, face: t > land ? 'grin' : 'determined', brow: t > land ? null : 'angry', arms: t > land ? [-60, -60] : [30, 30], rot: t < land ? -0.3 : 0 });
  if (t > land) {
    for (let i = 0; i < 3; i++) firework(g, 60 + i * 100, 60 + (i % 2) * 20, seg(t, land + i * 0.2, land + 0.9 + i * 0.2), [C.gold, C.coral, C.white][i], i, 38);
    sparkle(g, 186, 150, hop(seg(t, land, land + 0.5)) * 10, C.white);
  }
});

// -- Gutter balls -----------------------------------------------------------------------------------------------

// Sheepish: the ball teeters on the edge of the lane, plops into the gutter, and looks up at us, sheepish, while the pins
// fall about laughing.
gag('sheepish', 'gutter', 2.7, 1.7, [[0.95, 'plop'], [1.2, 'sadHorn'], [1.7, 'giggle']], (g, t) => {
  bands(g, [C.deep, C.night, C.purple, C.night], 0, 112);
  // The back wall's lit band, with stars.
  g.fillStyle = C.sky; g.fillRect(0, 30, W, 40); line(g, [0, 30, W, 30], 2); line(g, [0, 70, W, 70], 2);
  for (let i = 0; i < 6; i++) sparkle(g, 20 + i * 56, 50, 3 + Math.sin(t * 4 + i) * 1.2, C.teal);
  // The lane, the gutter along the front.
  g.fillStyle = C.wood; g.fillRect(0, 112, W, 64);
  g.fillStyle = C.wood2; for (let i = 0; i < 7; i++) g.fillRect(0, 118 + i * 8, W, 1.4);
  line(g, [0, 112, W, 112], 2.5);
  g.fillStyle = '#4a5268'; g.fillRect(0, 176, W, 44); g.fillStyle = '#1b1f2b'; g.fillRect(0, 188, W, 20);
  line(g, [0, 176, W, 176], 2.5); line(g, [0, 220, W, 220], 2.5);
  g.fillStyle = C.deep; g.fillRect(0, 220, W, 20);
  // Pins at the right, laughing.
  const laugh = t > 1.45;
  for (let i = 0; i < 3; i++) pin(g, 230 + i * 30, 132 + i % 2 * 6, { h: 60, face: laugh ? 'laugh' : t > 0.6 ? 'shock' : 'happy', arms: laugh ? [Math.sin(t * 30 + i) * 25 - 30, Math.sin(t * 30 + i + 1) * 25 - 30] : [-55, -55], spin: laugh ? Math.sin(t * 28 + i) * 0.14 : 0, look: [-1, 0.5] });
  if (laugh) for (let i = 0; i < 3; i++) words(g, 'HA', 222 + i * 32, 52 - Math.abs(Math.sin(t * 9 + i)) * 8, 16, C.white, (i - 1) * 0.15, seg(t, 1.45 + i * 0.1, 1.55 + i * 0.1));
  // The ball: rolling, wobbling at the edge, then in.
  const x = lerp(-40, 100, eo(seg(t, 0, 0.6)));
  const teeter = seg(t, 0.6, 0.95), drop = seg(t, 0.95, 1.1);
  let by = 150, rot = x / 26;
  if (t > 0.6) { rot = Math.sin(teeter * 20) * 0.3; by = 150 + Math.sin(teeter * 20) * 2; }
  if (drop > 0) by = lerp(150, 196, ei(drop)) + (t > 1.1 ? -hop(seg(t, 1.1, 1.3)) * 5 : 0);
  const sheep = t > 1.3;
  g.save(); g.beginPath(); g.rect(0, 0, W, drop > 0.4 ? 212 : 240); g.clip();
  ball(g, x + drop * 8, by, 26, { rot, face: sheep ? 'sheepish' : t > 0.6 ? 'scared' : 'happy', look: sheep ? [0, -1] : [1, 0], blush: sheep, sweat: sheep ? t * 1.5 : undefined });
  g.restore();
  if (t > 0.6 && drop === 0) bang(g, x, 106, t - 0.6, '!?');
  if (t > 0.96 && t < 1.5) words(g, 'plop', x + 60, 170, 18, C.white, 0.2, 1 - seg(t, 1.3, 1.5));
});

// Snooze: the pins are asleep on their feet; the ball trundles past in the gutter, one pin opens an eye, decides it's
// nothing, and nods off again.
gag('snooze', 'gutter', 2.6, 1.35, [[0.2, 'snore'], [1.3, 'peek'], [1.9, 'snore']], (g, t) => {
  bands(g, [C.deep, C.night, C.deep], 0, 172);
  twinkles(g, t, 24);
  ellipse(g, 60, 46, 16, 16, C.sun, 0); ellipse(g, 68, 40, 14, 14, C.deep, 0);
  boards(g, 172, C.wood, C.wood2);
  const spots = [[166, 172, 56], [200, 172, 56], [234, 172, 56], [268, 172, 56], [183, 190, 64], [217, 190, 66], [251, 190, 64]];
  spots.forEach(([x, y, h], i) => {
    const peeker = i === 5, peek = peeker && t > 1.25 && t < 1.85;
    pin(g, x, y, { h, face: peek ? 'peek' : 'sleep', look: [-1, 0.4], sway: Math.sin(t * 2.5 + i) * 0.05, arms: peek && t > 1.55 ? [30, 30] : null });
  });
  for (let i = 0; i < 4; i++) {
    const u = (t * 0.6 + i * 0.25) % 1;
    if (!(t > 1.25 && t < 1.85 && i % 2)) words(g, 'Z', 196 + i * 20 + u * 24, 100 - u * 54, 12 + u * 12, C.white, 0, 1 - u);
  }
  if (t > 1.55 && t < 1.85) words(g, 'meh.', 256, 96, 16, C.white, 0.1, 1);
  // The gutter in front, and the ball going along it.
  g.fillStyle = '#3a4152'; g.fillRect(0, 206, W, 26); g.fillStyle = '#151821'; g.fillRect(0, 214, W, 10);
  line(g, [0, 206, W, 206], 2.5); line(g, [0, 232, W, 232], 2.5);
  g.fillStyle = C.deep; g.fillRect(0, 232, W, 8);
  const bx = lerp(-30, 350, seg(t, 0.1, 2.4));
  g.save(); g.beginPath(); g.rect(0, 0, W, 222); g.clip();
  ball(g, bx, 203, 17, { rot: 0, face: 'sheepish', blush: true, look: [0, -1] });
  g.restore();
});

// The lazy river: the ball floats down the gutter on a rubber ring in sunglasses, not a care in the world.
gag('river', 'gutter', 2.6, 1.3, [[0.3, 'plop'], [0.9, 'ukulele']], (g, t) => {
  bands(g, [C.teal, C.mint, C.teal], 0, 150);
  ellipse(g, 270, 40, 20, 20, C.sun, 2);
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + t; line(g, [270 + Math.cos(a) * 26, 40 + Math.sin(a) * 26, 270 + Math.cos(a) * 34, 40 + Math.sin(a) * 34], 2.5, C.sun); }
  // A palm tree, why not.
  line(g, [40, 152, 48, 70], 6, C.dbrown);
  for (let i = 0; i < 5; i++) { const a = -Math.PI + i * Math.PI / 4 + Math.sin(t * 2) * 0.05; g.beginPath(); g.ellipse(48 + Math.cos(a) * 18, 70 + Math.sin(a) * 9, 20, 6, a, 0, Math.PI * 2); inked(g, C.green, 2); }
  // The water in the gutter, rippling.
  g.fillStyle = C.blue; g.fillRect(0, 150, W, 90);
  g.fillStyle = C.wood; g.fillRect(0, 140, W, 12); line(g, [0, 140, W, 140], 2.5); line(g, [0, 152, W, 152], 2.5);
  for (let r = 0; r < 4; r++) for (let i = 0; i < 9; i++) { const x = ((i * 44 + t * 40 * (r + 1)) % 360) - 20, y = 168 + r * 18; line(g, [x, y, x + 8, y - 3, x + 16, y], 1.6, C.mint); }
  const bx = lerp(-40, 360, seg(t, 0, 2.6)), bob = Math.sin(t * 5) * 2.5;
  ellipse(g, bx, 196 + bob, 30, 10, C.pink, 2.4);
  ellipse(g, bx, 194 + bob, 14, 4, C.blue, 0);
  ball(g, bx, 180 + bob, 18, { glasses: true, face: 'grin', arms: [110, 110] });
  g.beginPath(); g.ellipse(bx, 196 + bob, 30, 10, 0, 0, Math.PI); inked(g, C.pink, 2.4);
  g.fillStyle = C.white; g.fillRect(bx - 18, 200 + bob, 6, 3); g.fillRect(bx + 10, 200 + bob, 6, 3);
  if (t > 0.9) for (let i = 0; i < 2; i++) { const u = (t * 0.9 + i * 0.5) % 1; note(g, bx + 24 + u * 20, 150 - u * 40, 1, C.white); }
});

// -- A miss that wasn't a gutter ball ---------------------------------------------------------------------------

// Crickets: the ball whooshes straight past the pin, which spins round in the wind, looks about, and shrugs; crickets.
gag('crickets', 'whiff', 2.3, 1.35, [[0.3, 'whoosh'], [1.3, 'cricket'], [1.8, 'cricket']], (g, t) => {
  bands(g, [C.deep, C.night, C.deep], 0, 186);
  twinkles(g, t, 30);
  ellipse(g, 262, 50, 18, 18, C.cream, 0);
  boards(g, 186, C.wood, C.wood2);
  const pass = 0.35, spin = seg(t, pass, pass + 0.6);
  const shrug = t > 1.2;
  pin(g, 170, 194, { h: 110, turn: spin > 0 && spin < 1 ? Math.cos(eo(spin) * Math.PI * 6) : undefined, face: shrug ? 'blank' : spin >= 1 ? 'dizzy' : spin > 0 ? 'shock' : 'happy', arms: shrug ? [40, 40] : spin > 0 && spin < 1 ? [80, 80] : [-55, -55], look: t > 0.95 && t < 1.2 ? [Math.sin(t * 20) > 0 ? 1 : -1, 0] : [0, 0] });
  if (spin > 0 && spin < 1) for (let i = 0; i < 3; i++) { const a = spin * 12 + i * 2.1; line(g, [170 + Math.cos(a) * 24, 120 + Math.sin(a) * 6, 170 + Math.cos(a + 0.6) * 24, 120 + Math.sin(a + 0.6) * 6], 2, C.white); }
  const bx = lerp(-40, 380, seg(t, pass - 0.12, pass + 0.12));
  if (t < pass + 0.2) { ball(g, bx, 174, 14, { rot: bx / 14, face: 'determined' }); speedLines(g, bx - 10, 174, 40, 3); }
  if (t > 1.3) words(g, 'chirp', 70, 150 - hop(seg(t, 1.3, 1.6)) * 6, 15, C.mint, -0.1, seg(t, 1.3, 1.35));
  if (t > 1.8) words(g, 'chirp', 268, 140 - hop(seg(t, 1.8, 2.1)) * 6, 15, C.mint, 0.1, seg(t, 1.8, 1.85));
});

// Phew: the ball sails by; the pin pats itself all over, finds nothing missing, and gives a thumbs up.
gag('phew', 'whiff', 2.3, 1.6, [[0.3, 'whoosh'], [1.45, 'phew']], (g, t) => {
  bands(g, [C.sky, C.blue, C.sky], 0, 190);
  boards(g, 190);
  const bx = lerp(-40, 380, seg(t, 0.15, 0.5));
  const pat = t > 0.6 && t < 1.35;
  const arms = pat ? [Math.sin(t * 24) * 40 - 30, Math.cos(t * 24) * 40 - 30] : t > 1.35 ? [-50, 105 + Math.sin(seg(t, 1.35, 1.9) * Math.PI * 2) * 6] : [-55, -55];
  pin(g, 170, 198, { h: 116, front: t > 1.35, reach: t > 1.35 ? 1.95 : 1, face: t > 1.35 ? 'swoon' : pat ? 'nervous' : t > 0.3 ? 'shock' : 'happy', arms, look: pat ? [0, 1] : [-1, 0], sweat: pat ? t * 2 : undefined });
  if (t > 1.35) {
    // A wipe of the brow, and the sweat flicked off.
    const u = seg(t, 1.45, 2.0);
    if (u > 0 && u < 1) drop(g, 200 + u * 60, 80 - hop(u) * 34 + u * 50, 2.6);
  }
  if (t < 0.6) { ball(g, bx, 184, 14, { rot: bx / 14, face: 'determined' }); speedLines(g, bx - 10, 184, 46, 3); }
  if (t > 1.45) words(g, 'phew!', 90, 80, 22, C.white, -0.1, seg(t, 1.45, 1.55));
});

// ---- The monitor ----------------------------------------------------------------------------------------------

const ON = 0.3, OFF = 0.22;   // the picture switching on and off, s

// The monitor on its canvas: the case, and in it the picture with its scanlines.
export class Screen {
  constructor(canvas, { cue = () => {} } = {}) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.cue = cue;
    this.now = null;        // what's playing: { id, event, n, t, still, end (s, or null), cued }
    this.last = {};         // the gag each event played last, so it doesn't come round twice running
    this.box = null;
  }

  get playing() { return !!this.now; }

  // Plays a gag for an event ({ event, n }) in `box` (see fit). `still` draws one frame of it and holds it, for Reduce
  // Motion. Returns what it's playing.
  play(ev, box, { still = false, rand = Math.random } = {}) {
    const id = pick(ev.event, this.last[ev.event], rand);
    if (!id || !box) return null;
    this.last[ev.event] = id;
    this.now = { id, event: ev.event, n: ev.n || 0, t: 0, still, cued: 0, end: null };
    this.place(box);
    this.c.hidden = false;
    this.draw();
    return this.now;
  }

  // Where the monitor goes, in CSS px.
  place(box) {
    this.box = box;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    Object.assign(this.c.style, { left: `${Math.round(box.x)}px`, top: `${Math.round(box.y)}px`, width: `${Math.round(box.w)}px`, height: `${Math.round(box.h)}px` });
    this.c.width = Math.round(box.w * dpr); this.c.height = Math.round(box.h * dpr);
    this.dpr = dpr;
  }

  // How long the whole thing takes, switching on and off included.
  get length() { return this.now ? ON + GAGS[this.now.id].dur + OFF : 0; }

  // The game's clock moving on dt seconds (already sped up when the game is).
  tick(dt) {
    const p = this.now;
    if (!p) return;
    p.t += dt;
    const gagT = p.t - ON, cues = GAGS[p.id].cues;
    // Sounds as their moments come (all of them at once if a still is up: none of it moves, but it's still heard).
    while (p.cued < cues.length && gagT >= [...cues].sort((a, b) => a[0] - b[0])[p.cued][0]) this.cue([...cues].sort((a, b) => a[0] - b[0])[p.cued++][1], p);
    if (p.end === null && p.t >= this.length - OFF) p.end = p.t;
    if (p.end !== null && p.t >= p.end + (p.still ? 0.15 : OFF)) this.clear();
  }

  // Ends it now: switching off quickly (a tap), or gone at once.
  stop(at = true) {
    if (!this.now) return;
    if (!at) { this.clear(); return; }
    if (this.now.end === null || this.now.end > this.now.t) this.now.end = this.now.t;
  }

  clear() { this.now = null; this.c.hidden = true; }

  draw() {
    const p = this.now;
    if (!p) return;
    const { g } = this, w = this.c.width / this.dpr, h = this.c.height / this.dpr;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    paint(g, w, h, p, this.dpr);
  }
}

// The monitor, w x h px, with the picture for `p` ({ id, n, t, still, end }) on it.
const pictures = new WeakMap();
export function paint(g, w, h, p, dpr = 1) {
  g.clearRect(0, 0, w, h);
  const still = p.still, t = p.t;
  // Popping in, and out again.
  const inU = still ? 1 : seg(t, 0, 0.22), outU = p.end === null ? 0 : seg(t, p.end, p.end + (still ? 0.15 : OFF));
  const k = still ? 1 : back(inU) * (1 - 0.06 * outU);
  g.save();
  g.globalAlpha = clamp(still ? 1 - outU : inU * 3) * (1 - outU);
  g.translate(w / 2, h * 0.1); g.scale(k, k); g.translate(-w / 2, -h * 0.1);
  monitorCase(g, w, h);
  const b = Math.max(7, w * 0.045), ix = b, iy = b, iw = w - 2 * b, ih = h - b * 2.25;
  const r = Math.max(6, w * 0.035);
  g.save();
  g.beginPath(); g.roundRect(ix, iy, iw, ih, r); g.clip();
  g.fillStyle = '#05060c'; g.fillRect(ix, iy, iw, ih);
  // The picture, drawn small and blown up so its pixels show a little.
  const def = GAGS[p.id];
  const gt = still ? def.still : clamp(t - ON, 0, def.dur);
  const pic = picture(g.canvas);
  const pg = pic.getContext('2d');
  pg.setTransform(1, 0, 0, 1, 0, 0);
  pg.clearRect(0, 0, W, H);
  def.draw(pg, gt, p.n);
  // Switching on: a line across the middle that opens up; switching off, the other way.
  let sy = 1, sx = 1, flash = 0;
  if (!still) {
    const on = seg(t, 0.06, ON);
    if (on < 1) { sx = on < 0.45 ? eo(on / 0.45) : 1; sy = on < 0.45 ? 0.012 : eo((on - 0.45) / 0.55); flash = 1 - on; }
    if (outU > 0) { sy *= 1 - eo(seg(outU, 0, 0.6)) * 0.99; sx *= 1 - eo(seg(outU, 0.5, 1)); flash = Math.max(flash, outU); }
  }
  const scale = Math.min(iw / W, ih / H);
  g.imageSmoothingEnabled = scale * dpr < 2;
  const dw = iw * sx, dh = ih * sy;
  g.drawImage(pic, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
  g.imageSmoothingEnabled = true;
  if (flash > 0) { g.fillStyle = `rgba(230,250,255,${0.85 * flash})`; g.fillRect(ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh); }
  // Scanlines, a darker edge and a shine across the glass.
  g.fillStyle = 'rgba(0,0,12,0.2)';
  const step = Math.max(2, ih / H * 2);
  for (let y = iy; y < iy + ih; y += step) g.fillRect(ix, Math.round(y), iw, Math.max(1, step * 0.4));
  const vg = g.createRadialGradient(ix + iw / 2, iy + ih / 2, Math.min(iw, ih) * 0.45, ix + iw / 2, iy + ih / 2, Math.max(iw, ih) * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,10,0.5)');
  g.fillStyle = vg; g.fillRect(ix, iy, iw, ih);
  const sh = g.createLinearGradient(ix, iy, ix + iw * 0.5, iy + ih * 0.6);
  sh.addColorStop(0, 'rgba(255,255,255,0.12)'); sh.addColorStop(0.5, 'rgba(255,255,255,0.03)'); sh.addColorStop(0.51, 'rgba(255,255,255,0)');
  g.fillStyle = sh; g.fillRect(ix, iy, iw, ih);
  g.restore();
  g.restore();
}

// The low picture each canvas draws into, made once.
function picture(c) {
  let pic = pictures.get(c);
  if (!pic) {
    pic = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    pictures.set(c, pic);
  }
  return pic;
}

// The case: a chunky old monitor in dark plum, with a gold trim, two bolts and a row of little lights along the bottom.
function monitorCase(g, w, h) {
  const r = Math.max(10, w * 0.06);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
  g.beginPath(); g.roundRect(0.5, 0.5, w - 1, h - 1, r);
  const body = g.createLinearGradient(0, 0, 0, h);
  body.addColorStop(0, '#3a2c5c'); body.addColorStop(1, '#1d1636');
  g.fillStyle = body; g.fill();
  g.restore();
  g.lineWidth = 2; g.strokeStyle = '#ffc94a'; g.globalAlpha *= 0.9;
  g.beginPath(); g.roundRect(3, 3, w - 6, h - 6, r - 2.5); g.stroke();
  g.globalAlpha /= 0.9;
  g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.roundRect(1.5, 1.5, w - 3, h - 3, r - 1); g.stroke();
  const b = Math.max(7, w * 0.045);
  // The glass's deep surround.
  g.fillStyle = '#0b0918';
  g.beginPath(); g.roundRect(b - 3, b - 3, w - 2 * b + 6, h - b * 2.25 + 6, Math.max(6, w * 0.035) + 3); g.fill();
  for (const x of [b * 0.55, w - b * 0.55]) { g.fillStyle = '#a3461c'; g.beginPath(); g.arc(x, b * 0.55, Math.max(1.5, b * 0.16), 0, Math.PI * 2); g.fill(); }
}

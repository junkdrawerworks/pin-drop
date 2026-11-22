// The balls a player can bowl with: six plain ones any player can pick, and ten more, each with a pattern of its own,
// earned by playing (the first game, the first strike, a turkey, 10 games...). One function draws every ball, so the
// ball rolling down the lane, the picker on the title and the little dots on the scorecards all match; and the rules
// for earning each are here too, worked out from a game's list of balls (see scoring.js).
import { next, total, stats } from './scoring.js';

const TAU = Math.PI * 2;

// Each look: its id (kept with a player's games and picks), its name, its colours [light, mid, dark] for the ball's
// shading, `ink` (a colour to read on the dark panels: the scorecard's dot, the name on the card as the turn passes)
// and its pattern. An earned ball also says how to earn it (`how`, under it while it's locked) and what earned it
// (`why`, on the end card: "New ball for Ana: Marble · your first strike").
const look = (id, name, colours, more = {}) => ({ id, name, colours, ink: colours[0], pattern: 'plain', ...more });
export const PLAIN = [
  look('blue', 'Blue', ['#5aa8ff', '#1d4fa8', '#0b1d45']),
  look('red', 'Red', ['#ff7a6b', '#c22d2d', '#4a0d14']),
  look('green', 'Green', ['#7be0a4', '#1f8f5c', '#0b3322']),
  look('purple', 'Purple', ['#c9a0ff', '#6b3fc4', '#24124d']),
  look('orange', 'Orange', ['#ffb366', '#e0661a', '#5a2208']),
  look('pink', 'Pink', ['#ff9ad5', '#d63d93', '#4d0f33']),
];
// In the order they tend to come: the first two in a first game, the last only with a perfect one.
export const EARNED = [
  look('pearl', 'Pearl', ['#ffffff', '#e4d9f0', '#7f7299'], { pattern: 'pearl', ink: '#f1e6ff', how: 'Finish your first game', why: 'your first game' }),
  look('marble', 'Marble', ['#ffffff', '#dcd7cd', '#77726a'], { pattern: 'marble', ink: '#ebe6dc', how: 'Bowl your first strike', why: 'your first strike' }),
  look('twotone', 'Two-tone', ['#8ff5ea', '#14a39a', '#053d3a'], { pattern: 'twotone', other: ['#ffa3d6', '#d1287f', '#4a0629'], how: 'Pick up a split', why: 'a split picked up' }),
  look('sparkle', 'Sparkle', ['#a596ff', '#4325c4', '#12063a'], { pattern: 'sparkle', ink: '#b9adff', how: 'Bowl a turkey', why: 'a turkey' }),
  look('flame', 'Flame', ['#5d5d6b', '#1d1d26', '#050507'], { pattern: 'flame', ink: '#ffae45', how: 'Play 10 games', why: '10 games played' }),
  look('target', 'Target', ['#ffffff', '#ebe6de', '#8a8378'], { pattern: 'target', ink: '#ff7b73', how: 'Make 7 of 10 in Practise spares', why: '7 of 10 spares made' }),
  look('galaxy', 'Galaxy', ['#5b4fd0', '#1b1446', '#04030c'], { pattern: 'galaxy', ink: '#a99cff', how: 'Bowl a 200 game', why: 'a 200 game' }),
  look('stripe', 'Stripe', ['#5b78ff', '#1a2a8c', '#060a2e'], { pattern: 'stripe', ink: '#ffe14d', how: 'Bowl a clean game', why: 'a clean game' }),
  look('gold', 'Gold', ['#fff6c8', '#e0a91f', '#5c3a06'], { pattern: 'gold', ink: '#ffd760', how: 'Play 50 games', why: '50 games played' }),
  look('prism', 'Prism', ['#ffffff', '#d9d2ff', '#5d5394'], { pattern: 'prism', ink: '#cdbfff', how: 'Bowl a perfect game', why: 'a perfect game' }),
];
export const LOOKS = [...PLAIN, ...EARNED];
// The computer's ball: silver, and never anything else.
export const CPU_LOOK = look('silver', 'Silver', ['#eef1f7', '#8a91a6', '#2b2f3c']);
const BY_ID = new Map([...LOOKS, CPU_LOOK].map(l => [l.id, l]));
export const lookById = id => (typeof id === 'string' && BY_ID.get(id)) || null;
export const isPlain = id => PLAIN.some(l => l.id === id);

// The ball a player in a game (or a kept game's score) bowled with: the computer's silver; the look kept on them
// (`ball`); before there were looks, a colour by number (`c`, one of the first four plain balls); or, with neither,
// the plain ball for their place.
export function lookFor(q, i = 0) {
  if (q?.cpu) return CPU_LOOK;
  const kept = lookById(q?.ball);
  if (kept && kept !== CPU_LOOK) return kept;
  if (Number.isInteger(q?.c) && q.c >= 0) return PLAIN[q.c % 4];
  return PLAIN[((i % PLAIN.length) + PLAIN.length) % PLAIN.length];
}

// ---- Earning ---------------------------------------------------------------------------------------------------

const int = v => Math.max(0, Math.trunc(Number(v)) || 0);
// Balls earned by how many games a player has played (any game they finished, bumpers or not).
export const BY_GAMES = { pearl: 1, flame: 10, gold: 50 };
// Spare practice: how many of its ten leaves to make for the Target.
export const TARGET = 7;

// The balls one player's finished game earns by itself, from its balls: a strike (Marble), a split picked up (Two-tone),
// three strikes in a row (Sparkle), and, without bumpers, 200 or more (Galaxy), a strike or spare in every frame
// (Stripe) and 300 (Prism). A head start doesn't come into it: these are the pins they bowled. The computer earns
// nothing. A game kept with only its score (from before the balls were kept) can still be a 200 or a perfect game.
export function gameEarns(q) {
  if (!q || q.cpu || typeof q.name !== 'string') return [];
  const out = [];
  const rolls = Array.isArray(q.rolls) ? q.rolls.map(int) : null;
  const helped = !!q.bumpers;
  if (!rolls) {
    const pins = int(q.score) - int(q.head);
    if (!helped && pins >= 200) out.push('galaxy');
    if (!helped && pins === 300) out.push('prism');
    return out;
  }
  let run = 0, turkey = false, strike = false;
  for (let k = 0; k < rolls.length; k++) {
    const st = next(rolls.slice(0, k));
    if (st.done) break;
    if (!st.fresh) continue;
    if (rolls[k] === 10) { strike = true; if (++run >= 3) turkey = true; } else run = 0;
  }
  if (strike) out.push('marble');
  // A split (a first ball, kept by its place in the list, that left pins in two or more groups) and the next ball
  // taking the rest.
  const splits = Array.isArray(q.splits) ? q.splits : [];
  if (splits.some(k => Number.isInteger(k) && k + 1 < rolls.length && rolls[k] < 10 && next(rolls.slice(0, k)).fresh
    && !next(rolls.slice(0, k + 1)).fresh && rolls[k] + rolls[k + 1] === 10)) out.push('twotone');
  if (turkey) out.push('sparkle');
  const done = next(rolls).done;
  if (!helped && done && total(rolls) >= 200) out.push('galaxy');
  if (!helped && done && stats(rolls).open === 0) out.push('stripe');
  if (!helped && done && total(rolls) === 300) out.push('prism');
  return out;
}

// Spare practice earns the Target with TARGET or more of its ten leaves made, and nothing else.
export const practiceEarns = made => (made >= TARGET ? ['target'] : []);

// Every ball a list of kept games shows each player has earned (by name, with no prototype, so a name is just a name),
// each with when: the end of the first game that earned it. Oldest first, counting each player's games as it goes.
export function earnedIn(games) {
  const out = Object.create(null), played = Object.create(null);
  const list = (Array.isArray(games) ? games : []).filter(g => g && Number.isFinite(g.at) && Array.isArray(g.scores)).sort((a, b) => a.at - b.at);
  for (const g of list) {
    for (const q of g.scores) {
      if (!q || q.cpu || typeof q.name !== 'string') continue;
      const mine = Object.hasOwn(out, q.name) ? out[q.name] : (out[q.name] = Object.create(null));
      played[q.name] = (Object.hasOwn(played, q.name) ? played[q.name] : 0) + 1;
      const ids = [...gameEarns(q), ...Object.keys(BY_GAMES).filter(id => played[q.name] >= BY_GAMES[id])];
      for (const id of ids) if (!Object.hasOwn(mine, id)) mine[id] = Math.max(1, int(g.at));
    }
  }
  return out;
}

// ---- Drawing -----------------------------------------------------------------------------------------------------
// The ball is a sphere seen face on: x to the right, y down the screen, z towards the viewer. As it rolls it turns
// about the x axis, so the side facing the viewer moves up the screen (as the swirl and finger holes always have).
// Each pattern is made on the sphere and turned by `roll` before it's drawn, so it rolls with the ball.

const turn = ([x, y, z], a) => { const c = Math.cos(a), s = Math.sin(a); return [x, y * c - z * s, y * s + z * c]; };
const unit = ([x, y, z]) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// The same pattern every time for a look, from a seed.
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const onSphere = r => { const z = r() * 2 - 1, a = r() * TAU, s = Math.sqrt(1 - z * z); return [s * Math.cos(a), s * Math.sin(a), z]; };

// Adds to the path the part of the cap of the sphere where n·p > d that faces the viewer (n a unit vector, already
// turned). Filled 'evenodd', several caps on one path make bands. False when none of it shows.
function cap(g, cx, cy, R, n, d) {
  const r = Math.sqrt(Math.max(0, 1 - d * d));
  const u = unit(cross(n, Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0])), v = cross(n, u);
  const K = 72, pts = [];
  for (let k = 0; k < K; k++) {
    const t = k / K * TAU, c = Math.cos(t) * r, s = Math.sin(t) * r;
    pts.push([d * n[0] + c * u[0] + s * v[0], d * n[1] + c * u[1] + s * v[1], d * n[2] + c * u[2] + s * v[2]]);
  }
  const inside = p => dot(n, p) > d;
  const vis = pts.map(p => p[2] >= 0), seen = vis.filter(Boolean).length;
  const at = p => [cx + R * p[0], cy + R * p[1]];
  const disc = () => { g.moveTo(cx + R, cy); g.arc(cx, cy, R, 0, TAU); g.closePath(); };
  const ring = () => { pts.forEach((p, k) => (k ? g.lineTo(...at(p)) : g.moveTo(...at(p)))); g.closePath(); };
  if (seen === K) {
    // The whole edge of the cap shows: the cap is inside it, or everything round it (the edge of the ball included).
    if (inside([1, 0, 0])) disc();
    ring();
    return true;
  }
  if (seen === 0) {
    if (!inside([0, 0, 1])) return false;
    disc();
    return true;
  }
  // Where the edge of the cap goes round behind the ball: on the ball's outline.
  const edge = (a, b) => { const t = a[2] / (a[2] - b[2]), x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, l = Math.hypot(x, y) || 1; return [x / l, y / l, 0]; };
  const s0 = vis.findIndex((ok, k) => ok && !vis[(k - 1 + K) % K]);
  const a0 = edge(pts[(s0 - 1 + K) % K], pts[s0]);
  g.moveTo(...at(a0));
  let k = s0;
  while (vis[k]) { g.lineTo(...at(pts[k])); k = (k + 1) % K; }
  const a1 = edge(pts[(k - 1 + K) % K], pts[k]);
  g.lineTo(...at(a1));
  // Back round the outline, the way that's inside the cap.
  const from = Math.atan2(a1[1], a1[0]), to = Math.atan2(a0[1], a0[0]);
  const mid = from + (((to - from) % TAU) + TAU) % TAU / 2;
  g.arc(cx, cy, R, from, to, !inside([Math.cos(mid), Math.sin(mid), 0]));
  g.closePath();
  return true;
}

// Adds to the path a segment of the ball between two lines from pole to pole round the axis it turns about (x), at
// angles a0 to a1 (already turned): a slice of an orange. Only the half facing the viewer shows (angles 0 to π).
function lune(g, cx, cy, R, a0, a1) {
  const shift = Math.floor(a0 / TAU) * TAU;
  a0 -= shift; a1 -= shift;
  const N = 24, side = (a, back) => {
    for (let k = 0; k <= N; k++) {
      const s = (back ? N - k : k) / N * Math.PI;
      const x = cx + R * Math.cos(s), y = cy + R * Math.sin(s) * Math.cos(a);
      if (k === 0 && !back) g.moveTo(x, y); else g.lineTo(x, y);
    }
  };
  for (const lo of [0, TAU]) {
    const from = Math.max(a0, lo), to = Math.min(a1, lo + Math.PI);
    if (to <= from) continue;
    side(from, false); side(to, true); g.closePath();
  }
}

// A line over the ball through the points `pts` (on the sphere, turned), drawn only where it faces the viewer.
function trail(g, cx, cy, R, pts) {
  let on = false;
  g.beginPath();
  for (const p of pts) {
    if (p[2] < 0.02) { on = false; continue; }
    const x = cx + R * p[0], y = cy + R * p[1];
    if (on) g.lineTo(x, y); else g.moveTo(x, y);
    on = true;
  }
  g.stroke();
}

// The ball's own shading: a light top left, darker to the edge.
function shade(g, cx, cy, R, [hi, mid, dark]) {
  const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
  grad.addColorStop(0, hi); grad.addColorStop(0.5, mid); grad.addColorStop(1, dark);
  return grad;
}
// Over a pattern drawn in flat colours, the same light and shadow, so it stays round.
function overlay(g, cx, cy, R, dark = 0.42) {
  const grad = g.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.05, cx, cy, R);
  grad.addColorStop(0, 'rgba(255,255,255,0.22)'); grad.addColorStop(0.45, 'rgba(255,255,255,0)');
  grad.addColorStop(0.75, 'rgba(0,0,0,0.08)'); grad.addColorStop(1, `rgba(0,0,0,${dark})`);
  g.fillStyle = grad;
  g.fillRect(cx - R, cy - R, R * 2, R * 2);
}
const fillPath = (g, style, build) => { g.beginPath(); build(); g.fillStyle = style; g.fill('evenodd'); };

// The patterns, made once for each look: points and lines on the sphere, before it's turned.
const made = new Map();
function parts(id) {
  if (made.has(id)) return made.get(id);
  const r = seeded([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7));
  let p;
  if (id === 'marble') {
    // Veins: wandering lines over the sphere, a few bold and more faint, some branching off.
    const veins = [];
    const walk = (start, dir, steps, w) => {
      let at = start, t = unit(cross(cross(start, dir), start));
      const pts = [at];
      for (let i = 0; i < steps; i++) {
        const side = unit(cross(at, t)), bend = (r() - 0.5) * 0.9;
        t = unit([t[0] + side[0] * bend, t[1] + side[1] * bend, t[2] + side[2] * bend]);
        at = unit([at[0] + t[0] * 0.11, at[1] + t[1] * 0.11, at[2] + t[2] * 0.11]);
        t = unit(cross(cross(at, t), at));
        pts.push(at);
        if (w > 0.6 && r() < 0.12) veins.push({ pts: walk(at, onSphere(r), 6 + Math.floor(r() * 8), w * 0.5), w: w * 0.5 });
      }
      return pts;
    };
    for (let i = 0; i < 12; i++) { const w = i < 7 ? 1 : 0.45; veins.push({ pts: walk(onSphere(r), onSphere(r), 16 + Math.floor(r() * 10), w), w }); }
    p = { veins };
  } else if (id === 'sparkle') {
    const tints = ['#ffffff', '#ffffff', '#ffe27a', '#ff9ff0', '#9ff4ff'];
    p = { flecks: Array.from({ length: 140 }, () => ({ at: onSphere(r), size: 0.6 + r() * 0.8, tint: tints[Math.floor(r() * tints.length)], phase: r() * TAU })) };
  } else if (id === 'galaxy') {
    const hues = ['255,79,216', '79,216,255', '160,110,255', '255,79,216'];
    p = {
      clouds: Array.from({ length: 6 }, (_, i) => ({ at: onSphere(r), size: 0.45 + r() * 0.35, rgb: hues[i % hues.length] })),
      stars: Array.from({ length: 70 }, () => ({ at: onSphere(r), size: r() < 0.12 ? 2.2 : 0.6 + r() * 0.7 })),
    };
  } else if (id === 'flame') {
    // Tongues of flame licking up from round one pole (straight down the screen, before it rolls) past the middle.
    const tongues = [];
    const N = 9;
    for (let k = 0; k < N; k++) {
      const mid = k / N * TAU, w = TAU / N * 1.15, tip = -0.15 - r() * 0.55, flick = (r() - 0.35) * 0.45;
      tongues.push({ mid, w, tip, flick });
    }
    p = { tongues };
  }
  made.set(id, p);
  return p;
}

// A point on the sphere at latitude `lat` (towards the pole `a`) and longitude `lon` round it, with e1 and e2 across.
const sph = (a, e1, e2, lat, lon) => {
  const c = Math.cos(lat), s = Math.sin(lat), x = Math.cos(lon) * c, y = Math.sin(lon) * c;
  return [a[0] * s + e1[0] * x + e2[0] * y, a[1] * s + e1[1] * x + e2[1] * y, a[2] * s + e1[2] * x + e2[2] * y];
};

const PATTERNS = {
  // Soft bands of colour over a pale ball, the way the light plays on a pearl.
  pearl(g, cx, cy, R, ph) {
    for (const [n, w, rgb, a] of [[[0.25, 0.55, 0.8], 0.4, '255,180,225', 0.32], [[-0.5, 0.75, -0.2], 0.3, '160,225,255', 0.3], [[0.85, -0.2, 0.45], 0.22, '150,120,200', 0.22]]) {
      const m = turn(unit(n), ph);
      fillPath(g, `rgba(${rgb},${a * 0.5})`, () => { cap(g, cx, cy, R, m, -w * 1.35); cap(g, cx, cy, R, m, w * 1.35); });
      fillPath(g, `rgba(${rgb},${a})`, () => { cap(g, cx, cy, R, m, -w); cap(g, cx, cy, R, m, w); });
    }
    overlay(g, cx, cy, R, 0.3);
  },
  marble(g, cx, cy, R, ph) {
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const v of parts('marble').veins) {
      const pts = v.pts.map(q => turn(q, ph));
      g.strokeStyle = v.w > 0.6 ? 'rgba(44,44,54,0.9)' : 'rgba(110,104,98,0.6)';
      g.lineWidth = Math.max(v.w > 0.6 ? 1 : 0.6, R * 0.055 * v.w);
      trail(g, cx, cy, R, pts);
    }
    overlay(g, cx, cy, R, 0.32);
  },
  // Half one colour and half another, the line between them rolling over the ball.
  twotone(g, cx, cy, R, ph, l) {
    fillPath(g, shade(g, cx, cy, R, l.other), () => lune(g, cx, cy, R, ph + 0.5, ph + 0.5 + Math.PI));
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(1, R * 0.05);
    for (const a of [ph + 0.5, ph + 0.5 + Math.PI]) {
      const c = Math.cos(a);
      if (Math.sin(a) < 0) continue;
      g.beginPath();
      for (let k = 0; k <= 24; k++) { const s = k / 24 * Math.PI, x = cx + R * Math.cos(s), y = cy + R * Math.sin(s) * c; if (k) g.lineTo(x, y); else g.moveTo(x, y); }
      g.stroke();
    }
    overlay(g, cx, cy, R, 0.25);
  },
  // Glitter: flecks of white, gold, pink and blue that catch the light as the ball turns.
  sparkle(g, cx, cy, R, ph) {
    const s = Math.max(0.9, R * 0.06);
    for (const f of parts('sparkle').flecks) {
      const q = turn(f.at, ph);
      if (q[2] < 0.05) continue;
      const lit = Math.sqrt(q[2]) * (0.55 + 0.45 * Math.sin(f.phase + ph * 2));
      g.globalAlpha = Math.max(0.15, lit);
      g.fillStyle = f.tint;
      const z = s * f.size;
      g.fillRect(cx + R * q[0] - z / 2, cy + R * q[1] - z / 2, z, z);
    }
    g.globalAlpha = 1;
    overlay(g, cx, cy, R, 0.3);
  },
  flame(g, cx, cy, R, ph) {
    const a = turn([0, 1, 0], ph), e1 = turn([1, 0, 0], ph), e2 = turn([0, 0, 1], ph);
    const lip = p => (p[2] >= 0 ? p : (() => { const l = Math.hypot(p[0], p[1]) || 1; return [p[0] / l, p[1] / l, 0]; })());
    const tongue = (t, scale, colour) => {
      const base = 1.0, tip = base + (t.tip - base) * scale, w = t.w * scale, pts = [];
      for (let k = 0; k <= 10; k++) { const u = k / 10; pts.push(sph(a, e1, e2, base + (tip - base) * u, t.mid - w / 2 * (1 - u) ** 1.4 + t.flick * u * u)); }
      for (let k = 10; k >= 0; k--) { const u = k / 10; pts.push(sph(a, e1, e2, base + (tip - base) * u * 0.92, t.mid + w / 2 * (1 - u) ** 0.8 + t.flick * u * u * 0.8)); }
      if (pts.every(p => p[2] < 0)) return;
      g.beginPath();
      pts.map(lip).forEach((p, k) => (k ? g.lineTo(cx + R * p[0], cy + R * p[1]) : g.moveTo(cx + R * p[0], cy + R * p[1])));
      g.closePath(); g.fillStyle = colour; g.fill();
    };
    const { tongues } = parts('flame');
    fillPath(g, '#e8361c', () => cap(g, cx, cy, R, a, Math.sin(0.95)));
    for (const t of tongues) tongue(t, 1, '#e8461c');
    fillPath(g, '#ff8a1f', () => cap(g, cx, cy, R, a, Math.sin(1.05)));
    for (const t of tongues) tongue(t, 0.78, '#ff8a1f');
    fillPath(g, '#ffd23f', () => cap(g, cx, cy, R, a, Math.sin(1.18)));
    for (const t of tongues) tongue(t, 0.55, '#ffd23f');
    overlay(g, cx, cy, R, 0.35);
  },
  // A bullseye on each side, red rings on white.
  target(g, cx, cy, R, ph, l) {
    const white = shade(g, cx, cy, R, l.colours), red = shade(g, cx, cy, R, ['#ff7b73', '#e3342f', '#5e0d0b']);
    for (const pole of [[0, 0.12, 1], [0, -0.12, -1]]) {
      const n = turn(unit(pole), ph);
      [[0.35, red], [0.6, white], [0.78, red], [0.9, white], [0.965, red]].forEach(([d, s]) => fillPath(g, s, () => cap(g, cx, cy, R, n, d)));
    }
    overlay(g, cx, cy, R, 0.2);
  },
  // Deep blue and violet with clouds of colour and stars.
  galaxy(g, cx, cy, R, ph) {
    const { clouds, stars } = parts('galaxy');
    for (const c of clouds) {
      const q = turn(c.at, ph);
      if (q[2] < -0.2) continue;
      const x = cx + R * q[0], y = cy + R * q[1], rr = R * c.size * (0.6 + 0.4 * Math.max(0, q[2]));
      const grad = g.createRadialGradient(x, y, 0, x, y, rr);
      grad.addColorStop(0, `rgba(${c.rgb},${0.55 * Math.min(1, q[2] + 0.4)})`); grad.addColorStop(1, `rgba(${c.rgb},0)`);
      g.fillStyle = grad; g.fillRect(x - rr, y - rr, rr * 2, rr * 2);
    }
    const s = Math.max(0.55, R * 0.025);
    g.fillStyle = '#fff';
    for (const st of stars) {
      const q = turn(st.at, ph);
      if (q[2] < 0.05) continue;
      const x = cx + R * q[0], y = cy + R * q[1], z = s * st.size;
      g.globalAlpha = Math.min(1, 0.3 + q[2]);
      g.beginPath(); g.arc(x, y, z, 0, TAU); g.fill();
      if (st.size > 2) {
        g.fillRect(x - z * 2.6, y - z * 0.18, z * 5.2, z * 0.36);
        g.fillRect(x - z * 0.18, y - z * 2.6, z * 0.36, z * 5.2);
      }
    }
    g.globalAlpha = 1;
    overlay(g, cx, cy, R, 0.3);
  },
  // A bright yellow band round the ball, edged in white.
  stripe(g, cx, cy, R, ph) {
    const n = turn(unit([0.3, 0.62, 0.72]), ph);
    fillPath(g, '#ffffff', () => { cap(g, cx, cy, R, n, -0.36); cap(g, cx, cy, R, n, 0.36); });
    fillPath(g, shade(g, cx, cy, R, ['#fff7b0', '#ffd21f', '#8a5a00']), () => { cap(g, cx, cy, R, n, -0.29); cap(g, cx, cy, R, n, 0.29); });
    overlay(g, cx, cy, R, 0.28);
  },
  // Polished metal: the room reflected in it (still, as the ball turns under it), and an engraved band that rolls.
  gold(g, cx, cy, R, ph) {
    const sky = g.createLinearGradient(0, cy - R, 0, cy + R);
    sky.addColorStop(0, '#fffbe6'); sky.addColorStop(0.3, '#ffd75a'); sky.addColorStop(0.5, '#f0b429');
    sky.addColorStop(0.53, '#7a4d08'); sky.addColorStop(0.68, '#b77e14'); sky.addColorStop(1, '#ffe08a');
    g.fillStyle = sky; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    const n = turn(unit([0.2, 0.55, 0.81]), ph);
    fillPath(g, 'rgba(255,250,215,0.85)', () => { cap(g, cx, cy, R, n, -0.17); cap(g, cx, cy, R, n, 0.17); });
    fillPath(g, 'rgba(120,72,6,0.75)', () => { cap(g, cx, cy, R, n, -0.12); cap(g, cx, cy, R, n, 0.12); });
    overlay(g, cx, cy, R, 0.5);
  },
  // Every colour of the rainbow in slices round the ball, turning over as it rolls, under a pearly sheen.
  prism(g, cx, cy, R, ph) {
    const hues = ['#ff5e7e', '#ffa94d', '#ffe066', '#69db7c', '#3bc9db', '#4dabf7', '#9775fa'];
    const w = TAU / hues.length / 2;
    [...hues, ...hues].forEach((h, k) => fillPath(g, h, () => lune(g, cx, cy, R, ph + k * w, ph + (k + 1) * w)));
    const sheen = g.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
    sheen.addColorStop(0, 'rgba(255,255,255,0.55)'); sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)'); sheen.addColorStop(1, 'rgba(255,255,255,0.35)');
    g.fillStyle = sheen; g.fillRect(cx - R, cy - R, R * 2, R * 2);
    overlay(g, cx, cy, R, 0.35);
  },
};

// The ball, of radius R (px) centred at (x, y), in the look `l`, turned `roll` radians: the shading, the pattern (or a
// plain ball's swirl), the three finger holes and the shine. The shadow under it is the lane's business.
export function drawBall(g, x, y, R, l, roll = 0) {
  const ph = ((roll % TAU) + TAU) % TAU;
  g.save();
  g.fillStyle = shade(g, x, y, R, l.colours);
  g.beginPath(); g.arc(x, y, R, 0, TAU); g.fill();
  g.beginPath(); g.arc(x, y, R, 0, TAU); g.clip();
  const pattern = PATTERNS[l.pattern];
  if (pattern) pattern(g, x, y, R, ph, l);
  else {
    // A swirl, so you can see it roll.
    g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = R * 0.18;
    for (let i = 0; i < 2; i++) {
      const yy = y + R * Math.cos(ph + i * Math.PI);
      if (Math.sin(ph + i * Math.PI) < 0) continue;
      g.beginPath(); g.ellipse(x, yy, R * 0.95, R * 0.25, 0.25, 0, TAU); g.stroke();
    }
  }
  // Finger holes, rolling round.
  for (const [hx, hz0] of [[-0.32, 0.55], [0.32, 0.55], [0, -0.1]]) {
    const ang = Math.atan2(hz0, -0.75) - ph, rad = Math.hypot(hz0, 0.75);
    const ly = Math.cos(ang) * rad, lz = Math.sin(ang) * rad;
    if (ly > -0.15) continue;
    const vis = Math.min(1, -ly);
    g.fillStyle = `rgba(4,6,14,${0.85 * vis})`;
    g.beginPath(); g.ellipse(x + hx * R, y - lz * R, R * 0.11, R * 0.11 * vis, 0, 0, TAU); g.fill();
  }
  g.restore();
  // Shine.
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.ellipse(x - R * 0.38, y - R * 0.45, R * 0.22, R * 0.13, -0.6, 0, TAU); g.fill();
}

// A picture of a ball, for the picker and the little dots: drawn once for each look, as a data: URL.
const pictures = new Map();
export function picture(l, px = 96) {
  const key = `${l.id} ${px}`;
  if (!pictures.has(key)) {
    const c = document.createElement('canvas');
    c.width = c.height = px;
    drawBall(c.getContext('2d'), px / 2, px / 2, px / 2 - 0.5, l, 0);
    pictures.set(key, c.toDataURL());
  }
  return pictures.get(key);
}

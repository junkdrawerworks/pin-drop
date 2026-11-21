// Reading a swipe.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const STRAIGHT = 0.05;   // a swipe bowed less than this share of its length throws a straight ball

// How fast the finger was going, in px/ms: the fastest stretch (of at least 40 ms) in the swipe's last quarter
// second, since a finger often slows a little just before it lifts. Never less than the swipe's average speed.
export function swipeSpeed(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  let v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(40, b.t - a.t);
  for (let j = pts.length - 1; j > 0 && b.t - pts[j].t < 250; j--) {
    for (let i = j - 1; i >= 0; i--) {
      const dt = pts[j].t - pts[i].t;
      if (dt >= 40) { v = Math.max(v, Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) / dt); break; }
    }
  }
  return v;
}

// What a stroke on the lane is so far, from its points (the first where the finger went down): null while it's too
// short to tell, 'move' for sliding the ball across, 'throw' for a swipe up, 'none' for one heading down. Its first
// 10 px decide, but a stroke can change its mind. One that heads down or up a little as the thumb settles, then goes
// clearly sideways (over 20 px, and more than twice as far across as up or down, before it has gone 40 px up), moves
// the ball. A backswing that comes back up 12 px throws from its lowest point (s.from). A move that then goes well up
// (over 60 px, and more than twice as far up as across) throws: from the corner if the ball was slid over and then
// swiped up, like an L (see corner()), leaving the ball where it was slid (s.slid px across); otherwise it's a hook
// swipe that started sideways, thrown from where it began. Updates s.mode, s.from and s.slid, and returns the mode.
export function readStroke(s) {
  const a = s.pts[0], b = s.pts[s.pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!s.mode && Math.hypot(dx, dy) > 10) s.mode = Math.abs(dx) > Math.abs(dy) ? 'move' : dy < 0 ? 'throw' : 'none';
  if (s.mode === 'none' || s.mode === 'throw') {
    // Sideways from where the throw would start (where the finger went down, or the bottom of a backswing).
    const o = s.pts[s.from || 0], ox = b.x - o.x, oy = b.y - o.y;
    if (-oy < 40 && Math.abs(ox) > 20 && Math.abs(ox) > 2 * Math.abs(oy)) { s.mode = 'move'; s.from = 0; s.slid = 0; }
  }
  if (s.mode === 'none') {
    let low = 0;
    s.pts.forEach((p, i) => { if (p.y >= s.pts[low].y) low = i; });
    if (s.pts[low].y - b.y >= 12) { s.mode = 'throw'; s.from = low; }
  } else if (s.mode === 'move') {
    // Slid over, then swiped up: thrown from the corner, with the ball left where it was slid (s.slid px across).
    // Otherwise a hook swipe that started sideways, thrown from where it began with the ball back where it stood.
    const c = corner(s.pts), o = s.pts[c], ux = b.x - o.x, uy = b.y - o.y;
    if (c && -uy > 60 && -uy > 2 * Math.abs(ux)) { s.mode = 'throw'; s.from = c; s.slid = o.x - a.x; }
    else if (-dy > 60 && -dy > 2 * Math.abs(dx)) { s.mode = 'throw'; s.from = 0; s.slid = 0; }
  }
  return s.mode;
}

// Where a stroke that slid sideways turned to go up, if it turned like an L and not like a curve: the index of the last
// point before the upward run, or 0. The turn is the point furthest from the line between the stroke's ends, and it
// reads as an L if the finger stopped there (for 120 ms or more, moving less than 4 px), or if it had gone at least
// 40 px across (about a ball's width) and turned more than 60° within 30 px: a bend tighter than a circle 57 px
// across. A hook swipe bends far more gently than that, so it never reads as one. (Bowing a 300 px swipe out by 20%,
// the most hook there is, turns it 9° over 30 px at its sharpest.)
const STOP = 4, STILL = 120;
function corner(raw) {
  const pts = timed(raw), n = pts.length, a = pts[0], b = pts[n - 1];
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (n < 3 || len < 60) return 0;
  let k = 0, far = -1;
  for (let i = 1; i < n - 1; i++) {
    const d = Math.abs((pts[i].x - a.x) * (b.y - a.y) - (pts[i].y - a.y) * (b.x - a.x)) / len;
    if (d >= far) { far = d; k = i; }
  }
  // The stretch where the finger was within 4 px of the turn.
  const near = i => Math.hypot(pts[i].x - pts[k].x, pts[i].y - pts[k].y) < STOP;
  let i0 = k, i1 = k;
  while (i0 > 0 && near(i0 - 1)) i0--;
  while (i1 < n - 1 && near(i1 + 1)) i1++;
  const side = pts[k].x - a.x;
  if (i0 === 0 || i1 === n - 1 || Math.abs(side) < 10 || Math.abs(side) < Math.abs(pts[k].y - a.y)) return 0;
  const run = [0];
  for (let i = 1; i < n; i++) run.push(run[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const at = d => {
    let i = 1;
    while (i < n - 1 && run[i] < d) i++;
    const u = (d - run[i - 1]) / (run[i] - run[i - 1] || 1);
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u };
  };
  // The upward run starts once a turn rounded off after the corner has come round: where the next 15 px head the
  // same way (within 20°) as the rest of the stroke.
  const upFrom = c => {
    while (c < n - 2 && run[c] < run[i1] + 40) {
      const q = at(run[c] + 15), ux = q.x - pts[c].x, uy = q.y - pts[c].y, rx = b.x - pts[c].x, ry = b.y - pts[c].y;
      if ((ux * rx + uy * ry) / (Math.hypot(ux, uy) * Math.hypot(rx, ry) || 1) > Math.cos(Math.PI / 9)) break;
      c++;
    }
    return c;
  };
  // Stopped there: from the first point near the turn to the first one past it, less the time it takes to get there.
  if (pts[i1 + 1].t - pts[i0].t - 20 >= STILL) return upFrom(i1);
  if (Math.abs(side) < 40) return 0;
  // The sharpest it turned near there: the way it went over 20 px of the stroke against the way it went over the 20 px
  // starting 30 px further on, from 30 px before the turn to 30 px after it.
  let sharpest = 0.5, turn = -1;
  for (let d = Math.max(25, run[i0] - 30); d <= Math.min(run[n - 1] - 25, run[i1] + 30); d += 2) {
    const p0 = at(d - 25), p1 = at(d - 5), q0 = at(d + 5), q1 = at(d + 25);
    const ix = p1.x - p0.x, iy = p1.y - p0.y, ox = q1.x - q0.x, oy = q1.y - q0.y;
    const cos = (ix * ox + iy * oy) / (Math.hypot(ix, iy) * Math.hypot(ox, oy) || 1);
    if (Math.abs(ix) > Math.abs(iy) && -oy > Math.abs(ox) && cos < sharpest) { sharpest = cos; turn = d; }
  }
  if (turn < 0) return 0;
  let c = i1;
  while (c < n - 2 && run[c + 1] <= turn) c++;
  return upFrom(c);
}

// A stroke on the lane, begun by a pointerdown event at `now` on the page's clock (performance.now()).
export function stroke(e, now) {
  return { pts: [{ x: e.clientX, y: e.clientY, t: now, ev: onClock(e.timeStamp, now) ? 0 : NaN }], down: e.timeStamp, mode: null, from: 0, slid: 0 };
}

// Adds the finger positions an event hands over (a touch screen's come several at once: its coalesced events),
// keeping two times for each. `ev` is the event's own timeStamp, from the stroke's first: when the finger was really
// there. `t` is the page's clock as they arrive, spread evenly over the time since the last ones, which runs late
// and in bursts whenever the page is busy, and a burst reads as a quick flick. See timed() for which is used.
export function addPoints(s, list, now) {
  const last = s.pts[s.pts.length - 1];
  list.forEach((c, i) => s.pts.push({
    x: c.clientX, y: c.clientY,
    t: last.t + (now - last.t) * (i + 1) / list.length,
    ev: onClock(c.timeStamp, now) ? c.timeStamp - s.down : NaN,
  }));
}

// An event's timeStamp is on the page's clock, as it should be: from the last second, and not yet to come. Some touch
// screens stamp the finger's positions on another clock (on a tablet that made every fling come out at the slowest
// speed), or not at all.
const onClock = (ts, now) => ts > 0 && ts <= now + 1 && now - ts < 1000;

// A stroke's points, timed by the events' own stamps if every one of them is on the page's clock and they come in
// order; otherwise by the page's clock as they arrived.
export function timed(pts) {
  if (pts.length < 2 || !pts.every((p, i) => (i ? p.ev > pts[i - 1].ev : p.ev === 0))) return pts;
  return pts.map(p => ({ ...p, t: p.ev }));
}

// The points a throw is read from, timed.
export const throwPoints = s => timed(s.pts).slice(s.from || 0);

// What a stroke does when the finger lifts: 'throw' for a swipe at least 40 px up and within 45° of straight up;
// 'move' for a drag, or a swipe further over than that (a ball never starts out more than 0.07 rad off straight, and a
// swipe 41° off straight already gets that much, which from the middle of the lane is the gutter within 25 feet: it's
// someone moving the ball, not throwing it); 'short' for a swipe up
// that stops short; 'cancel' for one pulled back down to where it began; 'tap' and 'none' for a tap and a stroke
// that only went down.
export function liftAs(s) {
  if (s.mode === 'move') return 'move';
  if (s.mode !== 'throw') return s.mode ? 'none' : 'tap';
  const p = throwPoints(s), a = p[0], b = p[p.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (Math.abs(dx) > Math.abs(dy)) return 'move';
  return -dy >= 40 ? 'throw' : dy < 0 ? 'short' : 'cancel';
}

// A flick with a mouse or trackpad counts one and a half times as hard as the same flick on a touch screen. The pointer
// moves much slower than a thumb on glass: a quick 300 px press-and-flick on a trackpad threw about 13 mph, and an
// easy drag about 10, near the slowest there is, when a good ball is about 16.5.
export const MOUSE = 1.5;

// A swipe, read as a throw: its direction is the aim, its speed at the end is how hard, and how much it bends is the
// hook. Gives the ball's speed (in/s), its angle off straight (radians) and its hook (in/s; negative hooks left).
// The speed is read in screen px per ms against a phone's height held upright (844 px), whatever the size of the
// screen and whichever way up it is, so the same flick throws the same ball after turning a tablet round. `gain`
// scales it: MOUSE for a mouse or trackpad.
export function throwOf(pts, gain = 1) {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const vn = swipeSpeed(pts) * gain * 800 / 844;
  // Forgiving around a good ball: speed goes with the swipe's speed in proportion (its log), so a swipe 10% off
  // the one that throws 16.5 mph (290 in/s, a 1.8 px/ms flick) throws within half a mph of it, and firm flicks spread
  // from 18 mph (2.5 px/ms) to 22 (6 px/ms) rather than all reaching the top speed at 3 px/ms. Each 10% faster adds
  // 7.7 in/s (0.44 mph). The slowest there is, 9.7 mph, is a drag under 0.4 px/ms.
  const speed = clamp(290 + 81 * Math.log(Math.max(vn, 0.01) / 1.71), 170, 390);
  const angle = clamp(Math.atan(dx / -dy * 0.08), -0.07, 0.07);
  // The bend: how far the swipe bows out from a straight line, as a share of its length. Bowing out to the right
  // (so it finishes turning left) hooks left. A thumb swinging from the wrist draws a slight arc of its own, so up to
  // a 5% bow is straight; past that the hook grows to the most there is (65) at a 20% bow.
  let bow = 0;
  for (const p of pts) {
    const right = -((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
    if (Math.abs(right) > Math.abs(bow)) bow = right;
  }
  const c = bow / len;
  const hook = Math.abs(c) < STRAIGHT ? 0 : -Math.sign(c) * Math.min(65, (Math.abs(c) - STRAIGHT) * 65 / (0.2 - STRAIGHT));
  return { speed, angle, hook };
}

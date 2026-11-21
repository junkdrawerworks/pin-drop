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
// 10 px decide, but a stroke can change its mind into a throw: a backswing that comes back up 12 px throws from its
// lowest point (s.from), and a sideways start that then goes well up (over 60 px, and more than twice as far up as
// across) throws from where it began. Updates s.mode and s.from, and returns the mode.
export function readStroke(s) {
  const a = s.pts[0], b = s.pts[s.pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  if (!s.mode && Math.hypot(dx, dy) > 10) s.mode = Math.abs(dx) > Math.abs(dy) ? 'move' : dy < 0 ? 'throw' : 'none';
  if (s.mode === 'none') {
    let low = 0;
    s.pts.forEach((p, i) => { if (p.y >= s.pts[low].y) low = i; });
    if (s.pts[low].y - b.y >= 12) { s.mode = 'throw'; s.from = low; }
  } else if (s.mode === 'move' && -dy > 60 && -dy > 2 * Math.abs(dx)) s.mode = 'throw';
  return s.mode;
}

// The points a throw is read from.
export const throwPoints = s => s.pts.slice(s.from || 0);

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

// A swipe, read as a throw: its direction is the aim, its speed at the end is how hard, and how much it bends is the
// hook. Gives the ball's speed (in/s), its angle off straight (radians) and its hook (in/s; negative hooks left).
// The speed is read in screen px per ms against a phone's height held upright (844 px), whatever the size of the
// screen and whichever way up it is, so the same flick throws the same ball after turning a tablet round.
export function throwOf(pts) {
  const a = pts[0], b = pts[pts.length - 1];
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const vn = swipeSpeed(pts) * 800 / 844;
  const speed = clamp(175 + (vn - 0.5) * 95, 170, 390);
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

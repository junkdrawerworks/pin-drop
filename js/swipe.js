// Reading a swipe.

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

// Ten-pin scoring. A player's game is just the list of pins knocked down by each ball, in order; everything else
// (frames, marks, running totals, what the next ball faces) is worked out from that list.

// The game's frames: each with its balls, the marks to show in its boxes, and the running total once it's known.
export function frames(rolls) {
  const out = [];
  let i = 0, total = 0;
  for (let f = 0; f < 10 && i < rolls.length; f++) {
    const start = i;
    let balls;
    if (f < 9) {
      balls = rolls[i] === 10 ? [10] : rolls.slice(i, i + 2);
      i += balls.length;
    } else {
      balls = rolls.slice(i, i + 3);
      i += balls.length;
    }
    // The running total, once the balls it depends on have been rolled.
    let score = null;
    const a = rolls[start], b = rolls[start + 1], c = rolls[start + 2];
    if (a === 10) { if (b !== undefined && c !== undefined) score = 10 + b + c; }
    else if (b !== undefined) {
      if (a + b === 10) { if (c !== undefined) score = 10 + c; }
      else score = a + b;
    }
    const known = score !== null && (out.length === 0 || out[out.length - 1].total !== null);
    if (known) total += score;
    out.push({ balls, marks: marks(balls, f === 9), total: known ? total : null });
  }
  return out;
}

// What goes in a frame's boxes: X for a strike, / for a spare, - for a miss.
function marks(balls, tenth) {
  const m = [];
  if (!tenth) {
    if (balls[0] === 10) return ['', 'X'];
    balls.forEach((n, k) => m.push(k === 1 && balls[0] + n === 10 ? '/' : n === 0 ? '-' : String(n)));
    return m;
  }
  let fresh = true, prev = 0;
  for (const n of balls) {
    if (fresh) { m.push(n === 10 ? 'X' : n === 0 ? '-' : String(n)); fresh = n === 10; prev = n === 10 ? 0 : n; }
    else { m.push(prev + n === 10 ? '/' : n === 0 ? '-' : String(n)); fresh = true; prev = 0; }
  }
  return m;
}

// Where a game stands: the frame (0–9) and ball (0–2) to roll next, whether that ball faces a full rack, and
// whether the game is over.
export function next(rolls) {
  let i = 0;
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return { frame: f, ball: 0, fresh: true, done: false };
    if (rolls[i] === 10) { i += 1; continue; }
    if (i + 1 >= rolls.length) return { frame: f, ball: 1, fresh: false, done: false };
    i += 2;
  }
  const t = rolls.slice(i);
  if (t.length === 0) return { frame: 9, ball: 0, fresh: true, done: false };
  if (t.length === 1) return { frame: 9, ball: 1, fresh: t[0] === 10, done: false };
  if (t.length === 2) {
    if (t[0] === 10) return { frame: 9, ball: 2, fresh: t[1] === 10, done: false };
    if (t[0] + t[1] === 10) return { frame: 9, ball: 2, fresh: true, done: false };
    return { frame: 9, ball: 2, fresh: false, done: true };
  }
  return { frame: 9, ball: 3, fresh: false, done: true };
}

// The total so far (frames still waiting on bonus balls count what they have).
export function total(rolls) {
  const fs = frames(rolls);
  for (let k = fs.length - 1; k >= 0; k--) if (fs[k].total !== null) return fs[k].total;
  return 0;
}

// The highest the game could still reach.
export function best(rolls) {
  const r = rolls.slice();
  for (let s = next(r); !s.done; s = next(r)) {
    if (s.fresh) r.push(10);
    else r.push(10 - r[r.length - 1]); // the rest of the rack the last ball left
  }
  return total(r);
}

// Pins hold each other together if nothing could be down between them: one diagonally in front of the other, or a
// "sleeper" standing straight behind another (the 2-8, the 3-9), with no pin's spot between them. Two pins side by
// side have the pin in front of them between them, so they don't.
const NEAR = [[2, 3], [1, 4, 5, 8], [1, 5, 6, 9], [2, 7, 8], [2, 3, 8, 9], [3, 9, 10], [4], [2, 4, 5], [3, 5, 6], [6]];

// A split, by the USBC Playing Rules, Rule 3g: what stands after the first ball, when the head pin is down and at
// least one pin is down between two or more standing pins (the 7-10, the 3-10) or immediately ahead of two or more
// (the 5-6, the 9-10). So it's a split when what's left falls into two or more groups.
export function isSplit(standing) {
  if (standing.includes(1) || standing.length < 2) return false;
  const seen = new Set([standing[0]]), todo = [standing[0]];
  while (todo.length) {
    const p = todo.pop();
    for (const q of NEAR[p - 1]) if (standing.includes(q) && !seen.has(q)) { seen.add(q); todo.push(q); }
  }
  return seen.size < standing.length;
}

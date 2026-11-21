// What Pin Drop keeps on this device, all under one key: the players' names, the sound setting, the best games,
// the last few games, and the game in progress so a reload carries on where you were.
import { total, stats } from './scoring.js';

export const KEY = 'pin-drop.v1';
// `thrown` counts each player's balls by name, so the hint on how to throw shows for a new player's first few, and
// `hookShown` and `slideShown` how many balls each has been shown how to hook and how to line up with pins left.
// `best` is the best game here, by `bestBy` (the names of everyone on it, joined with " & "); `bests` is each player's
// own best by name. A game bowled with bumpers or a head start counts toward neither, and is kept with `bumpers: true`
// or `head` (its pins) on its score. Both by-name lists are kept with no prototype, so a name like "constructor" is just a name.
// `opts` holds each player's switches on the title by name ({ bumpers, head }), for the next time they play here, and
// `cpu` the computer player's level ('rookie', 'regular' or 'pro'), or null for none. The computer's games never count
// toward a best, and are kept with `cpu` (its level) on its score.
// `games` are the last GAMES games, newest first, each { at (when it ended, ms), scores: [{ name, score, rolls, splits,
// c (ball colour), bumpers, head, cpu }] }. `bestAt` and `bestsAt` (by name) are when each best was bowled, so that
// Forget these scores, which sets `forgot` to when it was tapped, takes away every game and best from before then, in
// every window and on every device that merges with this one (see merge).
export const GAMES = 500;
const blank = () => ({ names: ['You'], sound: true, best: 0, bestAt: 0, games: [], current: null, throws: 0, thrown: byName(), bests: byName(),
  bestsAt: byName(), hookShown: byName(), slideShown: byName(), opts: byName(), cpu: null, forgot: 0 });
const byName = (o = {}) => Object.assign(Object.create(null), o && typeof o === 'object' ? o : {});
export const int = v => Math.max(0, Math.trunc(Number(v)) || 0);

// What's kept, from its JSON: anything that isn't a kept Pin Drop counts as nothing kept.
export function parse(json) {
  try {
    const s = JSON.parse(json || 'null');
    if (!s || typeof s !== 'object') return blank();
    return { ...blank(), ...s, best: int(s.best), bestAt: int(s.bestAt), games: Array.isArray(s.games) ? s.games : [], thrown: byName(s.thrown),
      bests: byName(s.bests), bestsAt: byName(s.bestsAt), hookShown: byName(s.hookShown), slideShown: byName(s.slideShown), opts: byName(s.opts),
      forgot: int(s.forgot) };
  } catch { return blank(); }
}

// Whether this browser lets Pin Drop keep anything: false once reading or writing has failed (site data blocked, or
// a private window with no room). load() tries a write too, so the title can say so before a game is lost.
let works = true;
export const keeping = () => works;

export function load() {
  try {
    const s = parse(localStorage.getItem(KEY));
    localStorage.setItem(`${KEY}.try`, '1');
    localStorage.removeItem(`${KEY}.try`);
    return s;
  } catch { works = false; return blank(); }
}

// Folds the records kept in `theirs` into `mine`: another window of Pin Drop (a home-screen copy and a browser tab, a
// tab brought back) may have finished a game since this one loaded, and writing this one's stale copy over it would
// lose that game and maybe the best. The games are both lists together, newest first; the best and each player's best
// are the higher of the two (a tie keeps this window's), and each player's ball count and lessons shown the higher.
// Forget these scores on either side wins over everything bowled before it was tapped. The names and their switches,
// the sound and the game in progress stay this window's.
export function merge(mine, theirs) {
  const forgot = Math.max(int(mine.forgot), int(theirs.forgot));
  // Kept from before Forget these scores was tapped (a best kept before bests had times counts as from then).
  const gone = at => forgot > 0 && int(at) <= forgot;
  const seen = new Map();
  for (const g of [...(mine.games || []), ...(theirs.games || [])]) {
    if (!g || !Number.isFinite(g.at) || !Array.isArray(g.scores) || gone(g.at)) continue;
    const key = `${g.at} ${g.scores.map(q => q?.name).join(',')}`;
    if (!seen.has(key)) seen.set(key, g);
  }
  mine.games = [...seen.values()].sort((a, b) => b.at - a.at).slice(0, GAMES);
  const best = [mine, theirs].filter(s => int(s.best) && !gone(s.bestAt))
    .reduce((top, s) => (!top || int(s.best) > int(top.best) ? s : top), null);
  [mine.best, mine.bestBy, mine.bestAt] = best ? [int(best.best), best.bestBy, int(best.bestAt)] : [0, undefined, 0];
  const bests = byName(), bestsAt = byName();
  for (const s of [mine, theirs]) {
    for (const [name, v] of Object.entries(s.bests || {})) {
      const at = int(s.bestsAt?.[name]);
      if (gone(at) || (Object.hasOwn(bests, name) && int(v) <= bests[name])) continue;
      bests[name] = int(v); bestsAt[name] = at;
    }
  }
  [mine.bests, mine.bestsAt, mine.forgot] = [bests, bestsAt, forgot];
  for (const k of ['thrown', 'hookShown', 'slideShown']) {
    const out = byName();
    for (const from of [mine[k], theirs[k]]) {
      for (const [name, v] of Object.entries(from || {})) if (!Object.hasOwn(out, name) || int(v) > out[name]) out[name] = int(v);
    }
    mine[k] = out;
  }
  mine.throws = Math.max(int(mine.throws), int(theirs.throws));
  return mine;
}

// Forget these scores: every game and best kept here goes, now and from any window or device that still has them. The
// names, the lessons shown and the game in progress stay.
export function forget(s, now = Date.now()) {
  Object.assign(s, { games: [], best: 0, bestBy: undefined, bestAt: 0, bests: byName(), bestsAt: byName(), forgot: Math.max(now, int(s.forgot)) });
  return s;
}

// Writes `s`, with whatever another window has kept since folded into it first (see merge). False when the browser
// wouldn't keep it: the game carries on without.
export function save(s) {
  let kept = null;
  try { kept = localStorage.getItem(KEY); } catch { /* blocked: written over, or not at all, below */ }
  merge(s, parse(kept));
  try { localStorage.setItem(KEY, JSON.stringify(s)); return true; } catch { works = false; return false; }
}

// Each player's numbers over the games kept here, for the Averages sheet: one row per name (the computer's games and
// any bowled with bumpers left out), the player who bowled last first. `games` played, the average of the last 10
// (`avg`, rounded), the `high` game, and the share of strike and spare chances made (`strikes`, `spares`, from 0 to 1,
// or null with none yet: a game kept with only its score has no balls to count). The pins are what they bowled, a head
// start not added.
export function numbers(games) {
  const rows = new Map();
  for (const g of games || []) {
    for (const q of g?.scores || []) {
      if (!q || q.cpu || q.bumpers || typeof q.name !== 'string') continue;
      if (!rows.has(q.name)) rows.set(q.name, { name: q.name, pins: [], s: [0, 0], p: [0, 0] });
      const r = rows.get(q.name), balls = Array.isArray(q.rolls) ? q.rolls.map(int) : null;
      r.pins.push(balls ? total(balls) : Math.max(0, int(q.score) - int(q.head)));
      if (balls) { const t = stats(balls); r.s[0] += t.strikes; r.s[1] += t.strikeChances; r.p[0] += t.spares; r.p[1] += t.spareChances; }
    }
  }
  return [...rows.values()].map(r => {
    const last = r.pins.slice(0, 10);
    return { name: r.name, games: r.pins.length, avg: Math.round(last.reduce((a, b) => a + b, 0) / last.length), high: Math.max(...r.pins),
      strikes: r.s[1] ? r.s[0] / r.s[1] : null, spares: r.p[1] ? r.p[0] / r.p[1] : null };
  });
}

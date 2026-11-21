// What Pin Drop keeps on this device, all under one key: the players' names, the sound setting, the best games,
// the last few games, and the game in progress so a reload carries on where you were.
export const KEY = 'pin-drop.v1';
// `thrown` counts each player's balls by name, so the hint on how to throw shows for a new player's first few.
// `best` is the best game here, by `bestBy` (the names of everyone on it, joined with " & "); `bests` is each player's
// own best by name. Both by-name lists are kept with no prototype, so a name like "constructor" is just a name.
const blank = () => ({ names: ['You'], sound: true, best: 0, games: [], current: null, throws: 0, thrown: byName(), bests: byName() });
const byName = (o = {}) => Object.assign(Object.create(null), o && typeof o === 'object' ? o : {});
export const int = v => Math.max(0, Math.trunc(Number(v)) || 0);

// What's kept, from its JSON: anything that isn't a kept Pin Drop counts as nothing kept.
export function parse(json) {
  try {
    const s = JSON.parse(json || 'null');
    if (!s || typeof s !== 'object') return blank();
    return { ...blank(), ...s, best: int(s.best), games: Array.isArray(s.games) ? s.games : [], thrown: byName(s.thrown), bests: byName(s.bests) };
  } catch { return blank(); }
}

export function load() {
  try { return parse(localStorage.getItem(KEY)); } catch { return blank(); }
}

// Folds the records kept in `theirs` into `mine`: another window of Pin Drop (a home-screen copy and a browser tab, a
// tab brought back) may have finished a game since this one loaded, and writing this one's stale copy over it would
// lose that game and maybe the best. The games are both lists together, newest first; the best and each player's
// best and ball count are the higher of the two. The names, the sound and the game in progress stay this window's.
export function merge(mine, theirs) {
  const seen = new Map();
  for (const g of [...(mine.games || []), ...(theirs.games || [])]) {
    if (g && Number.isFinite(g.at) && Array.isArray(g.scores) && !seen.has(g.at)) seen.set(g.at, g);
  }
  mine.games = [...seen.values()].sort((a, b) => b.at - a.at).slice(0, 20);
  mine.best = int(mine.best);
  if (int(theirs.best) > mine.best) { mine.best = int(theirs.best); mine.bestBy = theirs.bestBy; }
  for (const k of ['bests', 'thrown']) {
    const out = byName();
    for (const from of [mine[k], theirs[k]]) {
      for (const [name, v] of Object.entries(from || {})) if (!Object.hasOwn(out, name) || int(v) > out[name]) out[name] = int(v);
    }
    mine[k] = out;
  }
  mine.throws = Math.max(int(mine.throws), int(theirs.throws));
  return mine;
}

// Writes `s`, with whatever another window has kept since folded into it first (see merge).
export function save(s) {
  let kept = null;
  try { kept = localStorage.getItem(KEY); } catch { /* blocked: written over, or not at all, below */ }
  merge(s, parse(kept));
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window or full: carry on without */ }
}

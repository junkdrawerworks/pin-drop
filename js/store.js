// What Pin Drop keeps on this device, all under one key: the players' names, the sound setting, the best games,
// the last few games, and the game in progress so a reload carries on where you were.
const KEY = 'pin-drop.v1';
// `thrown` counts each player's balls by name, so the hint on how to throw shows for a new player's first few.
// `best` is the best game here, by `bestBy` (the names of everyone on it, joined with " & "); `bests` is each player's
// own best by name, kept with no prototype so a name like "constructor" is just a name.
const blank = () => ({ names: ['You'], sound: true, best: 0, games: [], current: null, throws: 0, thrown: {}, bests: byName() });
const byName = (o = {}) => Object.assign(Object.create(null), o && typeof o === 'object' ? o : {});

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && typeof s === 'object' ? { ...blank(), ...s, bests: byName(s.bests) } : blank();
  } catch { return blank(); }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window or full: carry on without */ }
}

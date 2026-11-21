// What Pin Drop keeps on this device, all under one key: the players' names, the sound setting, your best game,
// the last few games, and the game in progress so a reload carries on where you were.
const KEY = 'pin-drop.v1';
const blank = () => ({ names: ['You'], sound: true, best: 0, games: [], current: null, throws: 0 });

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    return s && typeof s === 'object' ? { ...blank(), ...s } : blank();
  } catch { return blank(); }
}

export function save(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window or full: carry on without */ }
}

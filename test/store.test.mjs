// What's kept on this device: node --test test/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, merge, save, KEY } from '../js/store.js';

// A localStorage of our own, as a browser has.
const box = new Map();
globalThis.localStorage = { getItem: k => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, String(v)), removeItem: k => box.delete(k) };
const kept = () => JSON.parse(box.get(KEY));
const game = (at, ...scores) => ({ at, scores: scores.map(([name, score]) => ({ name, score })) });

test('a window that loaded before another finished a game keeps that game and its best when it saves', () => {
  box.set(KEY, JSON.stringify({ names: ['Ana'], best: 150, bestBy: 'Ana', bests: { Ana: 150 }, games: [game(1000, ['Ana', 150])] }));
  const b = parse(box.get(KEY));                 // window B opens, and sits on the title
  const a = parse(box.get(KEY));                 // window A plays a game to 240
  a.best = 240; a.bestBy = 'Ben'; a.bests.Ben = 240; a.thrown.Ben = 21; a.hookShown.Ben = 2; a.slideShown.Ben = 1;
  a.games = [game(2000, ['Ben', 240]), ...a.games];
  a.current = null;
  save(a);
  b.names = ['Cy']; b.current = { players: [{ name: 'Cy', rolls: [7], x: 0 }], turn: 0, leftover: null };
  b.thrown.Cy = 1; b.hookShown.Ben = 1;
  save(b);                                       // B throws a ball
  const s = kept();
  assert.equal(s.best, 240);
  assert.equal(s.bestBy, 'Ben');
  assert.deepEqual(s.games.map(g => g.at), [2000, 1000]);
  assert.deepEqual(s.bests, { Ana: 150, Ben: 240 });
  assert.deepEqual(s.thrown, { Ben: 21, Cy: 1 });
  // The lessons A showed Ben aren't shown again in B.
  assert.deepEqual([s.hookShown, s.slideShown], [{ Ben: 2 }, { Ben: 1 }]);
  // B's own: the names, and the game in progress.
  assert.deepEqual(s.names, ['Cy']);
  assert.deepEqual(s.current.players[0].rolls, [7]);
  // And B now knows about A's game, without reading it again.
  assert.equal(b.best, 240);
  assert.equal(b.games.length, 2);
});

test('the games are both lists together, newest first, no game twice, twenty at most', () => {
  const mine = parse(JSON.stringify({ games: [game(30, ['A', 1]), game(10, ['A', 2])] }));
  const theirs = parse(JSON.stringify({ games: Array.from({ length: 25 }, (_, i) => game(i * 2, ['B', i])) }));
  merge(mine, theirs);
  assert.equal(mine.games.length, 20);
  assert.deepEqual(mine.games.slice(0, 4).map(g => g.at), [48, 46, 44, 42]);
  assert.equal(new Set(mine.games.map(g => g.at)).size, 20);
  // A game kept in both is there once, and a broken one isn't there at all.
  const one = parse(JSON.stringify({ games: [game(5, ['A', 1]), null, { at: 'x', scores: [] }, { at: 6 }] }));
  merge(one, parse(JSON.stringify({ games: [game(5, ['A', 1])] })));
  assert.deepEqual(one.games.map(g => g.at), [5]);
});

test('the best and each player\'s best are the higher of the two; a tie keeps this window\'s', () => {
  const mine = parse(JSON.stringify({ best: 200, bestBy: 'Ana', bests: { Ana: 200, Ben: 90 } }));
  merge(mine, parse(JSON.stringify({ best: 200, bestBy: 'Ben', bests: { Ben: 200, Cy: 50 } })));
  assert.equal(mine.bestBy, 'Ana');
  assert.deepEqual({ ...mine.bests }, { Ana: 200, Ben: 200, Cy: 50 });
});

test('a name like constructor or __proto__ is just a name', () => {
  const mine = parse(JSON.stringify({ bests: { constructor: 120 } }));
  const theirs = parse('{"bests":{"__proto__":80,"toString":70},"thrown":{"constructor":4}}');
  merge(mine, theirs);
  assert.deepEqual(Object.entries(mine.bests).sort(), [['__proto__', 80], ['constructor', 120], ['toString', 70]]);
  assert.equal(mine.thrown.constructor, 4);
  assert.equal(parse('{}').thrown.constructor, undefined);
  assert.equal(parse('{}').bests.hasOwnProperty, undefined);
});

test('kept text where a number belongs comes back as a number', () => {
  const s = parse(JSON.stringify({ best: '<img src=x onerror=alert(1)>', bests: { Ana: '<b>9</b>' } }));
  assert.equal(s.best, 0);
  merge(s, parse(JSON.stringify({ best: '170' })));
  assert.equal(s.best, 170);
  assert.equal(s.bests.Ana, 0);
});

test('nothing kept, or something that is not Pin Drop\'s, counts as nothing kept', () => {
  for (const json of [null, '', 'not json', '42', '"text"', 'null', '[]']) {
    const s = parse(json);
    assert.deepEqual([s.best, s.games, s.current, s.names], [0, [], null, ['You']], String(json));
  }
  box.set(KEY, 'not json');
  const s = parse(null);
  s.names = ['Ana'];
  save(s);
  assert.deepEqual(kept().names, ['Ana']);
});

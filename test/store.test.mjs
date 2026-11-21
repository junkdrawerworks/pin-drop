// What's kept on this device: node --test test/store.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, merge, save, forget, numbers, KEY, GAMES } from '../js/store.js';

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

test('the games are both lists together, newest first, no game twice, the last 500 at most', () => {
  const mine = parse(JSON.stringify({ games: [game(1030, ['A', 1]), game(10, ['A', 2])] }));
  const theirs = parse(JSON.stringify({ games: Array.from({ length: 510 }, (_, i) => game(i * 2, ['B', i])) }));
  merge(mine, theirs);
  assert.equal(GAMES, 500);
  assert.equal(mine.games.length, 500);
  assert.deepEqual(mine.games.slice(0, 4).map(g => g.at), [1030, 1018, 1016, 1014]);
  assert.equal(new Set(mine.games.map(g => g.at)).size, 500);
  // Two games that ended in the same millisecond on two devices are both kept.
  const two = parse(JSON.stringify({ games: [game(7, ['Ana', 100])] }));
  merge(two, parse(JSON.stringify({ games: [game(7, ['Ben', 90])] })));
  assert.equal(two.games.length, 2);
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

test('Forget these scores takes every game and best from before it, in this window and from any other that saves after', () => {
  box.clear();
  const old = { names: ['Ana'], best: 180, bestBy: 'Ana', bestAt: 900, bests: { Ana: 180, Ben: 120 }, bestsAt: { Ana: 900, Ben: 800 },
    thrown: { Ana: 40 }, hookShown: { Ana: 2 }, games: [game(900, ['Ana', 180]), game(800, ['Ben', 120])] };
  box.set(KEY, JSON.stringify(old));
  const stale = parse(box.get(KEY));            // another window, opened before
  const here = parse(box.get(KEY));
  here.current = { players: [{ name: 'Ana', rolls: [7], x: 0 }], turn: 0, leftover: null };
  forget(here, 1000);
  save(here);
  let s = kept();
  assert.deepEqual([s.games, s.best, s.bests, s.forgot], [[], 0, {}, 1000]);
  // The names, the lessons shown and the game in progress stay.
  assert.deepEqual([s.names, s.thrown, s.hookShown, s.current.players[0].rolls], [['Ana'], { Ana: 40 }, { Ana: 2 }, [7]]);
  // The stale window bowls a game after it, and saves: its old games and bests don't come back, but the new game does,
  // and so does its best.
  stale.games = [game(1100, ['Cy', 95]), ...stale.games];
  stale.bests.Cy = 95; stale.bestsAt.Cy = 1100;
  save(stale);
  s = kept();
  assert.deepEqual(s.games.map(g => g.at), [1100]);
  assert.deepEqual([s.best, s.bests, s.forgot], [0, { Cy: 95 }, 1000]);
  assert.deepEqual(stale.games.map(g => g.at), [1100], 'the stale window still shows the games forgotten');
  // A best kept before bests had times counts as from before it too.
  const older = parse(JSON.stringify({ best: 150, bestBy: 'Ana', bests: { Ana: 150 } }));
  merge(older, parse(JSON.stringify({ forgot: 5 })));
  assert.deepEqual([older.best, older.bestBy, { ...older.bests }], [0, undefined, {}]);
  // With nothing forgotten, such a best stays.
  const kept2 = parse(JSON.stringify({ best: 150, bestBy: 'Ana', bests: { Ana: 150 } }));
  merge(kept2, parse('{}'));
  assert.deepEqual([kept2.best, kept2.bestBy, { ...kept2.bests }], [150, 'Ana', { Ana: 150 }]);
});

test('each player\'s numbers: games, the average of the last 10, the high game, and strikes and spares made', () => {
  const nine = Array.from({ length: 18 }, (_, i) => (i % 2 ? 0 : 9));                 // 81: nine frames of 9 and a miss
  const g = (at, ...scores) => ({ at, scores });
  const games = [
    g(30, { name: 'Ben', score: 300, rolls: Array(12).fill(10) }, { name: 'Computer (Pro)', cpu: 'pro', score: 250, rolls: [] }),
    g(29, { name: 'Ana', score: 120, rolls: [...nine, 10, 7, 3], head: 20 }, { name: 'Ben', score: 90, rolls: [...nine, 9, 0] }),
    g(28, { name: 'Ana', score: 140, rolls: Array(21).fill(5), bumpers: true }),       // with bumpers: not counted
    g(27, { name: 'Ana', score: 133 }),                                                 // kept with only its score
    ...Array.from({ length: 12 }, (_, i) => g(26 - i, { name: 'Cy', score: i < 10 ? 100 : 40, rolls: null })),
  ];
  const rows = numbers(games);
  assert.deepEqual(rows.map(r => r.name), ['Ben', 'Ana', 'Cy']);
  const [ben, ana, cy] = rows;
  assert.deepEqual([ben.games, ben.avg, ben.high], [2, 195, 300]);
  // 12 strikes from 12 chances and none from 10, then 0 spares from 10 chances.
  assert.equal(ben.strikes, 12 / 22);
  assert.equal(ben.spares, 0);
  // Ana's head start isn't added: she bowled 101; her game with only a score counts for the average and high.
  assert.deepEqual([ana.games, ana.avg, ana.high], [2, 117, 133]);
  assert.deepEqual([ana.strikes, ana.spares], [1 / 11, 1 / 10]);   // the tenth's strike earned another chance
  // The average is of the last 10: Cy's two 40s from longer ago don't count, but they're games played.
  assert.deepEqual([cy.games, cy.avg, cy.high, cy.strikes, cy.spares], [12, 100, 100, null, null]);
  assert.deepEqual(numbers([]), []);
});

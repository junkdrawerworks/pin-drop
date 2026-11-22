// The balls and how each is earned, without a browser:  node --test test/balls.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOKS, PLAIN, EARNED, CPU_LOOK, lookFor, lookById, gameEarns, practiceEarns, earnedIn, drawBall } from '../js/balls.js';
import { parse, merge, forget, catchUp, earn } from '../js/store.js';
import { next, total } from '../js/scoring.js';

const nineAndMiss = Array.from({ length: 18 }, (_, i) => (i % 2 ? 0 : 9));   // nine frames of 9 and a miss: 81
const ninety = [...nineAndMiss, 9, 0];
const game = (at, ...scores) => ({ at, scores });
const sorted = a => [...a].sort();

test('six plain balls and ten to earn, each with a name, colours and how to earn it', () => {
  assert.equal(PLAIN.length, 6);
  assert.deepEqual(EARNED.map(l => l.id), ['pearl', 'marble', 'twotone', 'sparkle', 'flame', 'target', 'galaxy', 'stripe', 'gold', 'prism']);
  assert.equal(LOOKS.length, 16);
  assert.equal(new Set(LOOKS.map(l => l.id)).size, 16);
  for (const l of LOOKS) assert.ok(l.name && l.colours.length === 3 && l.ink, l.id);
  for (const l of EARNED) assert.ok(l.how && l.why && l.pattern !== 'plain', l.id);
  // Every earned ball draws a pattern of its own.
  assert.equal(new Set(EARNED.map(l => l.pattern)).size, 10);
});

test('a game kept before there were looks shows its colour by number; one with a look shows that', () => {
  // The first four plain balls are the four colours there were, in their order.
  assert.deepEqual(PLAIN.slice(0, 4).map(l => l.colours[0]), ['#5aa8ff', '#ff7a6b', '#7be0a4', '#c9a0ff']);
  assert.equal(lookFor({ name: 'Ana', c: 0 }, 3).id, 'blue');
  assert.equal(lookFor({ name: 'Ben', c: 1 }, 0).id, 'red');
  assert.equal(lookFor({ name: 'Cy', c: 7 }, 0).id, 'purple');   // c went round the four colours
  assert.equal(lookFor({ name: 'Ana', ball: 'marble', c: 2 }, 0).id, 'marble');
  // Neither: the plain ball for their place. Something unknown counts as nothing.
  assert.equal(lookFor({ name: 'Dee' }, 1).id, 'red');
  assert.equal(lookFor({ name: 'Dee', ball: 'no such ball' }, 4).id, 'orange');
  assert.equal(lookFor({ name: 'Dee', ball: 'silver' }, 0).id, 'blue', 'a person bowled with the computer\'s ball');
  // The computer is silver, whatever is kept on it.
  assert.equal(lookFor({ name: 'Computer (Pro)', cpu: 'pro', ball: 'gold', c: 1 }, 0), CPU_LOOK);
  assert.equal(lookById('constructor'), null);
});

test('each ball from a game: strike, split picked up, turkey, 200, clean, perfect', () => {
  const ana = rolls => gameEarns({ name: 'Ana', rolls, splits: [] });
  assert.deepEqual(ana(ninety), []);
  assert.deepEqual(ana([10, ...nineAndMiss.slice(2), 9, 0]), ['marble']);
  // Two strikes, a 9, then three strikes in a row (a turkey, which a double isn't).
  assert.deepEqual(ana([10, 10, 9, 0, ...Array(14).fill(0)]), ['marble']);
  assert.deepEqual(ana([0, 0, 10, 10, 10, ...Array(12).fill(0)]), ['marble', 'sparkle']);
  // A turkey in the tenth counts: X X X.
  assert.deepEqual(ana([...Array(18).fill(0), 10, 10, 10]), ['marble', 'sparkle']);
  // A spare after a split (the 7–10 left by an 8, kept as ball 0) picks it up; an open frame after one doesn't.
  assert.deepEqual(gameEarns({ name: 'Ana', rolls: [8, 2, ...Array(18).fill(0), 0], splits: [0] }), ['twotone']);
  assert.deepEqual(gameEarns({ name: 'Ana', rolls: [8, 1, ...Array(18).fill(0)], splits: [0] }), []);
  // A spare that wasn't after a split earns nothing; nor does a split ball's count kept wrongly (a second ball).
  assert.deepEqual(gameEarns({ name: 'Ana', rolls: [8, 2, ...Array(18).fill(0), 0], splits: [] }), []);
  assert.deepEqual(gameEarns({ name: 'Ana', rolls: [2, 8, 0, 0, ...Array(16).fill(0), 0], splits: [1] }), []);
  // 200 (all spares of 9 and 1, with a 9 at the end: 190 isn't, nine strikes then 9 and 0 is 249).
  assert.equal(total(Array(21).fill(5)), 150);
  assert.ok(!ana(Array(21).fill(5)).includes('galaxy'));
  const strikes = [...Array(9).fill(10), 9, 0];
  assert.ok(total(strikes) >= 200);
  assert.deepEqual(ana(strikes), ['marble', 'sparkle', 'galaxy']);
  // Clean: a strike or spare in every frame (all spares of 5: 150, clean but not 200).
  assert.deepEqual(ana(Array(21).fill(5)), ['stripe']);
  assert.deepEqual(ana([...Array(9).fill(10), 9, 1, 10]), ['marble', 'sparkle', 'galaxy', 'stripe']);
  // A game not finished earns nothing that needs the whole game.
  assert.deepEqual(ana(Array(20).fill(5)), []);
  assert.equal(next(Array(20).fill(5)).done, false);
  // Perfect: everything.
  assert.deepEqual(sorted(ana(Array(12).fill(10))), sorted(['marble', 'sparkle', 'galaxy', 'stripe', 'prism']));
});

test('with bumpers a game counts for the strike, split and turkey balls but not 200, clean or perfect; a head start makes no odds', () => {
  const perfect = Array(12).fill(10);
  assert.deepEqual(gameEarns({ name: 'Ana', rolls: perfect, bumpers: true }), ['marble', 'sparkle']);
  assert.deepEqual(gameEarns({ name: 'Ana', rolls: [8, 2, ...Array(18).fill(0), 0], splits: [0], bumpers: true }), ['twotone']);
  // 190 bowled with a head start of 20 isn't a 200 game; 200 bowled with one is.
  const n190 = Array(21).fill(0).map((_, i) => (i % 2 ? 1 : 9));
  assert.equal(total(n190), 190);
  assert.ok(!gameEarns({ name: 'Ana', rolls: n190, head: 20 }).includes('galaxy'));
  assert.ok(gameEarns({ name: 'Ana', rolls: [...Array(9).fill(10), 9, 0], head: 50 }).includes('galaxy'));
  // A game kept with only its score: the pins bowled are the score less the head start.
  assert.deepEqual(gameEarns({ name: 'Ana', score: 220, head: 30 }), []);
  assert.deepEqual(gameEarns({ name: 'Ana', score: 230, head: 30 }), ['galaxy']);
  assert.deepEqual(gameEarns({ name: 'Ana', score: 300 }), ['galaxy', 'prism']);
  assert.deepEqual(gameEarns({ name: 'Ana', score: 300, bumpers: true }), []);
});

test('the computer earns nothing, however it bowls', () => {
  assert.deepEqual(gameEarns({ name: 'Computer (Pro)', cpu: 'pro', rolls: Array(12).fill(10) }), []);
  const games = Array.from({ length: 12 }, (_, i) => game(i + 1, { name: 'Computer (Pro)', cpu: 'pro', score: 300, rolls: Array(12).fill(10) }));
  assert.deepEqual(Object.keys(earnedIn(games)), []);
});

test('games played: the first game, 10 and 50, bumpers or not, each earned with the game that made the count', () => {
  const games = Array.from({ length: 55 }, (_, i) => game(1000 + i, { name: 'Ana', score: 90, rolls: ninety, bumpers: i % 2 === 0 }, { name: 'Computer (Rookie)', cpu: 'rookie', score: 90, rolls: ninety }));
  const got = earnedIn(games.slice().reverse());   // kept newest first
  assert.deepEqual({ ...got.Ana }, { pearl: 1000, flame: 1009, gold: 1049 });
  assert.deepEqual({ ...earnedIn(games.slice(0, 9)).Ana }, { pearl: 1000 });
  // Each player counts their own games.
  const two = earnedIn([game(5, { name: 'Ana', rolls: ninety }, { name: 'Ben', rolls: [10, ...nineAndMiss.slice(2), 9, 0] })]);
  assert.deepEqual([{ ...two.Ana }, { ...two.Ben }], [{ pearl: 5 }, { marble: 5, pearl: 5 }]);
});

test('spare practice earns the Target with 7 of the 10, and nothing else', () => {
  assert.deepEqual(practiceEarns(6), []);
  assert.deepEqual(practiceEarns(7), ['target']);
  assert.deepEqual(practiceEarns(10), ['target']);
});

test('a player who played before there were balls has what their kept games show, and Forget these scores takes none away', () => {
  const s = parse(JSON.stringify({ names: ['Ana'], games: [
    game(3000, { name: 'Ana', score: 160, rolls: [10, 10, 10, ...Array(15).fill(0)], splits: [], c: 1 }),
    game(2000, { name: 'Ana', score: 90, rolls: ninety, splits: [], c: 1 }),
  ] }));
  const added = catchUp(s);
  assert.deepEqual(added.map(b => `${b.id}@${b.at}`).sort(), ['marble@3000', 'pearl@2000', 'sparkle@3000']);
  assert.deepEqual(catchUp(s), [], 'caught up twice');
  assert.ok(earn(s, 'Ana', 'target', 3500));
  assert.equal(earn(s, 'Ana', 'target', 4000), false, 'earned twice');
  forget(s, 5000);
  assert.deepEqual(s.games, []);
  catchUp(s);
  assert.deepEqual({ ...s.earned.Ana }, { pearl: 2000, marble: 3000, sparkle: 3000, target: 3500 });
  // Kept, and read back.
  assert.deepEqual({ ...parse(JSON.stringify(s)).earned.Ana }, { pearl: 2000, marble: 3000, sparkle: 3000, target: 3500 });
});

test('merging: the balls earned are both sides\' with the earlier time, each pick the one chosen last, the last look the later', () => {
  const mine = parse(JSON.stringify({ earned: { Ana: { marble: 500, pearl: 400 }, Ben: { pearl: 10 } }, picks: { Ana: { id: 'marble', at: 900 }, Ben: { id: 'green', at: 50 } }, seen: { Ana: 950 } }));
  const theirs = parse(JSON.stringify({ earned: { Ana: { marble: 300, galaxy: 800 }, Cy: { flame: 70 } }, picks: { Ana: { id: 'galaxy', at: 1000 }, Ben: { id: 'pink', at: 40 }, Cy: { id: 'flame', at: 71 } }, seen: { Ana: 600, Cy: 72 } }));
  merge(mine, theirs);
  assert.deepEqual(JSON.parse(JSON.stringify(mine.earned)), { Ana: { marble: 300, pearl: 400, galaxy: 800 }, Ben: { pearl: 10 }, Cy: { flame: 70 } });
  assert.deepEqual(JSON.parse(JSON.stringify(mine.picks)), { Ana: { id: 'galaxy', at: 1000 }, Ben: { id: 'green', at: 50 }, Cy: { id: 'flame', at: 71 } });
  assert.deepEqual({ ...mine.seen }, { Ana: 950, Cy: 72 });
  // A tie keeps this side's pick; nothing on either side is nothing.
  const a = parse(JSON.stringify({ picks: { Ana: { id: 'red', at: 5 } } }));
  merge(a, parse(JSON.stringify({ picks: { Ana: { id: 'blue', at: 5 } } })));
  assert.equal(a.picks.Ana.id, 'red');
  const empty = parse('{}');
  merge(empty, parse('{}'));
  assert.deepEqual([{ ...empty.earned }, { ...empty.picks }, { ...empty.seen }], [{}, {}, {}]);
  // Forget these scores on the other side doesn't touch them.
  const kept = parse(JSON.stringify({ earned: { Ana: { marble: 300 } }, picks: { Ana: { id: 'marble', at: 1 } } }));
  merge(kept, parse(JSON.stringify({ forgot: 10000 })));
  assert.deepEqual([kept.earned.Ana.marble, kept.picks.Ana.id], [300, 'marble']);
});

test('the balls by name are kept with no prototype, and junk where they belong comes back as nothing', () => {
  const s = parse('{"earned":{"__proto__":{"marble":5},"constructor":{"pearl":"7"}},"picks":{"toString":{"id":"gold","at":3},"Ana":"gold","Ben":{"id":4}},"seen":{"Ana":"<b>"}}');
  assert.deepEqual(Object.keys(s.earned).sort(), ['__proto__', 'constructor']);
  assert.equal(s.earned.constructor.pearl, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(s.picks)), { toString: { id: 'gold', at: 3 } });
  assert.equal(s.seen.Ana, 0);
  assert.equal(parse('{}').earned.constructor, undefined);
  assert.equal(parse('{"earned":[1,2]}').earned[0], undefined);
});

test('every ball draws, at any size and any turn, without throwing', () => {
  // A canvas that only checks the numbers it's given are numbers.
  const bad = [];
  const g = new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => ({ addColorStop() {} })
    : (...args) => { if (args.some(a => typeof a === 'number' && !Number.isFinite(a))) bad.push(k); }), set: () => true });
  for (const l of [...LOOKS, CPU_LOOK]) for (const R of [2, 9, 40]) for (const roll of [0, 1, 2.5, Math.PI, 5, 77.7, -3]) drawBall(g, 50, 50, R, l, roll);
  assert.deepEqual(bad, []);
});

// Aiming for the tests: the angle (radians) that sends a ball released at x0 through xh at the head pin line, by
// bisection with the real physics. Used by scoring.test.mjs for the strike rates and by e2e.mjs to bowl strikes.
// It aims with the lane's wander turned off (every random draw 0.5, so no push either way), so a ball aimed at xh
// crosses there on average over many seeds. Aiming with one seed's wander would aim that seed's ball, and seed 1's
// drifts left, so every ball aimed that way crossed about an inch right of xh.
import { Sim } from '../js/physics.js';

export function through(x0, xh, hook, speed = 290) {
  let lo = -0.08, hi = 0.08;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2, s = new Sim([], { x: x0, speed, angle: m, hook });
    s.rand = () => 0.5;
    while (s.ball.y < 720 && s.ball.state === 'lane') s.step(1 / 240);
    if (s.ball.x < xh) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

// The ball the tests bowl at a full rack: from 10 in right of the middle, hooking left into the pocket, 2.5 in right of
// the middle of the head pin (the real pocket, board 17.5 counting from the right, is 2.66 in). It strikes about two
// times in three: 52 of seeds 1 to 80.
export const pocket = { x: 10, speed: 290, angle: through(10, 2.5, -40), hook: -40 };

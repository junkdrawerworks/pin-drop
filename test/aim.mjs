// Aiming for the tests: the angle (radians) that sends a ball released at x0 through xh at the head pin line, by
// bisection with the real physics. Used by scoring.test.mjs for the strike rates and by e2e.mjs to bowl strikes.
import { Sim } from '../js/physics.js';

export function through(x0, xh, hook, speed = 290) {
  let lo = -0.08, hi = 0.08;
  for (let k = 0; k < 40; k++) {
    const m = (lo + hi) / 2, s = new Sim([], { x: x0, speed, angle: m, hook }, 1);
    while (s.ball.y < 720 && s.ball.state === 'lane') s.step(1 / 240);
    if (s.ball.x < xh) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

// The ball the tests bowl at a full rack: from 10 in right of the middle, hooking into the pocket just right of the
// head pin. It strikes about half the time.
export const pocket = { x: 10, speed: 290, angle: through(10, 1.5, -40), hook: -40 };

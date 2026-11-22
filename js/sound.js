// Every sound is made on the spot with Web Audio: no files to download. The rumble of the ball is low filtered
// noise that pulses with the ball's turning; a pin hit is a low hollow knock with a burst of woody noise, the way a
// coated maple pin sounds, rather than a bright tone.
let ctx = null, master = null, noise = null, white = null, rumble = null;
let on = true;
let lastHit = 0, hitsThisBeat = 0;

export function setSound(v) {
  on = v;
  if (master) master.gain.value = v ? 0.9 : 0;
}

// Browsers only start audio after a tap, so the first touch calls this. wake(false) only carries on after sleep(),
// never starting the sound from nothing (which a browser refuses without a tap).
export function wake(start = true) {
  if (!ctx) {
    if (!start) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = on ? 0.9 : 0;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);
    // Brown-ish noise, used for everything.
    const len = ctx.sampleRate * 2;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.035 * w) / 1.035; d[i] = last * 3.2 + w * 0.08; }
    // And plain white noise, for the crack of wood on wood.
    white = ctx.createBuffer(1, len, ctx.sampleRate);
    const wd = white.getChannelData(0);
    for (let i = 0; i < len; i++) wd[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// Everything stops where it is, while the page is out of sight, until wake().
export function sleep() {
  if (ctx && ctx.state === 'running') ctx.suspend();
}

// The ball on the wood. level 0–1 follows its speed; call with 0 to stop. A steady low rumble (the slow swells of
// raw low noise sound like thunder, so they're filtered out), pulsing a little at the rate the ball turns, with a
// faint hiss of the ball on the lane.
export function roll(level) {
  if (!ctx) return;
  if (!rumble && level > 0) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 55; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 170; lp.Q.value = 0.9;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 105; body.Q.value = 1.4; body.gain.value = 7;
    const pulse = ctx.createGain(); pulse.gain.value = 1;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
    const depth = ctx.createGain(); depth.gain.value = 0.28;
    lfo.connect(depth); depth.connect(pulse.gain);
    const g = ctx.createGain(); g.gain.value = 0;
    const duck = ctx.createGain(); duck.gain.value = 1;   // dips while the ball hits the pins (see duck())
    src.connect(hp); hp.connect(lp); lp.connect(body); body.connect(pulse); pulse.connect(g); g.connect(duck);
    const hsrc = ctx.createBufferSource(); hsrc.buffer = white; hsrc.loop = true;
    const hbp = ctx.createBiquadFilter(); hbp.type = 'bandpass'; hbp.frequency.value = 2200; hbp.Q.value = 0.7;
    const hg = ctx.createGain(); hg.gain.value = 0;
    hsrc.connect(hbp); hbp.connect(hg); hg.connect(duck); duck.connect(master);
    src.start(); hsrc.start(); lfo.start();
    rumble = { src, hsrc, lfo, g, hg, duck };
  }
  if (!rumble) return;
  const t = ctx.currentTime;
  rumble.g.gain.setTargetAtTime(level * 0.8, t, 0.08);
  rumble.hg.gain.setTargetAtTime(level * 0.012, t, 0.08);
  rumble.lfo.frequency.setTargetAtTime(2 + level * 12, t, 0.1);   // about one pulse a turn
  if (level <= 0) {
    const r = rumble; rumble = null;
    setTimeout(() => { for (const n of [r.src, r.hsrc, r.lfo]) { try { n.stop(); } catch { /* already stopped */ } } }, 600);
  }
}

// The rumble drops back by about 8 dB for 0.4 s as the ball reaches the pins, so the crash rides over it rather than
// under it (it was louder than the crash's first half second).
export function duck() {
  if (!ctx || !rumble) return;
  const t = ctx.currentTime, d = rumble.duck.gain;
  d.cancelScheduledValues(t);
  d.setValueAtTime(d.value, t);
  d.linearRampToValueAtTime(0.4, t + 0.02);
  d.setValueAtTime(0.4, t + 0.4);
  d.linearRampToValueAtTime(1, t + 0.6);
}

// A burst of noise through a band-pass filter, dying away over `len` seconds.
function burst(buf, freq, q, gain, len, t) {
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + len);
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t, Math.random() * 1.5, len + 0.05);
}

// A low knock whose pitch falls as it dies: the hollow body of a pin, or the weight of the ball.
function knock(freq, gain, len, t) {
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(freq * 1.7, t);
  o.frequency.exponentialRampToValueAtTime(freq, t + 0.02);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0005, t + len);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + len + 0.05);
}

// A hit: ball on pin, pin on pin, the ball off a bumper, a pin on the kickback or the floor.
export function hit(kind, power) {
  if (!ctx || !on || power < 0.03) return;
  const t = ctx.currentTime;
  if (t - lastHit < 0.012) { if (++hitsThisBeat > 3) return; } else hitsThisBeat = 0;
  lastHit = t;
  const v = Math.min(1, power);
  const r = () => 0.85 + Math.random() * 0.35;
  if (kind === 'ball') {
    knock(105 * r(), v * 0.9, 0.16, t);              // the ball's weight
    knock(260 * r(), v * 0.55, 0.08, t);             // the pin it hit
    burst(white, 650 * r(), 2.5, v * 1.1, 0.06, t);  // the crack
  } else if (kind === 'pin') {
    knock(240 * r(), v * 0.6, 0.07, t);
    burst(white, 750 * r(), 3.5, v * 0.9, 0.045, t);
    burst(white, 1500 * r(), 5, v * 0.25, 0.03, t);
  } else if (kind === 'bumper') {
    knock(120 * r(), v * 0.5, 0.12, t);              // the ball off a padded rail: a dull bump
  } else if (kind === 'wall') {
    knock(140 * r(), v * 0.4, 0.1, t);
    burst(noise, 420, 2, v * 0.8, 0.09, t);
  } else {
    burst(noise, 300, 1.2, v * 1.2, 0.12, t);        // a pin dropping onto the deck
  }
}

// The ball dropping into the gutter: a low drop, and a hollow clatter in the channel that a phone's small speaker
// can carry (the drop alone is all under 150 Hz, which it can't).
export function gutter() {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  burst(white, 520, 1.3, 0.5, 0.2, t);
  knock(300, 0.3, 0.09, t);
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35);
}

// One note of the bell, `at` seconds from now, ringing for `len`.
function bell(f, at, len = 0.5, gain = 0.057) {
  const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
  const g = ctx.createGain();
  const s = ctx.currentTime + at;
  g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(gain, s + 0.01);   // under the crash, not as loud
  g.gain.exponentialRampToValueAtTime(0.0001, s + len);
  o.connect(lp); lp.connect(g); g.connect(master); o.start(s); o.stop(s + len + 0.05);
}
const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5, E6 = 1318.51, G6 = 1567.98;

// A little bell for a strike or a spare.
export function chime(big) {
  if (!ctx || !on) return;
  (big ? [C5, E5, G5, C6] : [587.33, 880]).forEach((f, i) => bell(f, i * 0.09));
}

// A strike's bell, longer the bigger the moment (see level in main.js): 1 a strike, 2 a double, 3 a turkey or more in a
// row, each going a note higher; 4, a perfect game, a fanfare of two rising runs and a held chord, about two seconds.
export function fanfare(n) {
  if (!ctx || !on) return;
  if (n < 4) { [C5, E5, G5, C6, E6, G6].slice(0, 3 + n).forEach((f, i, a) => bell(f, i * 0.09, i === a.length - 1 ? 0.35 + 0.15 * n : 0.5)); return; }
  [C5, E5, G5, C6].forEach((f, i) => bell(f, i * 0.09));
  [G5, C6, E6, G6].forEach((f, i) => bell(f, 0.5 + i * 0.09));
  for (const f of [C6, E6, G6]) bell(f, 1.0, 1.2, 0.04);
}

// A new best game: a rising run of the bell, softer, as the end of the game shows it.
export function best() {
  if (!ctx || !on) return;
  [G5, 987.77, 1174.66, G6].forEach((f, i) => bell(f, 0.2 + i * 0.13, i === 3 ? 0.9 : 0.4, 0.045));
}

// A new ball earned, as the end of the game shows it: a quick glassy run up, softer than the bell, each note with the
// ring of a struck glass (a sine with a fainter partial a little under three times as high). `at` seconds from now.
export function newBall(at = 0) {
  if (!ctx || !on) return;
  [E5, 987.77, E6, 1975.53].forEach((f, i) => {
    for (const [m, gain] of [[1, 0.07], [2.76, 0.018]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const g = ctx.createGain(), s = ctx.currentTime + at + i * 0.085, len = i === 3 ? 1.1 : 0.45;
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(gain, s + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, s + len);
      o.connect(g); g.connect(master); o.start(s); o.stop(s + len + 0.05);
    }
  });
}

// The ball landing on the boards as it's let go: a brief low thud with a little wood in it (all of it under 150 Hz would
// be lost on a phone's speaker), louder for a harder throw (`speed` in in/s, 170 to 390) but well under a pin hit.
export const thudLevel = speed => 0.12 + 0.14 * Math.max(0, Math.min(1, (speed - 170) / 220));
export function thud(speed) {
  if (!ctx || !on) return;
  const t = ctx.currentTime, v = thudLevel(speed);
  knock(70, v, 0.13, t);
  burst(noise, 240, 1.4, v * 0.9, 0.07, t);
}

// The pinsetter's bar coming down, and the new rack set on the deck: a short low knock with a small tick of metal.
export function clunk() {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  knock(125, 0.2, 0.09, t);
  burst(noise, 380, 2, 0.22, 0.05, t);
  burst(white, 3200, 8, 0.05, 0.015, t);
}

// The pinsetter's whirr, `rate` times as fast when it's hurried (see hurry()).
let whirr = null;
export function sweep(rate = 1) {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.3 / rate); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4 / rate);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(t, 0, 1.5 / rate);
  whirr = { g, end: t + 1.4 / rate };
}
// A tap hurried the pinsetter on: its whirr dies away now rather than outlasting it.
export function hurry() {
  if (!ctx || !whirr || ctx.currentTime >= whirr.end) return;
  const t = ctx.currentTime, g = whirr.g.gain;
  g.cancelScheduledValues(t);
  g.setValueAtTime(Math.max(0.0001, g.value), t);
  g.exponentialRampToValueAtTime(0.0001, t + 0.15);
  whirr = null;
}

// ---- The alley screen's cartoons (see screen.js) ----------------------------------------------------------------
// Honks, whistles, a gobble, a kazoo, a sad horn: all made here too. They go through a bus of their own, a little under
// the game's sounds and the callout's bell, which a tap that ends the cartoon fades out (see hushToons).
let toonBus = null;
function bus() {
  if (!toonBus) { toonBus = ctx.createGain(); toonBus.gain.value = 0.55; toonBus.connect(master); }
  return toonBus;
}
export function hushToons() {
  if (!ctx || !toonBus) return;
  const b = toonBus, t = ctx.currentTime;
  toonBus = null;
  b.gain.setValueAtTime(b.gain.value, t); b.gain.linearRampToValueAtTime(0, t + 0.08);
  setTimeout(() => b.disconnect(), 400);
}

// A note of `type`, gliding from f0 to f1 over `len` s, `at` s from now, with a wobble (vibrato) of `vib` Hz at `rate`,
// through a band-pass filter at `bp` (the buzz of a kazoo, the bray of a horn), or none.
function note(type, f0, f1, at, len, gain, { vib = 0, rate = 6, bp = 0, q = 2, attack = 0.01, curve = 'exp' } = {}) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) curve === 'exp' ? o.frequency.exponentialRampToValueAtTime(f1, t + len) : o.frequency.linearRampToValueAtTime(f1, t + len);
  let lfo = null;
  if (vib) { lfo = ctx.createOscillator(); lfo.frequency.value = rate; const d = ctx.createGain(); d.gain.value = vib; lfo.connect(d); d.connect(o.frequency); lfo.start(t); lfo.stop(t + len + 0.05); }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.setValueAtTime(gain, t + Math.max(attack, len * 0.6)); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  let out = o;
  if (bp) { const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = q; o.connect(f); out = f; }
  out.connect(g); g.connect(bus());
  o.start(t); o.stop(t + len + 0.05);
  return { o, g, t };
}
// A breath of noise, its band-pass gliding from f0 to f1.
function hiss(f0, f1, at, len, gain, q = 1.5, buf = white) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, t); bp.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + len * 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(bp); bp.connect(g); g.connect(bus());
  src.start(t, Math.random() * 1.2, len + 0.05);
}
// A kazoo: a buzzing saw through a nasal band, with a wobble.
const kz = (f, at, len, gain = 0.16) => note('sawtooth', f, f, at, len, gain, { vib: f * 0.02, rate: 7, bp: 1100, q: 3, attack: 0.02 });
// A bike horn: a square honk, falling a little.
const honk1 = (at, f = 360) => { note('square', f, f * 0.92, at, 0.17, 0.12, { bp: 900, q: 1.5 }); note('square', f * 1.5, f * 1.4, at, 0.17, 0.05, { bp: 1400, q: 2 }); };
const N = { C4: 261.63, E4: 329.63, G4: 392, A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5 };

const TOONS = {
  bonk: () => { note('sine', 700, 180, 0, 0.14, 0.35); hiss(900, 500, 0, 0.06, 0.25, 3); },
  tock: () => note('sine', 1300, 900, 0, 0.05, 0.25),
  thud: () => { note('sine', 160, 60, 0, 0.2, 0.4); hiss(400, 200, 0, 0.12, 0.2, 1, noise); },
  splat: () => { hiss(1400, 300, 0, 0.22, 0.4, 0.8); note('sine', 260, 70, 0, 0.18, 0.3); },
  squeak: () => { for (let i = 0; i < 3; i++) note('sine', 1900 + i * 150, 2300 + i * 150, i * 0.12, 0.09, 0.05, { vib: 80, rate: 40 }); },
  whoosh: () => hiss(300, 2600, 0, 0.38, 0.22, 1.2),
  swish: () => hiss(1800, 4200, 0, 0.16, 0.16, 1.5),
  zip: () => note('sine', 300, 2200, 0, 0.16, 0.12),
  eek: () => note('square', 900, 1500, 0, 0.18, 0.06, { vib: 60, rate: 30, bp: 1500 }),
  boing: () => note('sine', 160, 420, 0, 0.45, 0.3, { vib: 70, rate: 24, curve: 'lin' }),
  whistleDown: () => note('sine', 1500, 320, 0, 0.75, 0.1, { vib: 20, rate: 9 }),
  whistleTune: () => [1175, 1319, 1175, 988, 1175].forEach((f, i) => note('sine', f, f, i * 0.16, 0.14, 0.06, { vib: 15, rate: 8, attack: 0.03 })),
  clap: () => { hiss(1400, 1100, 0, 0.08, 0.5, 0.9); hiss(1600, 1200, 0.03, 0.07, 0.3, 0.9); },
  sparkle: () => [2093, 2637, 3136, 4186].forEach((f, i) => note('sine', f, f, i * 0.06, 0.25, 0.05)),
  tink: () => { note('sine', 2600, 2600, 0, 0.25, 0.12); note('sine', 3900, 3900, 0, 0.15, 0.05); },
  // Gob-ble gob-ble: four quick, warbling syllables.
  gobble: () => [480, 360, 470, 340, 450, 330].forEach((f, i) => note('sawtooth', f * 1.15, f, i * 0.085, 0.075, 0.13, { vib: 60, rate: 34, bp: 1000, q: 2.5 })),
  tada: () => { kz(N.G4, 0, 0.12); kz(N.C5, 0.13, 0.5); },
  kazoo: () => [N.C5, N.E5, N.G5, N.E5, N.G5, N.C6].forEach((f, i) => kz(f, i * 0.12, i === 5 ? 0.35 : 0.1, 0.12)),
  honk: () => { honk1(0); honk1(0.22); },
  cheer: () => { hiss(900, 1600, 0, 1.0, 0.12, 0.6); hiss(2000, 1400, 0.2, 0.9, 0.06, 0.8); },
  firework: () => { note('sine', 700, 1700, 0, 0.3, 0.04); hiss(1500, 600, 0.3, 0.4, 0.3, 0.7); for (let i = 0; i < 5; i++) hiss(3000, 2500, 0.38 + Math.random() * 0.3, 0.04, 0.15, 2); },
  stretch: () => note('sawtooth', 180, 420, 0, 1.0, 0.04, { vib: 25, rate: 18, bp: 700, q: 4, attack: 0.2, curve: 'lin' }),
  rip: () => { const t = 0; hiss(2400, 2800, t, 0.32, 0.3, 1.2); for (let i = 0; i < 6; i++) hiss(3000, 2600, i * 0.05, 0.03, 0.12, 3); },
  rumble: () => hiss(120, 90, 0, 0.6, 0.5, 0.7, noise),
  crack: () => { hiss(2200, 1200, 0, 0.07, 0.5, 1.2); note('sine', 220, 90, 0, 0.12, 0.25); },
  // Wah, wah, wah, waaah: a sad horn going down, the last note held and wobbling.
  sadHorn: () => [311.13, 293.66, 277.18, 261.63].forEach((f, i) => note('sawtooth', f, i === 3 ? f * 0.97 : f, i * 0.32, i === 3 ? 0.85 : 0.28, 0.1, { bp: 700, q: 1.6, attack: 0.05, vib: i === 3 ? 6 : 0, rate: 5 })),
  wind: () => { hiss(400, 700, 0, 1.4, 0.12, 0.8); hiss(700, 350, 0.6, 1.2, 0.08, 0.8); },
  hello: () => { kz(392, 0, 0.18, 0.1); kz(523, 0.2, 0.3, 0.1); },
  echo: () => { kz(392, 0, 0.15, 0.04); kz(523, 0.17, 0.25, 0.04); kz(392, 0.6, 0.15, 0.02); kz(523, 0.77, 0.25, 0.02); },
  plop: () => { note('sine', 900, 160, 0, 0.14, 0.3); hiss(700, 300, 0.02, 0.1, 0.12, 2); },
  giggle: () => { for (let i = 0; i < 6; i++) note('square', 900 - i * 40, 760 - i * 40, i * 0.09, 0.06, 0.035, { bp: 1300 }); },
  snore: () => { hiss(300, 500, 0, 0.7, 0.18, 1, noise); note('sawtooth', 70, 80, 0, 0.7, 0.05, { bp: 300, q: 1, attack: 0.25 }); },
  peek: () => note('sine', 700, 1100, 0, 0.08, 0.12),
  ukulele: () => [N.C5, N.E5, N.G5, N.A5, N.G5].forEach((f, i) => note('triangle', f, f, i * 0.18, 0.3, 0.09, { attack: 0.004 })),
  cricket: () => { for (let k = 0; k < 2; k++) for (let i = 0; i < 3; i++) note('sine', 4300, 4300, k * 0.25 + i * 0.035, 0.025, 0.05); },
  phew: () => { hiss(1200, 500, 0, 0.55, 0.14, 1); note('sine', 950, 520, 0.05, 0.45, 0.04); },
};
export const TOON_SOUNDS = Object.keys(TOONS);
// One of the cartoon's sounds, by name.
export function cartoon(name) {
  if (!ctx || !on || !TOONS[name]) return;
  TOONS[name]();
}

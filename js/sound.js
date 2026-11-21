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

// A hit: ball on pin, pin on pin, pin on the kickback or the floor.
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

// A little bell for a strike or a spare.
export function chime(big) {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  const notes = big ? [523.25, 659.25, 783.99, 1046.5] : [587.33, 880];
  notes.forEach((f, i) => {
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const g = ctx.createGain();
    const s = t + i * 0.09;
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.057, s + 0.01);   // under the crash, not as loud
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(s); o.stop(s + 0.55);
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

// The pinsetter's whirr.
export function sweep() {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(t, 0, 1.5);
}

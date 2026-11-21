// Every sound is made on the spot with Web Audio: no files to download. The rumble of the ball is filtered
// noise; a pin hit is a short knock of noise with two wooden tones on top.
let ctx = null, master = null, noise = null, rumble = null;
let on = true;
let lastHit = 0, hitsThisBeat = 0;

export function setSound(v) {
  on = v;
  if (master) master.gain.value = v ? 0.9 : 0;
}

// Browsers only start audio after a tap, so the first touch calls this.
export function wake() {
  if (!ctx) {
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
  }
  if (ctx.state === 'suspended') ctx.resume();
}

// The ball on the wood. level 0–1 follows its speed; call with 0 to stop.
export function roll(level) {
  if (!ctx) return;
  if (!rumble && level > 0) {
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start();
    rumble = { src, lp, g };
  }
  if (!rumble) return;
  const t = ctx.currentTime;
  rumble.g.gain.setTargetAtTime(level * 0.55, t, 0.08);
  rumble.lp.frequency.setTargetAtTime(180 + level * 220, t, 0.1);
  if (level <= 0) {
    const r = rumble; rumble = null;
    setTimeout(() => { try { r.src.stop(); } catch { /* already stopped */ } }, 600);
  }
}

// A knock: ball on pin, pin on pin, pin on the kickback or the floor.
export function hit(kind, power) {
  if (!ctx || !on || power < 0.03) return;
  const t = ctx.currentTime;
  if (t - lastHit < 0.012) { if (++hitsThisBeat > 3) return; } else hitsThisBeat = 0;
  lastHit = t;
  const v = Math.min(1, power) * (kind === 'ball' ? 1 : kind === 'pin' ? 0.8 : 0.5);
  // The crack.
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
  bp.frequency.value = kind === 'thud' ? 500 : kind === 'wall' ? 900 : 1800 + Math.random() * 1400;
  bp.Q.value = 1.1;
  const g = ctx.createGain();
  g.gain.setValueAtTime(v * 1.6, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'thud' ? 0.12 : 0.07));
  src.connect(bp); bp.connect(g); g.connect(master);
  src.start(t, Math.random() * 1.5, 0.2);
  // The hollow wooden tone of a pin.
  if (kind === 'ball' || kind === 'pin') {
    for (const f of [820 + Math.random() * 260, 1500 + Math.random() * 400]) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const og = ctx.createGain();
      og.gain.setValueAtTime(v * 0.22, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.09 + Math.random() * 0.06);
      o.connect(og); og.connect(master);
      o.start(t); o.stop(t + 0.2);
    }
  }
}

// The ball dropping into the gutter.
export function gutter() {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
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
    g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.09, s + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(lp); lp.connect(g); g.connect(master); o.start(s); o.stop(s + 0.55);
  });
}

// The pinsetter's whirr and clunk.
export function sweep() {
  if (!ctx || !on) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource(); src.buffer = noise;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 320; bp.Q.value = 2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
  src.connect(bp); bp.connect(g); g.connect(master); src.start(t, 0, 1.5);
}

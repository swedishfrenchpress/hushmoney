import { degreeHz } from './melody';

// A small bell, like the one the laptop plays under the song, for the pages that
// let you hear a tune. Sound starts only from a tap, on a context made then.

let ctx: AudioContext | null = null;

export function audio(): AudioContext {
  ctx ??= new AudioContext();
  void ctx.resume();
  return ctx;
}

export function bell(hz: number, at = 0) {
  const c = audio();
  const t = c.currentTime + at;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.28, t + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
  out.connect(c.destination);
  for (const [mult, level] of [
    [1, 1],
    [2, 0.2],
  ] as const) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.frequency.value = hz * mult;
    g.gain.value = level;
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 1.2);
  }
}

// Rings a tune, a note every `gap` seconds, and calls `onNote(i)` as each one sounds.
export function playTune(degrees: number[], onNote: (i: number) => void, gap = 0.22) {
  degrees.forEach((d, i) => {
    bell(degreeHz(d), i * gap);
    setTimeout(() => onNote(i), i * gap * 1000);
  });
}

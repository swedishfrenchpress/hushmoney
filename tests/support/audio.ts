import { decoder } from '../../src/ggwave';

// What can happen to a song between a laptop speaker and a phone mic, done to samples.

// A sound card converting between sample rates, roughly (linear).
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const out = new Float32Array(Math.floor((x.length * to) / from));
  for (let i = 0; i < out.length; i++) {
    const p = (i * from) / to;
    const j = Math.floor(p);
    out[i] = x[j] + (x[Math.min(j + 1, x.length - 1)] - x[j]) * (p - j);
  }
  return out;
}

export const silence = (seconds: number, rate: number) => new Float32Array(Math.round(seconds * rate));

export function join(...parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// A seeded random, so a failing case can be replayed.
export function random(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

export const gain = (x: Float32Array, g: number) => x.map((v) => v * g);
export const clip = (x: Float32Array, drive: number) => x.map((v) => Math.max(-1, Math.min(1, v * drive)));
export const noisy = (x: Float32Array, level: number, seed = 1) => {
  const r = random(seed);
  return x.map((v) => v + r() * level);
};
// A wall 10 m away: the song again, quieter, 30 ms late.
export const echo = (x: Float32Array, rate: number, delay = 0.03, level = 0.4) => {
  const d = Math.round(delay * rate);
  return x.map((v, i) => v + (i >= d ? x[i - d] * level : 0));
};

// Every message the decoder hears in `samples`, fed in blocks of `block`.
export async function hearAll(samples: Float32Array, rate: number, block = 128): Promise<Uint8Array[]> {
  const dec = await decoder(rate);
  const heard: Uint8Array[] = [];
  for (let i = 0; i < samples.length; i += block) {
    const m = dec.push(samples.slice(i, i + block));
    if (m) heard.push(m);
  }
  dec.free();
  return heard;
}

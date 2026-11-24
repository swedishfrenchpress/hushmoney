// Shared by the link-preview concepts. Each concept draws a 1200 x 630 frame as a
// function of time, t in seconds, read from performance.now(). render.mjs swaps the
// browser's clock for a virtual one, so every frame of the video lands exactly.

import { makeOrb, type Look, type Orb, type OrbOptions, type Sound } from '../../src/listen/orb';

export interface Concept {
  duration: number; // seconds in one loop of the video
  hero: number; // the moment the still image is taken
  warm?: number; // seconds to run before the video starts, so a loop is already going
  ready: Promise<unknown>;
}

export const now = () => performance.now() / 1000;

export function register(c: { duration: number; hero: number; warm?: number; ready: Promise<unknown> }) {
  (window as unknown as { __og: Concept }).__og = { ...c, ready: c.ready.then(() => document.fonts.ready) };
}

// Runs draw(t) every frame, t in seconds within the loop.
export function every(duration: number, draw: (t: number) => void) {
  const tick = () => {
    draw(now() % duration);
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const span = (t: number, from: number, to: number) => clamp((t - from) / (to - from));
export const easeOut = (x: number) => 1 - (1 - x) ** 3;
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
// A spring's overshoot, settling at 1.
export const springy = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.cos(x * Math.PI * 2.5) * Math.exp(-x * 5.5));

// Sets an element's font size so its text is exactly `width` wide.
export function fit(el: HTMLElement, width: number) {
  el.style.fontSize = '100px';
  el.style.fontSize = `${(100 * width) / el.scrollWidth}px`;
}

// The site's chrome orb in `host`. sound(t) drives its ripples; look() changes its state.
export async function orb(host: HTMLElement, sound: () => Sound, options: OrbOptions = {}): Promise<Orb> {
  const o = await makeOrb(host, sound, options);
  if (!o) throw new Error('no WebGL for the orb');
  return o;
}

export type { Look, Orb };

// HUSH MONEY as the landing sets it: each letter in its own box, the pairs kerned by the
// site's own table, so N and E never touch.
export { KERN } from '../../src/sing/letters';
import { KERN } from '../../src/sing/letters';
export function kern(el: HTMLElement) {
  const chars = [...(el.textContent ?? '')];
  el.textContent = '';
  chars.forEach((c, i) => {
    const s = document.createElement('span');
    s.style.display = 'inline-block';
    s.textContent = c === ' ' ? ' ' : c;
    const k = KERN[(c + (chars[i + 1] ?? '')).toUpperCase()];
    if (k) s.style.marginRight = `${k}em`;
    el.append(s);
  });
}

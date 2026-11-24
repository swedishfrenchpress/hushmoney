import { makeBlob, type Blob } from './footblob';
import type { Look } from './listen/orb';

// The footer, inverted: black, green type. A checkerboard edge, SHHHHHHH set giant with a
// blob of liquid chrome as its full stop, and the quiet links. The blob ripples and crackles
// as if shouting the hush, and shouts harder while the laptop sings.

const YEAR = new Date().getFullYear();

export function footer(parent: HTMLElement): { look(next: Look): void } {
  const el = document.createElement('footer');
  el.className = 'sitefoot';
  el.innerHTML = `
    <div class="checker" aria-hidden="true"></div>
    <p class="foot-giant" aria-label="Shhhhhhh.">SHHHHHHH<span class="foot-blob" aria-hidden="true"><span class="disc"></span></span></p>
    <div class="foot-row">
      <p class="foot-left">&copy;${YEAR} <span>Hush Money</span></p>
      <nav class="foot-links" aria-label="Elsewhere">
        <a href="/how">How it works</a>
        <a href="/music">Good Music</a>
        <a href="https://x.com/eriklocalhost" target="_blank" rel="noopener noreferrer">X</a>
        <a href="https://cashu.space" target="_blank" rel="noopener noreferrer">Ecash by Cashu</a>
      </nav>
    </div>
  `;
  parent.append(el);

  // The blob arrives when it is ready; until then, and without WebGL or with reduced motion, a flat green disc.
  let blob: Blob | null = null;
  let want: Look = 'drift';
  const t0 = performance.now();
  const sound = () => {
    const t = (performance.now() - t0) / 1000;
    // Always restless: a swell that rises and falls, with quicker flutters on top.
    const swell = 0.55 + 0.45 * Math.sin(t * 1.3) + 0.25 * Math.sin(t * 3.7 + 1);
    return { level: Math.max(0, 0.42 * swell), kick: 0.1 * Math.max(0, Math.sin(t * 2.3)) };
  };
  void makeBlob(el.querySelector<HTMLElement>('.foot-blob')!, sound).then((b) => {
    blob = b;
    blob?.look(want);
  });

  return {
    look(next) {
      want = next === 'heard' || next === 'listening' ? 'listening' : next === 'caught' ? 'caught' : 'drift';
      blob?.look(want);
    },
  };
}

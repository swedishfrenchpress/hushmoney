import { makeOrb, type Look, type Orb } from './listen/orb';

// The footer, inverted: black, green type. A checkerboard edge, SHHHHHHH set giant
// with a liquid chrome orb as its full stop, and the quiet links. The orb is the phone's ball of
// chrome at the size of a full stop; it ripples gently, and listens harder while the
// laptop sings.

const YEAR = new Date().getFullYear();

export function footer(parent: HTMLElement): { look(next: Look): void } {
  const el = document.createElement('footer');
  el.className = 'sitefoot';
  el.innerHTML = `
    <div class="checker" aria-hidden="true"></div>
    <p class="foot-giant" aria-label="Shhhhhhh.">SHHHHHHH<span class="foot-orb" aria-hidden="true"><span class="disc"></span></span></p>
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

  // The orb arrives when it is ready; until then, and without WebGL or with reduced motion, a flat black disc.
  let orb: Orb | null = null;
  let want: Look = 'drift';
  const t0 = performance.now();
  const sound = () => {
    const t = (performance.now() - t0) / 1000;
    // Always restless: a swell that rises and falls, with quicker flutters on top, harder while singing.
    const loud = want === 'heard' ? 0.75 : 0.42;
    const swell = 0.55 + 0.45 * Math.sin(t * 1.3) + 0.25 * Math.sin(t * 3.7 + 1);
    return { level: Math.max(0, loud * swell), kick: 0.1 * Math.max(0, Math.sin(t * 2.3)) };
  };
  const host = el.querySelector<HTMLElement>('.foot-orb')!;
  // A liquid chrome ball, the full stop after the hush.
  void makeOrb(host, sound, { speed: 0.45, liquid: true }).then((o) => {
    orb = o;
    orb?.look(want);
  });

  return {
    look(next) {
      want = next === 'heard' || next === 'listening' ? 'listening' : next === 'caught' ? 'caught' : 'drift';
      orb?.look(want);
    },
  };
}

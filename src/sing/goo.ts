// The play / pause mark on the orb: a green drop of liquid with the glyph set in it. When the
// state flips, the glyph melts from triangle to two bars (or back) and a few droplets leave
// the blob and fall back into it, the SVG goo filter pulling them in like mercury. It only
// animates for the moment of the change; with reduced motion it just switches.

type Quad = [number, number][];
const PLAY: Quad[] = [
  [[-8, -13], [0, -7.8], [0, 7.8], [-8, 13]],
  [[0, -7.8], [12, 0], [12, 0], [0, 7.8]],
];
const PAUSE: Quad[] = [
  [[-11, -12], [-3, -12], [-3, 12], [-11, 12]],
  [[3, -12], [11, -12], [11, 12], [3, 12]],
];
// The loading comet: a head and a tail of dark drops that circle inside the blob and melt into one another.
const SWIRL = [5.6, 4.8, 4, 3.2, 2.4];
const DROPS = [-62, 24, 118, 200, 290];
let uid = 0;

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const mix = (a: Quad[], b: Quad[], t: number) => a.map((q, i) => q.map((p, j) => [p[0] + (b[i][j][0] - p[0]) * t, p[1] + (b[i][j][1] - p[1]) * t] as [number, number]));
const path = (g: Quad[]) => g.map((q) => `M${q.map((p) => p.map((n) => n.toFixed(2)).join(' ')).join('L')}Z`).join('');

export class Goo {
  private glyph: SVGPathElement;
  private blob: SVGPathElement;
  private radius = 30;
  private kick = 0;
  private idle = 0;
  private visible = true;
  private drops: SVGCircleElement[];
  private state: 'play' | 'pause' = 'play';
  private raf = 0;
  private swirl: SVGCircleElement[];
  private spin = 0;
  private loading = false;
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(host: HTMLElement) {
    const id = `goo${uid++}`;
    host.innerHTML = `<svg viewBox="-50 -50 100 100" aria-hidden="true">
      <defs><filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="3.6"/>
        <feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/>
      </filter></defs>
      <g filter="url(#${id})" fill="#7bfb70">
        <path class="blob"/>
        ${DROPS.map(() => '<circle class="drop" r="0"/>').join('')}
      </g>
      <g filter="url(#${id})" fill="#202020" class="swirl">
        ${SWIRL.map(() => '<circle r="0"/>').join('')}
      </g>
      <path class="glyph" fill="#202020" stroke="#202020" stroke-width="3" stroke-linejoin="round"/>
    </svg>`;
    this.glyph = host.querySelector('.glyph')!;
    this.blob = host.querySelector('.blob')!;
    this.drops = [...host.querySelectorAll<SVGCircleElement>('.drop')];
    this.swirl = [...host.querySelectorAll<SVGCircleElement>('.swirl circle')];
    this.glyph.setAttribute('d', path(PLAY));
    this.draw(0);
    if (!this.reduced) {
      new IntersectionObserver((e) => {
        this.visible = e[0].isIntersecting;
        if (this.visible) this.tick();
      }).observe(host);
      this.tick();
    }
  }

  // The blob is a ring of lobes that breathe at different speeds, so its edge is never the same
  // twice; three small drops circle it and the goo filter keeps reaching out to take them back.
  private draw(t: number) {
    const n = 14;
    const r = (i: number) => {
      const a = (i / n) * Math.PI * 2;
      const k = this.kick;
      return this.radius * (1 + 0.09 * Math.sin(a * 3 + t * 1.7) + 0.06 * Math.sin(a * 5 - t * 2.3) + 0.04 * Math.sin(a * 2 + t * 0.9) + k * 0.12 * Math.sin(a * 4 + t * 9));
    };
    const pts = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return [Math.cos(a) * r(i), Math.sin(a) * r(i)];
    });
    // Closed Catmull-Rom curve through the lobes.
    let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
    }
    this.blob.setAttribute('d', d + 'Z');
  }

  // While loading, the glyph melts to nothing and the comet fades in and turns; when the song
  // starts the comet drains away and the glyph melts back into the pause bars.
  private drawSwirl(t: number) {
    this.spin += ((this.loading ? 1 : 0) - this.spin) * 0.1;
    if (this.spin < 0.003) this.spin = 0;
    this.glyph.style.transform = `scale(${(1 - this.spin).toFixed(3)})`;
    this.glyph.style.opacity = String(1 - this.spin);
    this.swirl.forEach((c, i) => {
      const a = -t * 5.2 - i * 0.5;
      const r = 12 * this.spin;
      c.setAttribute('cx', (Math.cos(a) * r).toFixed(2));
      c.setAttribute('cy', (Math.sin(a) * r).toFixed(2));
      c.setAttribute('r', (SWIRL[i] * this.spin).toFixed(2));
    });
  }

  load(on: boolean) {
    this.loading = on;
    if (!this.reduced) this.tick();
  }

  private tick = () => {
    if (!this.visible) return;
    cancelAnimationFrame(this.idle);
    this.kick *= 0.94;
    const now = performance.now() / 1000;
    this.draw(now);
    this.drawSwirl(now);
    this.idle = requestAnimationFrame(this.tick);
  };

  set(next: 'play' | 'pause') {
    if (next === this.state) return;
    const from = this.state === 'play' ? PLAY : PAUSE;
    const to = next === 'play' ? PLAY : PAUSE;
    this.state = next;
    cancelAnimationFrame(this.raf);
    if (this.reduced) {
      this.glyph.setAttribute('d', path(to));
      return;
    }
    this.kick = 1;
    const t0 = performance.now();
    const run = (now: number) => {
      const t = Math.min(1, (now - t0) / 720);
      this.glyph.setAttribute('d', path(mix(from, to, ease(Math.min(1, t * 1.25)))));
      // The blob squashes down and springs back as the drops fly out and return.
      const squash = 1 - 0.16 * Math.sin(Math.PI * Math.min(1, t * 1.6)) * Math.exp(-t * 1.5);
      this.radius = 30 * squash + 2 * Math.sin(Math.PI * t);
      this.kick = Math.sin(Math.PI * t);
      if (this.reduced) this.draw(0);
      this.drops.forEach((d, i) => {
        const a = (DROPS[i] * Math.PI) / 180;
        const k = Math.min(1, Math.max(0, (t - i * 0.04) / 0.9));
        const out = Math.sin(Math.PI * k);
        const r = 30 + 14 * out * (0.7 + 0.3 * ((i * 7) % 3));
        d.setAttribute('cx', String(Math.cos(a) * r));
        d.setAttribute('cy', String(Math.sin(a) * r));
        d.setAttribute('r', String(7 * out * (1 - 0.3 * k)));
      });
      if (t < 1) this.raf = requestAnimationFrame(run);
      else {
        this.radius = 30;
        this.drops.forEach((d) => d.setAttribute('r', '0'));
      }
    };
    this.raf = requestAnimationFrame(run);
  }
}

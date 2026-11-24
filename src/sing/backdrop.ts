// Flat rings behind the title: one opens at every note of the tune as it
// sounds, in cream. Low notes ring on the left, high on the right.
// When a phone catches the coins, one big thick ring goes out. No gradients.

export interface Tap {
  t: number; // seconds from the start of the played buffer
  degree: number; // 0 to 11, up the pentatonic scale
}

const CREAM = '245 255 240';
const RING_S = 2.2;
const BIG_S = 3;

interface Burst {
  x: number;
  born: number;
  big?: boolean;
}

export class Backdrop {
  private loops: { at: number; taps: Tap[]; fired: number }[] = [];
  private bursts: Burst[] = [];
  private frame = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private clock: () => number,
  ) {
    this.frame = requestAnimationFrame(this.tick);
  }

  loop(at: number, taps: Tap[]) {
    this.loops = [...this.loops.slice(-1), { at, taps, fired: 0 }];
  }

  caught() {
    this.loops = [];
    this.bursts.push({ x: 0.5, born: performance.now() / 1000, big: true });
  }

  rest() {
    this.loops = [];
  }

  destroy() {
    cancelAnimationFrame(this.frame);
  }

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    const scale = devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * scale) || this.canvas.height !== Math.round(h * scale)) {
      this.canvas.width = Math.round(w * scale);
      this.canvas.height = Math.round(h * scale);
    }
    const g = this.canvas.getContext('2d')!;
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.clearRect(0, 0, w, h);
    const now = this.clock();
    const wall = performance.now() / 1000;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    // A ring is born as the playhead passes each note.
    for (const loop of this.loops) {
      const songTime = now - loop.at;
      while (loop.fired < loop.taps.length && loop.taps[loop.fired]!.t <= songTime) {
        const tap = loop.taps[loop.fired++]!;
        if (!still && songTime - tap.t < 0.5) this.bursts.push({ x: 0.1 + (0.8 * tap.degree) / 11, born: wall });
      }
    }

    this.bursts = this.bursts.filter((b) => wall - b.born < (b.big ? BIG_S : RING_S));
    for (const b of this.bursts) {
      const age = (wall - b.born) / (b.big ? BIG_S : RING_S);
      const r = (1 - (1 - age) ** 3) * Math.max(w, h) * (b.big ? 0.8 : 0.45);
      g.strokeStyle = `rgb(${CREAM} / ${(1 - age) * (b.big ? 1 : 0.7)})`;
      g.lineWidth = b.big ? 22 : 5;
      g.beginPath();
      g.arc(b.x * w, h * 0.45, r, 0, Math.PI * 2);
      g.stroke();
    }
  };
}

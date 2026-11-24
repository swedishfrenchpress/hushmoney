import { toneHz, type Beat } from './score';

// The song drawn as it sings: the real tones of each beat as noteheads on a
// stave, scrolling past a playhead and lighting up as they sound. The chime's
// three notes sit low; ggwave's data sparkles above them. Pitch is drawn on a
// log scale, as on a real stave, from 560 Hz at the bottom to 6.6 kHz at the top.

export interface Note {
  t: number; // seconds from the start of the played buffer
  hz: number;
  chime?: boolean;
}

const LOW_HZ = 560;
const HIGH_HZ = 6600;
const PX_PER_S = 320;
const INK = '32 32 32';
const GOLD = '32 32 32';

export function notesOf(score: Beat[], dataOffset: number, chime: { t: number; hz: number }[]): Note[] {
  return [...chime.map((c) => ({ ...c, chime: true })), ...score.flatMap((b) => b.tones.map((tone) => ({ t: dataOffset + b.t, hz: toneHz(tone) })))];
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

export class Stave {
  private loops: { at: number; notes: Note[] }[] = []; // each play of the song, and when it started
  private sparks: Spark[] = [];
  private frame = 0;
  private still: boolean;

  constructor(
    private canvas: HTMLCanvasElement,
    private clock: () => number,
  ) {
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = requestAnimationFrame(this.tick); // not now: the page may still be setting up the clock
  }

  // A play of the song starts at clock time `at`; the one before scrolls on out.
  loop(at: number, notes: Note[]) {
    this.loops = [...this.loops.slice(-1), { at, notes }];
  }

  // The coins were claimed: the notes on screen float up and fade.
  caught() {
    const { w, h } = this.size();
    const now = this.clock();
    for (const { at, notes } of this.loops) {
      for (const n of notes) {
        const x = this.x(n, now - at, w);
        if (x < -20 || x > w + 20) continue;
        this.sparks.push({ x, y: this.y(n.hz, h), vx: (Math.random() - 0.5) * 30, vy: -40 - Math.random() * 90, life: 1 });
      }
    }
    this.loops = [];
  }

  rest() {
    this.loops = [];
  }

  destroy() {
    cancelAnimationFrame(this.frame);
  }

  private size() {
    return { w: this.canvas.clientWidth, h: this.canvas.clientHeight };
  }

  private playX = (w: number) => w * 0.3;

  private x(n: Note, songTime: number, w: number) {
    if (this.still) return 24 + (n.t / 3) * (w - 48); // the whole song laid out, unmoving
    return this.playX(w) + (n.t - songTime) * PX_PER_S;
  }

  private y(hz: number, h: number) {
    const f = Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ);
    return h - 18 - f * (h - 36);
  }

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    const { w, h } = this.size();
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
    const singing = this.loops.length > 0;

    // Five lines across the data's register, and faint ledger lines above and below.
    for (let i = -2; i <= 6; i++) {
      const y = this.y(2000 * 2 ** (i * 0.25), h);
      const ledger = i < 0 || i > 4;
      g.strokeStyle = `rgb(${INK} / ${ledger ? 0.1 : singing ? 0.35 : 0.25})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(w, Math.round(y) + 0.5);
      g.stroke();
    }

    const px = this.still ? -100 : this.playX(w);
    if (singing && !this.still) {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgb(${GOLD} / 0)`);
      grad.addColorStop(0.5, `rgb(${GOLD} / 0.5)`);
      grad.addColorStop(1, `rgb(${GOLD} / 0)`);
      g.fillStyle = grad;
      g.fillRect(px - 0.75, 0, 1.5, h);
    }

    for (const { at, notes } of this.loops) {
      const songTime = now - at;
      // Each beat's tones joined by a hairline, like a chord's stem.
      const beats = new Map<number, Note[]>();
      for (const n of notes) if (!n.chime) beats.set(n.t, [...(beats.get(n.t) ?? []), n]);
      for (const chord of beats.values()) {
        const x = this.x(chord[0], songTime, w);
        if (x < -10 || x > w + 10) continue;
        const ys = chord.map((n) => this.y(n.hz, h));
        g.strokeStyle = `rgb(${INK} / 0.2)`;
        g.beginPath();
        g.moveTo(x, Math.min(...ys));
        g.lineTo(x, Math.max(...ys));
        g.stroke();
      }
      for (const n of notes) {
        const x = this.x(n, songTime, w);
        if (x < -20 || x > w + 20) continue;
        const sounded = this.still ? songTime >= n.t : x <= px + 1;
        const near = Math.max(0, 1 - Math.abs(this.still ? (songTime - n.t) * PX_PER_S : x - px) / 28);
        const fade = this.still ? 1 : Math.min(1, Math.max(0, x / (px * 0.9)));
        this.head(g, x, this.y(n.hz, h), n.chime ? 1.5 : 1, sounded ? `rgb(${GOLD} / ${(0.35 + 0.65 * near) * fade})` : `rgb(${INK} / 0.45)`, near);
      }
    }

    // After a catch: the notes rise and go.
    this.sparks = this.sparks.filter((s) => s.life > 0);
    for (const s of this.sparks) {
      s.x += s.vx / 60;
      s.y += s.vy / 60;
      s.vy -= 1.5;
      s.life -= 1 / 70;
      this.head(g, s.x, s.y, 1, `rgb(${GOLD} / ${Math.max(0, s.life)})`, s.life * 0.6);
    }
  };

  private head(g: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, glow: number) {
    g.save();
    g.translate(x, y);
    g.rotate(-0.35);
    if (glow > 0.05) {
      g.shadowColor = `rgb(${GOLD} / ${glow})`;
      g.shadowBlur = 16 * glow;
    }
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(0, 0, 6.2 * size, 4.4 * size, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

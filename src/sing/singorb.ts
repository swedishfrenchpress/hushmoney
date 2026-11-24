import { makeOrb, type Look, type Orb, type Sound } from '../listen/orb';

// The SING button is the chrome orb. At rest it ripples gently; it swells as the pointer
// comes near and squashes under a press; while the laptop sings, every note of the song's
// tune sends a pulse through it, on the same audio clock as the title letters and the
// rings. Without WebGL, or with reduced motion, it stays a flat black disc.

export class SingOrb {
  private orb: Orb | null = null;
  private loops: { at: number; notes: { t: number; degree: number }[] }[] = [];
  private singing = false;
  private busy = false;
  private near = 0;
  private pressed = false;
  private want: Look = 'listening';
  private t0 = performance.now();

  constructor(
    private host: HTMLElement,
    zone: HTMLElement,
    private clock: () => number,
  ) {
    void makeOrb(host, () => this.sound()).then((o) => {
      this.orb = o;
      o?.look(this.want);
    });
    addEventListener('pointermove', (e) => this.track(e), { passive: true });
    zone.addEventListener('pointerdown', () => this.press(true));
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) zone.addEventListener(type, () => this.press(false));
  }

  // How close the pointer is to the orb: 0 far, 1 on it. It swells the ball and the shader.
  private track(e: PointerEvent) {
    const r = this.host.getBoundingClientRect();
    const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
    this.near = Math.max(0, 1 - d / (r.width * 1.3));
    this.paint();
  }

  private press(down: boolean) {
    this.pressed = down;
    this.host.toggleAttribute('data-pressed', down); // the stylesheet makes a press quick
    this.paint();
  }

  private paint() {
    const scale = this.pressed ? 0.94 : 1 + this.near * 0.04;
    this.host.style.transform = `scale(${scale.toFixed(3)})`;
  }

  // What the orb feels: a little room tone, the pointer, and a pulse per note while singing.
  private sound(): Sound {
    const t = (performance.now() - this.t0) / 1000;
    const now = this.clock();
    let pulse = 0;
    let onset = 0;
    for (const loop of this.loops) {
      for (const n of loop.notes) {
        const age = now - (loop.at + n.t);
        if (age >= 0 && age < 0.7) {
          pulse += Math.exp(-age * 6) * (0.55 + (0.35 * n.degree) / 11);
          if (age < 0.09) onset = 0.35;
        }
      }
    }
    const rest = 0.09 + 0.05 * Math.sin(t * 1.4);
    // While the song is on its way the ball churns, faster and brighter than at rest.
    const level = this.busy ? 0.4 + 0.15 * Math.sin(t * 6) : rest + this.near * 0.22 + (this.singing ? 0.12 : 0) + pulse * 0.8;
    return { level: Math.min(0.8, level), kick: Math.max(onset, this.pressed ? 0.4 : 0) };
  }

  // A play of the song starts at audio-clock time `at`, with these notes.
  loop(at: number, notes: { t: number; degree: number }[]) {
    this.singing = true;
    this.loops = [...this.loops.slice(-1), { at, notes }];
  }

  // The press has been heard and the song isn't playing yet.
  loading(on: boolean) {
    this.busy = on;
  }

  rest() {
    this.singing = false;
    this.loops = [];
  }

  // For the caught moment, when the ball can take the coin's look.
  look(next: Look) {
    this.want = next;
    this.orb?.look(next);
  }
}

// The title plays the song: each letter lifts as its note sounds, higher for a higher
// scale degree, then settles back. Nine letters, about seven notes, spread across the
// word, so every song makes the word move in its own way. Driven by the same audio
// clock as the stave and the rings. With reduced motion nothing moves.

const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export class TitleBells {
  private timers: number[] = [];

  constructor(
    private letters: HTMLElement[],
    private clock: () => number,
  ) {}

  private lift(letter: number, degree: number) {
    const em = 0.05 + (0.11 * degree) / 11;
    this.letters[letter]?.animate(
      [{ transform: 'translateY(0)' }, { transform: `translateY(${-em}em)`, offset: 0.2 }, { transform: 'translateY(0)' }],
      { duration: 950, easing: EASE },
    );
  }

  // One play of the song starts at clock time `at`; `notes` are when each sounds and how high.
  loop(at: number, notes: { t: number; degree: number }[]) {
    this.rest();
    if (still()) return;
    const last = this.letters.length - 1;
    notes.forEach((note, i) => {
      const letter = notes.length < 2 ? 0 : Math.round((i * last) / (notes.length - 1));
      const delay = (at + note.t - this.clock()) * 1000;
      if (delay < -250) return;
      this.timers.push(window.setTimeout(() => this.lift(letter, note.degree), Math.max(0, delay)));
    });
  }

  // The sound check's chime: E, G♯, B, three letters in turn.
  chime() {
    if (still()) return;
    [
      [1, 0],
      [4, 2],
      [7, 3],
    ].forEach(([letter, degree], i) => this.timers.push(window.setTimeout(() => this.lift(letter!, degree!), i * 160)));
  }

  // The coins are caught: the whole word dips once and is still.
  settle() {
    this.rest();
    if (still()) return;
    for (const l of this.letters) l.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(0.04em)', offset: 0.3 }, { transform: 'translateY(0)' }], { duration: 900, easing: EASE });
  }

  rest() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }
}

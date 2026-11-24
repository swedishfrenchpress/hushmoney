// HUSH MONEY as one mask per letter, so each can rise out of nothing on the landing
// and ring with a note of the song. Returns the letters themselves, spaces left out.

// Each letter sits in its own box, so the font's own kerning can't reach across them. These are
// the pairs, in em, tuned by eye for Olline caps: negative pulls the pair together.
export const KERN: Record<string, number> = {
  HU: 0.02,
  US: 0.01,
  SH: 0.02,
  MO: 0.02,
  ON: 0.03,
  NE: 0.05,
  EY: -0.03,
};

export function splitTitle(title: HTMLElement): HTMLElement[] {
  const text = title.textContent ?? '';
  title.textContent = '';
  const letters: HTMLElement[] = [];
  const chars = [...text];
  for (const [i, c] of chars.entries()) {
    const mask = document.createElement('span');
    mask.className = c === ' ' ? 'ch sp' : 'ch';
    const inner = document.createElement('span');
    inner.textContent = c === ' ' ? '' : c;
    mask.append(inner);
    const k = KERN[(c + (chars[i + 1] ?? '')).toUpperCase()];
    if (k) mask.style.marginRight = `${k}em`;
    title.append(mask);
    if (c !== ' ') letters.push(inner);
  }
  return letters;
}

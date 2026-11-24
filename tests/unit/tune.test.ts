import { describe, expect, it } from 'vitest';
import { songTune, tune } from '../../src/melody';
import { ladder } from '../../src/tuneLadder';
import { MINTS, packSong } from '../../shared/song';

describe('the tune of a song', () => {
  const seed = Uint8Array.from({ length: 16 }, (_, i) => i * 17);
  const bytes = packSong(MINTS[1]!, seed);

  it('is the same every time, and always ends on E (degree 5, home)', () => {
    expect(songTune(bytes)).toEqual(songTune(bytes));
    expect(songTune(bytes).at(-1)).toBe(5);
  });

  it('differs between songs and stays on the scale', () => {
    const other = packSong(MINTS[1]!, Uint8Array.from({ length: 16 }, (_, i) => 255 - i * 11));
    expect(songTune(other)).not.toEqual(songTune(bytes));
    for (const d of tune(bytes, 9)) expect(d).toBeGreaterThanOrEqual(0);
  });

  it('draws one dot per note, the last one open', () => {
    const svg = ladder(songTune(bytes), 300, 96);
    expect((svg.match(/class="tdot/g) ?? []).length).toBe(songTune(bytes).length);
    expect(svg).toContain('tdot last');
  });
});

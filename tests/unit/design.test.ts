import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { chime, chimeSeconds, CHIME, withChime } from '../../src/chime';
import { encode } from '../../src/ggwave';
import { score, scoreOf, TONES } from '../../src/sing/score';
import { MINTS, packSong, unpackSong } from '../../shared/song';
import { hearAll, join, noisy, resample, silence } from '../support/audio';

const song = () => packSong(MINTS[1], new Uint8Array(randomBytes(16)));

describe('the chime', () => {
  test('stays below ggwave band, and is short', () => {
    expect(Math.max(...CHIME) * 1).toBeLessThan(1800);
    expect(chimeSeconds()).toBeLessThan(1);
    expect(chime(48_000).length).toBe(Math.round(chimeSeconds() * 48_000));
  });

  for (const [laptop, phone] of [
    [48_000, 48_000],
    [48_000, 44_100],
    [44_100, 44_100],
    [44_100, 48_000],
  ]) {
    test(`a song with the chime is heard just the same, sung at ${laptop} Hz and heard at ${phone} Hz`, async () => {
      const bytes = song();
      const sung = resample(withChime(await encode(bytes, laptop), laptop), laptop, phone);
      const air = noisy(join(silence(0.3, phone), sung, silence(0.3, phone)), 0.15, laptop);
      expect((await hearAll(air, phone)).map(unpackSong)).toEqual([unpackSong(bytes)]);
    });
  }

  test('the chime alone is never heard as a song', async () => {
    expect(await hearAll(join(chime(48_000), chime(48_000), silence(1, 48_000)), 48_000)).toEqual([]);
  });

  test('looping chime and song, as the laptop does, every song is heard', async () => {
    const bytes = song();
    const one = withChime(await encode(bytes, 48_000), 48_000);
    const air = join(one, silence(1.8, 48_000), one, silence(1.8, 48_000), one);
    expect((await hearAll(air, 48_000)).map(unpackSong)).toEqual([unpackSong(bytes), unpackSong(bytes), unpackSong(bytes)]);
  });
});

// From the first six-tone beat to the last: the song's data, between its markers.
const dataBeats = (beats: { tones: number[] }[]) => {
  const first = beats.findIndex((b) => b.tones.length === 6);
  const last = beats.length - 1 - [...beats].reverse().findIndex((b) => b.tones.length === 6);
  return first < 0 ? [] : beats.slice(first, last + 1);
};

describe('the score', () => {
  test("reads up to six of ggwave's tones per beat, one per band, and exactly six in every data beat", async () => {
    const beats = await scoreOf(song());
    expect(beats.length).toBeGreaterThan(10);
    for (const b of beats) {
      expect(b.tones.length).toBeLessThanOrEqual(6);
      for (const t of b.tones) expect(t).toBeGreaterThanOrEqual(0), expect(t).toBeLessThan(TONES);
      expect(new Set(b.tones.map((t) => Math.floor(t / 16))).size).toBe(b.tones.length);
    }
    // The beats between ggwave's start and end markers carry data: six tones each, never a blur.
    const data = dataBeats(beats);
    expect(data.length).toBeGreaterThan(5);
    for (const b of data) expect(b.tones).toHaveLength(6);
  });

  test('neighbouring tones across a band edge are told apart, over many songs', async () => {
    // Regression: read at 44.1 kHz, tones 47 Hz apart blurred, and 47 read as 46.
    for (let i = 0; i < 40; i++) {
      const bytes = song();
      const once = (await scoreOf(bytes)).map((b) => b.tones.join());
      expect((await scoreOf(bytes)).map((b) => b.tones.join())).toEqual(once);
      for (const b of dataBeats(await scoreOf(bytes))) expect(b.tones).toHaveLength(6);
    }
  });

  test('a different song is a different score', async () => {
    const a = (await scoreOf(song())).map((b) => b.tones.join());
    const b = (await scoreOf(song())).map((x) => x.tones.join());
    expect(a).not.toEqual(b);
  });

  test("the score is read from the song's samples: a 48 kHz encode, as score() expects", async () => {
    const bytes = song();
    expect(score(await encode(bytes, 48_000))).toEqual(await scoreOf(bytes));
  });
});

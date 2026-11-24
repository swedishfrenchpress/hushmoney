import { randomBytes } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { encode, type Mode } from '../../src/ggwave';
import { MINTS, packSong, SEED_BYTES, unpackSong } from '../../shared/song';
import { clip, gain, hearAll, join, noisy, resample, silence } from '../support/audio';

// Songs through everything a room can do to them, with no speaker or mic: the
// samples go from the encoder to the decoder in the mic's 128-sample blocks.

const song = () => packSong(MINTS[1], new Uint8Array(randomBytes(SEED_BYTES)));
const rates = [48_000, 44_100] as const;

async function sung(bytes: Uint8Array, laptop: number, phone: number, mode: Mode = 'fast') {
  return resample(await encode(bytes, laptop, mode), laptop, phone);
}

describe('ggwave loopback', () => {
  for (const laptop of rates) {
    for (const phone of rates) {
      test(`sung at ${laptop} Hz, heard at ${phone} Hz, through noise`, async () => {
        const bytes = song();
        const air = noisy(join(silence(0.3, phone), await sung(bytes, laptop, phone), silence(0.3, phone)), 0.15, laptop + phone);
        expect((await hearAll(air, phone)).map(unpackSong)).toEqual([unpackSong(bytes)]);
      });
    }
  }

  test('a song is short: under 2 s fast, under 2.5 s normal', async () => {
    const bytes = song();
    expect((await encode(bytes, 48_000, 'fast')).length / 48_000).toBeLessThan(2);
    expect((await encode(bytes, 48_000, 'normal')).length / 48_000).toBeLessThan(2.5);
  });

  for (const phone of rates) {
    test(`clipped hard by an overdriven speaker, at ${phone} Hz`, async () => {
      const bytes = song();
      const air = join(silence(0.2, phone), clip(await sung(bytes, 48_000, phone), 6), silence(0.2, phone));
      expect((await hearAll(air, phone)).map(unpackSong)).toEqual([unpackSong(bytes)]);
    });

    test(`very quiet (-34 dB) with a little hiss, at ${phone} Hz`, async () => {
      const bytes = song();
      const air = noisy(join(silence(0.2, phone), gain(await sung(bytes, 44_100, phone), 0.02), silence(0.2, phone)), 0.002, 7);
      expect((await hearAll(air, phone)).map(unpackSong)).toEqual([unpackSong(bytes)]);
    });

    test(`long silence before and after, at ${phone} Hz`, async () => {
      const bytes = song();
      const air = join(silence(3, phone), await sung(bytes, 48_000, phone), silence(3, phone));
      expect((await hearAll(air, phone)).map(unpackSong)).toEqual([unpackSong(bytes)]);
    });

    test(`two songs back to back are both heard, in order, at ${phone} Hz`, async () => {
      const [a, b] = [song(), song()];
      const air = join(silence(0.2, phone), await sung(a, 48_000, phone), silence(0.5, phone), await sung(b, 48_000, phone), silence(0.2, phone));
      expect((await hearAll(air, phone)).map(unpackSong)).toEqual([unpackSong(a), unpackSong(b)]);
    });
  }

  test('the normal mode is heard too, so the laptop can alternate', async () => {
    const bytes = song();
    const air = noisy(join(silence(0.2, 44_100), await sung(bytes, 48_000, 44_100, 'normal'), silence(0.2, 44_100)), 0.15, 3);
    expect((await hearAll(air, 44_100)).map(unpackSong)).toEqual([unpackSong(bytes)]);
  });

  test('a 16 kHz phone (call-quality mic) still hears it: the tones stay under 7 kHz', async () => {
    const bytes = song();
    const air = join(silence(0.2, 16_000), await sung(bytes, 48_000, 16_000), silence(0.2, 16_000));
    expect((await hearAll(air, 16_000)).map(unpackSong)).toEqual([unpackSong(bytes)]);
  });

  test('odd block sizes make no difference', async () => {
    const bytes = song();
    const air = join(silence(0.2, 44_100), await sung(bytes, 48_000, 44_100), silence(0.2, 44_100));
    for (const block of [1, 127, 1000, 4096]) expect((await hearAll(air, 44_100, block)).map(unpackSong)).toEqual([unpackSong(bytes)]);
  });

  test('silence and noise alone are never heard as a song', async () => {
    expect(await hearAll(noisy(silence(5, 48_000), 0.3, 11), 48_000)).toEqual([]);
  });
});

// How often a song survives the room, per ggwave mode and condition. No speaker
// or mic: samples go encoder to decoder with the room done to them in software.
//
//   npm run air            20 songs per cell
//   npm run air -- 50      50 songs per cell
//
// A cell passes a song when the decoder hears exactly that song and nothing else.

import { randomBytes } from 'node:crypto';
import { encode } from '../src/ggwave.ts';
import { withMelody } from '../src/melody.ts';
import { MINTS, packSong, unpackSong } from '../shared/song.ts';
import { clip, echo, gain, hearAll, join, noisy, resample, silence } from '../tests/support/audio.ts';

const trials = Number(process.argv[2] ?? 20);
const modes = ['fastest', 'fast', 'normal'];
const phone = 44_100; // the harder of the two common rates

const conditions = {
  clean: (x) => x,
  'noise 0.15': (x, i) => noisy(x, 0.15, i),
  'noise 0.3': (x, i) => noisy(x, 0.3, i),
  'noise 0.5': (x, i) => noisy(x, 0.5, i),
  'clipped x6': (x) => clip(x, 6),
  'quiet -34 dB': (x, i) => noisy(gain(x, 0.02), 0.002, i),
  'quiet -46 dB': (x, i) => noisy(gain(x, 0.005), 0.002, i),
  'echo 30 ms': (x) => echo(x, phone),
  'echo + noise 0.3': (x, i) => noisy(echo(x, phone), 0.3, i),
  '16 kHz mic': null, // resampled down to 16 kHz instead of 44.1
};

const rows = [];
const airtime = {};
for (const mode of modes) {
  const row = { mode };
  for (const [name, room] of Object.entries(conditions)) {
    let pass = 0;
    for (let i = 0; i < trials; i++) {
      const bytes = packSong(MINTS[1], new Uint8Array(randomBytes(16)));
      const sung = withMelody(await encode(bytes, 48_000, mode), 48_000, bytes);
      airtime[mode] ??= (sung.length / 48_000).toFixed(2);
      const rate = room ? phone : 16_000;
      const air = join(silence(0.3, rate), resample(sung, 48_000, rate), silence(0.3, rate));
      const heard = await hearAll(room ? room(air, i + 1) : air, rate);
      if (heard.length === 1 && heard[0].every((b, j) => b === bytes[j])) pass++;
    }
    row[name] = `${Math.round((pass / trials) * 100)}%`;
  }
  rows.push(row);
}
console.log(`${trials} songs per cell, heard at ${phone / 1000} kHz. Airtime: ${modes.map((m) => `${m} ${airtime[m]} s`).join(', ')}.`);
console.table(rows);

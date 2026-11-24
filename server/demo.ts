import { MINTS, unpackSong, fromHex, type SongResult } from '../shared/song.js';
import songs from './demo-songs.json' with { type: 'json' };

// A demo for a test deploy with nothing set up: songs made ahead on the test
// mint (fake sats, worth nothing), picked at random and handed out again and
// again. It is on only with TRICK4_DEMO=1, and refuses to start if any song in
// the file is for another mint, so real sats can never end up here.

export const DEMO = process.env.TRICK4_DEMO === '1';

const entries = songs as unknown as SongResult[];

export function demoSong(): SongResult | null {
  if (!entries.length) return null;
  for (const e of entries) {
    const unpacked = unpackSong(fromHex(e.song) ?? new Uint8Array());
    if (!unpacked || unpacked.mint !== MINTS[1]) throw new Error('[demo] demo-songs.json holds a song that is not for the test mint.');
  }
  return entries[Math.floor(Math.random() * entries.length)]!;
}

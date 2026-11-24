// Makes the songs for the test-deploy demo (server/demo-songs.json): free test-mint
// sats, worth nothing. Run it again when they've all been caught.
//
//   npx tsx scripts/demo-songs.mjs 40

import { writeFileSync } from 'node:fs';
import { makeTestSongs } from './lib/make-songs.ts';

const n = Number(process.argv[2] ?? 40);
const songs = await makeTestSongs(n);
writeFileSync(new URL('../server/demo-songs.json', import.meta.url), JSON.stringify(songs));
console.log(`wrote ${songs.length} test-mint songs to server/demo-songs.json`);

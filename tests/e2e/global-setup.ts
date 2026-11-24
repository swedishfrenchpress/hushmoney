import { fillPool } from '../../scripts/lib/fill-pool';
import { PORT } from '../../playwright.config';

// Every test that needs a song takes one from the pool, so it starts stocked
// with a few made on the test mint (free), by the same code as scripts/songs.mjs.
export default async function setup() {
  await fillPool(`http://localhost:${PORT}`, 16);
}

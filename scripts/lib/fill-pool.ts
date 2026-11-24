import { makeTestSongs, pushSongs } from './make-songs';

// Puts n testnut songs in the pool of the server at `base`, for scripts and
// tests that need songs without paying for any. Made by the same code as
// scripts/songs.mjs. A local server shares .data/pool.json with this process,
// so they go straight in; any other server needs ADMIN_SECRET.
export async function fillPool(base: string, n: number): Promise<void> {
  const entries = await makeTestSongs(n);
  if (/^https?:\/\/(localhost|127\.0\.0\.1)[:/]?/.test(base)) {
    const { push } = await import('../../server/pool');
    await push(entries);
  } else {
    if (!process.env.ADMIN_SECRET) throw new Error('Set ADMIN_SECRET to fill the pool of ' + base);
    await pushSongs(base, process.env.ADMIN_SECRET, entries);
  }
}

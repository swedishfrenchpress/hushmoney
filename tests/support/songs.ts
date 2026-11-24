import { Wallet, type Proof } from '@cashu/cashu-ts';
import { randomBytes } from 'node:crypto';
import { songCoins } from '../../shared/fees';
import { SEED_BYTES, type Song } from '../../shared/song';
import type { FakeMint } from './fakemint';

// A song made the way the server makes one, on the fake mint: coins split off
// other coins with outputs derived from a fresh seed.
export async function makeSong(fake: FakeMint, sats: number): Promise<{ song: Song; proofs: Proof[] }> {
  const ppk = fake.active.ppk;
  const denominations = songCoins(sats, ppk);
  const total = denominations.reduce((a, b) => a + b, 0);
  const funding = fake.issue(songCoins(total + 1, ppk)); // enough to cover the swap's own fee
  const seed = new Uint8Array(randomBytes(SEED_BYTES));
  const w = new Wallet(fake.url, { unit: 'sat', bip39seed: seed });
  await w.loadMint();
  const { send } = await w.send(total, funding, { includeFees: false }, { send: { type: 'deterministic', counter: 0, denominations }, keep: { type: 'random' } });
  return { song: { mint: fake.url, seed }, proofs: send };
}

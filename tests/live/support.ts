import { Wallet } from '@cashu/cashu-ts';
import { fromHex, MINTS, SONG_SATS, unpackSong, type Song, type SongResult } from '../../shared/song';
import { MemoryKv, Vault } from '../../src/listen/vault';
import { PhoneWallet } from '../../src/listen/wallet';
import { makeTestSongs } from '../../scripts/lib/make-songs';

// Live helpers: songs made on the real testnut by the same code as scripts/songs.mjs.

export const MINT = MINTS[1];
export const realFetch = globalThis.fetch;

// A few songs at a time: each batch is one mint and a pair of swaps per song.
let spare: SongResult[] = [];
export async function testSongs(n: number): Promise<SongResult[]> {
  return retry(() => makeTestSongs(n), 3);
}

export async function makeSong(): Promise<{ song: Song; sats: number; proofs: SongResult['proofs']; entry: SongResult }> {
  if (!spare.length) spare = await testSongs(4);
  const entry = spare.shift()!;
  return { song: unpackSong(fromHex(entry.song)!)!, sats: SONG_SATS, proofs: entry.proofs, entry };
}

export const phone = (kv = new MemoryKv()) => new PhoneWallet(MINT, Vault.of(kv));

export async function freshWallet() {
  const w = new Wallet(MINT, { unit: 'sat' });
  await retry(() => w.loadMint());
  return w;
}

// testnut is shared and sometimes slow or rate limited: back off and try again.
export async function retry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const transient = /rate|429|timed out|network|fetch failed|ECONN|503|502/i.test(String((e as Error)?.message ?? e));
      if (!transient || i >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

// A fetch that passes everything through to the network, except that it can
// lose answers to /v1/swap on purpose: the mint does the swap, the phone never hears back.
export function lossyFetch() {
  const state = { loseSwapAnswers: 0, swaps: 0, restores: 0, restoreOutputs: [] as number[] };
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.endsWith('/v1/restore')) {
      state.restores++;
      state.restoreOutputs.push(JSON.parse(String(init?.body)).outputs.length);
    }
    if (url.endsWith('/v1/swap')) {
      state.swaps++;
      if (state.loseSwapAnswers > 0) {
        state.loseSwapAnswers--;
        await realFetch(input, init); // the mint does it
        throw new TypeError('fetch failed'); // and the answer is lost
      }
    }
    return realFetch(input, init);
  };
  return { fetch, state };
}

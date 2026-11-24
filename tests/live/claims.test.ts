import { Wallet } from '@cashu/cashu-ts';
import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { MINTS } from '../../shared/song';
import { freshWallet, lossyFetch, makeSong, phone, retry } from './support';
import { MemoryKv } from '../../src/listen/vault';

afterEach(() => vi.unstubAllGlobals());

describe('catching songs on testnut', () => {
  test('a song nets exactly the ₿21 it shows', async () => {
    const { song, sats } = await makeSong();
    const w = phone();
    expect(await retry(() => w.catch(song))).toEqual({ status: 'caught', sats });
    expect(w.balance().total).toBe(21);
  });

  test('two phones racing for one song: exactly one wins, the other hears "someone else"', async () => {
    const { song } = await makeSong();
    const [a, b] = [phone(), phone()];
    const results = await Promise.all([a.catch(song), b.catch(song)]);
    expect(results.filter((r) => r.status === 'caught')).toEqual([{ status: 'caught', sats: 21 }]);
    expect(results.filter((r) => r.status === 'gone')).toHaveLength(1);
    expect(a.pendingClaims() + b.pendingClaims()).toBe(0);
  });

  test('a song whose coins were already spent is gone', async () => {
    const { song, proofs } = await makeSong();
    await (await freshWallet()).receive(proofs);
    expect(await phone().catch(song)).toEqual({ status: 'gone' });
  });

  test('a seed testnut never signed for is gone', async () => {
    expect(await phone().catch({ mint: MINTS[1], seed: new Uint8Array(randomBytes(16)) })).toEqual({ status: 'gone' });
  });

  test('restore asks about 10 counters and no more', async () => {
    // Twelve 1-sat coins at counters 0 to 11; a phone only ever asks about 0 to 9.
    const seed = new Uint8Array(randomBytes(16));
    const base = await freshWallet();
    const seeded = new Wallet(MINTS[1], { unit: 'sat', bip39seed: seed });
    seeded.loadMintFromCache(base.getMintInfo().cache, base.keyChain.cache);
    const quote = await base.createMintQuoteBolt11(14);
    for (let i = 0; i < 40 && (await base.checkMintQuoteBolt11(quote.quote)).state !== 'PAID'; i++) await new Promise((r) => setTimeout(r, 500));
    const funding = await base.mintProofsBolt11(14, quote.quote);
    await seeded.send(12, funding, { includeFees: false }, { send: { type: 'deterministic', counter: 0, denominations: Array(12).fill(1) }, keep: { type: 'random' } });

    const net = lossyFetch();
    vi.stubGlobal('fetch', net.fetch);
    const w = phone();
    const r = await w.catch({ mint: MINTS[1], seed });
    expect(net.state.restoreOutputs).toEqual([10]);
    expect(r).toEqual({ status: 'caught', sats: 10 - 1 }); // ten coins found, one sat to swap them
  });
});

describe('a lost answer, on testnut', () => {
  test('cashu-ts sends the swap again and testnut repeats its answer (NUT-19)', async () => {
    const { song } = await makeSong();
    const net = lossyFetch();
    vi.stubGlobal('fetch', net.fetch);
    net.state.loseSwapAnswers = 1;
    const w = phone();
    expect(await w.catch(song)).toEqual({ status: 'caught', sats: 21 });
    expect(net.state.swaps).toBe(2);
    expect(net.state.restores).toBe(1); // only the song's own restore
  });

  test('a tab that lost its answer and closed: the next visit gets it from NUT-19, within 60 s', async () => {
    const { song } = await makeSong();
    const net = lossyFetch();
    vi.stubGlobal('fetch', net.fetch);
    net.state.loseSwapAnswers = 50; // the network stays down for this tab
    const kv = new MemoryKv();
    await expect(phone(kv).catch(song)).rejects.toThrow();
    expect(phone(kv).pendingClaims()).toBe(1);

    net.state.loseSwapAnswers = 0;
    const restoresBefore = net.state.restores;
    const next = phone(kv);
    expect(await next.recover()).toBe(21);
    expect(next.balance().total).toBe(21);
    expect(net.state.restores).toBe(restoresBefore); // the replay answered, no restore needed
  });

  test('after testnut forgets (60 s), the next visit gets it from NUT-09 restore', async () => {
    const { song } = await makeSong();
    const net = lossyFetch();
    vi.stubGlobal('fetch', net.fetch);
    net.state.loseSwapAnswers = 50;
    const kv = new MemoryKv();
    await expect(phone(kv).catch(song)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 65_000));

    net.state.loseSwapAnswers = 0;
    const restoresBefore = net.state.restores;
    const next = phone(kv);
    expect(await next.recover()).toBe(21);
    expect(next.balance().total).toBe(21);
    expect(net.state.restores).toBe(restoresBefore + 1);
  }, 150_000);
});

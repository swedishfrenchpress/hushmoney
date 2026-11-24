import { getDecodedToken, Wallet } from '@cashu/cashu-ts';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MemoryKv, Vault } from '../../src/listen/vault';
import { PhoneWallet } from '../../src/listen/wallet';
import { FakeMint } from '../support/fakemint';
import { fakeNet } from '../support/net';
import { makeSong } from '../support/songs';

let fake: FakeMint;
const phone = (kv = new MemoryKv()) => new PhoneWallet(fake.url, Vault.of(kv));
const swaps = () => fake.calls.filter((c) => c === '/v1/swap').length;

beforeEach(() => {
  fake = new FakeMint(100);
  vi.stubGlobal('fetch', fakeNet(fake).fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('catching a song', () => {
  test('restores the coins from the seed and claims exactly the amount', async () => {
    const { song } = await makeSong(fake, 37);
    const w = phone();
    expect(await w.catch(song)).toEqual({ status: 'caught', sats: 37 });
    expect(w.balance()).toEqual({ held: 37, out: 0, total: 37 });
    expect(w.pendingClaims()).toBe(0);
  });

  test('a second phone hearing the same song gets nothing', async () => {
    const { song } = await makeSong(fake, 21);
    expect((await phone().catch(song)).status).toBe('caught');
    expect(await phone().catch(song)).toEqual({ status: 'gone' });
  });

  test('two phones racing for one song: exactly one wins', async () => {
    const { song } = await makeSong(fake, 64);
    const [a, b] = [phone(), phone()];
    const results = await Promise.all([a.catch(song), b.catch(song)]);
    expect(results.filter((r) => r.status === 'caught')).toEqual([{ status: 'caught', sats: 64 }]);
    expect(results.filter((r) => r.status === 'gone')).toHaveLength(1);
    expect(a.balance().total + b.balance().total).toBe(64);
    expect(a.pendingClaims() + b.pendingClaims()).toBe(0);
  });

  test('a seed whose coins were already spent is gone', async () => {
    const { song, proofs } = await makeSong(fake, 10);
    const thief = new Wallet(fake.url, { unit: 'sat' });
    await thief.loadMint();
    await thief.receive(proofs);
    expect(await phone().catch(song)).toEqual({ status: 'gone' });
  });

  test('a seed the mint never signed for is gone', async () => {
    expect(await phone().catch({ mint: fake.url, seed: new Uint8Array(16).fill(7) })).toEqual({ status: 'gone' });
  });

  test("a song for another mint isn't caught here", async () => {
    await expect(phone().catch({ mint: 'https://other.mint', seed: new Uint8Array(16) })).rejects.toThrow('another mint');
  });

  test("a browser that can't store refuses before touching the mint", async () => {
    const { song } = await makeSong(fake, 5);
    const before = fake.calls.length;
    await expect(new PhoneWallet(fake.url, Vault.of(null)).catch(song)).rejects.toThrow("can't save");
    expect(fake.calls.length).toBe(before);
  });
});

describe('when the answer is lost', () => {
  test('cashu-ts asks again and the mint repeats its answer (NUT-19)', async () => {
    const { song } = await makeSong(fake, 33);
    const before = swaps();
    fake.fail(/\/v1\/swap$/, 'network', 'after');
    const w = phone();
    expect(await w.catch(song)).toEqual({ status: 'caught', sats: 33 });
    expect(swaps() - before).toBe(2);
    expect(w.pendingClaims()).toBe(0);
  });

  test('a claim whose answer never came back lands later, from restore (NUT-09)', async () => {
    const { song } = await makeSong(fake, 50);
    fake.replayTtlMs = 0; // past testnut's 60 s: no replay
    fake.fail(/\/v1\/swap$/, 'network', 'after', 1);
    fake.fail(/\/v1\/swap$/, 'network', 'before', 20);
    const kv = new MemoryKv();
    await expect(phone(kv).catch(song)).rejects.toThrow();
    expect(phone(kv).pendingClaims()).toBe(1);
    expect(phone(kv).balance().total).toBe(0);

    fake.faults = [];
    const reopened = phone(kv); // a new tab, same storage
    expect(await reopened.recover()).toBe(50);
    expect(reopened.balance().total).toBe(50);
    expect(reopened.pendingClaims()).toBe(0);
  });

  test('a claim that never reached the mint is sent on the next visit', async () => {
    const { song } = await makeSong(fake, 12);
    fake.fail(/\/v1\/swap$/, 'network', 'before', 20);
    const kv = new MemoryKv();
    await expect(phone(kv).catch(song)).rejects.toThrow();
    expect(phone(kv).pendingClaims()).toBe(1);
    fake.faults = [];
    const reopened = phone(kv);
    expect(await reopened.recover()).toBe(12);
    expect(reopened.balance().total).toBe(12);
  });

  test('a saved claim someone else beat is dropped as gone', async () => {
    const { song } = await makeSong(fake, 8);
    fake.fail(/\/v1\/swap$/, 'network', 'before', 20);
    const kv = new MemoryKv();
    await expect(phone(kv).catch(song)).rejects.toThrow();
    fake.faults = [];
    expect((await phone().catch(song)).status).toBe('caught'); // another phone
    const reopened = phone(kv);
    expect(await reopened.recover()).toBe(0);
    expect(reopened.pendingClaims()).toBe(0);
    expect(reopened.balance().total).toBe(0);
  });

  test('recovering twice never counts a coin twice', async () => {
    const { song } = await makeSong(fake, 40);
    fake.replayTtlMs = 0;
    fake.fail(/\/v1\/swap$/, 'network', 'after', 1);
    fake.fail(/\/v1\/swap$/, 'network', 'before', 20);
    const kv = new MemoryKv();
    await expect(phone(kv).catch(song)).rejects.toThrow();
    fake.faults = [];
    await Promise.all([phone(kv).recover(), phone(kv).recover()]);
    expect(phone(kv).balance().total).toBe(40);
  });
});

describe('handing sats out', () => {
  test('a token carries everything, and the coins stay until a wallet claims them', async () => {
    const w = phone();
    await w.catch((await makeSong(fake, 20)).song);
    await w.catch((await makeSong(fake, 7)).song);
    const token = w.handOut()!;
    expect(getDecodedToken(token, fake.keysets.map((k) => k.id)).proofs.reduce((s, p) => s + p.amount.toNumber(), 0)).toBe(27);
    expect(w.balance()).toEqual({ held: 0, out: 27, total: 27 });

    expect(await w.settle()).toEqual({ landed: 0, balance: { held: 0, out: 27, total: 27 } });
    const app = new Wallet(fake.url, { unit: 'sat' }); // the wallet app claims it
    await app.loadMint();
    await app.receive(token);
    expect(await w.settle()).toEqual({ landed: 27, balance: { held: 0, out: 0, total: 0 } });
  });

  test('a catch after handing out joins the next token, and only what was handed out lands', async () => {
    const w = phone();
    await w.catch((await makeSong(fake, 16)).song);
    const first = w.handOut()!;
    await w.catch((await makeSong(fake, 4)).song);
    expect(w.balance()).toEqual({ held: 4, out: 16, total: 20 });
    const app = new Wallet(fake.url, { unit: 'sat' });
    await app.loadMint();
    await app.receive(first);
    expect(await w.settle()).toEqual({ landed: 16, balance: { held: 4, out: 0, total: 4 } });
  });

  test('nothing to hand out', () => {
    expect(phone().handOut()).toBeNull();
  });
});

describe('watching for a wallet app to claim', () => {
  const claimedBy = async (token: string) => {
    const app = new Wallet(fake.url, { unit: 'sat' });
    await app.loadMint();
    await app.receive(token);
  };
  const checks = () => fake.calls.filter((c) => c === '/v1/checkstate').length;

  test('a claim is noticed while the page stays open, without a reload', async () => {
    const w = phone();
    await w.catch((await makeSong(fake, 12)).song);
    const token = w.handOut()!;
    const onSpent = vi.fn();
    const stop = await w.watch(onSpent, 20);
    await new Promise((r) => setTimeout(r, 80));
    expect(onSpent).not.toHaveBeenCalled();
    await claimedBy(token);
    await vi.waitFor(() => expect(onSpent).toHaveBeenCalled());
    expect((await w.settle()).landed).toBe(12);
    stop();
  });

  test('a mint that says it pushes, but whose socket fails, is asked instead', async () => {
    fake.pushes = true;
    const w = phone();
    await w.catch((await makeSong(fake, 9)).song);
    const token = w.handOut()!;
    const onSpent = vi.fn();
    const stop = await w.watch(onSpent, 20);
    await claimedBy(token);
    await vi.waitFor(() => expect(onSpent).toHaveBeenCalled());
    stop();
  });

  test('stopping stops the asking', async () => {
    const w = phone();
    await w.catch((await makeSong(fake, 5)).song);
    w.handOut();
    const stop = await w.watch(() => {}, 20);
    await vi.waitFor(() => expect(checks()).toBeGreaterThan(0));
    stop();
    const after = checks();
    await new Promise((r) => setTimeout(r, 80));
    expect(checks()).toBe(after);
  });

  test("coins never handed out aren't watched", async () => {
    const w = phone();
    await w.catch((await makeSong(fake, 6)).song);
    const before = fake.calls.length;
    const stop = await w.watch(() => {}, 20);
    await new Promise((r) => setTimeout(r, 80));
    expect(fake.calls.length).toBe(before);
    stop();
  });
});

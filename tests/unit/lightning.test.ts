import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FakeOutcomeName } from '../../shared/lnurl';
import { fakeInvoice, fakeLimits } from '../../server/fakeln';
import { Lightning, TooSmall } from '../../src/listen/lightning';
import { MemoryKv, Vault } from '../../src/listen/vault';
import { PhoneWallet } from '../../src/listen/wallet';
import { FakeMint } from '../support/fakemint';
import { fakeNet } from '../support/net';
import { makeSong } from '../support/songs';

// The Lightning send against the fake mint, whose fake Lightning reads each
// payment's outcome from the invoice, like testnut's. Addresses are the
// dev-only <outcome>@fake.testnut ones, answered here instead of by the server.

let fake: FakeMint;
const api = {
  limits: async () => ({ ...fakeLimits(), fake: true }),
  invoice: async (address: string, msat: number) => ({ pr: fakeInvoice(address.split('@')[0] as FakeOutcomeName, msat), fake: true }),
};

async function holding(sats: number, kv = new MemoryKv()) {
  const w = new PhoneWallet(fake.url, Vault.of(kv));
  await w.catch((await makeSong(fake, sats)).song);
  return { w, ln: new Lightning(w, api), kv };
}

beforeEach(() => {
  fake = new FakeMint(100);
  vi.stubGlobal('fetch', fakeNet(fake).fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('sending to a Lightning address', () => {
  test('paid: the invoice gets the share less fees, and the unused reserve comes back', async () => {
    const { w, ln } = await holding(64);
    const op = await ln.pay('paid@fake.testnut');
    expect(op.state).toBe('paid');
    expect(op.sats + op.reserve + op.inputFee).toBeLessThanOrEqual(64);
    expect(op.change).toBeGreaterThan(0);
    expect(w.balance().total).toBe(op.change);
  });

  test('failed: nothing paid, and the sats are back in the balance', async () => {
    const { w, ln } = await holding(64);
    const op = await ln.pay('failed@fake.testnut');
    expect(op.state).toBe('failed');
    expect(w.balance().total).toBe(64);
  });

  test('pending, then paid the next time the page looks', async () => {
    const { w, ln, kv } = await holding(32);
    expect((await ln.pay('pending-paid@fake.testnut')).state).toBe('pending');
    expect(w.balance().total).toBe(0);
    const reopened = new Lightning(new PhoneWallet(fake.url, Vault.of(kv)), api);
    const op = (await reopened.resume())!;
    expect(op.state).toBe('paid');
  });

  test('pending, then failed: the sats come back', async () => {
    const { w, ln } = await holding(32);
    expect((await ln.pay('pending-failed@fake.testnut')).state).toBe('pending');
    expect((await ln.resume())!.state).toBe('failed');
    expect(w.balance().total).toBe(32);
  });

  test('a lost answer is settled by asking about the quote, and the change is restored (NUT-09)', async () => {
    const { w, ln } = await holding(64);
    fake.fail(/\/v1\/melt\/bolt11$/, 'network', 'after', 10);
    const op = await ln.pay('paid@fake.testnut');
    expect(op.state).toBe('paid');
    expect(op.change).toBeGreaterThan(0);
    expect(w.balance().total).toBe(op.change);
  });

  test('a payment already under way is resumed, never sent twice', async () => {
    const { ln } = await holding(32);
    await ln.pay('pending@fake.testnut');
    const melts = fake.calls.filter((c) => c === '/v1/melt/bolt11').length;
    expect((await ln.pay('paid@fake.testnut')).state).toBe('pending');
    expect(fake.calls.filter((c) => c === '/v1/melt/bolt11').length).toBe(melts);
  });

  test('below ₿8 there is nothing to send', async () => {
    const { ln } = await holding(5);
    await expect(ln.pay('paid@fake.testnut')).rejects.toThrow(TooSmall);
  });

  test("an address that isn't one is refused before the mint is asked", async () => {
    const { ln } = await holding(16);
    const before = fake.calls.length;
    await expect(ln.pay('not an address')).rejects.toThrow("doesn't look like a Lightning address");
    expect(fake.calls.slice(before).filter((c) => c.includes('melt'))).toEqual([]);
  });
});

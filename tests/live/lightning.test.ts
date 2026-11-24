import { describe, expect, test } from 'vitest';
import type { FakeOutcomeName } from '../../shared/lnurl';
import { fakeInvoice, fakeLimits } from '../../server/fakeln';
import { Lightning } from '../../src/listen/lightning';
import { makeSong, phone, retry } from './support';

// testnut's fake Lightning backend reads the outcome from the invoice, so the
// dev-only fake addresses exercise every path with no real wallet. Off for
// visitors on testnut; this is the code that turns on with real sats.

const api = {
  limits: async () => ({ ...fakeLimits(), fake: true }),
  invoice: async (address: string, msat: number) => ({ pr: fakeInvoice(address.split('@')[0] as FakeOutcomeName, msat), fake: true }),
};

describe('Lightning on testnut, to fake addresses', () => {
  test('paid@fake.testnut: paid, with the unused reserve back as change', async () => {
    const w = phone();
    await retry(async () => w.catch((await makeSong()).song));
    const op = await new Lightning(w, api).pay('paid@fake.testnut');
    expect(op.state).toBe('paid');
    expect(op.sats + op.inputFee + op.reserve).toBeLessThanOrEqual(21);
    expect(w.balance().total).toBe(op.change ?? 0);
  });

  test('failed@fake.testnut: not paid, and the sats are back', async () => {
    const w = phone();
    await retry(async () => w.catch((await makeSong()).song));
    const op = await new Lightning(w, api).pay('failed@fake.testnut');
    expect(op.state).toBe('failed');
    expect(w.balance().total).toBe(21);
  });
});

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { fakeDescription, writeInvoice, type FakeOutcome } from '../shared/bolt11.js';
import { LnurlError, type FakeOutcomeName } from '../shared/lnurl.js';

// Development only, on a test mint: Lightning addresses at fake.testnut that our own server answers
// for, with invoices signed by a throwaway key. testnut's fake Lightning backend reads the outcome of
// a payment from the invoice's description, so each address makes a different thing happen:
//
//   paid@fake.testnut            pays at once
//   pending@fake.testnut         stays pending
//   pending-paid@fake.testnut    pending, then paid when the mint checks again
//   pending-failed@fake.testnut  pending, then failed when the mint checks again
//   failed@fake.testnut          fails
//   unknown@fake.testnut         the backend can't say what happened
//   error@fake.testnut           the backend errors out
//
// No real wallet is ever paid, and testnut sats never leave testnut.

const KEY = secp256k1.utils.randomSecretKey();

const OUTCOMES: Record<FakeOutcomeName, { pay: FakeOutcome; check: FakeOutcome; payErr?: boolean }> = {
  paid: { pay: 'PAID', check: 'PAID' },
  pending: { pay: 'PENDING', check: 'PENDING' },
  'pending-paid': { pay: 'PENDING', check: 'PAID' },
  'pending-failed': { pay: 'PENDING', check: 'FAILED' },
  failed: { pay: 'FAILED', check: 'FAILED' },
  unknown: { pay: 'UNKNOWN', check: 'UNKNOWN' },
  error: { pay: 'PAID', check: 'PAID', payErr: true },
};

export const fakeLimits = () => ({ minSendable: 1000, maxSendable: 500_000_000 });

export function fakeInvoice(user: FakeOutcomeName, msat: number): string {
  const o = OUTCOMES[user];
  if (!o) throw new LnurlError('unknown fake address');
  if (!Number.isSafeInteger(msat) || msat < 1000 || msat % 1000) throw new LnurlError('fake addresses take whole sats');
  return writeInvoice({ sats: msat / 1000, description: fakeDescription(o.pay, o.check, { payErr: o.payErr }), key: KEY, expiry: 600 }).pr;
}

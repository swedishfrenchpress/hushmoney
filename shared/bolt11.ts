import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { bech32 } from '@scure/base';
import { decode as decodeInvoice } from 'light-bolt11-decoder';

// BOLT11 invoices: reading and checking the ones a Lightning address hands out, and (for tests and
// the dev-only fake Lightning address) writing our own, signed with a throwaway node key.

export type Invoice = {
  network: 'bc' | 'tb' | 'bcrt' | 'tbs' | string;
  msat: number;
  paymentHash: string;
  description?: string;
  descriptionHash?: string;
  timestamp: number; // unix seconds
  expiry: number; // seconds
};

export class InvoiceError extends Error {}

export function readInvoice(pr: string): Invoice {
  if (typeof pr !== 'string' || pr.length > 2000 || !/^ln[a-z0-9]+$/i.test(pr)) throw new InvoiceError('not a Lightning invoice');
  let decoded: ReturnType<typeof decodeInvoice>;
  try {
    decoded = decodeInvoice(pr.toLowerCase());
  } catch {
    throw new InvoiceError('not a valid Lightning invoice');
  }
  const out: Partial<Invoice> = { expiry: 3600 };
  for (const s of decoded.sections) {
    const v = (s as { value?: unknown }).value;
    switch (s.name as string) {
      case 'coin_network':
        out.network = (v as { bech32?: string })?.bech32 ?? 'bc';
        break;
      case 'amount':
        out.msat = Number(v);
        break;
      case 'payment_hash':
        out.paymentHash = String(v);
        break;
      case 'description':
        out.description = String(v);
        break;
      case 'description_hash':
        out.descriptionHash = String(v);
        break;
      case 'timestamp':
        out.timestamp = Number(v);
        break;
      case 'expiry':
        out.expiry = Number(v);
        break;
    }
  }
  if (!out.paymentHash || out.timestamp === undefined) throw new InvoiceError('invoice is missing its payment hash');
  if (!out.msat || !Number.isSafeInteger(out.msat) || out.msat <= 0) throw new InvoiceError('invoice has no amount');
  return out as Invoice;
}

// Checks an invoice from a Lightning address (LUD-06): the amount we asked for, still valid for a
// while, the right network and, for real addresses, the address's own metadata committed to by hash.
export function checkInvoice(
  pr: string,
  want: { msat: number; network: string; metadata?: string; now?: number; minValidS?: number },
): Invoice {
  const inv = readInvoice(pr);
  if (inv.network !== want.network) throw new InvoiceError(`invoice is for the wrong network (${inv.network})`);
  if (inv.msat !== want.msat) throw new InvoiceError('invoice is for a different amount than asked');
  const now = want.now ?? Math.floor(Date.now() / 1000);
  if (inv.timestamp + inv.expiry < now + (want.minValidS ?? 60)) throw new InvoiceError('invoice expires too soon');
  if (inv.timestamp > now + 600) throw new InvoiceError('invoice is dated in the future');
  // A hash that is there must be the right one. Some servers (npub.cash) leave it out and put a plain
  // description in the invoice; the amount, network and expiry are still checked, so those pass.
  if (want.metadata !== undefined && inv.descriptionHash !== undefined) {
    const h = bytesToHex(sha256(utf8ToBytes(want.metadata)));
    if (inv.descriptionHash !== h) throw new InvoiceError("invoice doesn't match the Lightning address");
  }
  return inv;
}

// --- Writing invoices (tests and the dev-only fake Lightning address) ------------------------------

const toWords = (n: number, len: number) => {
  const w: number[] = [];
  for (let i = len - 1; i >= 0; i--) w.push(Math.floor(n / 32 ** i) % 32);
  return w;
};
const minimalWords = (n: number) => {
  const w: number[] = [];
  do {
    w.unshift(n % 32);
    n = Math.floor(n / 32);
  } while (n > 0);
  return w;
};
const tagged = (code: number, words: number[]) => [code, ...toWords(words.length, 2), ...words];
// Bech32 tag codes from BOLT11.
const TAG = { p: 1, s: 16, d: 13, h: 23, x: 6, c: 24, features: 5 } as const;

// 5-bit words back to bytes, keeping the trailing partial byte padded with zeros (BOLT11 signs this).
function wordsToBytesPadded(words: number[]): Uint8Array {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const w of words) {
    acc = (acc << 5) | w;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  if (bits > 0) out.push((acc << (8 - bits)) & 0xff);
  return Uint8Array.from(out);
}

export function writeInvoice(opts: {
  sats: number;
  description?: string;
  descriptionHash?: string;
  expiry?: number;
  network?: 'bc' | 'tb';
  key?: Uint8Array;
  timestamp?: number;
  paymentHash?: string;
}): { pr: string; paymentHash: string; preimage: string } {
  if (!Number.isSafeInteger(opts.sats) || opts.sats <= 0) throw new Error('sats must be a positive integer');
  const preimage = randomBytes(32);
  const paymentHash = opts.paymentHash ?? bytesToHex(sha256(preimage));
  const hrp = `ln${opts.network ?? 'bc'}${opts.sats * 10}n`;
  const ts = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const words: number[] = [...toWords(ts, 7)];
  words.push(...tagged(TAG.p, bech32.toWords(hexToBytes(paymentHash))));
  words.push(...tagged(TAG.s, bech32.toWords(randomBytes(32))));
  if (opts.descriptionHash) words.push(...tagged(TAG.h, bech32.toWords(hexToBytes(opts.descriptionHash))));
  else words.push(...tagged(TAG.d, bech32.toWords(utf8ToBytes(opts.description ?? ''))));
  words.push(...tagged(TAG.x, minimalWords(opts.expiry ?? 3600)));
  words.push(...tagged(TAG.c, minimalWords(18)));
  // Feature bits 8 (var_onion_optin) and 14 (payment_secret), both required.
  words.push(...tagged(TAG.features, [16, 8, 0]));
  const key = opts.key ?? secp256k1.utils.randomSecretKey();
  const msg = sha256(new Uint8Array([...utf8ToBytes(hrp), ...wordsToBytesPadded(words)]));
  const rec = secp256k1.sign(msg, key, { prehash: false, format: 'recovered' }); // [recid, r, s]
  const sig = new Uint8Array([...rec.slice(1), rec[0]]);
  words.push(...bech32.toWords(sig));
  return { pr: bech32.encode(hrp, words, false), paymentHash, preimage: bytesToHex(preimage) };
}

// testnut's fake Lightning backend reads the outcome of a payment from the invoice's description.
export type FakeOutcome = 'PAID' | 'PENDING' | 'UNPAID' | 'FAILED' | 'UNKNOWN';
export const fakeDescription = (pay: FakeOutcome, check: FakeOutcome = pay, opts: { payErr?: boolean; checkErr?: boolean } = {}) =>
  JSON.stringify({ pay_invoice_state: pay, check_payment_state: check, pay_err: !!opts.payErr, check_err: !!opts.checkErr });

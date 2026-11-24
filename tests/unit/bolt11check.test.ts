import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { checkInvoice, InvoiceError, writeInvoice } from '../../shared/bolt11';

const metadata = '[["text/plain","hello"]]';
const want = { msat: 21000, network: 'bc', metadata };

describe('checkInvoice and the address metadata (LUD-06)', () => {
  test('accepts the right description hash', () => {
    const { pr } = writeInvoice({ sats: 21, descriptionHash: bytesToHex(sha256(utf8ToBytes(metadata))) });
    expect(checkInvoice(pr, want).msat).toBe(21000);
  });

  test('refuses a wrong description hash', () => {
    const { pr } = writeInvoice({ sats: 21, descriptionHash: bytesToHex(sha256(utf8ToBytes('other'))) });
    expect(() => checkInvoice(pr, want)).toThrow(InvoiceError);
  });

  test('accepts a plain description with no hash (npub.cash does this)', () => {
    const { pr } = writeInvoice({ sats: 21, description: '' });
    expect(checkInvoice(pr, want).msat).toBe(21000);
  });

  test('still refuses a different amount or network when there is no hash', () => {
    expect(() => checkInvoice(writeInvoice({ sats: 22 }).pr, want)).toThrow(/different amount/);
    expect(() => checkInvoice(writeInvoice({ sats: 21, network: 'tb' }).pr, want)).toThrow(/network/);
  });
});

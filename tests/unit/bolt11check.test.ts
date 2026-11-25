import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { checkInvoice, writeInvoice } from '../../shared/bolt11';

const want = { msat: 21000, network: 'bc' };

describe('checkInvoice (LUD-06)', () => {
  test('accepts the amount asked for', () => {
    const { pr } = writeInvoice({ sats: 21, descriptionHash: bytesToHex(sha256(utf8ToBytes('[["text/plain","hello"]]'))) });
    expect(checkInvoice(pr, want).msat).toBe(21000);
  });

  test("accepts a description hash that isn't the metadata's (Primal does this)", () => {
    const { pr } = writeInvoice({ sats: 21, descriptionHash: bytesToHex(sha256(utf8ToBytes('other'))) });
    expect(checkInvoice(pr, want).msat).toBe(21000);
  });

  test('accepts a plain description with no hash (npub.cash does this)', () => {
    const { pr } = writeInvoice({ sats: 21, description: '' });
    expect(checkInvoice(pr, want).msat).toBe(21000);
  });

  test('refuses a different amount or network', () => {
    expect(() => checkInvoice(writeInvoice({ sats: 22 }).pr, want)).toThrow(/different amount/);
    expect(() => checkInvoice(writeInvoice({ sats: 21, network: 'tb' }).pr, want)).toThrow(/network/);
  });
});

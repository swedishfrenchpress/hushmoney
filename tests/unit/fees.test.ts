import { describe, expect, test } from 'vitest';
import { feeFor, MAX_COINS, songCoins, split, sum } from '../../shared/fees';

describe('fees', () => {
  test('a mint rounds the fee up once per transaction (NUT-02)', () => {
    expect(feeFor(0, 100)).toBe(0);
    expect(feeFor(1, 100)).toBe(1);
    expect(feeFor(10, 100)).toBe(1);
    expect(feeFor(11, 100)).toBe(2);
    expect(feeFor(3, 0)).toBe(0);
    expect(feeFor(3, 1000)).toBe(3);
  });

  test('amounts split into powers of two, largest first', () => {
    expect(split(0)).toEqual([]);
    expect(split(1)).toEqual([1]);
    expect(split(100)).toEqual([64, 32, 4]);
    expect(split(127)).toEqual([64, 32, 16, 8, 4, 2, 1]);
    for (let n = 1; n <= 1024; n++) expect(sum(split(n))).toBe(n);
  });

  for (const ppk of [0, 100, 250, 1000]) {
    test(`every song from 1 to 100 sats nets exactly its amount at ${ppk} ppk`, () => {
      for (let sats = 1; sats <= 100; sats++) {
        const coins = songCoins(sats, ppk);
        expect(sum(coins) - feeFor(coins.length, ppk), `₿${sats}`).toBe(sats);
        expect(coins.length, `₿${sats} fits in the phone's 10 restore counters`).toBeLessThanOrEqual(MAX_COINS);
        for (const c of coins) expect(Math.log2(c) % 1).toBe(0);
      }
    });
  }

  test('on testnut (100 ppk) a song costs its amount plus one sat', () => {
    for (let sats = 1; sats <= 100; sats++) expect(sum(songCoins(sats, 100))).toBe(sats + 1);
  });

  test('a steep fee makes a song of repeated coins', () => {
    expect(songCoins(2, 1000)).toEqual([2, 2]);
    expect(songCoins(1, 1000)).toEqual([2]);
  });

  test('a song of nothing is refused', () => {
    expect(() => songCoins(0, 100)).toThrow(RangeError);
    expect(() => songCoins(1.5, 100)).toThrow(RangeError);
  });
});

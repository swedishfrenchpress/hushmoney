// What spending coins costs, and how a song is split so the phone nets exactly
// the number it shows. A mint charges `input_fee_ppk` thousandths of a sat per
// input coin, rounded up once per transaction (NUT-02).

export const feeFor = (coins: number, ppk: number) => Math.ceil((coins * ppk) / 1000);

// Powers of two, largest first: how a keyset splits an amount into coins.
export function split(amount: number): number[] {
  const out: number[] = [];
  for (let bit = 2 ** Math.floor(Math.log2(amount)); amount > 0; bit /= 2) {
    if (amount >= bit) {
      out.push(bit);
      amount -= bit;
    }
  }
  return out;
}

export const sum = (amounts: number[]) => amounts.reduce((a, b) => a + b, 0);

// The coins a song worth `sats` is made of, as few as possible: n coins that
// add up to `sats` plus the fee for spending n coins. Any total can be made of
// n powers of two when n is between its bit count and the total itself; the
// plain split gives the fewest, and halving the biggest coin adds one more.
// At 100 ppk that's just the split of sats + 1. A steep fee (1000 ppk, ₿2) needs
// a repeat, like 2 + 2.
export const MAX_COINS = 7;

export function songCoins(sats: number, ppk: number): number[] {
  if (!Number.isSafeInteger(sats) || sats < 1) throw new RangeError('A song holds at least 1 sat');
  for (let n = 1; n <= MAX_COINS; n++) {
    const total = sats + feeFor(n, ppk);
    const coins = split(total);
    if (coins.length > n || n > total) continue;
    while (coins.length < n) {
      const biggest = coins.shift()!;
      coins.unshift(biggest / 2, biggest / 2);
    }
    return coins;
  }
  throw new RangeError(`No song of ${sats} sats fits in ${MAX_COINS} coins at ${ppk} ppk`);
}

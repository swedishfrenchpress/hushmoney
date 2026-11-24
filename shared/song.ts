// What the laptop sings: one byte saying what this is, then the 16-byte seed
// the coins were made from (NUT-13). The phone asks the mint for the coins'
// signatures (NUT-09), so 17 bytes of sound carry the whole payment.
//
// The first byte's high nibble is the format, its low nibble the mint. It lets
// the phone ignore any other ggwave sound, and leaves room for a mint with real sats.

export const SEED_BYTES = 16;
const FORMAT = 0x3;

// The product's mint is Minibits (2). testnut (1) stays so tests and a free dev
// pool can run: the product never makes testnut songs unless an admin fills
// the pool with MINT_URL=https://testnut.cashu.space.
export const MINTS: Record<number, string> = {
  1: 'https://testnut.cashu.space',
  2: 'https://mint.minibits.cash/Bitcoin',
};
export const PRODUCT_MINT = MINTS[2];

// Every song holds the same amount.
export const SONG_SATS = 21;

export interface Song {
  mint: string;
  seed: Uint8Array;
}

export function packSong(mint: string, seed: Uint8Array): Uint8Array {
  const id = Number(Object.keys(MINTS).find((k) => MINTS[Number(k)] === mint));
  if (!id) throw new Error(`No song id for ${mint}`);
  if (seed.length !== SEED_BYTES) throw new Error(`A seed is ${SEED_BYTES} bytes`);
  return Uint8Array.of((FORMAT << 4) | id, ...seed);
}

// The song in `bytes`, or null when they aren't one of ours.
export function unpackSong(bytes: Uint8Array): Song | null {
  if (bytes.length !== 1 + SEED_BYTES || bytes[0] >> 4 !== FORMAT) return null;
  const mint = MINTS[bytes[0] & 0xf];
  return mint ? { mint, seed: bytes.slice(1) } : null;
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})*$/i.test(hex)) return null;
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

// The result of POST /api/song. `proofs` let the laptop watch the coins at the
// mint; it already holds the seed, so they give nothing more away.
export interface SongResult {
  song: string; // hex of the packed song
  sats: number;
  proofs: { id: string; amount: number; secret: string; C: string }[];
}

// The answers of POST /api/lnurl, as in trick5.
export type LnurlLimits = { minSendable: number; maxSendable: number; fake: boolean };
export type LnurlInvoice = { pr: string; fake: boolean };

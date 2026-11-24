import { randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { fromHex, MINTS, packSong, SEED_BYTES, toHex, unpackSong } from '../../shared/song';

const seed = () => new Uint8Array(randomBytes(SEED_BYTES));

test('a song packs and unpacks', () => {
  const s = seed();
  const song = unpackSong(packSong(MINTS[1], s));
  expect(song).toEqual({ mint: MINTS[1], seed: s });
});

test('other bytes are not a song', () => {
  const bytes = packSong(MINTS[1], seed());
  expect(unpackSong(bytes.slice(1))).toBeNull();
  expect(unpackSong(Uint8Array.of(0x21, ...bytes.slice(1)))).toBeNull(); // another format
  expect(unpackSong(Uint8Array.of(0x3f, ...bytes.slice(1)))).toBeNull(); // an unknown mint
  expect(unpackSong(new TextEncoder().encode('hello from ggwave'))).toBeNull();
});

test('hex goes both ways and refuses junk', () => {
  const bytes = packSong(MINTS[1], seed());
  expect(fromHex(toHex(bytes))).toEqual(bytes);
  expect(fromHex('abc')).toBeNull();
  expect(fromHex('zz')).toBeNull();
});

test('wrong lengths are not a song', () => {
  const bytes = packSong(MINTS[1], seed());
  expect(unpackSong(bytes.slice(0, 16))).toBeNull();
  expect(unpackSong(Uint8Array.of(...bytes, 0))).toBeNull();
  expect(unpackSong(new Uint8Array(0))).toBeNull();
});

test('packing refuses a seed of the wrong size or an unknown mint', () => {
  expect(() => packSong(MINTS[1], new Uint8Array(15))).toThrow();
  expect(() => packSong('https://other.mint', seed())).toThrow();
});

test('the header byte says format 3, mint 1', () => {
  expect(packSong(MINTS[1], seed())[0]).toBe(0x31);
});

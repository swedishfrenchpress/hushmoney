import { normalizeProofAmounts, Wallet, type Proof } from '@cashu/cashu-ts';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { songCoins, sum } from '../../shared/fees';
import { packSong, SEED_BYTES, SONG_SATS, toHex, type SongResult } from '../../shared/song';

// Making songs, on the admin's machine. Used by scripts/songs.mjs, and by the
// tests and scripts that need a few testnut songs. The server never sees this
// code, only the finished songs.
//
// The admin wallet is deterministic (NUT-13) from ADMIN_SEED, with every counter
// written to the journal before it is used, so whatever a crash leaves behind
// can be restored from the seed. A song's own coins come from the song's seed,
// exactly as src/listen/wallet.ts asks the mint for them.

type Plain = { id: string; amount: number; secret: string; C: string };
const plain = (p: Proof): Plain => ({ id: p.id, amount: p.amount.toNumber(), secret: p.secret, C: p.C });
const bytesOf = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

export interface Quote {
  amount: number;
  request: string;
  state: 'waiting' | 'minting' | 'minted';
}
export interface JournalData {
  v: 1;
  mint: string;
  counters: Record<string, number>; // next free counter, per keyset
  stash: Plain[];
  quotes: Record<string, Quote>;
  song: { seed: string; proofs: Plain[] } | null; // a song between step A and the backup
  posted: number; // how many of the backup's songs the server has
}

export function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}

// Everything in flight, saved before the next call to the mint. With no path it is only in memory.
export class Journal {
  data: JournalData;
  constructor(
    readonly path: string | null,
    mint: string,
  ) {
    const empty: JournalData = { v: 1, mint, counters: {}, stash: [], quotes: {}, song: null, posted: 0 };
    this.data = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : empty;
    if (this.data.mint !== mint) throw new Error(`${path} belongs to ${this.data.mint}, not ${mint}. Move it aside to use another mint.`);
  }
  save() {
    if (this.path) writeJson(this.path, this.data);
  }
}

const RESERVE = 32; // counters set aside per call, far more than a call needs; restores skip the gaps
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Admin {
  wallet: Wallet;
  journal: Journal;
  mint: string;
  ppk: number;
}

export async function connect(mint: string, adminSeed: string, journal: Journal, say: (line: string) => void = () => {}): Promise<Admin> {
  if (!/^[0-9a-f]{64}$/i.test(adminSeed)) throw new Error('ADMIN_SEED is 32 bytes as 64 hex characters.');
  const wallet = new Wallet(mint, { unit: 'sat', bip39seed: bytesOf(adminSeed) });
  await wallet.loadMint();
  // Read from the mint's keysets now, never assumed.
  const ppk = wallet.keyChain.getCheapestKeyset().fee;
  say(`${mint} charges ${ppk} ppk to spend a coin.`);
  return { wallet, journal, mint, ppk };
}

// Counters for `calls` calls' worth of coins, taken and saved before use.
function reserve(a: Admin, calls: number): number {
  const keyset = a.wallet.keyChain.getCheapestKeyset().id;
  const first = a.journal.data.counters[keyset] ?? 1; // 0 would mean "pick one for me"
  a.journal.data.counters[keyset] = first + calls * RESERVE;
  a.journal.save();
  return first;
}

export const stashSats = (j: Journal) => sum(j.data.stash.map((p) => p.amount));

// Asks the mint for an invoice and saves it. Returns the quote id and the bolt11.
export async function newInvoice(a: Admin, songs: number): Promise<{ id: string; request: string; amount: number }> {
  const amount = songs * SONG_SATS;
  const q = await a.wallet.createMintQuoteBolt11(amount);
  a.journal.data.quotes[q.quote] = { amount, request: q.request, state: 'waiting' };
  a.journal.save();
  return { id: q.quote, request: q.request, amount };
}

// Waits until the quote is paid, then mints it into the stash. Safe to run again after a stop.
export async function claimQuote(a: Admin, id: string): Promise<number> {
  const q = a.journal.data.quotes[id];
  if (!q) throw new Error('That quote is not in the journal.');
  if (q.state === 'minted') return 0;
  const gone = 'That quote was being minted when the last run stopped. Run `restore` to get the coins back from ADMIN_SEED.';
  if (q.state === 'minting') throw new Error(gone);
  for (;;) {
    const s = (await a.wallet.checkMintQuoteBolt11(id)).state;
    if (s === 'PAID') break;
    if (s === 'ISSUED') throw new Error(gone);
    await sleep(3000);
  }
  const counter = reserve(a, 1);
  q.state = 'minting';
  a.journal.save();
  const proofs = await a.wallet.mintProofsBolt11(q.amount, id, undefined, { type: 'deterministic', counter });
  a.journal.data.stash.push(...proofs.map(plain));
  q.state = 'minted';
  a.journal.save();
  return q.amount;
}

// Gets the admin's coins back from the mint with ADMIN_SEED alone (NUT-09), keeping only the unspent ones.
export async function restoreStash(a: Admin): Promise<number> {
  const { proofs, lastCounterWithSignature } = await a.wallet.batchRestore();
  const states = proofs.length ? await a.wallet.checkProofsStates(proofs) : [];
  a.journal.data.stash = proofs.filter((_, i) => states[i]?.state === 'UNSPENT').map(plain);
  const keyset = a.wallet.keyChain.getCheapestKeyset().id;
  a.journal.data.counters[keyset] = Math.max(a.journal.data.counters[keyset] ?? 1, (lastCounterWithSignature ?? 0) + 1 + RESERVE);
  for (const q of Object.values(a.journal.data.quotes)) if (q.state === 'minting') q.state = 'minted';
  a.journal.save();
  return stashSats(a.journal);
}

// One song. Step A swaps exactly the song's worth off the stash, into outputs
// of the admin wallet (restorable). Step B swaps those into outputs derived from
// the song's seed. The seed is saved before B, so a crash can be picked up by restoring from it.
export async function makeSong(a: Admin): Promise<SongResult> {
  const j = a.journal.data;
  const denominations = songCoins(SONG_SATS, a.ppk);
  const total = sum(denominations);
  if (!j.song) {
    if (stashSats(a.journal) < total) throw new Error('The stash has run out. Pay for more with `invoice`.');
    const seed = toHex(new Uint8Array(randomBytes(SEED_BYTES)));
    const counter = reserve(a, 2);
    const { keep, send } = await a.wallet.send(
      total,
      j.stash as unknown as Proof[],
      { includeFees: true },
      { send: { type: 'deterministic', counter }, keep: { type: 'deterministic', counter: counter + RESERVE } },
    );
    j.stash = keep.map(plain);
    j.song = { seed, proofs: send.map(plain) };
    a.journal.save();
  }
  const { seed, proofs } = j.song;
  const w = new Wallet(a.mint, { unit: 'sat', bip39seed: bytesOf(seed) });
  w.loadMintFromCache(a.wallet.getMintInfo().cache, a.wallet.keyChain.cache);
  const inputs = proofs as unknown as Proof[];
  if (sum(proofs.map((p) => p.amount)) - a.wallet.getFeesForProofs(inputs).toNumber() !== total) {
    throw new Error('The coins for a song do not add up to the song exactly at this mint. Nothing was swapped.');
  }
  let coins: Proof[];
  try {
    coins = (await w.send(total, inputs, { includeFees: false }, { send: { type: 'deterministic', counter: 0, denominations }, keep: { type: 'random' } })).send;
  } catch (e) {
    // Perhaps the swap went through and the answer was lost: the seed gets the coins back.
    const restored = (await w.restore(0, 10)).proofs;
    if (!restored.length) throw e;
    coins = restored;
  }
  return { song: toHex(packSong(a.mint, bytesOf(seed))), sats: SONG_SATS, proofs: coins.map(plain) };
}

// Called once the song is safely written down.
export function songDone(a: Admin) {
  a.journal.data.song = null;
  a.journal.save();
}

export async function pushSongs(base: string, secret: string, entries: SongResult[]): Promise<number> {
  let added = 0;
  for (let i = 0; i < entries.length; i += 100) {
    const batch = entries.slice(i, i + 100);
    const res = await fetch(`${base}/api/admin/songs`, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`The server said ${res.status}: ${await res.text()}`);
    added += batch.length;
  }
  return added;
}

// A few songs on testnut for tests and local scripts, made by the same code as
// songs.mjs but with a throwaway wallet and no files. testnut mints for free.
export async function makeTestSongs(n: number, mint = 'https://testnut.cashu.space'): Promise<SongResult[]> {
  const a = await connect(mint, toHex(new Uint8Array(randomBytes(32))), new Journal(null, mint));
  const { id } = await newInvoice(a, Math.ceil(n * 1.3) + 2); // testnut charges input fees, so more than n songs' worth
  await claimQuote(a, id);
  const out: SongResult[] = [];
  for (let i = 0; i < n; i++) {
    out.push(await makeSong(a));
    songDone(a);
  }
  return out;
}

// Songs that were made but are not where they should be: their coins are still unspent at the
// mint (nobody caught them), and the server's pool doesn't hold them. A song handed out and
// never caught ends up here. Only songs the server has been sent are looked at.
export async function strandedSongs(a: Admin, made: SongResult[], inPool: Set<string>): Promise<SongResult[]> {
  const todo = made.filter((s) => !inPool.has(s.song));
  const out: SongResult[] = [];
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50);
    const coins = batch.flatMap((s) => s.proofs);
    const states = await a.wallet.checkProofsStates(normalizeProofAmounts(coins) as unknown as Proof[]);
    let at = 0;
    for (const s of batch) {
      const mine = states.slice(at, at + s.proofs.length);
      at += s.proofs.length;
      if (mine.length && mine.every((x) => x?.state === 'UNSPENT')) out.push(s);
    }
  }
  return out;
}

// Swaps stranded songs' coins into the admin's stash, so they can fund new songs. The mint's
// fee on spending them comes out of each song. Returns the sats that arrived.
export async function sweepSongs(a: Admin, songs: SongResult[]): Promise<number> {
  let got = 0;
  for (const s of songs) {
    const counter = reserve(a, 1);
    const fresh = await a.wallet.receive(normalizeProofAmounts(s.proofs) as unknown as Proof[], undefined, { type: 'deterministic', counter });
    a.journal.data.stash.push(...fresh.map(plain));
    a.journal.save();
    got += sum(fresh.map((p) => p.amount.toNumber()));
  }
  return got;
}

import {
  deserializeSwapPreview,
  getEncodedToken,
  normalizeProofAmounts,
  serializeSwapPreview,
  Wallet,
  type OutputDataLike,
  type Proof,
  type SerializedSwapPreview,
} from '@cashu/cashu-ts';
import type { Song } from '../../shared/song';
import { exclusive, Vault, VaultError } from './vault';

// The phone's money, with no page attached, so every path runs in tests.
//
// A song is a seed. The coins it was made from come back from the mint with a
// restore (NUT-09), and are swapped at once for coins only this phone knows:
// everyone in the room heard the same song, and the mint decides who was first.
//
// Before that swap is sent, its outputs (secrets and blinding factors) are
// written down. If the answer is lost, the same request is sent again and the
// mint repeats its answer (NUT-19; testnut keeps it for 60 seconds). After that
// the mint is asked which of those outputs it signed (NUT-09), so a claim that
// landed is never lost, however long the tab was gone.

const RESTORE = 10; // counters asked about; a song of up to 100 sats is at most 7 coins
const SPENT = 11001; // NUT-00 error: "Token already spent"

type Stored = Omit<Proof, 'amount'> & { amount: number };
export type Coin = Stored & { out?: number }; // `out`: when it was first handed to a wallet app

interface Claim {
  v: 1;
  id: string;
  at: number;
  sats: number; // what the claim is worth once it lands
  preview: SerializedSwapPreview;
}

export type Catch = { status: 'caught'; sats: number } | { status: 'gone' };
export interface Balance {
  held: number; // here, never handed out
  out: number; // handed to a wallet app, not claimed yet: "on their way"
  total: number;
}

export class WalletError extends Error {}

const coinsKey = (mint: string) => `t3:coins:${mint}`;
const claimPrefix = (mint: string) => `t3:claim:${mint}:`;

const lostRace = (e: unknown) => {
  const { code, message } = e as { code?: number; message?: string };
  return code === SPENT || /already spent/i.test(message ?? '');
};

// A definite refusal from the mint: it answered, and did nothing.
const refused = (e: unknown) => typeof (e as { code?: unknown }).code === 'number' && !lostRace(e);

const plain = (p: Proof): Stored => ({ ...p, amount: p.amount.toNumber() });

export class PhoneWallet {
  private loaded: Promise<Wallet> | null = null;

  constructor(
    readonly mint: string,
    readonly vault: Vault,
    private now: () => number = () => Date.now(),
  ) {}

  // The mint's keys, loaded once; a failure is forgotten so the next call tries again.
  load(): Promise<Wallet> {
    this.loaded ??= (async () => {
      const w = new Wallet(this.mint, { unit: 'sat' });
      await w.loadMint();
      return w;
    })().catch((e) => {
      this.loaded = null;
      throw e;
    });
    return this.loaded;
  }

  coins(): Coin[] {
    return this.vault.read<Coin[]>(coinsKey(this.mint)) ?? [];
  }

  balance(): Balance {
    const coins = this.coins();
    const out = coins.filter((c) => c.out).reduce((s, c) => s + c.amount, 0);
    const total = coins.reduce((s, c) => s + c.amount, 0);
    return { held: total - out, out, total };
  }

  // Claims a song: restore its coins, check them, swap them for ours.
  async catch(song: Song): Promise<Catch> {
    if (song.mint !== this.mint) throw new WalletError('That song is for another mint.');
    if (!this.vault.ok) throw new VaultError("This browser can't save anything, so it can't hold sats.");
    const w = await this.load();
    const seeded = new Wallet(this.mint, { unit: 'sat', bip39seed: song.seed });
    seeded.loadMintFromCache(w.getMintInfo().cache, w.keyChain.cache);
    const { proofs } = await seeded.restore(0, RESTORE);
    if (!proofs.length) return { status: 'gone' };
    const states = await w.checkProofsStates(proofs);
    const live = proofs.filter((_, i) => states[i]?.state === 'UNSPENT');
    if (!live.length) return { status: 'gone' };
    const preview = await w.prepareSwapToReceive(live, {}, { type: 'random' });
    const claim: Claim = {
      v: 1,
      id: `${this.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      at: this.now(),
      sats: preview.amount.toNumber(),
      preview: serializeSwapPreview(preview),
    };
    this.vault.write(claimPrefix(this.mint) + claim.id, claim); // before anything is sent
    return this.finish(claim);
  }

  // Finishes every claim a closed tab or a lost answer left behind. Returns the sats that landed.
  async recover(): Promise<number> {
    let sats = 0;
    for (const key of this.vault.keys(claimPrefix(this.mint))) {
      const claim = this.vault.read<Claim>(key);
      if (!claim) continue;
      try {
        const r = await this.finish(claim);
        if (r.status === 'caught') sats += r.sats;
      } catch {
        // Still can't reach the mint; the claim waits for the next try.
      }
    }
    return sats;
  }

  // Sends the claim's swap, or the same swap again. One claim at a time, across tabs.
  private finish(claim: Claim): Promise<Catch> {
    const key = claimPrefix(this.mint) + claim.id;
    return exclusive(key, this.vault, async () => {
      if (!this.vault.read(key)) return { status: 'gone' }; // another tab finished it
      const w = await this.load();
      const preview = deserializeSwapPreview(claim.preview);
      let mine: Proof[];
      try {
        const { keep, send } = await w.completeSwap(preview);
        mine = [...keep, ...send];
      } catch (e) {
        if (refused(e)) {
          this.vault.remove(key);
          throw e;
        }
        if (!lostRace(e)) throw e; // no answer at all: keep the claim for later
        mine = await this.signedOutputs(w, [...(preview.keepOutputs ?? []), ...(preview.sendOutputs ?? [])]);
      }
      if (!mine.length) {
        this.vault.remove(key);
        return { status: 'gone' };
      }
      this.add(mine); // the coins are saved before the claim is dropped
      this.vault.remove(key);
      return { status: 'caught', sats: mine.reduce((s, p) => s + p.amount.toNumber(), 0) };
    });
  }

  // NUT-09: which of these outputs the mint signed, as coins. None means someone else's swap won.
  private async signedOutputs(w: Wallet, outputs: OutputDataLike[]): Promise<Proof[]> {
    if (!outputs.length) return [];
    const r = await w.mint.restore({ outputs: outputs.map((o) => o.blindedMessage) });
    return r.signatures.map((sig, i) => {
      const o = outputs.find((x) => x.blindedMessage.B_ === r.outputs[i].B_)!;
      return o.toProof(sig, w.keyChain.getKeyset(sig.id));
    });
  }

  private add(proofs: Proof[]) {
    const coins = this.coins();
    const have = new Set(coins.map((c) => c.secret));
    this.vault.write(coinsKey(this.mint), [...coins, ...proofs.map(plain).filter((p) => !have.has(p.secret))]);
  }

  // Everything here, as one token for a wallet app. The coins stay in the
  // balance, marked as on their way, until the mint says they're spent.
  handOut(): string | null {
    const coins = this.coins();
    if (!coins.length) return null;
    const token = getEncodedToken({ mint: this.mint, unit: 'sat', proofs: normalizeProofAmounts(coins) });
    const at = this.now();
    this.vault.write(coinsKey(this.mint), coins.map((c) => ({ ...c, out: c.out ?? at })));
    return token;
  }

  // Asks the mint which coins are spent and drops them (NUT-07). `landed` is
  // what a wallet app claimed from what was handed out.
  async settle(): Promise<{ landed: number; balance: Balance }> {
    const coins = this.coins();
    if (!coins.length) return { landed: 0, balance: this.balance() };
    const w = await this.load();
    const states = await w.checkProofsStates(coins);
    const spent = new Set(coins.filter((_, i) => states[i]?.state === 'SPENT').map((c) => c.secret));
    if (!spent.size) return { landed: 0, balance: this.balance() };
    const landed = coins.filter((c) => spent.has(c.secret) && c.out).reduce((s, c) => s + c.amount, 0);
    // Re-read, so a catch that landed meanwhile isn't overwritten.
    this.vault.write(coinsKey(this.mint), this.coins().filter((c) => !spent.has(c.secret)));
    return { landed, balance: this.balance() };
  }

  // Calls `onSpent` when a wallet app claims any coin handed out so far, so the
  // page can settle() at once. The mint pushes it (NUT-17), or, when it can't,
  // the page asks every few seconds (NUT-07). Returns a function that stops it.
  async watch(onSpent: () => void, pollMs = 3000): Promise<() => void> {
    const out = this.coins().filter((c) => c.out);
    if (!out.length) return () => {};
    const w = await this.load();
    let poll: ReturnType<typeof setInterval> | undefined;
    let cancel: (() => void) | null = null;
    const pollInstead = () => {
      poll ??= setInterval(async () => {
        const states = await w.checkProofsStates(out).catch(() => []);
        if (states.some((s) => s.state === 'SPENT')) onSpent();
      }, pollMs);
    };
    if (w.getMintInfo().isSupported(17).supported) {
      try {
        cancel = await w.on.proofStateUpdates(out, (p) => p.state === 'SPENT' && onSpent(), pollInstead);
      } catch {
        pollInstead();
      }
    } else pollInstead();
    return () => {
      cancel?.();
      clearInterval(poll);
    };
  }

  // Takes coins out of the balance for a payment that spends them (Lightning).
  take(secrets: Set<string>): Coin[] {
    const coins = this.coins();
    const taken = coins.filter((c) => secrets.has(c.secret));
    this.vault.write(coinsKey(this.mint), coins.filter((c) => !secrets.has(c.secret)));
    return taken;
  }

  give(proofs: Proof[]) {
    this.add(proofs);
  }

  pendingClaims(): number {
    return this.vault.keys(claimPrefix(this.mint)).length;
  }
}

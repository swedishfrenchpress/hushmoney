import { MintOperationError, normalizeProofAmounts, OutputData, type MeltQuoteBolt11Response, type Proof, type SerializedOutputData } from '@cashu/cashu-ts';
import { checkInvoice } from '../../shared/bolt11';
import { feeFor } from '../../shared/fees';
import { LnurlError, parseAddress } from '../../shared/lnurl';
import { exclusive } from './vault';
import type { Coin, PhoneWallet } from './wallet';

// Sending everything this phone holds to a Lightning address, as an operation
// that survives a lost answer. The same states and rules as trick5's
// src/money/lightning.ts, which runs on trick5's own mint client; this one
// runs on cashu-ts.
//
//   paying   saved, sent (or about to be); outcome not known yet
//   pending  the mint says the payment is in flight; the coins are locked until it settles
//   paid     the invoice was paid; any change is back in the balance
//   failed   definitely not paid, and the coins are back in the balance
//   unknown  we couldn't find out yet; we keep asking about the same quote
//
// A payment is never sent twice: after the first try, the page only asks the
// mint about that quote and those coins. The mint pays a quote at most once,
// and coins spend once.

export type LnState = 'paying' | 'pending' | 'paid' | 'failed' | 'unknown';

export interface LnOp {
  v: 1;
  address: string;
  invoice: string;
  sats: number; // what the invoice pays
  quote: string;
  reserve: number;
  inputs: Coin[];
  inputFee: number;
  outputs: SerializedOutputData[]; // NUT-08 blanks for the change
  state: LnState;
  change?: number;
  error?: string;
  at: number;
}

export interface LnApi {
  limits(address: string): Promise<{ minSendable: number; maxSendable: number; fake: boolean }>;
  invoice(address: string, msat: number): Promise<{ pr: string; fake: boolean }>;
}

export const MIN_LIGHTNING = 8; // the plan: below ₿8 the mint's 2-sat reserve leaves too little
const PENDING = 20005; // NUT-05: quote pending

export class TooSmall extends LnurlError {}

const opKey = (mint: string) => `t3:ln:${mint}`;
const total = (coins: { amount: number }[]) => coins.reduce((s, c) => s + c.amount, 0);

export class Lightning {
  constructor(
    private wallet: PhoneWallet,
    private api: LnApi,
    private now: () => number = () => Date.now(),
  ) {}

  get op(): LnOp | null {
    return this.wallet.vault.read<LnOp>(opKey(this.wallet.mint));
  }

  // Clears a finished payment, so the sheet stops showing it.
  dismiss() {
    const op = this.op;
    if (op && (op.state === 'paid' || op.state === 'failed')) this.wallet.vault.remove(opKey(this.wallet.mint));
  }

  async pay(address: string): Promise<LnOp> {
    return exclusive('ln', this.wallet.vault, async () => {
      const existing = this.op;
      if (existing && existing.state !== 'paid' && existing.state !== 'failed') return this.reconcile(existing);
      const coins = this.wallet.heldCoins();
      const share = total(coins);
      if (share < MIN_LIGHTNING) throw new TooSmall(`Lightning needs at least ₿${MIN_LIGHTNING}, for the mint's fee.`);
      const a = parseAddress(address);
      const w = await this.wallet.load();
      const states = await w.checkProofsStates(coins);
      if (!states.every((s) => s.state === 'UNSPENT')) throw new LnurlError('Some of these sats were already claimed by a wallet. Reopen the page and try again.');
      const inputFee = feeFor(coins.length, w.keyChain.getCheapestKeyset().fee);
      const limits = await this.api.limits(address);
      const fits = (sats: number) => sats >= Math.ceil(limits.minSendable / 1000) && sats * 1000 <= limits.maxSendable;

      // An invoice the coins can cover with the mint's fee reserve, re-asked once
      // if the reserve turns out bigger than guessed.
      let sats = share - inputFee - Math.max(2, Math.ceil(share * 0.02));
      let quote: MeltQuoteBolt11Response | null = null;
      let invoice = '';
      for (let i = 0; i < 3 && sats >= 1; i++) {
        if (!fits(sats)) break;
        invoice = (await this.api.invoice(address, sats * 1000)).pr;
        checkInvoice(invoice, { msat: sats * 1000, network: 'bc' });
        quote = await w.createMeltQuoteBolt11(invoice);
        if (quote.amount.toNumber() !== sats) throw new LnurlError("The mint read the invoice's amount differently.");
        if (sats + quote.fee_reserve.toNumber() + inputFee <= share) break;
        sats = share - inputFee - quote.fee_reserve.toNumber();
        quote = null;
      }
      if (!quote || sats < 1 || !fits(sats)) throw new TooSmall("These sats don't cover the Lightning fee.");

      const preview = await w.prepareMelt('bolt11', quote, normalizeProofAmounts(coins));
      // The invoice and quote take network round-trips. If the visitor handed
      // these proofs to a wallet meanwhile, do not melt the same proofs too.
      const stillHeld = new Set(this.wallet.heldCoins().map((c) => c.secret));
      if (coins.some((c) => !stillHeld.has(c.secret))) {
        throw new LnurlError('Some of these sats were handed to a wallet while Lightning was getting ready. Try again with what is still here.');
      }
      const op: LnOp = {
        v: 1,
        address: `${a.user}@${a.domain}`,
        invoice,
        sats,
        quote: quote.quote,
        reserve: quote.fee_reserve.toNumber(),
        inputs: coins,
        inputFee,
        outputs: preview.outputData.map((o) => OutputData.serialize(o)),
        state: 'paying',
        at: this.now(),
      };
      this.save(op); // before the coins leave
      this.wallet.take(new Set(coins.map((c) => c.secret)));
      try {
        const r = await w.completeMelt(preview);
        if (r.quote.state === 'PAID') return this.settle(op, r.change);
        if (r.quote.state === 'PENDING') return this.set(op, 'pending');
      } catch (e) {
        if (e instanceof MintOperationError && e.code === PENDING) return this.set(op, 'pending');
      }
      return this.reconcile(op);
    });
  }

  // On page load: picks up a payment the last visit left unfinished.
  async resume(): Promise<LnOp | null> {
    return exclusive('ln', this.wallet.vault, async () => {
      const op = this.op;
      if (!op || op.state === 'paid' || op.state === 'failed') return op;
      return this.reconcile(op);
    });
  }

  // Asks the mint about the quote, then about the coins.
  private async reconcile(op: LnOp): Promise<LnOp> {
    try {
      const w = await this.wallet.load();
      const q = await w.checkMeltQuoteBolt11(op.quote);
      if (q.state === 'PAID') return this.settle(op);
      if (q.state === 'PENDING') return this.set(op, 'pending');
      const states = await w.checkProofsStates(op.inputs);
      if (states.some((s) => s.state === 'PENDING')) return this.set(op, 'pending');
      if (states.every((s) => s.state === 'UNSPENT')) {
        this.wallet.give(normalizeProofAmounts(op.inputs));
        return this.set(op, 'failed', "The payment didn't go through. Your sats are back.");
      }
      if (states.every((s) => s.state === 'SPENT')) return this.set(op, 'failed', 'These sats were claimed by a wallet before the payment.');
      return this.set(op, 'unknown', 'The mint gave an unclear answer. Checking again soon.');
    } catch {
      return this.set(op, 'unknown', "Couldn't reach the mint. Checking again soon.");
    }
  }

  // Paid: collect the change. The mint's answer may have been lost, so the
  // change comes from the blanks it signed (NUT-09) when it isn't given.
  private async settle(op: LnOp, change?: Proof[]): Promise<LnOp> {
    let coins = change ?? [];
    if (!change && op.outputs.length) {
      try {
        const w = await this.wallet.load();
        const outputs = op.outputs.map((s) => OutputData.deserialize(s));
        const r = await w.mint.restore({ outputs: outputs.map((o) => o.blindedMessage) });
        coins = r.signatures.map((sig, i) => outputs.find((o) => o.blindedMessage.B_ === r.outputs[i].B_)!.toProof(sig, w.keyChain.getKeyset(sig.id)));
      } catch {
        coins = [];
      }
    }
    if (coins.length) this.wallet.give(coins);
    op.change = coins.reduce((s, p) => s + p.amount.toNumber(), 0);
    return this.set(op, 'paid');
  }

  private set(op: LnOp, state: LnState, error?: string): LnOp {
    op.state = state;
    if (error) op.error = error;
    else delete op.error;
    this.save(op);
    return op;
  }

  private save(op: LnOp) {
    this.wallet.vault.write(opKey(this.wallet.mint), op);
  }
}

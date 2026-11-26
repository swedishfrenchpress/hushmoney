import { createBlindSignature, createDLEQProof, createNewMintKeys, hashToCurve, pointFromHex } from '@cashu/cashu-ts';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { readInvoice, writeInvoice } from '../../shared/bolt11';

// trick4's copy of trick5's tests/support/fakemint.ts. Changes, all marked trick4: a local MintProof
// type (trick4 has no shared/cashu.ts); GET /v1/keys, the NUT-04/05/17/19 sections of /v1/info, and
// `request`, `unit` and a numeric `expiry` on quotes, which
// cashu-ts reads; and NUT-19 replay of /v1/swap, so a lost answer can be fetched again.
type MintProof = { amount: number; id: string; secret: string; C: string }; // trick4

// A mint that lives in the test process. It signs for real (BDHKE with DLEQ proofs), so the app's
// own crypto runs end to end, and any request can be made to fail on purpose:
//   before: the mint never sees it          after: the mint does it, then the answer is lost
// This is a stand-in for testnut where real failures can't be produced on demand. Tests that use it
// say so; tests/testnut/ uses the real mint.

type Keyset = { id: string; active: boolean; ppk: number; pub: Record<string, string>; priv: Record<string, bigint> };
type Fault = { path: RegExp; when: 'before' | 'after'; kind: 'network' | 'timeout' | '500' | '429' | 'malformed'; times: number };
type Melt = { request: string; amount: number; reserve: number; state: 'UNPAID' | 'PENDING' | 'PAID'; pay: string; check: string; payErr: boolean; inputs?: MintProof[]; outputs?: any[]; change?: any[] };

const utf8 = (s: string) => new TextEncoder().encode(s);

export class FakeMint {
  readonly url = 'https://fake.mint.test';
  keysets: Keyset[] = [];
  spent = new Map<string, 'SPENT' | 'PENDING'>();
  signed = new Map<string, { amount: number; id: string; C_: string; dleq: { e: string; s: string } }>();
  melts = new Map<string, Melt>();
  faults: Fault[] = [];
  delayMs = 0;
  calls: string[] = [];
  lightningFee = 1;
  // trick4: NUT-19. A swap repeated byte for byte within `replayTtlMs` gets the first answer again.
  replayTtlMs = 60_000;
  replays = new Map<string, { at: number; r: { status: number; body: any } }>();
  mintQuotes = new Map<string, { amount: number; request: string }>(); // trick4
  // trick4: says it pushes proof states (NUT-17). There's no socket behind it, so connecting fails.
  pushes = false;
  private expiry = () => Math.floor(this.now() / 1000) + 600; // trick4: cashu-ts wants a number
  now = () => Date.now();

  constructor(ppk = 100) {
    this.rotate(ppk);
  }

  get active() {
    return this.keysets.find((k) => k.active)!;
  }

  // A new active keyset; the old ones still take inputs but no longer sign.
  rotate(ppk = this.active?.ppk ?? 0) {
    for (const k of this.keysets) k.active = false;
    const kp = createNewMintKeys(21, randomBytes(32), { input_fee_ppk: ppk, unit: 'sat' });
    const pub: Record<string, string> = {};
    const priv: Record<string, bigint> = {};
    for (const [a, p] of Object.entries(kp.pubKeys)) pub[a] = bytesToHex(p as Uint8Array);
    for (const [a, p] of Object.entries(kp.privKeys)) priv[a] = BigInt('0x' + bytesToHex(p as Uint8Array));
    this.keysets.push({ id: kp.keysetId, active: true, ppk, pub, priv });
    return this.active;
  }

  setFee(ppk: number) {
    this.active.ppk = ppk;
  }

  fail(path: RegExp, kind: Fault['kind'], when: Fault['when'] = 'before', times = 1) {
    this.faults.push({ path, when, kind, times });
  }

  // Coins straight from the mint, for setting up a test.
  issue(amounts: number[]): MintProof[] {
    const k = this.active;
    return amounts.map((amount) => {
      const secret = bytesToHex(randomBytes(32));
      const Y = secp256k1.Point.fromHex(hashToCurve(utf8(secret)).toHex(true));
      return { amount, id: k.id, secret, C: Y.multiply(k.priv[String(amount)]).toHex(true) };
    });
  }

  private yOf = (secret: string) => hashToCurve(utf8(secret)).toHex(true);

  private valid(p: MintProof) {
    const k = this.keysets.find((x) => x.id === p.id);
    const key = k?.priv[String(p.amount)];
    if (!key) return false;
    return secp256k1.Point.fromHex(this.yOf(p.secret)).multiply(key).toHex(true) === p.C;
  }

  private sign(o: { amount: number; id: string; B_: string }) {
    const k = this.keysets.find((x) => x.id === o.id)!;
    // hexToBytes, not Node's Buffer: this mint also runs in a page (tests/support/worstcase.ts).
    const privBytes = hexToBytes(k.priv[String(o.amount)].toString(16).padStart(64, '0'));
    const B = pointFromHex(o.B_);
    const sig = createBlindSignature(B, privBytes, o.id);
    const dleq = createDLEQProof(B, privBytes);
    const out = { amount: o.amount, id: o.id, C_: sig.C_.toHex(true), dleq: { e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) } };
    this.signed.set(o.B_, out);
    return out;
  }

  private fee(inputs: MintProof[]) {
    return Math.ceil(inputs.reduce((a, p) => a + (this.keysets.find((k) => k.id === p.id)?.ppk ?? 0), 0) / 1000);
  }

  private err(code: number, detail: string) {
    return { status: 400, body: { code, detail } };
  }

  // Checks inputs and outputs the way a mint does. Returns an error, or null.
  private check(inputs: MintProof[], outputs: { amount: number; id: string; B_: string }[]) {
    const ys = inputs.map((p) => this.yOf(p.secret));
    if (new Set(ys).size !== ys.length) return this.err(11007, 'Duplicate inputs');
    if (!inputs.every((p) => this.valid(p))) return this.err(10003, 'Invalid proof');
    if (ys.some((y) => this.spent.get(y) === 'SPENT')) return this.err(11001, 'Token Already Spent');
    if (ys.some((y) => this.spent.get(y) === 'PENDING')) return this.err(11003, 'Token pending');
    if (new Set(outputs.map((o) => o.B_)).size !== outputs.length || outputs.some((o) => this.signed.has(o.B_))) return this.err(11008, 'Duplicate outputs');
    for (const o of outputs) {
      const k = this.keysets.find((x) => x.id === o.id);
      if (!k) return this.err(12001, 'Keyset not known');
      if (!k.active) return this.err(12002, 'Keyset inactive');
      if (!k.pub[String(o.amount)]) return this.err(11004, 'Amount not in keyset');
    }
    return null;
  }

  private handle(method: string, path: string, body: any): { status: number; body: any } {
    if (method === 'GET' && path === '/v1/info') {
      // trick4: cashu-ts wants NUT-04/05, and reads NUT-19's cached endpoints to retry on its own.
      const nut4 = { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false };
      const nut19 = { ttl: this.replayTtlMs / 1000, cached_endpoints: [{ method: 'POST', path: '/v1/swap' }] };
      return { status: 200, body: { name: 'fake', nuts: { 4: nut4, 5: { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false }, 7: { supported: true }, 8: { supported: true }, 9: { supported: true }, 12: { supported: true }, 19: nut19, ...(this.pushes && { 17: { supported: [{ method: 'bolt11', unit: 'sat', commands: ['proof_state'] }] } }) } } };
    }
    // trick4: every active keyset's keys at once.
    if (method === 'GET' && path === '/v1/keys') return { status: 200, body: { keysets: this.keysets.filter((k) => k.active).map((k) => ({ id: k.id, unit: 'sat', keys: k.pub })) } };
    if (method === 'GET' && path === '/v1/keysets') return { status: 200, body: { keysets: this.keysets.map((k) => ({ id: k.id, unit: 'sat', active: k.active, input_fee_ppk: k.ppk })) } };
    const keys = /^\/v1\/keys\/(.+)$/.exec(path);
    if (method === 'GET' && keys) {
      const k = this.keysets.find((x) => x.id === decodeURIComponent(keys[1]));
      return k ? { status: 200, body: { keysets: [{ id: k.id, unit: 'sat', keys: k.pub }] } } : this.err(12001, 'Keyset not known');
    }
    if (path === '/v1/checkstate') return { status: 200, body: { states: body.Ys.map((Y: string) => ({ Y, state: this.spent.get(Y) ?? 'UNSPENT', witness: null })) } };
    if (path === '/v1/restore') {
      const known = body.outputs.filter((o: any) => this.signed.has(o.B_));
      return { status: 200, body: { outputs: known, signatures: known.map((o: any) => this.signed.get(o.B_)) } };
    }
    if (path === '/v1/swap') {
      // trick4: NUT-19 replay of an identical request.
      const key = JSON.stringify(body);
      const seen = this.replays.get(key);
      if (seen && this.now() - seen.at < this.replayTtlMs) return seen.r;
      const r = this.swap(body);
      if (r.status === 200) this.replays.set(key, { at: this.now(), r });
      return r;
    }
    return this.rest(method, path, body);
  }

  // trick4: the swap itself, split out so it can be cached.
  private swap(body: any): { status: number; body: any } {
    {
      const bad = this.check(body.inputs, body.outputs);
      if (bad) return bad;
      const inSum = body.inputs.reduce((a: number, p: MintProof) => a + p.amount, 0);
      const outSum = body.outputs.reduce((a: number, o: any) => a + o.amount, 0);
      if (inSum !== outSum + this.fee(body.inputs)) return this.err(11002, 'Transaction unbalanced');
      for (const p of body.inputs) this.spent.set(this.yOf(p.secret), 'SPENT');
      return { status: 200, body: { signatures: body.outputs.map((o: any) => this.sign(o)) } };
    }
  }

  // trick4: everything after the swap, unchanged.
  private rest(method: string, path: string, body: any): { status: number; body: any } {
    // trick4: checking a mint quote, which the server's stash does before minting.
    // trick4: quotes remember their amount, which cashu-ts reads back.
    const mintq = /^\/v1\/mint\/quote\/bolt11\/(.+)$/.exec(path);
    if (method === 'GET' && mintq) {
      const q = this.mintQuotes.get(mintq[1]);
      return q ? { status: 200, body: { quote: mintq[1], request: q.request, amount: q.amount, unit: 'sat', state: 'PAID', expiry: this.expiry() } } : this.err(20004, 'Unknown quote');
    }
    if (path === '/v1/mint/quote/bolt11') {
      const quote = `mq${Math.random().toString(36).slice(2)}`;
      // cashu-ts checks the invoice's amount against the quote's.
      const request = writeInvoice({ sats: body.amount, description: 'fake mint', key: secp256k1.utils.randomSecretKey(), expiry: 600 }).pr;
      this.mintQuotes.set(quote, { amount: body.amount, request });
      return { status: 200, body: { quote, request, amount: body.amount, unit: 'sat', state: 'PAID', expiry: this.expiry() } };
    }
    if (path === '/v1/mint/bolt11') return { status: 200, body: { signatures: body.outputs.map((o: any) => this.sign(o)) } };
    if (path === '/v1/melt/quote/bolt11') {
      const inv = readInvoice(body.request);
      let d: any = {};
      try {
        d = JSON.parse(inv.description ?? '{}');
      } catch {}
      const id = `q${Math.random().toString(36).slice(2)}`;
      const amount = inv.msat / 1000;
      const m: Melt = { request: body.request, amount, reserve: Math.max(2, Math.ceil(amount * 0.02)), state: 'UNPAID', pay: d.pay_invoice_state ?? 'PAID', check: d.check_payment_state ?? 'PAID', payErr: !!d.pay_err };
      this.melts.set(id, m);
      return { status: 200, body: { quote: id, amount, fee_reserve: m.reserve, request: m.request, unit: 'sat', state: 'UNPAID', expiry: this.expiry() } };
    }
    const mq = /^\/v1\/melt\/quote\/bolt11\/(.+)$/.exec(path);
    if (method === 'GET' && mq) {
      const m = this.melts.get(mq[1]);
      if (!m) return this.err(20004, 'Unknown quote');
      if (m.state === 'PENDING' && m.check !== 'PENDING') this.settleMelt(m, m.check === 'PAID');
      return { status: 200, body: { quote: mq[1], amount: m.amount, fee_reserve: m.reserve, request: m.request, unit: 'sat', state: m.state, expiry: this.expiry(), ...(m.change ? { change: m.change } : {}) } };
    }
    if (path === '/v1/melt/bolt11') {
      const m = this.melts.get(body.quote);
      if (!m) return this.err(20004, 'Unknown quote');
      if (m.state === 'PAID') return { status: 200, body: { quote: body.quote, amount: m.amount, fee_reserve: m.reserve, request: m.request, unit: 'sat', state: 'PAID', expiry: this.expiry(), change: m.change ?? [] } };
      if (m.state === 'PENDING') return this.err(20005, 'Quote pending');
      const bad = this.check(body.inputs, []);
      if (bad) return bad;
      const inSum = body.inputs.reduce((a: number, p: MintProof) => a + p.amount, 0);
      if (inSum < m.amount + m.reserve + this.fee(body.inputs)) return this.err(11002, 'Transaction unbalanced');
      m.inputs = body.inputs;
      m.outputs = body.outputs ?? [];
      if (m.payErr) return { status: 500, body: 'backend error' };
      if (m.pay === 'PENDING') {
        for (const p of body.inputs) this.spent.set(this.yOf(p.secret), 'PENDING');
        m.state = 'PENDING';
        return this.err(20005, 'Timed out waiting for pending melt to complete');
      }
      if (m.pay !== 'PAID') return { status: 200, body: { quote: body.quote, amount: m.amount, fee_reserve: m.reserve, request: m.request, unit: 'sat', state: 'UNPAID', expiry: this.expiry() } };
      this.settleMelt(m, true);
      return { status: 200, body: { quote: body.quote, amount: m.amount, fee_reserve: m.reserve, request: m.request, unit: 'sat', state: 'PAID', expiry: this.expiry(), change: m.change } };
    }
    return { status: 404, body: { detail: 'not found' } };
  }

  private settleMelt(m: Melt, paid: boolean) {
    if (!paid) {
      for (const p of m.inputs ?? []) this.spent.delete(this.yOf(p.secret));
      m.state = 'UNPAID';
      return;
    }
    for (const p of m.inputs!) this.spent.set(this.yOf(p.secret), 'SPENT');
    const inSum = m.inputs!.reduce((a, p) => a + p.amount, 0);
    let left = inSum - m.amount - this.lightningFee - this.fee(m.inputs!);
    const change = [];
    for (const o of m.outputs ?? []) {
      if (left <= 0) break;
      const a = 2 ** Math.floor(Math.log2(left));
      change.push(this.sign({ ...o, amount: a }));
      left -= a;
    }
    m.change = change;
    m.state = 'PAID';
  }

  fetch = async (input: string, init?: RequestInit): Promise<Response> => {
    const u = new URL(input);
    const path = u.pathname;
    this.calls.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (this.delayMs) await new Promise((r) => setTimeout(r, this.delayMs));
    const f = this.faults.find((x) => x.path.test(path) && x.times > 0);
    if (f) f.times--;
    const fault = async (): Promise<Response> => {
      if (f!.kind === 'network') throw new TypeError('fetch failed');
      if (f!.kind === 'timeout')
        return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
      if (f!.kind === '429') return new Response('slow down', { status: 429 });
      if (f!.kind === '500') return new Response('oops', { status: 500 });
      return new Response('{"signatures": [', { status: 200 });
    };
    if (f?.when === 'before') return fault();
    const r = this.handle(init?.method ?? 'GET', path, body);
    if (f?.when === 'after') return fault();
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
}

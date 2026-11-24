import { PaymentRequest, PaymentRequestTransportType } from '@cashu/cashu-ts';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { describe, expect, it } from 'vitest';
import { DestinationError, parseDestination } from '../../shared/destination';

const MINT = 'https://mint.minibits.cash/Bitcoin';
const pubkey = getPublicKey(generateSecretKey());
const relays = ['wss://relay.example.com'];

function request(over: { amount?: number; mints?: string[]; unit?: string; nostr?: boolean } = {}) {
  const transport = over.nostr === false ? [] : [{ type: PaymentRequestTransportType.NOSTR, target: nip19.nprofileEncode({ pubkey, relays }), tags: [['n', '17']] }];
  const r = new PaymentRequest(transport, 'abc123', over.amount, over.unit ?? 'sat', over.mints, 'for hush money', false);
  return r.toEncodedCreqA();
}

describe('parseDestination', () => {
  it('takes a Lightning address, lowercased, with or without a lightning: prefix', () => {
    expect(parseDestination(' You@Wallet.com ', MINT)).toEqual({ kind: 'ln', address: 'you@wallet.com' });
    expect(parseDestination('lightning:you@wallet.com', MINT)).toEqual({ kind: 'ln', address: 'you@wallet.com' });
  });

  it('takes a Cashu request and finds its inbox and relays', () => {
    const d = parseDestination(request(), MINT);
    expect(d).toMatchObject({ kind: 'creq', pubkey, relays, requestId: 'abc123' });
    expect(parseDestination(`cashu:${request()}`, MINT).kind).toBe('creq');
  });

  it('turns away what it cannot use, in plain words', () => {
    expect(() => parseDestination('', MINT)).toThrow(DestinationError);
    expect(() => parseDestination('hello', MINT)).toThrow(/Lightning address/);
    expect(() => parseDestination('a@b', MINT)).toThrow(DestinationError);
    expect(() => parseDestination('creqAnonsense', MINT)).toThrow(/didn't decode/);
    expect(() => parseDestination(request({ amount: 100 }), MINT)).toThrow(/no amount/);
    expect(() => parseDestination(request({ unit: 'usd' }), MINT)).toThrow(/usd/);
    expect(() => parseDestination(request({ nostr: false }), MINT)).toThrow(/by itself/);
  });
});

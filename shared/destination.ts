import { PaymentRequest, PaymentRequestTransportType, type RawPaymentRequest } from '@cashu/cashu-ts';
import { nip19 } from 'nostr-tools';
import { LnurlError, parseAddress } from './lnurl';

// Where a catch goes on to, set in the settings gear: a Lightning address
// (you@wallet.com) or a Cashu payment request (creq...). The words in these
// errors are shown to the visitor as they are.

export class DestinationError extends Error {}

export type Destination =
  | { kind: 'ln'; address: string }
  | { kind: 'creq'; request: string; pubkey: string; relays: string[]; requestId?: string };

const FALLBACK_RELAYS = ['wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.damus.io'];

// Android cashu.me writes a request's empty fields as nulls, and cashu-ts throws on a null amount.
class LenientRequest extends PaymentRequest {
  static override fromRawRequest(raw: RawPaymentRequest) {
    const present = Object.entries(raw).filter(([, value]) => value != null);
    return super.fromRawRequest(Object.fromEntries(present) as RawPaymentRequest);
  }
}

export function parseDestination(raw: string, mint: string): Destination {
  const text = raw.trim().replace(/^cashu:/i, '').replace(/^lightning:/i, '');
  if (!text) throw new DestinationError('Paste a Lightning address or a Cashu request.');
  if (/^creq[ab]/i.test(text)) return parseRequest(text, mint);
  if (text.includes('@')) {
    try {
      parseAddress(text);
    } catch (e) {
      if (e instanceof LnurlError) throw new DestinationError(`That Lightning address doesn't work: ${e.message}.`);
      throw e;
    }
    return { kind: 'ln', address: text.toLowerCase() };
  }
  throw new DestinationError("That doesn't look like a Lightning address or a Cashu request.");
}

function parseRequest(text: string, mint: string): Destination {
  let request: PaymentRequest;
  try {
    request = LenientRequest.fromEncodedRequest(text);
  } catch {
    throw new DestinationError("That request didn't decode. Copy it again from your wallet.");
  }
  if (request.unit && request.unit !== 'sat') throw new DestinationError(`That request is for ${request.unit}. Hush Money pays in sats.`);
  if (request.isMintListStrict && !request.includesMint(mint)) {
    const mints = request.mints!.map((m) => m.replace(/^https?:\/\//, '')).join(', ');
    throw new DestinationError(`That request only takes ecash from ${mints}. Make one that accepts any mint.`);
  }
  if (request.amount && request.amount.toNumber() > 0) throw new DestinationError('Make a request with no amount, so it accepts whatever arrives.');
  const nostr = request.transport?.find((t) => t.type === PaymentRequestTransportType.NOSTR);
  if (!nostr) throw new DestinationError("This request can't take a payment by itself. Make a new one in your wallet and paste that.");
  let pubkey: string;
  let relays: string[] = [];
  try {
    const decoded = nip19.decode(nostr.target);
    if (decoded.type === 'nprofile') {
      pubkey = decoded.data.pubkey;
      relays = decoded.data.relays ?? [];
    } else if (decoded.type === 'npub') pubkey = decoded.data;
    else throw new Error(decoded.type);
  } catch {
    throw new DestinationError("That request didn't decode. Copy it again from your wallet.");
  }
  return { kind: 'creq', request: text, pubkey, relays: relays.length ? relays : FALLBACK_RELAYS, requestId: request.id };
}

// A short name for a destination, for saying where something went.
export function nameOf(d: Destination): string {
  return d.kind === 'ln' ? d.address : 'your wallet';
}

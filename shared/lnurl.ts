// Lightning addresses (LUD-16) and LNURL-pay (LUD-06): what we accept, from anyone.

export class LnurlError extends Error {}

// Reserved for development on a test mint: `<outcome>@fake.testnut` is served by our own server and
// never touches the network or a real wallet. See server/fakeln.ts.
export const FAKE_DOMAIN = 'fake.testnut';
export const FAKE_OUTCOMES = ['paid', 'pending', 'pending-paid', 'pending-failed', 'failed', 'unknown', 'error'] as const;
export type FakeOutcomeName = (typeof FAKE_OUTCOMES)[number];

export type Address = { user: string; domain: string; fake: boolean };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
// Hostnames that only mean something on a private network, never a Lightning address's server.
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.home.arpa', '.intranet', '.corp', '.private', '.onion', '.test', '.invalid', '.example'];

export function parseAddress(raw: string): Address {
  const s = String(raw ?? '').trim().toLowerCase();
  const m = /^([a-z0-9._+-]{1,64})@([a-z0-9.-]{1,253})$/.exec(s);
  if (!m) throw new LnurlError("that doesn't look like a Lightning address");
  const [, user, domain] = m;
  if (domain === FAKE_DOMAIN) {
    if (!(FAKE_OUTCOMES as readonly string[]).includes(user)) throw new LnurlError(`try ${FAKE_OUTCOMES.map((o) => `${o}@${FAKE_DOMAIN}`).join(', ')}`);
    return { user, domain, fake: true };
  }
  const labels = domain.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) throw new LnurlError("that Lightning address's domain isn't valid");
  if (/^[0-9.]+$/.test(domain) || /^\d+$/.test(labels[labels.length - 1])) throw new LnurlError('Lightning addresses use a domain name, not an IP address');
  if (domain === 'localhost' || PRIVATE_SUFFIXES.some((x) => domain.endsWith(x))) throw new LnurlError("that domain isn't on the public internet");
  return { user, domain, fake: false };
}

export const wellKnown = (a: Address) => `https://${a.domain}/.well-known/lnurlp/${encodeURIComponent(a.user)}`;

export type PayMeta = { callback: string; minSendable: number; maxSendable: number; metadata: string };

export function checkPayMeta(x: any): PayMeta {
  if (!x || typeof x !== 'object') throw new LnurlError("the Lightning address didn't answer properly");
  if (x.status === 'ERROR') throw new LnurlError(`the Lightning address says: ${String(x.reason ?? 'error').slice(0, 140)}`);
  if (x.tag !== 'payRequest') throw new LnurlError("that address doesn't accept Lightning payments");
  const { callback, minSendable, maxSendable, metadata } = x;
  if (typeof callback !== 'string' || callback.length > 2000) throw new LnurlError('the Lightning address gave no callback');
  if (!Number.isSafeInteger(minSendable) || !Number.isSafeInteger(maxSendable) || minSendable < 1 || maxSendable < minSendable) {
    throw new LnurlError('the Lightning address gave odd limits');
  }
  if (typeof metadata !== 'string' || metadata.length > 10_000) throw new LnurlError('the Lightning address gave no metadata');
  try {
    if (!Array.isArray(JSON.parse(metadata))) throw 0;
  } catch {
    throw new LnurlError("the Lightning address's metadata isn't valid");
  }
  return { callback, minSendable, maxSendable, metadata };
}

export function callbackUrl(meta: PayMeta, msat: number): string {
  let u: URL;
  try {
    u = new URL(meta.callback);
  } catch {
    throw new LnurlError("the Lightning address's callback isn't a URL");
  }
  if (u.protocol !== 'https:') throw new LnurlError("the Lightning address's callback isn't https");
  if (u.username || u.password) throw new LnurlError("the Lightning address's callback carries credentials");
  u.searchParams.set('amount', String(msat));
  return u.toString();
}

export function checkPayResponse(x: any): string {
  if (!x || typeof x !== 'object') throw new LnurlError("the Lightning address didn't send an invoice");
  if (x.status === 'ERROR') throw new LnurlError(`the Lightning address says: ${String(x.reason ?? 'error').slice(0, 140)}`);
  if (typeof x.pr !== 'string' || x.pr.length > 2000) throw new LnurlError("the Lightning address didn't send an invoice");
  return x.pr;
}

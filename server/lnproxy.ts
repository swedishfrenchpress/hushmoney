import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { isIP } from 'node:net';
import { checkInvoice } from '../shared/bolt11.js';
import { callbackUrl, checkPayMeta, checkPayResponse, LnurlError, parseAddress, wellKnown, type Address, type PayMeta } from '../shared/lnurl.js';

// Fetching from Lightning addresses for browsers that can't (no CORS on the address's server). This
// endpoint fetches URLs chosen by strangers, so it's locked down:
//   - https on port 443 only, no credentials in the URL, hostnames only (no IP literals);
//   - the hostname is resolved here and every address it resolves to must be public, and the
//     connection goes to the address we checked, so DNS can't be swapped in between (rebinding);
//   - redirects are followed, at most 3, and every hop gets all of these checks again; a timeout, a 64 KB cap on the answer, and JSON only;
//   - the invoice must be for exactly the amount asked, on mainnet and unexpired.

export type Resolver = (host: string) => Promise<string[]>;
export type Transport = (url: URL, ip: string, opts: { timeoutMs: number; maxBytes: number }) => Promise<{ status: number; type: string; body: string; location?: string }>;
export type LnDeps = { resolve: Resolver; transport: Transport };

export function isPublicIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0 && c === 0) return false; // IETF protocol assignments (often used internally)
    if (a === 192 && b === 0 && c === 2) return false;
    if (a === 192 && b === 88 && c === 99) return false; // reserved 6to4 relay anycast
    if (a === 198 && (b === 18 || b === 19)) return false;
    if (a === 198 && b === 51 && c === 100) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (mapped) return isPublicIp(mapped[1]);
    if (s === '::' || s === '::1') return false;
    const first = parseInt(s.split(':')[0] || '0', 16);
    if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
    if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
    if ((first & 0xffc0) === 0xfec0) return false; // deprecated site-local fec0::/10
    if ((first & 0xff00) === 0xff00) return false; // multicast
    if (s.startsWith('2001:db8') || s.startsWith('64:ff9b') || s.startsWith('100::')) return false;
    if (s.startsWith('::')) return false; // other IPv4-compatible and reserved forms
    return true;
  }
  return false;
}

export const dnsResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

export const httpsTransport: Transport = (url, ip, { timeoutMs, maxBytes }) =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: url.hostname,
        servername: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: 'GET',
        headers: { accept: 'application/json', 'user-agent': 'hushmoney.cash' },
        timeout: timeoutMs,
        // Connect to the address we already checked, whatever DNS says now.
        lookup: (_h, opts, cb) => ((opts as { all?: boolean })?.all ? (cb as any)(null, [{ address: ip, family: isIP(ip) }]) : (cb as any)(null, ip, isIP(ip))),
      },
      (res) => {
        let size = 0;
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > maxBytes) {
            req.destroy();
            reject(new LnurlError('the Lightning address answered with too much'));
          } else chunks.push(c);
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8'), location: res.headers.location }));
        res.on('error', () => reject(new LnurlError('the Lightning address hung up')));
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new LnurlError('the Lightning address took too long'));
    });
    req.on('error', (e) => reject(e instanceof LnurlError ? e : new LnurlError("couldn't reach the Lightning address")));
    req.end();
  });

const MAX_HOPS = 3;

async function fetchChecked(raw: string, deps: LnDeps) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new LnurlError('not a URL');
  }
  if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password) throw new LnurlError('only plain https URLs');
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, ''))) throw new LnurlError('only hostnames, not IP addresses');
  // Same hostname rules as an address's domain.
  parseAddress(`x@${host}`);
  let ips: string[];
  try {
    ips = await deps.resolve(host);
  } catch {
    throw new LnurlError("couldn't find the Lightning address's server");
  }
  if (!ips.length || !ips.every(isPublicIp)) throw new LnurlError("that Lightning address's server isn't on the public internet");
  return deps.transport(url, ips[0], { timeoutMs: 8000, maxBytes: 64 * 1024 });
}

export async function safeGetJson(raw: string, deps: LnDeps): Promise<any> {
  let current = raw;
  let res = await fetchChecked(current, deps);
  for (let hop = 0; res.status >= 300 && res.status < 400; hop++) {
    if (hop >= MAX_HOPS) throw new LnurlError('the Lightning address redirected too many times');
    if (!res.location) throw new LnurlError('the Lightning address redirected nowhere');
    try {
      current = new URL(res.location, current).href; // relative Locations resolve against the last URL
    } catch {
      throw new LnurlError('the Lightning address redirected somewhere that is not a URL');
    }
    res = await fetchChecked(current, deps); // every hop is checked like the first request
  }
  if (res.status !== 200) throw new LnurlError(`the Lightning address answered ${res.status}`);
  if (!/json/i.test(res.type)) throw new LnurlError("the Lightning address didn't answer with JSON");
  try {
    return JSON.parse(res.body);
  } catch {
    throw new LnurlError("the Lightning address's answer isn't valid JSON");
  }
}

const metaCache = new Map<string, { meta: PayMeta; until: number }>();

export async function payMeta(a: Address, deps: LnDeps): Promise<PayMeta> {
  const key = `${a.user}@${a.domain}`;
  const hit = metaCache.get(key);
  if (hit && hit.until > Date.now()) return hit.meta;
  const meta = checkPayMeta(await safeGetJson(wellKnown(a), deps));
  metaCache.set(key, { meta, until: Date.now() + 60_000 });
  if (metaCache.size > 500) metaCache.delete(metaCache.keys().next().value!);
  return meta;
}

export async function payInvoice(a: Address, msat: number, deps: LnDeps): Promise<string> {
  const meta = await payMeta(a, deps);
  if (!Number.isSafeInteger(msat) || msat < meta.minSendable || msat > meta.maxSendable) throw new LnurlError('that amount is outside what the Lightning address accepts');
  const pr = checkPayResponse(await safeGetJson(callbackUrl(meta, msat), deps));
  checkInvoice(pr, { msat, network: 'bc' });
  return pr;
}

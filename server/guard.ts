// Keeps a faucet from being farmed. Every payout asks allow() first, which
// grants what's left of today's budget, of this phone's share and of this
// connection's share. once() lets a coin, a ticket or a welcome gift pay out a
// single time, even from a copied cookie. human() checks Cloudflare Turnstile.
//
// Self-contained so a later trick can copy it in: change the settings below.
// The counts live in Upstash Redis (connected through Vercel's Marketplace), so
// every server instance shares them. Without it they're kept per instance,
// which is only good enough for testnut and dev.

const TRICK = 'hushmoney'; // keeps these counts apart from magical.cash's, which share the database
const DOMAIN = 'hushmoney.cash';
// A test deploy can accept the check from its own address, named in TURNSTILE_EXTRA_HOSTS
// (comma separated), which must also be on the widget's list in Cloudflare.
const HOSTS = [DOMAIN, ...(process.env.TURNSTILE_EXTRA_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean)];
export const LIMITS = {
  budget: 2_100, // sats a day, everyone together: a hundred songs
  perWallet: 105, // sats a day to one phone: five songs
  perIp: 105, // sats a day to one connection: five songs
};

const DAY_S = 86_400;
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
export const shared = !!(REDIS_URL && REDIS_TOKEN);

// Cloudflare's test secret passes every check; dev uses it when there's no real one.
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY ?? (process.env.VERCEL ? '' : '1x0000000000000000000000000000000AA');
export const checksHumans = !!TURNSTILE_SECRET;

if (process.env.VERCEL && !shared) console.warn('[guard] No Redis connected: limits only hold within one server instance.');
if (process.env.VERCEL && !checksHumans) console.warn('[guard] No TURNSTILE_SECRET_KEY: not checking for people.');

interface Store {
  claim(key: string, ttl: number): Promise<boolean>;
  drop(key: string): Promise<void>;
  // Grants up to `asked` against every key's limit, and counts the grant on all of them.
  take(asked: number, ttl: number, limits: [string, number][]): Promise<number>;
}

const TAKE = `local grant = tonumber(ARGV[1])
for i, key in ipairs(KEYS) do
  local left = tonumber(ARGV[i + 2]) - tonumber(redis.call('GET', key) or '0')
  if left < grant then grant = left end
end
if grant <= 0 then return 0 end
for _, key in ipairs(KEYS) do
  redis.call('INCRBY', key, grant)
  redis.call('EXPIRE', key, ARGV[2])
end
return grant`;

async function redis(...command: (string | number)[]): Promise<unknown> {
  const res = await fetch(REDIS_URL!, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    body: JSON.stringify(command.map(String)),
  });
  const { result, error } = (await res.json()) as { result?: unknown; error?: string };
  if (error) throw new Error(`[guard] Redis: ${error}`);
  return result;
}

const upstash: Store = {
  claim: async (key, ttl) => (await redis('SET', key, 1, 'NX', 'EX', ttl)) === 'OK',
  drop: async (key) => void (await redis('DEL', key)),
  take: async (asked, ttl, limits) =>
    Number(await redis('EVAL', TAKE, limits.length, ...limits.map(([key]) => key), asked, ttl, ...limits.map(([, n]) => n))),
};

const kept = new Map<string, { n: number; until: number }>();
const count = (key: string) => {
  const entry = kept.get(key);
  return entry && entry.until > Date.now() ? entry.n : 0;
};
const memory: Store = {
  async claim(key, ttl) {
    if (count(key)) return false;
    kept.set(key, { n: 1, until: Date.now() + ttl * 1000 });
    return true;
  },
  async drop(key) {
    kept.delete(key);
  },
  async take(asked, ttl, limits) {
    const grant = Math.min(asked, ...limits.map(([key, limit]) => limit - count(key)));
    if (grant <= 0) return 0;
    for (const [key] of limits) kept.set(key, { n: count(key) + grant, until: Date.now() + ttl * 1000 });
    return grant;
  },
};

const store = shared ? upstash : memory;
const keyOf = (...parts: string[]) => [TRICK, ...parts].join(':');

export interface Visitor {
  wallet: string | null; // the phone's Nostr pubkey, once it's linked
  ip: string; // from ipOf()
}

// How many of `sats` this visitor may be paid now: all of them, some or none.
export function allow(sats: number, who: Visitor): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const limits: [string, number][] = [
    [keyOf('paid', day), LIMITS.budget],
    [keyOf('ip', who.ip, day), LIMITS.perIp],
  ];
  if (who.wallet) limits.push([keyOf('wallet', who.wallet, day), LIMITS.perWallet]);
  return store.take(sats, 2 * DAY_S, limits);
}

// True the first time `what` is claimed within `ttl` seconds, false after that.
export const once = (what: string, ttl: number) => store.claim(keyOf('once', what), ttl);

// Takes a claim back, for a payout that never left.
export const forget = (what: string) => store.drop(keyOf('once', what));

// The visitor's connection, from the address Vercel puts in x-real-ip. IPv6
// hands each connection a whole /64, so every address in one counts as one.
export function ipOf(address: string | undefined): string {
  const ip = address?.split(',')[0].trim().toLowerCase() || 'local';
  if (!ip.includes(':') || ip.includes('.')) return ip; // IPv4, or IPv4 written as IPv6
  const [head, tail] = ip.split('::');
  const groups = head ? head.split(':') : [];
  if (tail !== undefined) {
    const rest = tail ? tail.split(':') : [];
    groups.push(...Array(8 - groups.length - rest.length).fill('0'), ...rest);
  }
  return `${groups.slice(0, 4).join(':')}::/64`;
}

// What's set up, for /api/health. Redis is asked once per instance, so the
// endpoint can't be used to run up its bill.
let reachable: Promise<boolean> | null = null;
export async function status() {
  reachable ??= shared ? redis('PING').then((r) => r === 'PONG', () => false) : Promise.resolve(false);
  return { redis: await reachable, turnstile: checksHumans };
}

// True when Turnstile vouches for the token the browser got, on one of our
// sites. Until a secret is set, everyone passes.
export async function human(token: string | undefined, address: string | undefined): Promise<boolean> {
  if (!TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token, ...(address && { remoteip: address }) }),
    });
    const { success, hostname = '' } = (await res.json()) as { success: boolean; hostname?: string };
    const ours = HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
    return success && (ours || !process.env.VERCEL);
  } catch (e) {
    console.error('[guard] Turnstile', e);
    return false;
  }
}

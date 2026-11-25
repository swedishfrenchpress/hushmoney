import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { InvoiceError } from '../shared/bolt11.js';
import { LnurlError, parseAddress, type FakeOutcomeName } from '../shared/lnurl.js';
import type { LnurlInvoice, LnurlLimits } from '../shared/song.js';
import { fakeInvoice, fakeLimits } from './fakeln.js';
import { allow, checksHumans, human, ipOf, lnurlAllowed, refund, shared, status } from './guard.js';
import { dnsResolver, httpsTransport, payInvoice, payMeta } from './lnproxy.js';
import { timingSafeEqual } from 'node:crypto';
import { MAX_COINS, sum } from '../shared/fees.js';
import { fromHex, SONG_SATS, unpackSong, type SongResult } from '../shared/song.js';
import { DEMO } from './demo.js';
import { count, drain, pop, push, seeds } from './pool.js';

// On Vercel, songs are real sats: the limits must be shared by every instance,
// and visitors must be checked for being people.
if (process.env.VERCEL && !DEMO && !(shared && checksHumans)) {
  throw new Error('Connect Redis and set the Turnstile keys before paying real sats.');
}

const DEV = !process.env.VERCEL;
const ln = { resolve: dnsResolver, transport: httpsTransport };

export const app = new Hono().basePath('/api');

// Songs and their proofs are bearer secrets; neither browsers nor shared caches
// should keep an API answer after the request is over.
app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});

// Anything unexpected, most often Redis not answering, gets plain words instead of a bare 500.
app.onError((e, c) => {
  console.error('[app]', e);
  return c.json({ error: 'Something went wrong on our side. Try again in a minute.' }, 503);
});

// Whether Redis answers and Turnstile is on; nothing secret.
app.get('/health', async (c) => c.json(await status()));

// The next ready song for the laptop to sing. `human` is a Turnstile token.
app.post('/song', bodyLimit({ maxSize: 1024, onError: (c) => c.json({ error: 'too big' }, 413) }), async (c) => {
  const { human: token } = await c.req.json<{ human?: string }>().catch(() => ({ human: undefined }));
  const address = c.req.header('x-real-ip');
  if (!(await human(token, address))) return c.json({ error: "Couldn't check you're a person. Try again." }, 403);
  // Asked before the limits are charged, so an empty pool doesn't use up anyone's day.
  const empty = () => c.json({ error: 'The songs have run out for now. Check back soon.' }, 503);
  if (!(await count())) return empty();
  // No phone is linked here, so the only caps are today's budget and this connection's share.
  // A song is all or nothing, so a part of 21 sats means this connection is done.
  const who = { wallet: null, ip: ipOf(address) };
  const now = new Date();
  if ((await allow(SONG_SATS, who, now)) < SONG_SATS) {
    return c.json({ error: "That's all the singing for today. Come back tomorrow." }, 429);
  }
  try {
    const song = await pop();
    if (song) return c.json(song);
  } catch (e) {
    await refund(SONG_SATS, who, now);
    throw e;
  }
  // Another request may have taken the last song after count() answered.
  await refund(SONG_SATS, who, now);
  return empty();
});

// The admin fills the pool from their own machine (scripts/songs.mjs).
// ADMIN_SECRET must be set and long; it is compared in constant time.
const admin = new Hono();
admin.use('*', async (c, next) => {
  const secret = process.env.ADMIN_SECRET ?? '';
  const given = Buffer.from((c.req.header('authorization') ?? '').replace(/^Bearer /, ''));
  const want = Buffer.from(secret);
  const same = given.length === want.length && timingSafeEqual(given, want);
  if (secret.length < 32 || !same) return c.json({ error: 'No.' }, 401);
  return next();
});

const HEX = /^[0-9a-f]+$/i;
const MAX_BATCH = 500;

// A song as the admin script makes it: its seed, 21 sats, and its coins.
function validEntry(e: unknown): e is SongResult {
  const r = e as SongResult | null;
  if (!r || typeof r !== 'object' || typeof r.song !== 'string' || r.sats !== SONG_SATS || !Array.isArray(r.proofs)) return false;
  const bytes = fromHex(r.song);
  if (!bytes || !unpackSong(bytes)) return false;
  if (!r.proofs.length || r.proofs.length > MAX_COINS) return false;
  const coins = r.proofs.every(
    (p) =>
      typeof p?.id === 'string' && p.id.length <= 66 && HEX.test(p.id) &&
      Number.isSafeInteger(p.amount) && p.amount > 0 &&
      typeof p.secret === 'string' && p.secret.length > 0 && p.secret.length <= 256 &&
      typeof p.C === 'string' && /^[0-9a-f]{66}$/i.test(p.C),
  );
  // Whatever the mint charges to spend them, they can't be worth less than the song.
  return coins && sum(r.proofs.map((p) => p.amount)) >= r.sats;
}

admin.post('/songs', bodyLimit({ maxSize: 1_000_000, onError: (c) => c.json({ error: 'too big' }, 413) }), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!Array.isArray(body) || !body.length) return c.json({ error: 'Send an array of songs.' }, 400);
  if (body.length > MAX_BATCH) return c.json({ error: `At most ${MAX_BATCH} songs a call.` }, 400);
  const bad = body.findIndex((e) => !validEntry(e));
  if (bad >= 0) return c.json({ error: `Song ${bad} isn't right.` }, 400);
  await push(body.map(({ song, sats, proofs }: SongResult) => ({ song, sats, proofs: proofs.map(({ id, amount, secret, C }) => ({ id, amount, secret, C })) })));
  return c.json({ added: body.length, count: await count() });
});

admin.delete('/pool', async (c) => c.json({ removed: await drain() }));

admin.get('/pool', async (c) => {
  const songs = await count();
  // ?songs=1 also names them, so `reclaim` can leave the ones still waiting alone.
  return c.json({ count: songs, sats: songs * SONG_SATS, ...(c.req.query('songs') ? { songs: await seeds() } : {}) });
});

app.route('/admin', admin);

// Lightning addresses, fetched for the phone: limits without `msat`, an invoice
// with it. Copied from trick5's /lnurl. The server only ever sees an invoice,
// never money. Fake addresses (paid@fake.testnut) answer in development only;
// real ones always work, since the phone holds whatever mint the song named.
app.post('/lnurl', bodyLimit({ maxSize: 2048, onError: (c) => c.json({ error: 'too big' }, 413) }), async (c) => {
  if (!(await lnurlAllowed(c.req.header('x-real-ip')))) return c.json({ error: 'Too many Lightning lookups. Try again in a minute.' }, 429);
  const body = (await c.req.json().catch(() => null)) as { address?: string; msat?: number } | null;
  try {
    const a = parseAddress(body?.address ?? '');
    if (a.fake && !DEV) throw new LnurlError('fake addresses only work in development on a test mint');
    if (body?.msat === undefined) {
      const m = a.fake ? fakeLimits() : await payMeta(a, ln);
      return c.json<LnurlLimits>({ minSendable: m.minSendable, maxSendable: m.maxSendable, fake: a.fake });
    }
    const msat = Number(body.msat);
    const pr = a.fake ? fakeInvoice(a.user as FakeOutcomeName, msat) : await payInvoice(a, msat, ln);
    return c.json<LnurlInvoice>({ pr, fake: a.fake });
  } catch (e) {
    if (e instanceof LnurlError || e instanceof InvoiceError) return c.json({ error: e.message }, 400);
    throw e;
  }
});

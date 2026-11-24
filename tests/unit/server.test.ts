import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { sum } from '../../shared/fees';
import { fromHex, MINTS, packSong, toHex, unpackSong, type SongResult } from '../../shared/song';
import { MemoryKv, Vault } from '../../src/listen/vault';
import { PhoneWallet } from '../../src/listen/wallet';
import { FakeMint } from '../support/fakemint';
import { fakeNet } from '../support/net';
import { makeSong } from '../support/songs';

// The real Hono app in-process. Cloudflare is answered by tests/support/net.ts;
// dev's Turnstile secret is Cloudflare's always-pass one. Songs come out of a
// pool file in a temp folder, filled with songs made on the fake mint.

const fake = new FakeMint(0); // Minibits charges nothing to spend a coin
const net = fakeNet(fake);
vi.stubGlobal('fetch', net.fetch);
process.env.POOL_FILE = join(mkdtempSync(join(tmpdir(), 'pool-')), 'pool.json');
process.env.ADMIN_SECRET = 'a'.repeat(40);
let app: typeof import('../../server/app').app;
let guard: typeof import('../../server/guard');
let pool: typeof import('../../server/pool');

beforeAll(async () => {
  ({ app } = await import('../../server/app'));
  guard = await import('../../server/guard');
  pool = await import('../../server/pool');
});

// A ready song, as scripts/songs.mjs would make it, on the fake mint under testnut's name.
async function entry(): Promise<SongResult> {
  const { song, proofs } = await makeSong(fake, 21);
  return {
    song: toHex(packSong(MINTS[1], song.seed)),
    sats: 21,
    proofs: proofs.map((p) => ({ id: p.id, amount: p.amount.toNumber(), secret: p.secret, C: p.C })),
  };
}

beforeEach(async () => {
  while (await pool.pop());
});

const sing = (ip: string, human: string | null = 'XXXX.DUMMY.TOKEN.XXXX') =>
  app.request('/api/song', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ human }) });

const bearer = { authorization: `Bearer ${'a'.repeat(40)}`, 'content-type': 'application/json' };
const post = (body: unknown, headers: Record<string, string> = bearer) =>
  app.request('/api/admin/songs', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('the pool', () => {
  test('push, count and pop hand each song out once, in order', async () => {
    const [a, b] = [await entry(), await entry()];
    expect(await pool.count()).toBe(0);
    await pool.push([a, b]);
    expect(await pool.count()).toBe(2);
    expect(await pool.pop()).toEqual(a);
    expect(await pool.pop()).toEqual(b);
    expect(await pool.pop()).toBeNull();
    expect(await pool.count()).toBe(0);
  });

  test('racing pops never give the same song twice', async () => {
    await pool.push(await Promise.all([entry(), entry(), entry()]));
    const got = (await Promise.all(Array.from({ length: 8 }, () => pool.pop()))).filter((g) => g !== null);
    expect(got).toHaveLength(3);
    expect(new Set(got.map((g) => g.song)).size).toBe(3);
  });

  test('without Redis the songs are in a JSON file', async () => {
    await pool.push([await entry()]);
    expect(JSON.parse(readFileSync(process.env.POOL_FILE!, 'utf8'))).toHaveLength(1);
  });
});

describe('the server', () => {
  test('health says Turnstile is on and Redis is not connected', async () => {
    expect(await (await app.request('/api/health')).json()).toEqual({ redis: false, turnstile: true });
  });

  test('a song is 17 bytes, holds 21 sats, and a phone nets exactly the amount', async () => {
    await pool.push([await entry()]);
    const res = await sing('10.0.0.1');
    expect(res.status).toBe(200);
    const r = (await res.json()) as SongResult;
    const song = unpackSong(fromHex(r.song)!)!;
    expect(song.mint).toBe(MINTS[1]);
    expect(r.sats).toBe(21);
    expect(sum(r.proofs.map((p) => p.amount))).toBe(21);
    const phone = new PhoneWallet(MINTS[1], Vault.of(new MemoryKv()));
    expect(await phone.catch(song)).toEqual({ status: 'caught', sats: 21 });
  });

  test('a song goes to one laptop only', async () => {
    await pool.push([await entry()]);
    expect((await sing('10.0.1.1')).status).toBe(200);
    expect((await sing('10.0.1.2')).status).toBe(503);
  });

  test('with no songs left, the words say so, and no one is charged for asking', async () => {
    const res = await sing('10.0.0.10');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('The songs have run out for now. Check back soon.');
    expect(await guard.allow(guard.LIMITS.perIp, { wallet: null, ip: '10.0.0.10' })).toBe(guard.LIMITS.perIp);
  });

  test('without a Turnstile token there is no song', async () => {
    await pool.push([await entry()]);
    const res = await sing('10.0.0.2', null);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Couldn't check you're a person. Try again.");
    expect(await pool.count()).toBe(1);
  });

  test("a connection that has had its share today is turned away, and others aren't", async () => {
    await pool.push([await entry(), await entry()]);
    expect(await guard.allow(guard.LIMITS.perIp, { wallet: null, ip: '10.0.0.3' })).toBe(guard.LIMITS.perIp);
    const res = await sing('10.0.0.3');
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("That's all the singing for today. Come back tomorrow.");
    expect((await sing('10.0.0.4')).status).toBe(200);
  });

  test('a connection gets five songs a day, and the sixth is left in the pool', async () => {
    await pool.push(await Promise.all(Array.from({ length: 6 }, () => entry())));
    for (let i = 0; i < 5; i++) expect((await sing('10.0.2.1')).status).toBe(200);
    expect((await sing('10.0.2.1')).status).toBe(429);
    expect(await pool.count()).toBe(1);
  });

  test('a connection with less than a song left is turned away, not given a part', async () => {
    await pool.push([await entry()]);
    await guard.allow(guard.LIMITS.perIp - 3, { wallet: null, ip: '10.0.0.5' });
    expect((await sing('10.0.0.5')).status).toBe(429);
    expect(await pool.count()).toBe(1);
  });

  test('a request body over 1 KB is refused', async () => {
    const res = await app.request('/api/song', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ human: 'x'.repeat(2000) }) });
    expect(res.status).toBe(413);
  });

  test('IPv6 connections in one /64 share a cap', async () => {
    expect(guard.ipOf('2001:db8:1:2:aaaa::1')).toBe(guard.ipOf('2001:db8:1:2:bbbb::9'));
  });

  test('once the day is spent, nobody gets a song', async () => {
    await pool.push([await entry()]);
    const used = await guard.allow(guard.LIMITS.budget, { wallet: null, ip: '10.0.0.7' });
    // The per-connection cap stops one connection short of the whole budget; spread the rest.
    for (let i = 0; used + i * guard.LIMITS.perIp < guard.LIMITS.budget; i++) await guard.allow(guard.LIMITS.perIp, { wallet: null, ip: `10.1.0.${i}` });
    const res = await sing('10.0.0.8');
    expect(res.status).toBe(429);
  });
});

describe('the admin routes', () => {
  test('they refuse a missing or wrong secret', async () => {
    expect((await post([await entry()], { 'content-type': 'application/json' })).status).toBe(401);
    expect((await post([await entry()], { authorization: `Bearer ${'b'.repeat(40)}` })).status).toBe(401);
    expect((await app.request('/api/admin/pool')).status).toBe(401);
    expect(await pool.count()).toBe(0);
  });

  test('they refuse everyone while the secret is unset or short', async () => {
    for (const secret of [undefined, 'short']) {
      if (secret) process.env.ADMIN_SECRET = secret;
      else delete process.env.ADMIN_SECRET;
      expect((await app.request('/api/admin/pool', { headers: { authorization: `Bearer ${secret ?? ''}` } })).status).toBe(401);
    }
    process.env.ADMIN_SECRET = 'a'.repeat(40);
  });

  test('songs are added and counted, in sats too', async () => {
    const res = await post([await entry(), await entry()]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 2, count: 2 });
    expect(await (await app.request('/api/admin/pool', { headers: bearer })).json()).toEqual({ count: 2, sats: 42 });
  });

  test('the pool can name its songs, for reclaim, and only when asked', async () => {
    const one = await entry();
    await post([one]);
    const plain = await (await app.request('/api/admin/pool', { headers: bearer })).json();
    expect(plain.songs).toBeUndefined();
    const named = await (await app.request('/api/admin/pool?songs=1', { headers: bearer })).json();
    expect(named.songs).toContain(one.song);
    expect(JSON.stringify(named)).not.toContain(one.proofs[0]!.secret);
  });

  test('a song that is not right is refused whole, and nothing is added', async () => {
    const good = await entry();
    const bad: unknown[] = [
      { ...good, sats: 22 },
      { ...good, song: 'zz' },
      { ...good, song: '00' + good.song.slice(2) },
      { ...good, proofs: [] },
      { ...good, proofs: [{ ...good.proofs[0], C: 'abc' }] },
      { ...good, proofs: [{ ...good.proofs[0], amount: 1 }] },
      { ...good, proofs: [{ ...good.proofs[0], secret: 'x'.repeat(300) }] },
      { song: good.song },
      'nope',
    ];
    for (const b of bad) expect((await post([good, b])).status).toBe(400);
    expect((await post({ not: 'an array' })).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect(await pool.count()).toBe(0);
  });

  test('more than 500 songs in a call, or a body over 1 MB, is refused', async () => {
    const good = await entry();
    expect((await post(Array(501).fill(good))).status).toBe(400);
    expect((await post(Array(500).fill({ ...good, pad: 'x'.repeat(2000) }))).status).toBe(413);
    expect(await pool.count()).toBe(0);
  });
});

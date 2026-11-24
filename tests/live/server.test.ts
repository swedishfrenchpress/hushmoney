import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { fromHex, unpackSong, type SongResult } from '../../shared/song';
import { phone, retry, testSongs } from './support';

// The real Hono app in-process, with a pool of songs made on the real testnut
// and Cloudflare's real Turnstile check with dev's always-pass test secret.

process.env.POOL_FILE = join(mkdtempSync(join(tmpdir(), 'pool-')), 'pool.json');
let app: typeof import('../../server/app').app;
let guard: typeof import('../../server/guard');
let pool: typeof import('../../server/pool');

beforeAll(async () => {
  ({ app } = await import('../../server/app'));
  guard = await import('../../server/guard');
  pool = await import('../../server/pool');
  await pool.push(await testSongs(2));
});

const sing = (ip: string, human: string | null = 'XXXX.DUMMY.TOKEN.XXXX') =>
  app.request('/api/song', { method: 'POST', headers: { 'content-type': 'application/json', 'x-real-ip': ip }, body: JSON.stringify({ human }) });

describe('the server on testnut', () => {
  test('a song from the API is caught for exactly its 21 sats', async () => {
    const res = await sing('192.0.2.1');
    expect(res.status).toBe(200);
    const r = (await res.json()) as SongResult;
    expect(r.sats).toBe(21);
    expect(await retry(() => phone().catch(unpackSong(fromHex(r.song)!)!))).toEqual({ status: 'caught', sats: 21 });
  });

  test('a connection over its cap gets 429, with the plan words', async () => {
    await guard.allow(guard.LIMITS.perIp, { wallet: null, ip: '192.0.2.2' });
    const res = await sing('192.0.2.2');
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("That's all the singing for today. Come back tomorrow.");
  });

  test('no Turnstile token, no song', async () => {
    expect((await sing('192.0.2.3', null)).status).toBe(403);
  });

  test('when the pool is empty, the words say so', async () => {
    while (await pool.pop());
    const res = await sing('192.0.2.4');
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe('The songs have run out for now. Check back soon.');
  });
});

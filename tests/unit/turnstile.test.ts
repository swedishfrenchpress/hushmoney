import { expect, test, vi } from 'vitest';
import { FakeMint } from '../support/fakemint';
import { fakeNet } from '../support/net';

// Cloudflare's always-fail test secret: every check fails, so no song is made.
process.env.TURNSTILE_SECRET_KEY = '2x0000000000000000000000000000000AA';
const net = fakeNet(new FakeMint(100));
vi.stubGlobal('fetch', net.fetch);

test('a failed Turnstile check gets no song, and nothing is minted', async () => {
  const { app } = await import('../../server/app');
  const swapsBefore = net.mint.calls.filter((c) => c === '/v1/swap').length;
  const res = await app.request('/api/song', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ human: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  expect(res.status).toBe(403);
  expect(net.turnstile).toContain('2x0000000000000000000000000000000AA');
  expect(net.mint.calls.filter((c) => c === '/v1/swap').length).toBe(swapsBefore);
});

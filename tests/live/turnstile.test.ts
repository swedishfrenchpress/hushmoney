import { expect, test } from 'vitest';

// Cloudflare's real Turnstile check, with its always-fail test secret.
process.env.TURNSTILE_SECRET_KEY = '2x0000000000000000000000000000000AA';

test('a failed Turnstile check at Cloudflare gets no song', async () => {
  const { app } = await import('../../server/app');
  const res = await app.request('/api/song', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ human: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  expect(res.status).toBe(403);
  expect((await res.json()).error).toBe("Couldn't check you're a person. Try again.");
});

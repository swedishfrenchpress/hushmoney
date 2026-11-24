import { FakeMint } from './fakemint';

// Everything a test's code reaches over the network, answered in-process: the
// mint (whatever its URL, so the server's testnut URL lands here too) and
// Cloudflare's Turnstile check, which behaves like Cloudflare's own test keys:
// a secret starting 1x always passes, 2x always fails.

export function fakeNet(mint = new FakeMint()) {
  const turnstile: string[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith('https://challenges.cloudflare.com/')) {
      const secret = new URLSearchParams(String(init?.body)).get('secret') ?? '';
      turnstile.push(secret);
      const success = secret.startsWith('1x');
      return new Response(JSON.stringify({ success, hostname: 'hushmoney.cash' }), { headers: { 'content-type': 'application/json' } });
    }
    return mint.fetch(url, init);
  };
  return { mint, fetch, turnstile };
}

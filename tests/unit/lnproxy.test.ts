import { describe, expect, test } from 'vitest';
import { LnurlError } from '../../shared/lnurl';
import { safeGetJson, type LnDeps } from '../../server/lnproxy';

// Redirects are followed, a few hops at most, and every hop is checked like the first request.

const json = (body: unknown) => ({ status: 200, type: 'application/json', body: JSON.stringify(body) });
const moved = (location: string, status = 301) => ({ status, type: '', body: '', location });

function deps(routes: Record<string, any>, ips: Record<string, string[]> = {}) {
  const seen: string[] = [];
  const d: LnDeps = {
    resolve: async (h) => ips[h] ?? ['93.184.216.34'],
    transport: async (url) => {
      seen.push(url.href);
      return routes[url.href] ?? { status: 404, type: '', body: '' };
    },
  };
  return { d, seen };
}

describe('safeGetJson redirects', () => {
  test('follows a redirect to another host', async () => {
    const { d, seen } = deps({ 'https://a.com/x': moved('https://b.com/y'), 'https://b.com/y': json({ ok: 1 }) });
    expect(await safeGetJson('https://a.com/x', d)).toEqual({ ok: 1 });
    expect(seen).toEqual(['https://a.com/x', 'https://b.com/y']);
  });

  test('resolves a relative Location against the last URL', async () => {
    const { d } = deps({ 'https://a.com/x': moved('/y', 307), 'https://a.com/y': json({ ok: 2 }) });
    expect(await safeGetJson('https://a.com/x', d)).toEqual({ ok: 2 });
  });

  test('gives up after three hops, and on a loop', async () => {
    const { d } = deps({ 'https://a.com/x': moved('https://a.com/x') });
    await expect(safeGetJson('https://a.com/x', d)).rejects.toThrow(/too many times/);
  });

  test('three hops is fine, four is not', async () => {
    const ok = deps({ 'https://a.com/0': moved('https://a.com/1'), 'https://a.com/1': moved('https://a.com/2'), 'https://a.com/2': moved('https://a.com/3'), 'https://a.com/3': json({ ok: 3 }) });
    expect(await safeGetJson('https://a.com/0', ok.d)).toEqual({ ok: 3 });
    const no = deps({ 'https://a.com/0': moved('https://a.com/1'), 'https://a.com/1': moved('https://a.com/2'), 'https://a.com/2': moved('https://a.com/3'), 'https://a.com/3': moved('https://a.com/4'), 'https://a.com/4': json({}) });
    await expect(safeGetJson('https://a.com/0', no.d)).rejects.toThrow(/too many times/);
  });

  test('refuses a hop to http, a port, credentials or an IP address', async () => {
    for (const to of ['http://b.com/y', 'https://b.com:8443/y', 'https://u:p@b.com/y', 'https://127.0.0.1/y', 'https://[::1]/y']) {
      const { d } = deps({ 'https://a.com/x': moved(to) });
      await expect(safeGetJson('https://a.com/x', d)).rejects.toBeInstanceOf(LnurlError);
    }
  });

  test('refuses a hop to a host that resolves to a private address', async () => {
    const { d, seen } = deps({ 'https://a.com/x': moved('https://evil.com/y') }, { 'evil.com': ['10.0.0.5'] });
    await expect(safeGetJson('https://a.com/x', d)).rejects.toThrow(/public internet/);
    expect(seen).toEqual(['https://a.com/x']);
  });

  test('a redirect with no Location is an error', async () => {
    const { d } = deps({ 'https://a.com/x': { status: 302, type: '', body: '' } });
    await expect(safeGetJson('https://a.com/x', d)).rejects.toThrow(/nowhere/);
  });
});

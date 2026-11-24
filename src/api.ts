import type { LnurlInvoice, LnurlLimits, SongResult } from '../shared/song';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// What a wait that runs out says: a bad connection shouldn't leave anyone waiting for good.
export const SLOW = 'That took too long. Check your connection and try again.';

async function call<T>(method: string, path: string, body?: unknown, timeout?: number): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: timeout ? AbortSignal.timeout(timeout) : undefined,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') throw new ApiError(SLOW, 0);
    throw new ApiError("Can't reach the Hush Money server.", 0);
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? 'The Hush Money server ran into a problem.', res.status);
  return data;
}

export const api = {
  song: (human: string | undefined) => call<SongResult>('POST', '/song', { human }, 25_000),
  lnLimits: (address: string) => call<LnurlLimits>('POST', '/lnurl', { address }, 15_000),
  lnInvoice: (address: string, msat: number) => call<LnurlInvoice>('POST', '/lnurl', { address, msat }, 15_000),
};

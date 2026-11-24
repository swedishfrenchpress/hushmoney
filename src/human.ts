// Cloudflare Turnstile, checked when a phone links so a script can't link phone
// after phone. It's invisible unless Cloudflare isn't sure about the visitor;
// then a checkbox shows at the bottom of the page.

import { SLOW } from './api';

// Cloudflare's test key always passes; dev uses it when there's no real one.
const SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? (import.meta.env.DEV ? '1x00000000000000000000AA' : '');
const FRESH_MS = 4 * 60_000; // a token is good for five minutes
const FAILED = "Couldn't check you're a person. Try again.";
const LOAD_MS = 15_000; // a script that hasn't come by then isn't coming

declare const turnstile: {
  render(el: HTMLElement, options: object): string;
  remove(id: string): void;
};

let script: Promise<void> | null = null;
let early: { token: Promise<string | undefined>; at: number } | null = null;

function load() {
  script ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    // Failed or too slow, the next check loads it afresh.
    const fail = (message: string) => {
      script = null;
      el.remove();
      reject(new Error(message));
    };
    const slow = setTimeout(() => fail(SLOW), LOAD_MS);
    el.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    el.onload = () => {
      clearTimeout(slow);
      resolve();
    };
    el.onerror = () => {
      clearTimeout(slow);
      fail(FAILED);
    };
    document.head.append(el);
  });
  return script;
}

async function check(): Promise<string | undefined> {
  if (!SITE_KEY) return undefined;
  await load();
  const box = document.createElement('div');
  box.className = 'human';
  document.body.append(box);
  let id = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      const fail = () => reject(new Error(FAILED));
      id = turnstile.render(box, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only',
        callback: resolve,
        'error-callback': fail,
        'expired-callback': fail,
        'timeout-callback': fail,
      });
    });
  } finally {
    if (id) turnstile.remove(id);
    box.remove();
  }
}

// Starts a check while the visitor finds their request, so linking doesn't wait on it.
export function prepare() {
  if (early && performance.now() - early.at < FRESH_MS) return;
  const token = check();
  // Failed before anyone pasted, it's forgotten, and the paste checks afresh.
  token.catch(() => {
    if (early?.token === token) early = null;
  });
  early = { token, at: performance.now() };
}

// A token for one link. Each works once, so the next link checks again.
export async function humanToken(): Promise<string | undefined> {
  const ready = early && performance.now() - early.at < FRESH_MS ? early.token : null;
  early = null;
  // One that gave up on a slow connection says so, rather than making the visitor wait it all again.
  const token = await ready?.catch((e: Error) => {
    if (e.message === SLOW) throw e;
    return null;
  });
  return token ?? check();
}

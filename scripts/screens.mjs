// Screenshots and short recordings of every state, phone (390x844) and laptop
// (1280x800), into design/screens/. Needs a dev server running.
//
//   npm run dev -- --port 5195 &
//   npm run screens -- http://localhost:5195            every shot
//   npm run screens -- http://localhost:5195 p-idle     only the shots named
//
// The phone's mic is Chrome's fake one, playing WAVs made here: room noise, or
// a real song from the dev server, chime and all.

import { Wallet } from '@cashu/cashu-ts';
import { chromium } from '@playwright/test';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withChime } from '../src/chime.ts';
import { encode } from '../src/ggwave.ts';
import { fromHex } from '../shared/song.ts';
import { fillPool } from './lib/fill-pool.ts';
import { CHROMIUM } from '../playwright.config.ts';

const args = process.argv.slice(2);
const BASE = args[0]?.startsWith('http') ? args.shift() : 'http://localhost:5195';
const only = new Set(args);
const OUT = join(import.meta.dirname, '../design/screens');
const TMP = join(import.meta.dirname, '../test-results/screens');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const LAPTOP = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 };
const wanted = (name) => !only.size || only.has(name);
const shot = async (page, name) => {
  await page.screenshot({ path: join(OUT, `${name}.jpg`), type: 'jpeg', quality: 86 });
  console.log(`  ${name}.jpg`);
};

function wav(name, samples, rate = 48_000) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  const path = join(TMP, `${name}.wav`);
  writeFileSync(path, buf);
  return path;
}

// A room: soft noise with a slow swell, so the mic level moves.
const room = (seconds, loud = 0.06) =>
  Float32Array.from({ length: seconds * 48_000 }, (_, i) => (Math.random() * 2 - 1) * loud * (0.6 + 0.4 * Math.sin(i / 9000)));

async function song(refilled = false) {
  const res = await fetch(`${BASE}/api/song`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ human: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  if (res.status === 503 && !refilled) {
    await fillPool(BASE, 4); // the pool is empty: add a few testnut songs
    return song(true);
  }
  if (!res.ok) throw new Error(`/api/song ${res.status}`);
  return res.json();
}

// The song as the laptop sings it, after a moment of room, as the phone's mic.
async function songWav(hex) {
  const sung = withChime(await encode(fromHex(hex), 48_000), 48_000);
  return wav(`song-${hex.slice(2, 8)}`, [...room(1.2), ...sung, ...new Float32Array(48_000 * 3)]);
}

const browsers = [];
const phoneBrowser = async (opts = {}) => {
  const a = ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'];
  if (opts.mic !== false) a.push('--use-fake-ui-for-media-stream');
  if (opts.wav) a.push(`--use-file-for-fake-audio-capture=${opts.wav}`);
  const b = await chromium.launch({ executablePath: CHROMIUM, args: a });
  browsers.push(b);
  return b;
};
const settle = (page, ms = 900) => page.waitForTimeout(ms);
// One group of shots; a failure is logged and the rest still run.
let failures = 0;
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    failures++;
    console.log(`  FAILED ${name}: ${String(e?.message ?? e).split('\n')[0]}`);
  }
}
const orbReady = (page) => page.waitForSelector('.ear.gl', { timeout: 15_000 }).catch(() => null);

try {
  console.log('phone');
  if (wanted('p-idle')) await step('p-idle', async () => {
    const b = await phoneBrowser();
    const p = await (await b.newContext(PHONE)).newPage();
    await p.goto(`${BASE}/listen`);
    await orbReady(p);
    await settle(p, 1500);
    await shot(p, 'p-idle');
  });

  if (wanted('p-listening')) await step('p-listening', async () => {
    const b = await phoneBrowser({ wav: wav('room', room(20, 0.09)) });
    const p = await (await b.newContext(PHONE)).newPage();
    await p.goto(`${BASE}/listen`);
    await orbReady(p);
    await p.getByRole('button', { name: 'Tap to listen' }).click();
    await settle(p, 1800);
    await shot(p, 'p-listening');
  });

  if (['p-heard', 'p-catching', 'p-caught', 'p-sheet', 'p-onway', 'p-waiting', 'p-landed', 'p-gone', 'phone-catch'].some(wanted)) await step('group', async () => {
    const s = await song();
    const b = await phoneBrowser({ wav: await songWav(s.song) });
    const context = await b.newContext({ ...PHONE, recordVideo: { dir: TMP, size: { width: 390, height: 844 } } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const p = await context.newPage();
    // Slow the claim a little, so "catching" can be seen.
    await p.route('**/v1/swap', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    await p.goto(`${BASE}/listen`);
    await orbReady(p);
    await settle(p, 600);
    await p.getByRole('button', { name: 'Tap to listen' }).click();
    await p.waitForSelector('.ear[data-state="heard"]', { timeout: 20_000 });
    await settle(p, 500);
    if (wanted('p-heard')) await shot(p, 'p-heard');
    await p.waitForSelector('.ear[data-state="catching"]', { timeout: 20_000 });
    await settle(p, 500);
    if (wanted('p-catching')) await shot(p, 'p-catching');
    await p.waitForSelector('.ear[data-state="caught"]', { timeout: 30_000 });
    await settle(p, 1600);
    if (wanted('p-caught')) await shot(p, 'p-caught');
    await p.locator('.balance').click();
    await settle(p, 700);
    if (wanted('p-sheet')) await shot(p, 'p-sheet');
    await p.locator('.sheet .copy').click();
    await settle(p, 500);
    if (wanted('p-onway')) await shot(p, 'p-onway');
    await p.locator('.sheet .close').click();
    await settle(p, 500);
    if (wanted('p-waiting')) await shot(p, 'p-waiting');
    // A wallet app claims the token, and the open page turns the coin over.
    const app = new Wallet('https://testnut.cashu.space', { unit: 'sat' });
    await app.loadMint();
    await app.receive(await p.evaluate(() => navigator.clipboard.readText()));
    await p.waitForSelector('.ear[data-state="landed"]', { timeout: 20_000 });
    await settle(p, 1700);
    if (wanted('p-landed')) await shot(p, 'p-landed');
    await settle(p, 600);
    const video = p.video();
    await context.close();
    if (video && wanted('phone-catch')) {
      renameSync(await video.path(), join(OUT, 'phone-catch.webm'));
      console.log('  phone-catch.webm');
    }
    if (wanted('p-gone')) {
      const g = await (await b.newContext(PHONE)).newPage();
      await g.goto(`${BASE}/listen#${s.song}`);
      await g.waitForSelector('.ear[data-look="gone"]', { timeout: 30_000 });
      await settle(g, 1200);
      await shot(g, 'p-gone');
    }
  });

  if (wanted('p-denied')) await step('p-denied', async () => {
    const b = await phoneBrowser({ mic: false });
    const p = await (await b.newContext(PHONE)).newPage();
    await p.goto(`${BASE}/listen`);
    await orbReady(p);
    await p.getByRole('button', { name: 'Tap to listen' }).click();
    await p.waitForSelector('.ear[data-look="denied"]');
    await settle(p, 1200);
    await shot(p, 'p-denied');
  });

  if (wanted('p-lightning')) await step('p-lightning', async () => {
    const s = await song();
    const b = await phoneBrowser();
    const p = await (await b.newContext(PHONE)).newPage();
    await p.goto(`${BASE}/listen?ln#${s.song}`);
    await p.waitForSelector('.ear[data-state="caught"]', { timeout: 30_000 });
    await p.locator('.balance').click();
    await p.locator('#ln-address').fill('paid@fake.testnut');
    await p.getByRole('button', { name: 'Send' }).click();
    await p.waitForFunction(() => /Sent|Lightning needs|cover/.test(document.querySelector('.ln-status')?.textContent ?? ''), null, { timeout: 30_000 });
    await settle(p, 600);
    await shot(p, 'p-lightning');
  });

  if (wanted('p-flat')) await step('p-flat', async () => {
    const s = await song();
    const b = await phoneBrowser();
    const p = await (await b.newContext({ ...PHONE, reducedMotion: 'reduce' })).newPage();
    await p.goto(`${BASE}/listen`);
    await settle(p, 800);
    await shot(p, 'p-flat-idle');
    await p.evaluate((h) => (location.hash = h), s.song);
    await p.waitForSelector('.ear[data-state="caught"]', { timeout: 30_000 });
    await settle(p, 1200);
    await shot(p, 'p-flat-caught');
  });

  if (wanted('p-timeout')) await step('p-timeout', async () => {
    const b = await phoneBrowser({ wav: wav('quiet', room(40, 0.004)) });
    const p = await (await b.newContext(PHONE)).newPage();
    await p.goto(`${BASE}/listen`);
    await orbReady(p);
    await p.getByRole('button', { name: 'Tap to listen' }).click();
    await p.waitForSelector('.ear[data-look="timeout"]', { timeout: 45_000 });
    await settle(p, 1200);
    await shot(p, 'p-timeout');
  });

  console.log('laptop');
  if (['l-ready', 'l-singing', 'l-caught', 'laptop-sing'].some(wanted)) await step('group', async () => {
    // The page asks for its own song, so the pool must not be empty after the phone's shots.
    await fillPool(BASE, 2);
    const b = await chromium.launch({ executablePath: CHROMIUM, args: ['--autoplay-policy=no-user-gesture-required'] });
    browsers.push(b);
    const context = await b.newContext({ ...LAPTOP, recordVideo: { dir: TMP, size: { width: 1280, height: 800 } } });
    const l = await context.newPage();
    await l.addInitScript(() => {
      const f = window.fetch;
      window.fetch = async (...a) => {
        const r = await f(...a);
        if (String(a[0]).includes('/api/song')) r.clone().json().then((j) => (window.__song = j));
        return r;
      };
    });
    await l.goto(`${BASE}/?air`);
    // The landing plays first; a press before it ends would scroll the page to reach the button.
    await l.waitForFunction(() => !('intro' in document.querySelector('#sing').dataset), null, { timeout: 15_000 });
    await settle(l, 900);
    if (wanted('l-ready')) await shot(l, 'l-ready');
    await l.getByRole('button', { name: 'Sing', exact: true }).click();
    await l.waitForFunction(() => window.__song, null, { timeout: 30_000 });
    await settle(l, 1900);
    if (wanted('l-singing')) await shot(l, 'l-singing');
    await settle(l, 1500);
    const hex = await l.evaluate(() => window.__song.song);
    const pb = await phoneBrowser();
    const p = await (await pb.newContext(PHONE)).newPage();
    await p.goto(`${BASE}/listen#${hex}`);
    await l.waitForSelector('#sing[data-view="caught"] .coin .amount', { timeout: 30_000 });
    await settle(l, 350);
    if (wanted('l-caught')) await shot(l, 'l-caught');
    await settle(l, 1800);
    const video = l.video();
    await context.close();
    if (video && wanted('laptop-sing')) {
      renameSync(await video.path(), join(OUT, 'laptop-sing.webm'));
      console.log('  laptop-sing.webm');
    }
  });
} finally {
  for (const b of browsers) await b.close().catch(() => {});
  rmSync(TMP, { recursive: true, force: true });
}
if (failures) process.exitCode = 1;

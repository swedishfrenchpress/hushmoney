// Renders a link-preview concept from design/og/ to a still and a looping video.
// Needs the dev server: npx vite --port 5195, then
//   node design/og/render.mjs <concept> <out-dir> [--scale 0.5] [--fps 30] [--still-only] [--query k=v] [--as name]
// writes <out-dir>/<concept>.jpg, and unless --still-only <out-dir>/<concept>.mp4
// (full scale) or <concept>.webp (an animated preview, below scale 1).
// The page's clock is virtual: performance.now() and requestAnimationFrame advance one
// frame at a time, so every frame is exact however slow the capture is.

import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const [name, outDir] = args;
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const scale = Number(opt('--scale', 1));
const fps = Number(opt('--fps', 30));
const stillOnly = args.includes('--still-only');
const base = opt('--base', 'http://localhost:5195');
const query = opt('--query', ''); // e.g. stop=ribbon
const as = opt('--as', name); // the output files' name
if (!name || !outDir) throw new Error('usage: render.mjs <concept> <out-dir> [--scale s] [--fps n] [--still-only]');

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: scale });
await page.addInitScript(() => {
  let now = 0;
  let id = 0;
  const queue = new Map();
  performance.now = () => now;
  window.requestAnimationFrame = (cb) => (queue.set(++id, cb), id);
  window.cancelAnimationFrame = (i) => queue.delete(i);
  window.__step = (ms) => {
    now += ms;
    const due = [...queue.values()];
    queue.clear();
    for (const cb of due) cb(now);
  };
});
await page.goto(`${base}/design/og/${name}.html${query ? `?${query}` : ''}`, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__og, null, { polling: 100 });
const { duration, hero, warm } = await page.evaluate(async () => {
  await window.__og.ready;
  return { duration: window.__og.duration, hero: window.__og.hero, warm: window.__og.warm ?? 0 };
});
const stage = page.locator('#og');
const dt = 1000 / fps;
const step = (n = 1) => page.evaluate(([ms, n]) => { for (let i = 0; i < n; i++) window.__step(ms); }, [dt, n]);

const frames = mkdtempSync(join(tmpdir(), `og-${name}-`));
const count = Math.round(duration * fps);
const heroFrame = Math.round(hero * fps);
await step(1 + Math.round(warm * fps));
for (let i = 0; i < count; i++) {
  if (i === heroFrame) await stage.screenshot({ path: resolve(outDir, `${as}.jpg`), type: 'jpeg', quality: 90 });
  if (!stillOnly) await stage.screenshot({ path: join(frames, `f${String(i).padStart(4, '0')}.png`) });
  else if (i > heroFrame) break;
  await step(1);
}
await browser.close();

if (!stillOnly) {
  if (scale >= 1) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(frames, 'f%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'slow', '-movflags', '+faststart', resolve(outDir, `${as}.mp4`)]);
  } else {
    const files = readdirSync(frames).sort().map((f) => join(frames, f));
    execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '72', '-d', String(Math.round(dt)), ...files, '-o', resolve(outDir, `${as}.webp`)], { stdio: 'ignore' });
  }
}
rmSync(frames, { recursive: true, force: true });
console.log(`${as}: ${duration}s at ${fps} fps, still at ${hero}s`);

import { chromium, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHROMIUM, PORT } from '../../playwright.config';

export const BASE = `http://localhost:${PORT}`;
const DIR = join(import.meta.dirname, '../../test-results/wav');

// 16-bit mono PCM, the WAV Chrome's fake mic plays.
export function writeWav(name: string, samples: Float32Array | number[], rate: number): string {
  mkdirSync(DIR, { recursive: true });
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  const path = join(DIR, `${name}.wav`);
  writeFileSync(path, buf);
  return path;
}

// Records every buffer the page plays through Web Audio, as it starts.
export const CAPTURE_AUDIO = () => {
  const w = window as unknown as { __sung: { rate: number; data: number[] }[] };
  w.__sung = [];
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args: Parameters<AudioBufferSourceNode['start']>) {
    if (this.buffer) w.__sung.push({ rate: this.buffer.sampleRate, data: Array.from(this.buffer.getChannelData(0)) });
    return start.apply(this, args);
  };
};

// A phone: Chromium whose microphone plays `wav` (on a loop), or no mic permission at all.
export async function phoneBrowser(opts: { wav?: string; micAllowed?: boolean }): Promise<Browser> {
  const args = ['--use-fake-device-for-media-stream'];
  if (opts.micAllowed !== false) args.push('--use-fake-ui-for-media-stream');
  if (opts.wav) args.push(`--use-file-for-fake-audio-capture=${opts.wav}`);
  return chromium.launch({ executablePath: CHROMIUM, args });
}

export async function phonePage(browser: Browser, path = '/listen'): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, baseURL: BASE });
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

// A song straight from the API, as the laptop would get it.
export async function songFromApi(): Promise<{ song: string; sats: number }> {
  const res = await fetch(`${BASE}/api/song`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ human: 'XXXX.DUMMY.TOKEN.XXXX' }) });
  if (!res.ok) throw new Error(`/api/song ${res.status}`);
  return res.json();
}

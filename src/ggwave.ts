// ggwave turns bytes into sound and back (github.com/ggerganov/ggwave). The
// laptop sings with it and the phone listens. Its audible "fast" mode puts a
// 17-byte song in about 1.9 s of tones between 1.9 and 6.5 kHz.

import type { GGWave } from 'ggwave';

// Fast is the default. Normal is slower (2.4 s) and may carry better in a noisy
// room; the laptop can alternate them (?modes=alt). The phone hears every mode.
// Fastest is only for scripts/air.mjs to compare against.
export type Mode = 'fast' | 'normal' | 'fastest';
const PROTOCOLS: Record<Mode, string> = {
  fast: 'GGWAVE_PROTOCOL_AUDIBLE_FAST',
  normal: 'GGWAVE_PROTOCOL_AUDIBLE_NORMAL',
  fastest: 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST',
};
const VOLUME = 50; // of 100; peaks around half of full scale
export const BLOCK = 1024; // samples per decode, ggwave's own frame size

let loaded: Promise<GGWave> | null = null;

// The WASM loads once, and apart from the page's own script, so the page draws without
// waiting for it. It prints a line on every encode, so its output goes nowhere.
function load(): Promise<GGWave> {
  loaded ??= import('ggwave')
    .then(({ default: factory }) => factory({ print: () => {}, printErr: () => {} }))
    .then((gg) => {
      gg.disableLog();
      return gg;
    });
  // A failed download is tried again on the next call.
  loaded.catch(() => (loaded = null));
  return loaded;
}

function instance(gg: GGWave, sampleRate: number) {
  const p = gg.getDefaultParameters();
  p.sampleRateInp = sampleRate;
  p.sampleRateOut = sampleRate;
  p.sampleFormatInp = gg.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  p.sampleFormatOut = gg.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
  return gg.init(p);
}

export const warmGgwave = () => void load();

// The song as samples at `sampleRate`, ready for an AudioBuffer.
export async function encode(bytes: Uint8Array, sampleRate: number, mode: Mode = 'fast'): Promise<Float32Array<ArrayBuffer>> {
  const gg = await load();
  const id = instance(gg, sampleRate);
  try {
    // A copy, since the view points into WASM memory that the next call reuses.
    const raw = new Uint8Array(gg.encode(id, bytes, gg.ProtocolId[PROTOCOLS[mode]], VOLUME));
    return new Float32Array(raw.buffer);
  } finally {
    gg.free(id);
  }
}

export interface Decoder {
  // Takes the next samples, any number of them; returns the bytes of a message once one is complete.
  push(samples: Float32Array): Uint8Array | null;
  free(): void;
}

// ggwave only hears cleanly when it's handed whole 1,024-sample frames at
// 48 kHz: at 44.1 kHz it drops what's left over between calls, and the song
// falls apart. So the decoder resamples to 48 kHz itself and feeds exact frames.
const RATE = 48_000;

export async function decoder(sampleRate: number): Promise<Decoder> {
  const gg = await load();
  const id = instance(gg, RATE);
  const frame = new Float32Array(BLOCK);
  const bytes = new Uint8Array(frame.buffer);
  let filled = 0;
  let heard: Uint8Array | null = null;
  const take = (sample: number) => {
    frame[filled++] = sample;
    if (filled < BLOCK) return;
    filled = 0;
    const out = gg.decode(id, bytes);
    if (out.length) heard = new Uint8Array(out);
  };
  const resample = sampleRate === RATE ? null : resampler(sampleRate / RATE);
  return {
    push(samples) {
      heard = null;
      if (resample) resample(samples, take);
      else for (let i = 0; i < samples.length; i++) take(samples[i]);
      return heard;
    },
    free: () => gg.free(id),
  };
}

// A running linear resampler, `step` input samples per output sample. Plenty
// for tones under 7 kHz.
function resampler(step: number) {
  let pos = 0; // where the next output sample falls; -1 is the previous block's last sample
  let prev = 0;
  return (block: Float32Array, out: (sample: number) => void) => {
    for (; pos < block.length - 1; pos += step) {
      const i = Math.floor(pos);
      const a = i < 0 ? prev : block[i];
      out(a + (block[i + 1] - a) * (pos - i));
    }
    prev = block[block.length - 1];
    pos -= block.length;
  };
}

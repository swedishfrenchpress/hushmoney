import { encode, type Mode } from '../ggwave';

// The song as notes: which of ggwave's tones sound in each beat. ggwave's
// audible modes sing on 96 tones, 46.875 Hz apart from 1875 Hz up; each beat
// holds up to six at once, one from each band of 16.
//
// The tones are read back out of the song's own samples, encoded at 48 kHz
// whatever rate the laptop plays at. There, one ggwave frame is exactly 1,024
// samples and every tone sits exactly on a frequency the frame resolves, so
// neighbouring tones (47 Hz apart) never blur into each other. At 44.1 kHz they
// do: a frame is 941 samples, too short to tell them apart.

export const TONES = 96;
const RATE = 48_000;
const FRAME = 1024;
const FIRST_HZ = 40 * 46.875;
const STEP_HZ = 46.875;
export const FRAMES_PER_BEAT: Record<Mode, number> = { fast: 6, normal: 9, fastest: 3 };

export interface Beat {
  t: number; // seconds from the start of the song's data
  tones: number[]; // 0 to 95, low to high
}

export const toneHz = (tone: number) => FIRST_HZ + tone * STEP_HZ;

// Energy of `hz` over the 1,024 samples from `from` (Goertzel).
function energy(x: Float32Array, from: number, hz: number) {
  const k = 2 * Math.cos((2 * Math.PI * hz) / RATE);
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < FRAME; i++) {
    const s = (x[from + i] ?? 0) + k * s1 - s2;
    s2 = s1;
    s1 = s;
  }
  return s1 * s1 + s2 * s2 - k * s1 * s2;
}

function frameTones(samples: Float32Array, frame: number): number[] {
  const e = Array.from({ length: TONES }, (_, i) => energy(samples, frame * FRAME, toneHz(i)));
  const loudest = Math.max(...e);
  if (loudest < 1e-3) return []; // silence
  const tones: number[] = [];
  for (let band = 0; band < 6; band++) {
    let best = band * 16;
    for (let i = band * 16; i < band * 16 + 16; i++) if ((e[i] ?? 0) > (e[best] ?? 0)) best = i;
    if ((e[best] ?? 0) > loudest * 0.2) tones.push(best);
  }
  return tones;
}

// The score of samples encoded at 48 kHz. A song is a start marker (16 frames
// of two tones that flip), its data (six tones, held for a beat of
// `framesPerBeat` frames), and an end marker. Data beats are read on their own
// grid, from the first six-tone frame; the markers on grids of their own.
export function score(samples: Float32Array, framesPerBeat: number = FRAMES_PER_BEAT.fast): Beat[] {
  const frames = Array.from({ length: Math.floor(samples.length / FRAME) }, (_, f) => frameTones(samples, f));
  const isData = (tones: number[]) => tones.length === 6;
  const first = frames.findIndex(isData);
  const last = frames.length - 1 - [...frames].reverse().findIndex(isData);
  const beats: Beat[] = [];
  const at = (frame: number) => (frame * FRAME) / RATE;
  // The markers on the same grid as the data, so the song reads at an even pace.
  const grid = (from: number, to: number) => {
    for (let f = from; f < to; f += framesPerBeat) {
      const tones = frames[Math.min(to - 1, f + Math.floor(framesPerBeat / 2))] ?? [];
      if (tones.length) beats.push({ t: at(f), tones });
    }
  };
  if (first < 0) {
    grid(0, frames.length);
    return beats;
  }
  grid(0, first);
  for (let f = first; f <= last; f += framesPerBeat) beats.push({ t: at(f), tones: frames[Math.min(last, f + Math.floor(framesPerBeat / 2))] ?? [] });
  grid(last + 1, frames.length);
  return beats;
}

// The score of a song's bytes, whatever rate it will be played at.
export async function scoreOf(bytes: Uint8Array, mode: Mode = 'fast'): Promise<Beat[]> {
  return score(await encode(bytes, RATE, mode), FRAMES_PER_BEAT[mode]);
}

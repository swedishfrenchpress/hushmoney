// Three notes before the data, so a song opens like one: E5, G#5, B5, an E
// major arpeggio, rung like small bells. Everything stays under 1.8 kHz, below
// ggwave's band (1.9 to 6.4 kHz), so the decoder never mistakes it for data.

export const CHIME = [659.25, 830.61, 987.77]; // Hz
const NOTE_S = 0.16; // each note starts this long after the one before
const RING_S = 0.42; // and rings this long
const GAP_S = 0.12; // quiet between the chime and the data
const LEVEL = 0.32;

export const chimeSeconds = () => NOTE_S * (CHIME.length - 1) + RING_S + GAP_S;

export function chime(rate: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(chimeSeconds() * rate));
  CHIME.forEach((hz, n) => {
    const start = Math.round(n * NOTE_S * rate);
    const len = Math.round(RING_S * rate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / 0.004);
      const decay = Math.exp(-t * 7);
      // A little second harmonic on the low notes only; the top one's would land in ggwave's band.
      const tone = Math.sin(2 * Math.PI * hz * t) + (2 * hz < 1800 ? 0.18 * Math.sin(4 * Math.PI * hz * t) : 0);
      out[start + i] += LEVEL * attack * decay * tone;
    }
  });
  return out;
}

export function withChime(song: Float32Array, rate: number): Float32Array<ArrayBuffer> {
  const head = chime(rate);
  const out = new Float32Array(head.length + song.length);
  out.set(head);
  out.set(song, head.length);
  return out;
}

// When each note starts, for drawing them.
export const chimeNotes = () => CHIME.map((hz, n) => ({ t: n * NOTE_S, hz }));

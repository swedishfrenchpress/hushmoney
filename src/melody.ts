// A tune under the data. ggwave's tones carry the payment and sound like a
// modem; this is a soft bell melody in E major pentatonic (E F# G# B C#, the
// chime's key) laid beneath them, so a song is something you'd want to hear.
// It is made from the song's own bytes, so every payment has its own tune, and
// it always lands home on E. Everything stays under ggwave's band (1.9 kHz up),
// so the decoder never takes it for data.

const SCALE = [0, 2, 4, 7, 9]; // semitones above E: E F# G# B C#
const LOW_MIDI = 64; // E4
const SPAN = 11; // pentatonic degrees from E4 up to E6 (1.32 kHz, whose first overtone is dropped)
const NOTE_S = 0.2; // a new note this often
const RING_S = 0.55;
const LEVEL = 0.06; // well under the data, which is what the phone listens for

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
export const NOTE_NAMES = ['E', 'F♯', 'G♯', 'B', 'C♯'];
export const degreeHz = (d: number) => midiHz(LOW_MIDI + 12 * Math.floor(d / 5) + SCALE[d % 5]!);

// The degrees of the tune: a walk that each byte nudges a step or two up or
// down, ending on E5.
export function tune(bytes: Uint8Array, count: number): number[] {
  const home = 5; // E5
  let d = 8; // opens near B5, where the chime stopped
  const out: number[] = [];
  for (let i = 0; i < count - 1; i++) {
    const b = bytes[i % bytes.length] ?? 0;
    d += [-2, -1, -1, 0, 1, 1, 2, -3][b & 7]!;
    // pulled gently back toward the middle so it never wanders off
    if (d > 9) d -= 2;
    if (d < 2) d += 2;
    out.push(Math.max(0, Math.min(SPAN, d)));
  }
  out.push(home);
  return out;
}

const countFor = (seconds: number) => Math.max(2, Math.floor((seconds - 0.3) / NOTE_S));

// The tune a song has when it is sung in the usual (fast) mode, about 1.83 s of sound:
// the one the laptop plays and the phone can show again.
export const songTune = (bytes: Uint8Array): number[] => tune(bytes, countFor(1.83));

// The tune's notes for a song of `seconds`, for drawing: when each starts and its pentatonic degree (0 to 11).
export function tuneNotes(bytes: Uint8Array, seconds: number): { t: number; degree: number }[] {
  return tune(bytes, countFor(seconds)).map((degree, n) => ({ t: n * NOTE_S, degree }));
}

export function melody(bytes: Uint8Array, rate: number, seconds: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(Math.round(seconds * rate));
  const degrees = tune(bytes, countFor(seconds));
  degrees.forEach((d, n) => {
    const hz = degreeHz(d);
    const last = n === degrees.length - 1;
    const start = Math.round(n * NOTE_S * rate);
    const len = Math.round((last ? 0.45 : RING_S) * rate);
    for (let i = 0; i < len && start + i < out.length; i++) {
      const t = i / rate;
      const env = Math.min(1, t / 0.006) * Math.exp(-t * (last ? 4 : 6));
      const tone = Math.sin(2 * Math.PI * hz * t) + (2 * hz < 1800 ? 0.2 * Math.sin(4 * Math.PI * hz * t) : 0);
      out[start + i] += LEVEL * env * tone;
    }
  });
  return out;
}

// The song's samples with the tune mixed in.
export function withMelody(song: Float32Array, rate: number, bytes: Uint8Array): Float32Array<ArrayBuffer> {
  const under = melody(bytes, rate, song.length / rate);
  const out = new Float32Array(song.length);
  for (let i = 0; i < out.length; i++) out[i] = song[i]! + under[i]!;
  return out;
}

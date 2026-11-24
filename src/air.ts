// Dev only: the laptop page also posts each song it sings to a BroadcastChannel,
// and the phone page opened with ?air hears that instead of the mic. It runs the
// whole loop, decoding included, in one browser with no speaker or mic.

export interface AirSong {
  samples: Float32Array;
  sampleRate: number;
}

export const air = import.meta.env.DEV ? new BroadcastChannel('hushmoney-air') : null;

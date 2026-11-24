import tapUrl from './tap.ts?worker&url';

// The phone's microphone, raw. Echo cancellation, noise suppression and auto
// gain are built for voices and would eat the tones, so all three are off.

export interface Mic {
  sampleRate: number;
  level(): number; // 0 to 1, how loud the room is right now
  // How much louder ggwave's band (1.9 to 6.4 kHz) is than the bands around it.
  // Voices and rooms sit low; a song stands well above 4.
  tones(): number;
  close(): void;
}

// `context` is made by the caller inside the tap, since phones only start audio from a gesture.
export async function openMic(context: AudioContext, onBlock: (block: Float32Array) => void): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  try {
    await context.resume();
    await context.audioWorklet.addModule(tapUrl);
  } catch (e) {
    stream.getTracks().forEach((t) => t.stop());
    throw e;
  }
  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, 'tap');
  // Silent, but connected: some browsers only run a node that leads to the speakers.
  const mute = context.createGain();
  mute.gain.value = 0;
  source.connect(tap).connect(mute).connect(context.destination);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;
  source.connect(analyser);
  const bins = new Float32Array(analyser.frequencyBinCount);
  const hz = context.sampleRate / analyser.fftSize;
  const band = (lo: number, hi: number) => {
    let sum = 0;
    let n = 0;
    for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz) && i < bins.length; i++, n++) sum += 10 ** ((bins[i] ?? -200) / 10);
    return sum / Math.max(1, n);
  };

  let level = 0;
  tap.port.onmessage = (e: MessageEvent<Float32Array>) => {
    const block = e.data;
    let sum = 0;
    for (let i = 0; i < block.length; i++) sum += block[i] * block[i];
    level = Math.min(1, Math.sqrt(sum / block.length) * 8);
    onBlock(block);
  };

  return {
    sampleRate: context.sampleRate,
    level: () => level,
    tones() {
      analyser.getFloatFrequencyData(bins);
      return band(1850, 6450) / ((band(250, 1500) + band(7000, 9500)) / 2 + 1e-12);
    },
    close() {
      tap.port.onmessage = null;
      source.disconnect();
      analyser.disconnect();
      tap.disconnect();
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

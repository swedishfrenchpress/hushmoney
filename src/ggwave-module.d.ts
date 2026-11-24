// The parts of ggwave's Emscripten build that trick4 uses. The package ships no types.
declare module 'ggwave' {
  interface Parameters {
    sampleRateInp: number;
    sampleRateOut: number;
    sampleFormatInp: number;
    sampleFormatOut: number;
  }
  type Instance = number;
  export interface GGWave {
    SampleFormat: Record<'GGWAVE_SAMPLE_FORMAT_F32', number>;
    ProtocolId: Record<string, number>;
    getDefaultParameters(): Parameters;
    init(parameters: Parameters): Instance;
    free(instance: Instance): void;
    encode(instance: Instance, payload: Uint8Array, protocol: number, volume: number): Int8Array;
    decode(instance: Instance, samples: Uint8Array): Int8Array;
    disableLog(): void;
  }
  export default function factory(overrides?: { print?: (s: string) => void; printErr?: (s: string) => void }): Promise<GGWave>;
}

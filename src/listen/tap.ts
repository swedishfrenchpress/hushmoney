// Runs on the audio thread. Gathers the mic's 128-sample quanta into blocks of
// 1,024 and posts each block to the page: 47 messages a second instead of 375.

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void;

const SIZE = 1024;

class Tap extends AudioWorkletProcessor {
  block = new Float32Array(SIZE);
  filled = 0;

  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.block[this.filled++] = channel[i];
      if (this.filled === SIZE) {
        this.port.postMessage(this.block, [this.block.buffer]);
        this.block = new Float32Array(SIZE);
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('tap', Tap);

// Stretches and mixes rendered video's audio off the main thread.
import { mixAudio, type MixInput } from './mix';

self.onmessage = (e: MessageEvent<MixInput>) => {
  const out = mixAudio(e.data);
  (self as unknown as Worker).postMessage(out, out.map((c) => c.buffer));
};

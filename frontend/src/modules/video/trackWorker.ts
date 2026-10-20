// Runs the object tracker off the main thread (NCC search is ~10–50 ms a frame).
import { Tracker, type Gray, type TrackPoint } from './track';

export type TrackIn = { type: 'init'; frame: Gray; box: { x: number; y: number; w: number; h: number } } | { type: 'next'; frame: Gray };
export type TrackOut = TrackPoint | null;

let tracker: Tracker | null = null;
self.onmessage = (e: MessageEvent<TrackIn>) => {
  const m = e.data;
  if (m.type === 'init') {
    tracker = new Tracker(m.frame, m.box);
    (self as unknown as Worker).postMessage(null);
  } else (self as unknown as Worker).postMessage(tracker?.next(m.frame) ?? null);
};

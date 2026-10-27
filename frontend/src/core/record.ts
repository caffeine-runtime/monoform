// Screen recording: the choices that don't need a screen (format, quality,
// the clock, remembered options), kept apart from the recorder so they can
// be tested.

export interface RecordFormat {
  mime: string;
  ext: 'mp4' | 'webm';
}

/**
 * The best format the webview can record: MP4 (H.264 and AAC, which every
 * phone, browser and chat plays), else WebM. The H.264 level in the mime is
 * a starting point; the encoder raises it to fit the screen's size.
 */
export function pickFormat(isSupported: (mime: string) => boolean): RecordFormat | null {
  const candidates: RecordFormat[] = [
    { mime: 'video/mp4;codecs=avc1.640033,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/mp4;codecs=avc1.42E01F,mp4a.40.2', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  return candidates.find((c) => isSupported(c.mime)) ?? null;
}

/**
 * Video bits per second for a w×h picture at fps: enough for sharp text
 * (screens are mostly still, so the encoder spends it on what moves),
 * between 2 and 20 Mbit/s.
 */
export function videoBitrate(w: number, h: number, fps: number): number {
  const bits = w * h * fps * 0.09;
  return Math.round(Math.min(20e6, Math.max(2e6, bits)) / 1e5) * 1e5;
}

/** Recording time as a clock: 0:07, 12:34, 1:02:03. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

/** The recorder's options, remembered between recordings. */
export interface RecordPrefs {
  mic: boolean;
  micId: string; // '' is the system's default microphone
  countdown: boolean;
  fps: 30 | 60;
}

const KEY = 'monoform.record';
export const DEFAULT_PREFS: RecordPrefs = { mic: false, micId: '', countdown: true, fps: 30 };

export function loadPrefs(store: Pick<Storage, 'getItem'> = localStorage): RecordPrefs {
  try {
    const p = JSON.parse(store.getItem(KEY) ?? '{}');
    return {
      mic: typeof p.mic === 'boolean' ? p.mic : DEFAULT_PREFS.mic,
      micId: typeof p.micId === 'string' ? p.micId : DEFAULT_PREFS.micId,
      countdown: typeof p.countdown === 'boolean' ? p.countdown : DEFAULT_PREFS.countdown,
      fps: p.fps === 60 ? 60 : 30,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: RecordPrefs, store: Pick<Storage, 'setItem'> = localStorage) {
  store.setItem(KEY, JSON.stringify(p));
}

/** A folder as the recorder shows it: its last two names (Videos › Screen Recordings). */
export function shortFolder(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.slice(-2).join(' › ');
}

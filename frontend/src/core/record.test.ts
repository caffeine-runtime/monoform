import { describe, expect, it } from 'vitest';
import { clock, DEFAULT_PREFS, loadPrefs, pickFormat, savePrefs, shortFolder, videoBitrate } from './record';

describe('record', () => {
  it('records MP4 when it can, else WebM', () => {
    expect(pickFormat(() => true)?.ext).toBe('mp4');
    expect(pickFormat((m) => m.startsWith('video/webm'))).toEqual({ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
    expect(pickFormat((m) => m === 'video/mp4;codecs=avc1.42E01F,mp4a.40.2')?.mime).toBe('video/mp4;codecs=avc1.42E01F,mp4a.40.2');
    expect(pickFormat(() => false)).toBeNull();
  });

  it('gives bigger and smoother pictures more bits, within limits', () => {
    expect(videoBitrate(1920, 1080, 30)).toBe(5.6e6);
    expect(videoBitrate(2560, 1440, 60)).toBe(19.9e6);
    expect(videoBitrate(3840, 2160, 60)).toBe(20e6);
    expect(videoBitrate(640, 360, 30)).toBe(2e6);
  });

  it('shows the time as a clock', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(7_900)).toBe('0:07');
    expect(clock(754_000)).toBe('12:34');
    expect(clock(3_723_000)).toBe('1:02:03');
    expect(clock(-5)).toBe('0:00');
  });

  it('remembers the options and survives a damaged entry', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    savePrefs({ mic: true, micId: 'abc', countdown: false, fps: 60 }, store);
    expect(loadPrefs(store)).toEqual({ mic: true, micId: 'abc', countdown: false, fps: 60 });
    m.set('monoform.record', '{"mic":"yes","fps":25');
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    m.set('monoform.record', '{"mic":"yes","fps":25}');
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
  });

  it('shortens the folder to its last two names', () => {
    expect(shortFolder('C:\\Users\\Ann\\Videos\\Screen Recordings')).toBe('Videos › Screen Recordings');
    expect(shortFolder('/home/ann/Videos/Screen Recordings/')).toBe('Videos › Screen Recordings');
  });
});

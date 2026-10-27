// The screen recorder (monoform --record, a window of its own): the options,
// the system's "Choose what to share" step, a countdown, then recording with
// pause, microphone mute and stop. Pieces are streamed to the backend every
// second; on stop it writes the finished file and the main window opens it.
import { api, endpoint, errorMessage } from './backend';
import { t } from './i18n';
import { loadPrefs, pickFormat, savePrefs, videoBitrate, type RecordFormat, type RecordPrefs } from './record';

export type Phase = 'setup' | 'picking' | 'countdown' | 'recording' | 'saving' | 'done' | 'failed';

export interface Mic {
  id: string;
  label: string;
}

const AUDIO_BITS = 160_000;

class Recorder {
  phase = $state<Phase>('setup');
  prefs = $state<RecordPrefs>(loadPrefs());
  paused = $state(false);
  muted = $state(false);
  /** Time recorded so far (pauses don't count), in ms. */
  elapsed = $state(0);
  /** Seconds left before recording starts. */
  count = $state(0);
  /** Microphone loudness, 0..1. */
  level = $state(0);
  mics = $state<Mic[]>([]);
  /** Why the microphone can't be used (shown under its switch). */
  micError = $state('');
  /** The system doesn't let apps use the microphone (its settings can change that). */
  micBlocked = $state(false);
  /** Why the last attempt failed (shown in the options). */
  error = $state('');
  /** Whether the computer's sound is being recorded (chosen in the share step). */
  systemAudio = $state(false);
  folder = $state('');
  /** The finished recording (after Stop). */
  saved = $state('');
  /** Set in self-tests: nothing quits, and `source` may stand in for the share step. */
  testing = false;
  source: (() => Promise<MediaStream>) | null = null;

  readonly format: RecordFormat | null = typeof MediaRecorder === 'undefined' ? null : pickFormat((m) => MediaRecorder.isTypeSupported(m));
  readonly available = !!navigator.mediaDevices?.getDisplayMedia && !!this.format;

  private ac: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private meter = 0;
  private display: MediaStream | null = null;
  private mixNodes: AudioNode[] = [];
  private media: MediaRecorder | null = null;
  private queue: Promise<void> = Promise.resolve();
  private writeError = '';
  private since = 0;
  private recorded = 0;
  private clockTimer = 0;
  private countTimer = 0;

  constructor() {
    if (typeof window !== 'undefined') void api.RecordingsFolder().then((f) => (this.folder = f));
  }

  setPrefs(p: Partial<RecordPrefs>) {
    this.prefs = { ...this.prefs, ...p };
    savePrefs(this.prefs);
    if ('mic' in p || 'micId' in p) void this.startMic();
  }

  // --- microphone ---

  /** Opens the chosen microphone (for its level meter, then the recording), or closes it. */
  async startMic() {
    this.stopMic();
    this.micError = '';
    this.micBlocked = false;
    if (!this.prefs.mic) return;
    const constraints = (id: string): MediaStreamConstraints => ({
      audio: { deviceId: id ? { exact: id } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints(this.prefs.micId));
      } catch (e) {
        // The remembered microphone was unplugged: the default one.
        if (!this.prefs.micId || (e as Error).name !== 'OverconstrainedError') throw e;
        this.prefs = { ...this.prefs, micId: '' };
        stream = await navigator.mediaDevices.getUserMedia(constraints(''));
      }
      if (!this.prefs.mic) return void stream.getTracks().forEach((tr) => tr.stop());
      this.micStream = stream;
      const ac = this.audio();
      this.micGain = ac.createGain();
      this.micGain.gain.value = this.muted ? 0 : 1;
      this.analyser = ac.createAnalyser();
      this.analyser.fftSize = 1024;
      ac.createMediaStreamSource(stream).connect(this.micGain);
      this.micGain.connect(this.analyser);
      this.measure();
      await this.listMics();
    } catch (e) {
      const name = (e as Error).name;
      this.micBlocked = name === 'NotAllowedError' || name === 'SecurityError';
      this.micError =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? t('Windows doesn’t let apps use the microphone.')
          : name === 'NotFoundError'
            ? t('No microphone found.')
            : name === 'NotReadableError'
              ? t('The microphone is in use by another app or was unplugged.')
              : errorMessage(e);
    }
  }

  private async listMics() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    this.mics = devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || t('Microphone {n}', { n: i + 1 }) }));
  }

  private stopMic() {
    cancelAnimationFrame(this.meter);
    this.micStream?.getTracks().forEach((tr) => tr.stop());
    this.micGain?.disconnect();
    this.micStream = this.micGain = this.analyser = null;
    this.level = 0;
  }

  private measure() {
    const a = this.analyser;
    if (!a) return;
    const buf = new Float32Array(a.fftSize);
    const step = () => {
      if (this.analyser !== a) return;
      a.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += v * v;
      // Loudness on a rough decibel scale: speech fills most of the meter.
      const db = 20 * Math.log10(Math.sqrt(sum / buf.length) || 1e-6);
      const target = Math.min(1, Math.max(0, (db + 60) / 50));
      this.level = target > this.level ? target : this.level * 0.85 + target * 0.15;
      this.meter = requestAnimationFrame(step);
    };
    this.meter = requestAnimationFrame(step);
  }

  private audio(): AudioContext {
    if (!this.ac || this.ac.state === 'closed') this.ac = new AudioContext();
    if (this.ac.state === 'suspended') void this.ac.resume();
    return this.ac;
  }

  // --- recording ---

  /** Asks what to record (the system's share step), then counts down and records. */
  async choose() {
    if (!this.available || (this.phase !== 'setup' && this.phase !== 'failed')) return;
    this.error = '';
    this.phase = 'picking';
    let display: MediaStream;
    try {
      display = await (this.source ?? (() => this.pick()))();
    } catch (e) {
      // Cancel in the share step: back to the options, nothing to say.
      if ((e as Error).name !== 'NotAllowedError' && (e as Error).name !== 'AbortError') this.error = errorMessage(e);
      this.phase = 'setup';
      return;
    }
    this.display = display;
    this.systemAudio = display.getAudioTracks().length > 0;
    display.getVideoTracks()[0]?.addEventListener('ended', () => void this.ended());
    if (!this.prefs.countdown) return this.begin();
    this.phase = 'countdown';
    this.count = 3;
    this.countTimer = window.setInterval(() => {
      if (--this.count > 0) return;
      clearInterval(this.countTimer);
      void this.begin();
    }, 1000);
  }

  private pick(): Promise<MediaStream> {
    const fps = this.prefs.fps;
    return navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: fps, max: fps }, cursor: 'always' },
      audio: true,
      systemAudio: 'include',
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'include',
    } as DisplayMediaStreamOptions);
  }

  /** Cancel during the countdown: back to the options. */
  cancelCountdown() {
    if (this.phase !== 'countdown') return;
    clearInterval(this.countTimer);
    this.release();
    this.phase = 'setup';
  }

  private async begin() {
    const display = this.display;
    const video = display?.getVideoTracks()[0];
    if (!display || !video || video.readyState === 'ended' || !this.format) return void this.fail(t('The screen or window to record is gone.'));
    // One sound track: the computer's sound and the microphone, mixed.
    const tracks: MediaStreamTrack[] = [video];
    const sys = display.getAudioTracks();
    if (sys.length || this.micGain) {
      const ac = this.audio();
      const mix = ac.createMediaStreamDestination();
      if (sys.length) {
        const src = ac.createMediaStreamSource(new MediaStream(sys));
        src.connect(mix);
        this.mixNodes.push(src);
      }
      if (this.micGain) {
        this.micGain.connect(mix);
        this.mixNodes.push(mix);
      }
      tracks.push(...mix.stream.getAudioTracks());
    }
    const s = video.getSettings();
    const fps = s.frameRate || this.prefs.fps;
    let media: MediaRecorder;
    try {
      media = new MediaRecorder(new MediaStream(tracks), {
        mimeType: this.format.mime,
        videoBitsPerSecond: videoBitrate(s.width || 1920, s.height || 1080, fps),
        audioBitsPerSecond: AUDIO_BITS,
      });
      await api.RecordBegin(this.format.ext);
    } catch (e) {
      return void this.fail(errorMessage(e));
    }
    this.media = media;
    this.writeError = '';
    this.queue = Promise.resolve();
    media.ondataavailable = (e) => this.write(e.data);
    media.onerror = (e) => void this.fail(errorMessage((e as ErrorEvent).error ?? e));
    media.start(1000);
    this.recorded = 0;
    this.since = performance.now();
    this.elapsed = 0;
    this.paused = false;
    this.phase = 'recording';
    this.clockTimer = window.setInterval(() => this.tick(), 250);
    void api.SetDirtyCount(1); // closing the window saves first
  }

  /** Streams a piece to the backend, in order. */
  private write(data: Blob) {
    if (!data.size) return;
    this.queue = this.queue.then(async () => {
      if (this.writeError) return;
      try {
        const res = await fetch(endpoint('record/chunk'), { method: 'POST', body: await data.arrayBuffer() });
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      } catch (e) {
        // Disk full or gone: keep what was written.
        if (this.phase === 'recording') this.fail(errorMessage(e));
        else this.writeError ||= errorMessage(e);
      }
    });
  }

  private tick() {
    this.elapsed = this.recorded + (this.paused ? 0 : performance.now() - this.since);
  }

  togglePause() {
    const m = this.media;
    if (this.phase !== 'recording' || !m) return;
    if (this.paused) {
      m.resume();
      this.since = performance.now();
      this.paused = false;
    } else {
      m.pause();
      this.recorded += performance.now() - this.since;
      this.paused = true;
    }
    this.tick();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.micGain) this.micGain.gain.value = this.muted ? 0 : 1;
  }

  /** Stops, writes the finished file and hands it to the main window. */
  async stop() {
    if (this.phase !== 'recording') return;
    this.tick();
    this.phase = 'saving';
    await this.finishMedia();
    this.release();
    try {
      const path = await api.RecordFinish();
      this.saved = path;
      await api.SetDirtyCount(0);
      await api.RecordOpen(path);
      if (this.writeError) return void this.fail(t('Recording stopped: {error}. What was recorded is saved.', { error: this.writeError }));
      this.phase = 'done';
      if (!this.testing) api.Quit(0);
    } catch (e) {
      await api.SetDirtyCount(0);
      this.fail(errorMessage(e));
    }
  }

  /** Throws the recording away and goes back to the options. */
  async discard() {
    if (this.phase !== 'recording') return;
    this.phase = 'saving';
    if (this.media) this.media.ondataavailable = null;
    await this.finishMedia();
    this.release();
    await api.RecordDiscard().catch(() => {});
    await api.SetDirtyCount(0);
    this.phase = 'setup';
  }

  /** The recorded window was closed (or the screen unplugged): save what there is. */
  private async ended() {
    if (this.phase === 'recording') await this.stop();
    else if (this.phase === 'countdown') this.cancelCountdown();
  }

  private async finishMedia() {
    clearInterval(this.clockTimer);
    const m = this.media;
    this.media = null;
    if (m && m.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        m.addEventListener('stop', () => resolve(), { once: true });
        m.stop();
      });
    }
    await this.queue;
  }

  /** Lets go of the screen and the mix (the microphone stays for its meter). */
  private release() {
    this.display?.getTracks().forEach((tr) => tr.stop());
    this.display = null;
    for (const n of this.mixNodes) n.disconnect();
    this.mixNodes = [];
    if (this.micGain && this.analyser) {
      this.micGain.disconnect();
      this.micGain.connect(this.analyser);
    }
    this.paused = false;
  }

  private fail(message: string) {
    clearInterval(this.clockTimer);
    clearInterval(this.countTimer);
    if (this.media && this.media.state !== 'inactive' && this.phase === 'recording') {
      // Keep what was recorded until now (stop reports the error).
      this.writeError ||= message;
      void this.stop();
      return;
    }
    this.release();
    this.error = message;
    this.phase = 'failed';
  }

  /** Closes the recorder (Cancel, ✕, Esc in the options). */
  close() {
    if (this.phase === 'recording' || this.phase === 'saving') return;
    this.cancelCountdown();
    this.stopMic();
    if (!this.testing) api.Quit(0);
  }
}

export const recorder = new Recorder();

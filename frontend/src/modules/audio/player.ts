// Plays the edited timeline with the source file's <audio> element: it seeks
// over cut parts, waits through inserted silence and, when the edit has fades
// or gain, shapes the volume through a WebAudio gain node. This is a preview —
// cut points can be a few milliseconds late; the saved file is exact.
import { cutsOnly, locate, segGain, type Timeline } from './edits';

export class Player {
  readonly el: HTMLAudioElement;
  timeline: Timeline = [];
  rate = 44100; // timeline frames per second
  /** Seconds our decoder's timeline runs ahead of the element's (MP3 info frame / encoder delay). */
  offset = 0;
  pos = 0; // output frame
  playing = false;
  loop: [number, number] | null = null;
  onTick: (pos: number, playing: boolean) => void = () => {};
  /** Set when fades/gain can't be previewed (no WebAudio access to the stream). */
  gainPreview = true;

  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private raf = 0;
  private segIdx = -1;
  private segOut = 0;
  private silenceStart = 0;
  private speed = 1;
  private corsRetried = false;

  constructor(private url: string) {
    this.el = new Audio();
    this.el.preload = 'auto';
    // CORS lets WebAudio read the samples for gain preview; the media server
    // allows the app's origin. If that fails, play without it.
    this.el.crossOrigin = 'anonymous';
    this.el.addEventListener('error', () => {
      if (this.corsRetried || this.el.crossOrigin === null) return;
      this.corsRetried = true;
      this.gainPreview = false;
      const t = this.el.currentTime;
      this.el.removeAttribute('crossorigin');
      this.el.src = this.url;
      this.el.currentTime = t;
    });
    this.el.src = url;
  }

  private timeOf = (src: number) => Math.max(0, src / this.rate - this.offset);
  private srcOf = (time: number) => (time + this.offset) * this.rate;

  private ensureGraph(): boolean {
    if (this.gainNode) return true;
    if (!this.gainPreview) return false;
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaElementSource(this.el);
      this.gainNode = this.ctx.createGain();
      src.connect(this.gainNode).connect(this.ctx.destination);
      return true;
    } catch {
      this.gainPreview = false;
      return false;
    }
  }

  setVolume(v: number) {
    this.el.volume = Math.max(0, Math.min(1, v));
  }

  setSpeed(s: number) {
    this.speed = s;
    this.el.playbackRate = s;
  }

  /** Call when the timeline changes (keeps the position if possible). */
  setTimeline(t: Timeline) {
    this.timeline = t;
    if (this.playing) this.startAt(this.pos);
  }

  async play(from = this.pos) {
    if (!cutsOnly(this.timeline) && this.ensureGraph()) await this.ctx!.resume().catch(() => {});
    this.startAt(from);
  }

  pause() {
    this.playing = false;
    this.el.pause();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.onTick(this.pos, false);
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(x: number) {
    this.pos = Math.max(0, x);
    if (this.playing) this.startAt(this.pos);
    else this.onTick(this.pos, false);
  }

  private startAt(x: number) {
    const l = locate(this.timeline, x);
    if (!l) {
      this.pos = 0;
      this.pause();
      return;
    }
    this.segIdx = l.index;
    this.segOut = l.outStart;
    this.pos = x;
    this.playing = true;
    if (l.seg.silence) {
      this.el.pause();
      this.silenceStart = performance.now() - ((x - l.outStart) / this.rate / this.speed) * 1000;
    } else {
      const t = this.timeOf(l.src);
      if (Math.abs(this.el.currentTime - t) > 0.02) this.el.currentTime = t;
      if (this.el.paused) void this.el.play().catch(() => this.pause());
    }
    this.applyGain();
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private applyGain() {
    // Without a graph (no fades in the edit, or no WebAudio access) gain isn't
    // previewed; silence segments pause the element instead.
    if (!this.gainNode || !this.ctx) return;
    const seg = this.timeline[this.segIdx];
    if (!seg) return;
    const now = this.ctx.currentTime;
    const ahead = 0.05;
    const p = this.pos - this.segOut;
    const g = this.gainNode.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(segGain(seg, p), now);
    g.linearRampToValueAtTime(segGain(seg, Math.min(seg.end - seg.start, p + ahead * this.rate * this.speed)), now + ahead);
  }

  private tick = () => {
    this.raf = 0;
    if (!this.playing) return;
    const seg = this.timeline[this.segIdx];
    if (!seg) return this.pause();
    const L = seg.end - seg.start;
    let x: number;
    if (seg.silence) x = this.segOut + ((performance.now() - this.silenceStart) / 1000) * this.rate * this.speed;
    else x = this.segOut + (this.srcOf(this.el.currentTime) - seg.start);
    if (this.loop && x >= this.loop[1]) {
      this.startAt(this.loop[0]);
      return;
    }
    const ended = !seg.silence && this.el.ended;
    if (x >= this.segOut + L || ended) {
      const next = this.timeline[this.segIdx + 1];
      if (!next) {
        this.pos = this.loop ? this.loop[0] : 0;
        if (this.loop) return this.startAt(this.pos);
        this.pause();
        this.onTick(this.pos, false);
        return;
      }
      const nextOut = this.segOut + L;
      if (!seg.silence && !next.silence && next.start === seg.end) {
        // Continues in the source: no seek needed.
        this.segIdx++;
        this.segOut = nextOut;
      } else {
        this.startAt(nextOut);
        return;
      }
    }
    this.pos = Math.max(this.segOut, x);
    this.applyGain();
    this.onTick(this.pos, true);
    this.raf = requestAnimationFrame(this.tick);
  };

  destroy() {
    this.pause();
    this.el.removeAttribute('src');
    this.el.load();
    void this.ctx?.close();
  }
}

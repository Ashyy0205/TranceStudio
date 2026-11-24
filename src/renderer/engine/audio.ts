// Realtime audio playback for the timeline's audio channels. Uses streaming
// media elements (so hour-long voice tracks don't have to be decoded into
// memory) routed through Web Audio gain nodes for volume and fades.
// Clips arrive already resolved (channel volume, mute, no-overlap rule applied
// by resolveAudio), and export mixes exactly the same list with ffmpeg.

import type { ResolvedClip } from '../../shared/types';
import { mediaUrl } from './media';

interface Voice {
  clip: ResolvedClip;
  el: HTMLAudioElement;
  gain: GainNode;
}

export class AudioEngine {
  private ctx = new AudioContext();
  private voices = new Map<string, Voice>();
  private timers: ReturnType<typeof setTimeout>[] = [];

  async load(clips: ResolvedClip[]): Promise<void> {
    await Promise.all(clips.map((c) => this.voiceFor(c)));
  }

  // Applies edited clips. Unknown clips get a player; removed ones are freed.
  // If `playingAt` is a time, playback is rescheduled from there.
  update(clips: ResolvedClip[], playingAt: number | null, sessionEnd: number): void {
    const keep = new Set(clips.map((c) => c.id));
    for (const [id, v] of this.voices) {
      if (!keep.has(id) || v.clip.path !== clips.find((c) => c.id === id)?.path) {
        this.free(v);
        this.voices.delete(id);
      }
    }
    void Promise.all(clips.map((c) => this.voiceFor(c))).then(() => {
      if (playingAt !== null) this.start(playingAt, sessionEnd);
    });
  }

  private voiceFor(clip: ResolvedClip): Promise<void> {
    const existing = this.voices.get(clip.id);
    if (existing) {
      existing.clip = clip;
      return Promise.resolve();
    }
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = mediaUrl(clip.path);
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(gain).connect(this.ctx.destination);
    this.voices.set(clip.id, { clip, el, gain });
    return new Promise<void>((resolve) => {
      if (el.readyState >= 1) return resolve();
      el.addEventListener('loadedmetadata', () => resolve(), { once: true });
      el.addEventListener('error', () => resolve(), { once: true });
    });
  }

  // Starts every clip as if the session were at `sessionTime` seconds.
  start(sessionTime: number, _sessionEnd: number): void {
    this.stop();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const now = this.ctx.currentTime;
    for (const { clip, el, gain } of this.voices.values()) {
      const srcDuration = Number.isFinite(el.duration) && el.duration > 0 ? el.duration : clip.sourceDuration;
      const length = clip.end - clip.start;
      if (!srcDuration || length <= 0 || clip.end <= sessionTime) continue;

      const offset = Math.max(0, sessionTime - clip.start);
      const toCtx = (clipTime: number) => now + (clip.start + clipTime - sessionTime);
      const env = (clipTime: number) => {
        let g = clip.volume;
        if (clip.fadeIn > 0 && clipTime < clip.fadeIn) g *= clipTime / clip.fadeIn;
        if (clip.fadeOut > 0 && clipTime > length - clip.fadeOut) g *= Math.max(0, (length - clipTime) / clip.fadeOut);
        return g;
      };

      const p = gain.gain;
      p.cancelScheduledValues(0);
      p.setValueAtTime(env(offset), Math.max(now, toCtx(offset)));
      if (clip.fadeIn > 0 && offset < clip.fadeIn) p.linearRampToValueAtTime(clip.volume, toCtx(clip.fadeIn));
      if (clip.fadeOut > 0) {
        const fadeStart = Math.max(offset, length - clip.fadeOut);
        p.setValueAtTime(env(fadeStart), Math.max(now, toCtx(fadeStart)));
        p.linearRampToValueAtTime(0, toCtx(length));
      }

      const delay = (clip.start - sessionTime) * 1000;
      if (delay > 0) {
        el.currentTime = 0;
        this.timers.push(setTimeout(() => void el.play().catch(() => {}), delay));
      } else {
        el.currentTime = offset;
        void el.play().catch(() => {});
      }
      this.timers.push(setTimeout(() => el.pause(), (clip.end - sessionTime) * 1000));
    }
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    for (const v of this.voices.values()) {
      v.el.pause();
      v.gain.gain.cancelScheduledValues(0);
      v.gain.gain.value = 0;
    }
  }

  private free(v: Voice): void {
    v.el.pause();
    v.el.removeAttribute('src');
    v.el.load();
    v.gain.disconnect();
  }

  dispose(): void {
    this.stop();
    for (const v of this.voices.values()) this.free(v);
    this.voices.clear();
    void this.ctx.close();
  }
}

// Reads an audio file's duration without decoding it.
export function probeAudioDuration(path: string): Promise<number> {
  return new Promise((resolve) => {
    const el = new Audio();
    el.preload = 'metadata';
    el.addEventListener('loadedmetadata', () => resolve(Number.isFinite(el.duration) ? el.duration : 0), {
      once: true,
    });
    el.addEventListener('error', () => resolve(0), { once: true });
    el.src = mediaUrl(path);
  });
}

// Port of trance's AsyncStreamer. Animations play one decoded frame per
// 1/15th second (regardless of speed setting or the file's own frame rate),
// stream forward through a ring buffer, and ping-pong over the last buffered
// frames once the end of the file is reached, exactly like the original.
//
// Frames come from images pre-extracted by the main process (ffmpeg), which
// replaces the original's GIF / VP8 / VP9 decoders.

import { loadTex } from './media';
import { random as rand } from './random';
import { FRAME_GRACE_FRAMES, Tex, TextureManager } from './texture';

type Img = Tex | null;

// Playback diagnostics (see SessionPlayer.stats()).
export interface StreamerStats {
  framesLoaded: number;
  loadMsTotal: number;
  starvedReversals: number; // ran out of loaded frames mid-clip and bounced back
  emptyFrames: number; // asked for a frame with nothing buffered
}

export const streamerStats: StreamerStats = { framesLoaded: 0, loadMsTotal: 0, starvedReversals: 0, emptyFrames: 0 };

// Frames decoded ahead of time per animation (in parallel, delivered in order).
const PREFETCH = 4;

export class FrameStreamer {
  private index = 0;
  private ahead: Promise<Tex | null>[] = [];
  private discarded = false;

  constructor(
    readonly frames: string[],
    readonly fps: number,
    private readonly maxW: number,
    private readonly maxH: number,
  ) {}

  success(): boolean {
    return this.frames.length > 0;
  }

  private load(i: number): Promise<Tex | null> {
    const t0 = performance.now();
    return loadTex(this.frames[i], this.maxW, this.maxH).then((tex) => {
      streamerStats.loadMsTotal += performance.now() - t0;
      ++streamerStats.framesLoaded;
      if (this.discarded) {
        tex?.source?.close();
        return null;
      }
      return tex;
    });
  }

  private fill(): void {
    while (this.ahead.length < PREFETCH && this.index < this.frames.length) this.ahead.push(this.load(this.index++));
  }

  async nextFrame(): Promise<Tex | null> {
    this.fill();
    while (this.ahead.length) {
      const tex = await this.ahead.shift()!;
      this.fill();
      if (tex) return tex;
      if (this.discarded) return null;
    }
    return null;
  }

  // Frees frames decoded ahead that will never be shown.
  discard(): void {
    this.discarded = true;
    for (const p of this.ahead) void p.then((t) => t?.source?.close());
    this.ahead = [];
  }
}

interface Slot {
  streamer: FrameStreamer | null;
  buffer: Img[];
  begin: number;
  size: number;
  end: boolean;
}

function prevIndex(i: number, bufferSize: number): number {
  return (i + bufferSize - 1) % bufferSize;
}

export class AsyncStreamer {
  private a: Slot;
  private b: Slot;
  private current: Slot;
  private next: Slot;
  private index = 0;
  private backwards = false;
  private reachedEnd = false;
  private updateCounter = 0;
  private hasOldStreamer = false;
  private pendingCurrent: Tex | null = null;
  // The playing animation and the preloading one stream independently, so
  // preloading can never starve playback (the original's loader thread also
  // topped up the playing animation first).
  private busyCurrent: Promise<void> | null = null;
  private busyNext: Promise<void> | null = null;

  constructor(
    private readonly loadFunction: () => FrameStreamer | null,
    private readonly bufferSize: number,
    private readonly textures: TextureManager,
  ) {
    const slot = (): Slot => ({ streamer: null, buffer: new Array(bufferSize).fill(null), begin: 0, size: 0, end: false });
    this.a = slot();
    this.b = slot();
    this.current = this.a;
    this.next = this.b;
  }

  // Mirrors the constructor's synchronous initial fill.
  async init(): Promise<void> {
    const a = this.a;
    a.streamer = this.loadFunction();
    while (a.streamer && !a.end && a.size < this.bufferSize) {
      const image = await a.streamer.nextFrame();
      if (image) {
        a.buffer[a.size] = image;
        ++a.size;
      } else {
        a.end = true;
      }
    }
  }

  maybeUploadNext(): void {
    if (this.current.size) {
      this.textures.upload(this.current.buffer[(this.current.begin + rand(this.current.size)) % this.bufferSize]);
    }
    if (this.next.size) {
      this.textures.upload(this.next.buffer[(this.next.begin + rand(this.next.size)) % this.bufferSize]);
    }
  }

  getFrame(): Img {
    if (!this.current.buffer[this.index]) ++streamerStats.emptyFrames;
    return this.current.buffer[this.index];
  }

  advanceFrame(globalFps: number, maybeSwitch: boolean, forceSwitch: boolean): void {
    const bs = this.bufferSize;
    const canChange =
      !!this.current.streamer &&
      !!this.next.streamer &&
      !this.hasOldStreamer &&
      (!this.current.streamer.success() ||
        !this.current.size ||
        (maybeSwitch && (this.reachedEnd || forceSwitch) && (this.next.end || this.next.size >= bs)));
    if (canChange) {
      const old = this.current;
      this.current = this.next;
      this.next = old;
      this.next.begin = 0;
      this.next.size = 0;
      this.next.end = false;
      this.reachedEnd = false;
      this.backwards = false;
      this.index = 0;
      this.hasOldStreamer = true;
      this.next.streamer?.discard();
      this.next.streamer = null;
      for (let i = 0; i < bs; ++i) {
        this.textures.releaseFrame(this.next.buffer[i]);
        this.next.buffer[i] = null;
      }
      if (this.pendingCurrent) {
        this.textures.releaseFrame(this.pendingCurrent);
        this.pendingCurrent = null;
      }
    }

    const cur = this.current;
    // Each clip plays at its own frame rate (capped at 60). trance always used
    // 15 fps (120 / speed / 8 per tick), which made video slow and choppy.
    const frameRate = Math.min(60, cur.streamer?.fps || 15);
    this.updateCounter += frameRate / globalFps;
    while (this.updateCounter > 1) {
      this.updateCounter -= 1;
      if (this.backwards) {
        if (this.index !== cur.begin) {
          this.index = prevIndex(this.index, bs);
        } else {
          this.backwards = false;
          if (this.index !== prevIndex(cur.begin + cur.size, bs)) this.index = (this.index + 1) % bs;
        }
      } else {
        if (this.index !== prevIndex(cur.begin + cur.size, bs)) {
          this.index = (this.index + 1) % bs;
        } else {
          this.backwards = true;
          if (!cur.end) ++streamerStats.starvedReversals;
          if (this.index !== cur.begin) this.index = prevIndex(this.index, bs);
        }
      }
    }
    if (cur.end && this.index === prevIndex(cur.begin + cur.size, bs)) this.reachedEnd = true;
  }

  // Loads more frames. Never runs concurrently with itself.
  // Loads more frames. Each half never runs concurrently with itself.
  asyncUpdate(): Promise<unknown> {
    this.hasOldStreamer = false;
    this.busyCurrent ??= this.streamCurrent().finally(() => (this.busyCurrent = null));
    this.busyNext ??= this.preloadNext().finally(() => (this.busyNext = null));
    return Promise.all([this.busyCurrent, this.busyNext]);
  }

  private place(image: Tex): boolean {
    const cur = this.current;
    if (cur.size === this.bufferSize) {
      // Never evict the frame currently on screen.
      if (this.index === cur.begin) return false;
      this.textures.releaseFrame(cur.buffer[cur.begin]);
      cur.buffer[cur.begin] = image;
      cur.begin = (1 + cur.begin) % this.bufferSize;
    } else {
      cur.buffer[(cur.begin + cur.size) % this.bufferSize] = image;
      ++cur.size;
    }
    return true;
  }

  // Keeps the playing animation's buffer topped up ahead of the playhead.
  private async streamCurrent(): Promise<void> {
    if (this.pendingCurrent && this.place(this.pendingCurrent)) this.pendingCurrent = null;
    const cur = this.current;
    while (!this.pendingCurrent && this.current === cur && cur.streamer && !cur.end && this.index !== cur.begin) {
      const image = await cur.streamer.nextFrame();
      if (this.current !== cur) {
        // Swapped while loading; discard.
        this.textures.releaseFrame(image);
        return;
      }
      if (!image) {
        cur.end = true;
        return;
      }
      if (!this.place(image)) this.pendingCurrent = image;
    }
  }

  // Preloads the next animation, 8 frames per update like the original.
  private async preloadNext(): Promise<void> {
    const next = this.next;
    if (!next.streamer) next.streamer = this.loadFunction();
    for (let i = 0; i < 8; ++i) {
      if (!next.streamer || next.end || next.size === this.bufferSize) break;
      const streamer = next.streamer;
      const image = await streamer.nextFrame();
      if (this.next !== next || next.streamer !== streamer) {
        this.textures.releaseFrame(image);
        break;
      }
      if (!image) {
        next.end = true;
        break;
      }
      next.buffer[next.size] = image;
      ++next.size;
    }
  }

  dispose(): void {
    this.a.streamer?.discard();
    this.b.streamer?.discard();
    for (const s of [this.a, this.b]) {
      for (const t of s.buffer) if (t) this.textures.dispose(t);
    }
    if (this.pendingCurrent) this.textures.dispose(this.pendingCurrent);
  }
}

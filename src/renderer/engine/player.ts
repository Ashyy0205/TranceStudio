// Runs a session: the equivalent of trance's play_session() main loop.
// The same code path drives the editor preview, fullscreen playback and video
// export, so what you preview is what you export.

import {
  type AnimationInfo,
  activeThemes,
  blockIndexAt,
  defaultProgram,
  type Program,
  resolveAudio,
  type Session,
  sessionDuration,
} from '../../shared/types';
import { AudioEngine } from './audio';
import { Director } from './director';
import { GLRenderer } from './gl';
import { seedRandom } from './random';
import { DEFAULT_FONT, FontCache, loadFont, TextTextureCache } from './text';
import { streamerStats } from './streamer';
import { ThemeBank } from './themeBank';

export interface PlayerOptions {
  mode: 'realtime' | 'export';
  animationFrames: Map<string, AnimationInfo>;
  seed?: number;
  startTime?: number;
  audio?: boolean;
  loop?: boolean;
  onTime?: (seconds: number) => void;
  onEnd?: () => void;
  // The graphics context was lost (GPU reset / out of memory). The player is
  // unusable afterwards and should be recreated.
  onContextLost?: () => void;
}

const ASYNC_MILLIS = 10;

export class SessionPlayer {
  private session: Session;
  private readonly gl: GLRenderer;
  private readonly textCache: TextTextureCache;
  private bank!: ThemeBank;
  private director!: Director;
  private audio: AudioEngine | null = null;

  // Session clock in milliseconds.
  private timeMs = 0;
  private ticksResidual = 0;
  private asyncResidual = 0;
  private blockIndex = -1;
  // Identifies the themes currently enabled from the themes track.
  private themeKey = '';
  private playing = false;
  private raf = 0;
  private asyncTimer: ReturnType<typeof setInterval> | null = null;
  private lastFrame = 0;
  private disposed = false;
  private frameTimes: number[] = [];
  // Used when the looks row is empty: the classic default look.
  private readonly fallbackLook = defaultProgram('Default');
  private contextLost = false;

  private constructor(
    readonly canvas: HTMLCanvasElement,
    session: Session,
    private readonly opts: PlayerOptions,
  ) {
    this.session = session;
    const ctx = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!ctx) throw new Error('WebGL2 is not available');
    this.gl = new GLRenderer(ctx);
    this.gl.drawDepth = session.playback.drawDepth;
    this.textCache = new TextTextureCache(ctx);
    if (opts.mode === 'export') this.gl.enableExportTarget();
    canvas.addEventListener('webglcontextlost', this.onContextLost);
  }

  get lost(): boolean {
    return this.contextLost;
  }

  private onContextLost = (e: Event) => {
    if (this.disposed) return;
    e.preventDefault();
    this.contextLost = true;
    window.trance?.log(`WebGL context lost (${this.opts.mode}) at ${this.time.toFixed(1)}s: ${JSON.stringify(this.stats())}`);
    this.pause();
    this.opts.onContextLost?.();
  };

  static async create(canvas: HTMLCanvasElement, session: Session, opts: PlayerOptions): Promise<SessionPlayer> {
    const p = new SessionPlayer(canvas, session, opts);
    await p.init();
    return p;
  }

  get duration(): number {
    return sessionDuration(this.session);
  }

  get time(): number {
    return this.timeMs / 1000;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get currentBlockIndex(): number {
    return this.blockIndex;
  }

  private async init(): Promise<void> {
    if (this.opts.seed !== undefined) seedRandom(this.opts.seed);
    this.timeMs = (this.opts.startTime ?? 0) * 1000;

    const s = this.session;
    const fonts = new Set<string>([DEFAULT_FONT]);
    s.themes.forEach((t) => t.fonts.forEach((f) => fonts.add(f)));
    await Promise.all([...fonts].map((f) => loadFont(f)));

    const w = this.gl.width;
    const h = this.gl.height;
    this.bank = new ThemeBank(s.themes, this.gl.textures, {
      imageCacheSize: s.playback.imageCacheSize,
      animationBufferSize: s.playback.animationBufferSize,
      maxImageWidth: Math.ceil(w * 1.25),
      maxImageHeight: Math.ceil(h * 1.25),
      animationFrames: this.opts.animationFrames,
      deterministic: this.opts.mode === 'export',
    });
    this.blockIndex = this.blockAt(this.timeMs / 1000);
    const program = this.programFor(this.blockIndex);
    const themes = activeThemes(s, this.timeMs / 1000);
    this.themeKey = JSON.stringify(themes);
    await this.bank.init(program.speed, themes);

    const fontCache = new FontCache(Math.floor(h / 3), Math.floor(h / 12), this.textCache);
    this.director = new Director(this.gl, this.bank, fontCache, program);

    if (this.opts.mode === 'realtime' && this.opts.audio !== false && s.audio.length) {
      this.audio = new AudioEngine();
      await this.audio.load(resolveAudio(s));
    }
    // Draw a first frame so the canvas isn't blank before playing.
    this.director.render();
  }

  private blockAt(seconds: number): number {
    const i = blockIndexAt(this.session.blocks, seconds);
    return i >= 0 ? i : Math.max(0, this.session.blocks.length - 1);
  }

  // Follows both timeline tracks: looks drive the visuals, themes drive the
  // media and phrases. `force` re-applies the look (after edits).
  private syncTimeline(force = false): void {
    const seconds = this.timeMs / 1000;
    const index = this.blockAt(seconds);
    if (force || index !== this.blockIndex) {
      this.blockIndex = index;
      const program = this.programFor(index);
      this.bank.setSpeed(program.speed);
      this.director.enterProgram(program);
    }
    const themes = activeThemes(this.session, seconds);
    const key = JSON.stringify(themes);
    if (key !== this.themeKey) {
      this.themeKey = key;
      this.bank.setThemes(themes);
    }
  }

  private programFor(blockIndex: number): Program {
    const s = this.session;
    const block = s.blocks[blockIndex];
    return (
      (block && s.programs.find((p) => p.id === block.programId)) ?? s.programs[0] ?? this.fallbackLook
    );
  }

  // Applies edited program/timeline settings without restarting playback.
  updateSession(session: Session): void {
    this.session = session;
    this.gl.drawDepth = session.playback.drawDepth;
    this.bank.updateTexts(session.themes);
    this.syncTimeline(true);
    const clips = resolveAudio(session);
    if (!this.audio && this.opts.mode === 'realtime' && this.opts.audio !== false && clips.length) {
      this.audio = new AudioEngine();
    }
    this.audio?.update(clips, this.playing ? this.time : null, this.duration);
  }

  // One iteration of trance's main loop for `elapsedMs` of session time.
  private step(elapsedMs: number): void {
    if (this.contextLost) return;
    const program = this.director.program();
    this.ticksResidual += (program.speed * elapsedMs) / 1000;
    let ticks = 0;
    while (this.ticksResidual >= 1) {
      --this.ticksResidual;
      ++ticks;
    }
    this.timeMs += elapsedMs;

    // Timeline transitions (playlist item changes in the original).
    this.syncTimeline();
    if (this.bank.needsSwapToMatchTheme()) this.bank.changeThemes(true);

    for (let i = 0; i < ticks; ++i) {
      this.director.update();
      this.bank.advanceFrames();
    }
    this.director.render();
  }

  // Realtime

  play(): void {
    if (this.playing || this.disposed) return;
    if (this.duration && this.timeMs >= this.duration * 1000) this.seek(0);
    this.playing = true;
    this.lastFrame = performance.now();
    this.asyncTimer = setInterval(() => void this.bank.asyncUpdate(), ASYNC_MILLIS);
    this.audio?.start(this.time, this.duration);
    const loop = (now: number) => {
      if (!this.playing) return;
      const elapsed = Math.min(250, now - this.lastFrame);
      this.lastFrame = now;
      const t0 = performance.now();
      this.step(elapsed);
      this.frameTimes.push(elapsed, performance.now() - t0);
      if (this.frameTimes.length > 4000) this.frameTimes.splice(0, 2000);
      this.opts.onTime?.(this.time);
      if (this.duration && this.timeMs >= this.duration * 1000) {
        if (this.opts.loop) {
          this.seek(0);
        } else {
          this.pause();
          this.opts.onEnd?.();
          return;
        }
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause(): void {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    if (this.asyncTimer) clearInterval(this.asyncTimer);
    this.asyncTimer = null;
    this.audio?.stop();
  }

  // Jumps the clock. Visual state carries on (it is random anyway); the
  // program switches to the block at the new time.
  seek(seconds: number): void {
    this.timeMs = Math.max(0, seconds * 1000);
    this.syncTimeline();
    if (this.playing) this.audio?.start(this.time, this.duration);
    this.opts.onTime?.(this.time);
  }

  // Export

  // Advances exactly one video frame and renders it.
  async exportFrame(fps: number): Promise<void> {
    if (this.contextLost) throw new Error('The graphics driver reset during export (WebGL context lost). Try a lower resolution or close other GPU-heavy apps.');
    const frameMs = 1000 / fps;
    this.asyncResidual += frameMs;
    while (this.asyncResidual >= ASYNC_MILLIS) {
      this.asyncResidual -= ASYNC_MILLIS;
      await this.bank.asyncUpdate();
    }
    this.step(frameMs);
  }

  // Playback diagnostics: frame pacing, step cost, animation streaming.
  stats() {
    const gaps: number[] = [];
    const work: number[] = [];
    for (let i = 0; i < this.frameTimes.length; i += 2) {
      gaps.push(this.frameTimes[i]);
      work.push(this.frameTimes[i + 1]);
    }
    const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    return {
      frames: gaps.length,
      avgFrameGapMs: avg(gaps),
      longFrames: gaps.filter((g) => g > 40).length,
      avgStepMs: avg(work),
      maxStepMs: Math.max(0, ...work),
      ...streamerStats,
      avgFrameLoadMs: streamerStats.framesLoaded ? streamerStats.loadMsTotal / streamerStats.framesLoaded : 0,
      liveTextures: this.gl.textures.liveCount(),
      emptyImageDraws: this.gl.emptyImageDraws,
      time: this.time,
    };
  }

  // Export readback. 'yuv420p' converts on the GPU (smaller, no CPU work in
  // ffmpeg); 'rgba' is the fallback for sizes that don't suit 4:2:0 packing.
  exportPixelFormat(): 'yuv420p' | 'rgba' {
    return this.gl.supportsYuvExport() ? 'yuv420p' : 'rgba';
  }

  readFrame(out: Uint8Array): void {
    if (this.exportPixelFormat() === 'yuv420p') this.gl.readYuv420(out);
    else this.gl.readRgba(out);
  }

  dispose(): void {
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.pause();
    this.audio?.dispose();
    this.bank?.dispose();
    this.textCache.disposeAll();
    this.gl.dispose();
    this.gl.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

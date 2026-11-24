// Port of trance's ThemeBank. Keeps two themes active with a set of images in
// memory each, while a third theme loads in the background so the active
// themes can be swapped. Selection logic (shufflers, weights, pinned themes,
// recently-shown suppression, swap cadence) is unchanged from the original.
//
// Unlike the original there is no loader thread: loads are asynchronous
// promises on the render thread, which removes the data races that caused
// crashes in trance.

import type { AnimationInfo, ProgramTheme, Theme } from '../../shared/types';
import { loadTex } from './media';
import { random, Shuffler } from './random';
import { AsyncStreamer, FrameStreamer } from './streamer';
import { Img, LiveImage, Tex, TextureManager } from './texture';
import { DEFAULT_FONT } from './text';

const SWITCH_COOLDOWN = 500;
const LAST_IMAGE_COUNT = 8;
// Concurrent image decodes allowed in realtime mode.
const MAX_INFLIGHT = 4;

interface ImageInfo {
  path: string;
  useCount: number;
  image: Tex | null;
  loading: Promise<void> | null;
  generation: number;
}

class ThemeInfo {
  enabled = false;
  loadedSize = 0;
  loadedIndex: number[] = [];
  // How many entries of loadedIndex have had imageShuffler increased.
  readyCount = new Map<number, number>();
  loadShuffler: Shuffler;
  imageShuffler: Shuffler;
  animationShuffler: Shuffler;
  textLookup = new Map<string, number[]>();
  textShuffler: Shuffler;

  constructor(
    readonly id: string,
    readonly size: number,
    allImages: number,
    allAnimations: number,
    readonly fontPaths: string[],
    readonly textLines: string[],
  ) {
    this.textLines = [...textLines];
    this.loadShuffler = new Shuffler(allImages);
    this.imageShuffler = new Shuffler(allImages);
    this.animationShuffler = new Shuffler(allAnimations);
    this.textShuffler = new Shuffler(textLines.length);
    textLines.forEach((t, i) => {
      const list = this.textLookup.get(t) ?? [];
      list.push(i);
      this.textLookup.set(t, list);
    });
  }
}

export interface ThemeBankOptions {
  imageCacheSize: number;
  animationBufferSize: number;
  maxImageWidth: number;
  maxImageHeight: number;
  // Animation path -> extracted frames and frame rate.
  animationFrames: Map<string, AnimationInfo>;
  // Load everything synchronously-in-order (export mode).
  deterministic: boolean;
}

export class ThemeBank {
  private allImages: ImageInfo[] = [];
  private lastImages: number[] = [];
  private allAnimations: string[] = [];
  private lastText = '';
  private themes: ThemeInfo[] = [];
  private themeMap = new Map<string, number>();
  private enabledThemeWeights = new Map<string, number>();
  private pinnedTheme = '';
  private active: ThemeInfo[] = [];
  private swapsToMatchTheme = 0;
  private updates = 0;
  private globalFps = 120;
  private cooldown = SWITCH_COOLDOWN;
  private inflight = new Set<Promise<void>>();

  private streamer!: AsyncStreamer;
  private altStreamer!: AsyncStreamer;
  private animationThemeChanged = false;
  private altAnimationThemeChanged = false;
  private changeAnimationFlag = false;
  private altChangeAnimationFlag = false;

  constructor(
    themes: Theme[],
    private readonly textures: TextureManager,
    private readonly opts: ThemeBankOptions,
  ) {
    const imagePaths = new Set<string>();
    const animationPaths = new Set<string>();
    for (const t of themes) {
      t.images.forEach((p) => imagePaths.add(p));
      t.animations.forEach((p) => animationPaths.add(p));
    }
    for (const path of imagePaths) {
      this.allImages.push({ path, useCount: 0, image: null, loading: null, generation: 0 });
    }
    this.allAnimations = [...animationPaths];

    for (const t of themes) {
      this.themeMap.set(t.id, this.themes.length);
      const images = new Set(t.images);
      const animations = new Set(t.animations);
      const info = new ThemeInfo(
        t.id,
        images.size,
        this.allImages.length,
        this.allAnimations.length,
        t.fonts.length ? [...t.fonts] : [DEFAULT_FONT],
        t.texts.filter((s) => s.trim().length),
      );
      // Disable images not in this theme in both shufflers so that they can
      // never be chosen.
      this.allImages.forEach((img, i) => {
        if (images.has(img.path)) {
          info.loadShuffler.modify(i, LAST_IMAGE_COUNT);
          info.imageShuffler.modify(i, LAST_IMAGE_COUNT);
        }
      });
      this.allAnimations.forEach((a, i) => {
        if (animations.has(a)) info.animationShuffler.modify(i, 1);
      });
      this.themes.push(info);
    }
    if (!this.themes.length) {
      this.themes.push(new ThemeInfo('', 0, 0, 0, [DEFAULT_FONT], []));
      this.themeMap.set('', 0);
    }
    this.active = [this.themes[0], this.themes[0], this.themes[0], this.themes[0]];
  }

  async init(speed: number, themes: ProgramTheme[]): Promise<void> {
    this.setSpeed(speed);
    this.setThemes(themes);
    // Choose the initial active themes and load them up.
    for (let i = 0; i < 4; ++i) {
      this.advanceTheme();
      if (i) {
        const theme = this.active[3];
        while (theme.loadedSize < Math.min(theme.size, this.cachePerTheme())) this.doLoad(theme, true);
        await this.settle();
      }
    }
    this.streamer = new AsyncStreamer(() => this.doLoadAnimation(false), this.opts.animationBufferSize, this.textures);
    this.altStreamer = new AsyncStreamer(() => this.doLoadAnimation(true), this.opts.animationBufferSize, this.textures);
    await Promise.all([this.streamer.init(), this.altStreamer.init()]);
  }

  // Animation playback rate follows the look's speed setting.
  setSpeed(speed: number): void {
    this.globalFps = speed;
  }

  // Port of the theme half of ThemeBank::set_program(). The enabled themes now
  // come from the timeline's themes track rather than from the look.
  setThemes(themes: ProgramTheme[]): void {
    this.enabledThemeWeights.clear();
    this.pinnedTheme = '';
    for (const t of this.themes) t.enabled = false;
    for (const pt of themes) {
      const index = this.themeMap.get(pt.themeId);
      if (index === undefined) continue;
      if (pt.weight) this.enabledThemeWeights.set(pt.themeId, pt.weight);
      if (pt.pinned && !this.pinnedTheme) this.pinnedTheme = pt.themeId;
      if (pt.weight || pt.pinned) this.themes[index].enabled = true;
    }
    for (let i = 1; i < 4; ++i) {
      if (!this.active[i].enabled) this.swapsToMatchTheme = Math.max(this.swapsToMatchTheme, i);
    }
    if (this.pinnedTheme) {
      const pinned = this.themes[this.themeMap.get(this.pinnedTheme)!];
      let count = 0;
      for (let i = 1; i < 4; ++i) if (this.active[i] === pinned) ++count;
      if (count < 2) this.swapsToMatchTheme = Math.max(this.swapsToMatchTheme, 3);
    }
  }

  // Replaces each theme's phrases without reloading any media.
  updateTexts(themes: Theme[]): void {
    for (const t of themes) {
      const index = this.themeMap.get(t.id);
      if (index === undefined) continue;
      const old = this.themes[index];
      const lines = t.texts.filter((s) => s.trim().length);
      if (lines.length === old.textLines.length && lines.every((l, i) => l === old.textLines[i])) continue;
      old.textLines.splice(0, old.textLines.length, ...lines);
      old.textShuffler = new Shuffler(lines.length);
      old.textLookup.clear();
      lines.forEach((l, i) => {
        const list = old.textLookup.get(l) ?? [];
        list.push(i);
        old.textLookup.set(l, list);
      });
    }
  }

  advanceFrames(): void {
    this.streamer.advanceFrame(this.globalFps, this.changeAnimationFlag, this.animationThemeChanged);
    this.altStreamer.advanceFrame(this.globalFps, this.altChangeAnimationFlag, this.altAnimationThemeChanged);
    this.changeAnimationFlag = this.altChangeAnimationFlag = false;
  }

  getImage(alternate: boolean): Img {
    const theme = this.active[alternate ? 2 : 1];
    if (!theme.size) return alternate ? this.liveAlt : this.liveMain;
    const index = theme.imageShuffler.next();
    const image = index >= 0 ? this.allImages[index]?.image : null;
    if (!image) return null;
    this.textures.upload(image);
    this.lastImages.push(index);
    for (const other of this.themes) {
      other.imageShuffler.decrease(index);
      if (this.lastImages.length > LAST_IMAGE_COUNT) other.imageShuffler.increase(this.lastImages[0]);
    }
    if (this.lastImages.length > LAST_IMAGE_COUNT) this.lastImages.shift();
    return image;
  }

  // Live stand-ins for images in themes that only have animations.
  private readonly liveMain = new LiveImage(() => this.getAnimation(false));
  private readonly liveAlt = new LiveImage(() => this.getAnimation(true));

  getAnimation(alternate: boolean): Tex | null {
    const frame = (alternate ? this.altStreamer : this.streamer).getFrame();
    this.textures.upload(frame);
    return frame;
  }

  getText(alternate: boolean, exclusive: boolean): string {
    const theme = this.active[alternate ? 2 : 1];
    if (!theme.textLines.length) return '';
    if (!exclusive) return theme.textLines[theme.textShuffler.next()];
    const text = theme.textLines[theme.textShuffler.next()];
    for (const other of this.themes) {
      const now = other.textLookup.get(text);
      if (now) for (const i of now) other.textShuffler.decrease(i);
      const last = other.textLookup.get(this.lastText);
      if (this.lastText && last) for (const i of last) other.textShuffler.increase(i);
    }
    this.lastText = text;
    return text;
  }

  getFont(alternate: boolean): string {
    const theme = this.active[alternate ? 2 : 1];
    if (!theme.fontPaths.length) return '';
    return theme.fontPaths[random(theme.fontPaths.length)];
  }

  allFontPaths(): string[] {
    const s = new Set<string>();
    for (const t of this.themes) t.fontPaths.forEach((p) => s.add(p));
    return [...s];
  }

  maybeUploadNext(): void {
    const theme = this.active[3];
    if (theme.size) {
      const index = theme.imageShuffler.next();
      const image = index >= 0 ? this.allImages[index]?.image : null;
      if (image) this.textures.upload(image);
    }
    this.streamer.maybeUploadNext();
    this.altStreamer.maybeUploadNext();
  }

  changeAnimation(alternate: boolean): void {
    if (alternate) this.altChangeAnimationFlag = true;
    else this.changeAnimationFlag = true;
  }

  // `forced` swaps (the timeline moved to another theme) skip the original's
  // 5-second loading pause so the new theme appears as soon as it has loaded.
  changeThemes(forced = false): boolean {
    if (!this.allLoaded() || !this.allUnloaded()) return false;
    this.cooldown = forced ? 0 : SWITCH_COOLDOWN;
    this.advanceTheme();
    if (this.swapsToMatchTheme) --this.swapsToMatchTheme;
    return true;
  }

  needsSwapToMatchTheme(): boolean {
    return this.swapsToMatchTheme > 0;
  }

  // Called every 10ms of session time. Returns a promise that resolves when
  // the loads started by this update finish (awaited in export mode).
  asyncUpdate(): Promise<unknown> {
    // Animations keep streaming during the post-swap cooldown. In trance the
    // cooldown also paused them, so clips ran out of buffered frames and
    // bounced back and forth for several seconds after every theme change.
    const waits: Promise<unknown>[] = [this.streamer.asyncUpdate(), this.altStreamer.asyncUpdate()];
    if (this.cooldown) {
      --this.cooldown;
      return Promise.all(waits);
    }
    ++this.updates;
    if (this.updates === 128) {
      this.doSwap(1);
      this.doSwap(2);
      this.updates = 0;
    } else {
      this.doReconcile(this.active[1]);
      this.doReconcile(this.active[2]);
      if (!this.allUnloaded()) this.doUnload(this.active[0]);
      if (!this.allLoaded()) this.doLoad(this.active[3]);
    }
    if (this.opts.deterministic) waits.push(this.settle());
    return Promise.all(waits);
  }

  async settle(): Promise<void> {
    while (this.inflight.size) await Promise.all([...this.inflight]);
  }

  dispose(): void {
    for (const img of this.allImages) if (img.image) this.textures.dispose(img.image);
    this.streamer?.dispose();
    this.altStreamer?.dispose();
  }

  private cachePerTheme(): number {
    let enabled = 0;
    for (const t of this.themes) if (t.enabled) ++enabled;
    return enabled === 0 ? 0 : Math.floor(this.opts.imageCacheSize / Math.min(3, enabled));
  }

  private advanceTheme(): void {
    let randomThemeIndex = 0;
    let total = 0;
    for (const w of this.enabledThemeWeights.values()) total += w;
    if (!total) {
      randomThemeIndex = random(this.themes.length);
    } else {
      const r = random(total);
      let t = 0;
      for (const [id, w] of this.enabledThemeWeights) {
        t += w;
        if (r < t) {
          randomThemeIndex = this.themeMap.get(id)!;
          break;
        }
      }
    }
    // Override with pinned theme if last theme wasn't the pinned theme, or if
    // there are no other weights.
    if (this.pinnedTheme) {
      const pinnedIndex = this.themeMap.get(this.pinnedTheme)!;
      if (!total || this.themes[pinnedIndex] !== this.active[3]) randomThemeIndex = pinnedIndex;
    }
    for (let i = 0; i + 1 < 4; ++i) this.active[i] = this.active[i + 1];
    this.active[3] = this.themes[randomThemeIndex];
    if (this.active[0] !== this.active[1]) this.animationThemeChanged = true;
    if (this.active[1] !== this.active[2]) this.altAnimationThemeChanged = true;
  }

  private isPending(theme: ThemeInfo): boolean {
    for (const i of theme.loadedIndex) if (this.allImages[i].loading) return true;
    return false;
  }

  private allLoaded(): boolean {
    const next = this.active[3];
    return (next.loadedSize >= next.size || next.loadedSize >= this.cachePerTheme()) && !this.isPending(next);
  }

  private allUnloaded(): boolean {
    const prev = this.active[0];
    let count = 0;
    for (const t of this.active) if (t === prev) ++count;
    return !prev.loadedSize || count > 1;
  }

  private doSwap(i: number): void {
    const theme = this.active[i];
    if (!theme.loadedSize || theme.loadedSize === theme.size) return;
    this.doUnload(theme);
    this.doLoad(theme);
  }

  private doReconcile(theme: ThemeInfo): void {
    if (theme.loadedSize < this.cachePerTheme()) this.doLoad(theme);
    if (theme.loadedSize > this.cachePerTheme()) this.doUnload(theme);
  }

  private markReady(index: number): void {
    // Make a freshly-loaded image selectable in every theme that loaded it.
    for (const theme of this.themes) {
      let wanted = 0;
      for (const i of theme.loadedIndex) if (i === index) ++wanted;
      const have = theme.readyCount.get(index) ?? 0;
      for (let k = have; k < wanted; ++k) theme.imageShuffler.increase(index);
      if (wanted !== have) theme.readyCount.set(index, Math.max(have, wanted));
    }
  }

  private doLoad(theme: ThemeInfo, force = false): void {
    if (theme.loadedSize >= theme.size) return;
    if (!force && !this.opts.deterministic && this.inflight.size >= MAX_INFLIGHT) return;
    const index = theme.loadShuffler.next();
    if (index < 0) return;
    theme.loadShuffler.decrease(index);
    theme.loadedIndex.push(index);
    ++theme.loadedSize;

    const info = this.allImages[index];
    if (!info.useCount++) {
      const generation = ++info.generation;
      const p = loadTex(info.path, this.opts.maxImageWidth, this.opts.maxImageHeight).then((tex) => {
        this.inflight.delete(p);
        if (info.generation !== generation) {
          // Unloaded while loading.
          if (tex) this.textures.dispose(tex);
          return;
        }
        info.loading = null;
        if (!tex) {
          // Don't try to load again if it failed.
          for (const t of this.themes) t.loadShuffler.modify(index, -LAST_IMAGE_COUNT);
          return;
        }
        info.image = tex;
        this.markReady(index);
      });
      info.loading = p;
      this.inflight.add(p);
    } else if (info.image) {
      this.markReady(index);
    }
  }

  private doUnload(theme: ThemeInfo): void {
    if (!theme.loadedSize) return;
    const index = theme.loadedIndex.shift()!;
    theme.loadShuffler.increase(index);
    const ready = theme.readyCount.get(index) ?? 0;
    if (ready > 0) {
      theme.imageShuffler.decrease(index);
      theme.readyCount.set(index, ready - 1);
    }
    const info = this.allImages[index];
    if (!--info.useCount) {
      ++info.generation;
      info.loading = null;
      this.textures.release(info.image);
      info.image = null;
    }
    --theme.loadedSize;
  }

  private doLoadAnimation(alternate: boolean): FrameStreamer | null {
    const theme = this.active[alternate ? 2 : 1];
    const index = theme.animationShuffler.next();
    if (index < 0 || index >= this.allAnimations.length) return null;
    const info = this.opts.animationFrames.get(this.allAnimations[index]);
    const streamer = new FrameStreamer(info?.frames ?? [], info?.fps ?? 15, this.opts.maxImageWidth, this.opts.maxImageHeight);
    if (!streamer.success()) {
      for (const t of this.themes) t.animationShuffler.modify(index, -5);
    }
    if (alternate) this.altAnimationThemeChanged = false;
    else this.animationThemeChanged = false;
    return streamer;
  }
}

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import {
  type AnimationInfo,
  ANIMATION_EXTS,
  AUDIO_EXTS,
  extOf,
  FONT_EXTS,
  IMAGE_EXTS,
  type ScanResult,
  TEXT_EXTS,
} from '../shared/types';
import { ffmpegPath, runFfmpeg } from './ffmpeg';

// Reads a video's frame rate from ffmpeg's stream description.
export function probeFps(file: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-i', file], { windowsHide: true });
    let err = '';
    proc.stderr.on('data', (d) => (err += d.toString()));
    proc.on('error', () => resolve(15));
    proc.on('close', () => {
      const line = err.split('\n').find((l) => l.includes('Video:')) ?? '';
      const m = /([\d.]+) fps/.exec(line) ?? /([\d.]+) tbr/.exec(line);
      const fps = m ? Number(m[1]) : NaN;
      resolve(Number.isFinite(fps) && fps >= 1 && fps <= 240 ? fps : 15);
    });
  });
}

// Port of trance's split_text_line(): splits text into two rows at the space
// closest to the middle.
export function splitTextLine(text: string): string {
  let l = Math.floor(text.length / 2);
  let r = l;
  for (;;) {
    if (text[r] === ' ') return text.slice(0, r) + '\n' + text.slice(r + 1);
    if (text[l] === ' ') return text.slice(0, l) + '\n' + text.slice(l + 1);
    if (l === 0 || r >= text.length - 1) break;
    --l;
    ++r;
  }
  return text;
}

export interface TextImportOptions {
  // Classic trance style: UPPERCASE and split each line into two rows.
  classic: boolean;
}

export async function readTextLines(file: string, opts: TextImportOptions): Promise<string[]> {
  const raw = await fs.readFile(file, 'utf8');
  const lines: string[] = [];
  for (let line of raw.split(/\r?\n/)) {
    line = line.replace(/\r/g, '').trim();
    if (!line) continue;
    if (opts.classic) line = splitTextLine(line.toUpperCase());
    lines.push(line);
  }
  return lines;
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
}

// Port of trance's search_resources(): each top-level subfolder becomes a
// theme; files directly in the root are "wildcards" shared by every theme
// (or become the only theme if there are no subfolders).
export async function scanFolder(root: string, opts: TextImportOptions): Promise<ScanResult> {
  const files: string[] = [];
  await walk(root, files);
  files.sort((a, b) => a.localeCompare(b));

  type T = { name: string; images: string[]; animations: string[]; fonts: string[]; texts: string[] };
  const WILDCARDS = '\0wildcards';
  const themes = new Map<string, T>();
  const audio: string[] = [];
  const get = (name: string) => {
    let t = themes.get(name);
    if (!t) themes.set(name, (t = { name, images: [], animations: [], fonts: [], texts: [] }));
    return t;
  };

  for (const file of files) {
    const rel = path.relative(root, file);
    const parts = rel.split(path.sep);
    const themeName = parts.length === 1 ? WILDCARDS : parts[0];
    const ext = extOf(file);
    if (AUDIO_EXTS.includes(ext)) audio.push(file);
    else if (FONT_EXTS.includes(ext)) get(themeName).fonts.push(file);
    else if (TEXT_EXTS.includes(ext)) get(themeName).texts.push(...(await readTextLines(file, opts)));
    else if (ANIMATION_EXTS.includes(ext)) get(themeName).animations.push(file);
    else if (IMAGE_EXTS.includes(ext)) get(themeName).images.push(file);
  }

  const wild = themes.get(WILDCARDS);
  themes.delete(WILDCARDS);
  if (wild) {
    if (themes.size === 0) {
      themes.set(path.basename(root), { ...wild, name: path.basename(root) || 'Default' });
    } else {
      for (const t of themes.values()) {
        t.images.push(...wild.images);
        t.animations.push(...wild.animations);
        t.fonts.push(...wild.fonts);
        t.texts.push(...wild.texts);
      }
    }
  }
  const list = [...themes.values()].filter(
    (t) => t.images.length || t.animations.length || t.texts.length || t.fonts.length,
  );
  return { root, themes: list, audio };
}

// Animation frame extraction

const CACHE_VERSION = 2;
// Longest animation (in frames) kept; the original streams forever, but very
// long clips would use unbounded disk space.
const MAX_FRAMES = 3000;

export class AnimationCache {
  private pending = new Map<string, Promise<AnimationInfo>>();
  private queue: (() => void)[] = [];
  private running = 0;

  constructor(private readonly cacheRoot: string) {}

  prepare(file: string): Promise<AnimationInfo> {
    let p = this.pending.get(file);
    if (!p) {
      p = this.doPrepare(file).finally(() => this.pending.delete(file));
      this.pending.set(file, p);
    }
    return p;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= 2) await new Promise<void>((r) => this.queue.push(r));
    ++this.running;
    try {
      return await fn();
    } finally {
      --this.running;
      this.queue.shift()?.();
    }
  }

  private async doPrepare(file: string): Promise<AnimationInfo> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return { frames: [], fps: 15 };
    }
    const key = createHash('sha1')
      .update(`${CACHE_VERSION}|${file}|${stat.size}|${stat.mtimeMs}`)
      .digest('hex')
      .slice(0, 20);
    const dir = path.join(this.cacheRoot, key);
    const manifest = path.join(dir, 'frames.json');
    const meta = path.join(dir, 'meta.json');
    const fpsFor = async () => {
      try {
        return JSON.parse(await fs.readFile(meta, 'utf8')).fps as number;
      } catch {
        const fps = await probeFps(file);
        await fs.writeFile(meta, JSON.stringify({ fps })).catch(() => {});
        return fps;
      }
    };
    try {
      const frames = JSON.parse(await fs.readFile(manifest, 'utf8')).map((f: string) => path.join(dir, f));
      return { frames, fps: await fpsFor() };
    } catch {
      // Not cached yet.
    }

    return this.slot(async () => {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(dir, { recursive: true });
      // GIFs keep transparency (PNG); video frames use JPEG.
      const isGif = extOf(file) === 'gif';
      const pattern = path.join(dir, isGif ? 'f%05d.png' : 'f%05d.jpg');
      try {
        await runFfmpeg([
          '-hide_banner', '-loglevel', 'error', '-y',
          '-i', file,
          // settb=1,setpts=N renumbers frames so files with duplicate or broken
          // timestamps still yield every decoded frame (like the original,
          // which ignored timing and played each frame in turn).
          '-vf', "scale=w='min(iw,1280)':h='min(ih,720)':force_original_aspect_ratio=decrease,settb=1,setpts=N",
          '-fps_mode', 'passthrough',
          '-frames:v', String(MAX_FRAMES),
          ...(isGif ? [] : ['-q:v', '3']),
          pattern,
        ]);
      } catch (e) {
        // Keep whatever was extracted before the error (e.g. a damaged tail).
        console.warn('frame extraction stopped early', file, e instanceof Error ? e.message : e);
      }
      const frames = (await fs.readdir(dir)).filter((f) => /^f\d+\.(png|jpg)$/.test(f)).sort();
      if (frames.length) await fs.writeFile(manifest, JSON.stringify(frames));
      return { frames: frames.map((f) => path.join(dir, f)), fps: await fpsFor() };
    });
  }
}

// Media browser listings

export interface MediaFile {
  path: string;
  name: string;
  kind: 'image' | 'animation';
}

export interface DirListing {
  dirs: { name: string; path: string }[];
  files: MediaFile[];
}

function mediaKind(name: string): MediaFile['kind'] | null {
  const ext = extOf(name);
  if (IMAGE_EXTS.includes(ext)) return 'image';
  if (ANIMATION_EXTS.includes(ext)) return 'animation';
  return null;
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export async function listDir(dir: string): Promise<DirListing> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const dirs: DirListing['dirs'] = [];
  const files: MediaFile[] = [];
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) dirs.push({ name: e.name, path: full });
    else if (e.isFile()) {
      const kind = mediaKind(e.name);
      if (kind) files.push({ path: full, name: e.name, kind });
    }
  }
  dirs.sort((a, b) => byName.compare(a.name, b.name));
  files.sort((a, b) => byName.compare(a.name, b.name));
  return { dirs, files };
}

// Every image and animation below `dir` (capped so a whole drive can't hang the app).
export async function listDirRecursive(dir: string, limit = 200_000): Promise<MediaFile[]> {
  const all: string[] = [];
  await walk(dir, all);
  const files: MediaFile[] = [];
  for (const full of all) {
    const name = path.basename(full);
    const kind = mediaKind(name);
    if (kind) files.push({ path: full, name, kind });
    if (files.length >= limit) break;
  }
  files.sort((a, b) => byName.compare(a.path, b.path));
  return files;
}

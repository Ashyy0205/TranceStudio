// On-demand, disk-cached thumbnails for the media browser. Served to the
// renderer through tthumb://local/<encoded path>. Generation uses ffmpeg so
// images, GIFs and videos all work the same on Windows and Linux.

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { ANIMATION_EXTS, extOf } from '../shared/types';
import { runFfmpeg } from './ffmpeg';

const VERSION = 1;
const SIZE = 320;
const CONCURRENCY = 4;

export class ThumbnailCache {
  private pending = new Map<string, Promise<string | null>>();
  // LIFO: the most recently requested (i.e. currently visible) items first.
  private stack: (() => void)[] = [];
  private running = 0;

  constructor(private readonly dir: string) {}

  get(file: string): Promise<string | null> {
    let p = this.pending.get(file);
    if (!p) {
      p = this.make(file).finally(() => this.pending.delete(file));
      this.pending.set(file, p);
    }
    return p;
  }

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running >= CONCURRENCY) await new Promise<void>((r) => this.stack.push(r));
    ++this.running;
    try {
      return await fn();
    } finally {
      --this.running;
      this.stack.pop()?.();
    }
  }

  private async make(file: string): Promise<string | null> {
    let stat;
    try {
      stat = await fs.stat(file);
    } catch {
      return null;
    }
    const key = createHash('sha1').update(`${VERSION}|${file}|${stat.size}|${stat.mtimeMs}`).digest('hex');
    const out = path.join(this.dir, key.slice(0, 2), `${key}.jpg`);
    try {
      await fs.access(out);
      return out;
    } catch {
      // Not cached yet.
    }
    return this.slot(async () => {
      await fs.mkdir(path.dirname(out), { recursive: true });
      const scale = `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`;
      const args = (seek: boolean) => [
        '-hide_banner', '-loglevel', 'error', '-y',
        ...(seek ? ['-ss', '1'] : []),
        '-i', file,
        '-frames:v', '1',
        '-vf', scale,
        '-q:v', '5',
        out,
      ];
      const isVideo = ANIMATION_EXTS.includes(extOf(file)) && extOf(file) !== 'gif';
      try {
        // Videos: a frame one second in is usually more representative.
        await runFfmpeg(args(isVideo));
        await fs.access(out);
        return out;
      } catch {
        if (!isVideo) return null;
      }
      try {
        await runFfmpeg(args(false));
        await fs.access(out);
        return out;
      } catch {
        return null;
      }
    });
  }
}

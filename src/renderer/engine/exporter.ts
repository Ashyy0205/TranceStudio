// Renders a session frame-by-frame with the same player used for preview and
// streams the frames to ffmpeg (main process) for encoding.

import { type AnimationInfo, resolveAudio, type Session, sessionDuration } from '../../shared/types';
import { SessionPlayer } from './player';

export interface ExportProgress {
  frame: number;
  totalFrames: number;
  elapsedSeconds: number;
  etaSeconds: number;
  // Time spent per stage so far (ms): rendering, GPU readback, handing to ffmpeg.
  stages: { render: number; read: number; write: number };
}

export interface ExportOptions {
  path: string;
  width: number;
  height: number;
  fps: number;
  quality: Session['export']['quality'];
  hardware?: boolean; // use a GPU encoder when available
  duration?: number; // defaults to the session length
  seed?: number;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
}

export async function collectAnimationFrames(session: Session): Promise<Map<string, AnimationInfo>> {
  const paths = [...new Set(session.themes.flatMap((t) => t.animations))];
  if (!paths.length) return new Map();
  const result = await window.trance.prepareAnimations(paths);
  return new Map(Object.entries(result));
}

export async function exportSession(session: Session, opts: ExportOptions): Promise<void> {
  const width = opts.width - (opts.width % 2);
  const height = opts.height - (opts.height % 2);
  const duration = opts.duration ?? sessionDuration(session);
  const totalFrames = Math.max(1, Math.round(duration * opts.fps));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const frames = await collectAnimationFrames(session);
  const player = await SessionPlayer.create(canvas, session, {
    mode: 'export',
    animationFrames: frames,
    seed: opts.seed,
    audio: false,
  });

  const pixelFormat = player.exportPixelFormat();
  await window.trance.exportBegin({
    pixelFormat,
    hardware: opts.hardware ?? true,
    path: opts.path,
    width,
    height,
    fps: opts.fps,
    duration,
    quality: opts.quality,
    audio: resolveAudio(session),
  });

  const start = performance.now();
  const stages = { render: 0, read: 0, write: 0 };
  const frameBytes = pixelFormat === 'yuv420p' ? (width * height * 3) / 2 : width * height * 4;
  // Two buffers so the next frame renders while the last is being encoded.
  const buffers = [new Uint8Array(frameBytes), new Uint8Array(frameBytes)];
  const inflight: Promise<void>[] = [];
  try {
    for (let frame = 0; frame < totalFrames; ++frame) {
      if (opts.signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t0 = performance.now();
      await player.exportFrame(opts.fps);
      const t1 = performance.now();
      const buffer = buffers[frame % 2];
      player.readFrame(buffer);
      const t2 = performance.now();
      const sent = window.trance.exportFrame(buffer);
      sent.catch(() => {});
      inflight.push(sent);
      if (inflight.length >= 2) await inflight.shift();
      const t3 = performance.now();
      stages.render += t1 - t0;
      stages.read += t2 - t1;
      stages.write += t3 - t2;
      if (opts.onProgress && (frame % 4 === 0 || frame === totalFrames - 1)) {
        const elapsed = (performance.now() - start) / 1000;
        const done = frame + 1;
        opts.onProgress({
          frame: done,
          totalFrames,
          elapsedSeconds: elapsed,
          etaSeconds: (elapsed / done) * (totalFrames - done),
          stages,
        });
      }
    }
    await Promise.all(inflight);
    await window.trance.exportFinish();
  } catch (e) {
    await window.trance.exportCancel();
    throw e;
  } finally {
    player.dispose();
  }
}

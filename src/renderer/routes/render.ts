// Headless command-line render (--render). Loads a session file and exports it.

import { normalizeSession } from '../session';
import { exportSession } from '../engine/exporter';

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

export async function runRenderRoute(): Promise<void> {
  const api = window.trance;
  try {
    const req = await api.renderRequest();
    if (!req) throw new Error('no render request');
    const session = normalizeSession(await api.loadSession(req.session));
    let last = -1;
    await exportSession(session, {
      path: req.out,
      width: req.width ?? session.export.width,
      height: req.height ?? session.export.height,
      fps: req.fps ?? session.export.fps,
      quality: (req.quality as 'high' | 'medium' | 'fast') ?? session.export.quality,
      duration: req.seconds,
      seed: req.seed,
      hardware: !req.software,
      onProgress: (p) => {
        const pct = Math.floor((100 * p.frame) / p.totalFrames);
        if (pct !== last) {
          last = pct;
          api.renderProgress(
            `frame ${p.frame}/${p.totalFrames} [${pct}%] elapsed ${fmt(p.elapsedSeconds)} eta ${fmt(p.etaSeconds)} ` +
              `(ms/frame: render ${(p.stages.render / p.frame).toFixed(1)}, read ${(p.stages.read / p.frame).toFixed(1)}, write ${(p.stages.write / p.frame).toFixed(1)})`,
          );
        }
      },
    });
    api.renderDone(null);
  } catch (e) {
    api.renderDone(e instanceof Error ? e.stack ?? e.message : String(e));
  }
}

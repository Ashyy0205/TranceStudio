// Diagnostic log: <userData>/logs/trance-studio.log. Records renderer errors,
// GPU/renderer process crashes and graphics context resets so problems on a
// user's machine can be investigated after the fact.

import { app, type WebContents } from 'electron';
import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import * as path from 'node:path';

const MAX_BYTES = 5 * 1024 * 1024;
let file: string | null = null;

export function logPath(): string {
  if (!file) {
    const dir = path.join(app.getPath('userData'), 'logs');
    mkdirSync(dir, { recursive: true });
    file = path.join(dir, 'trance-studio.log');
  }
  return file;
}

export function log(message: string): void {
  try {
    const f = logPath();
    try {
      if (statSync(f).size > MAX_BYTES) renameSync(f, f + '.old');
    } catch {
      // No log yet.
    }
    appendFileSync(f, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Logging must never break the app.
  }
}

export function watchContents(wc: WebContents, label: string): void {
  wc.on('console-message', (e) => {
    if (e.message.startsWith('Electron Security Warning')) return; // dev-server only
    if (e.level === 'warning' || e.level === 'error') log(`[${label} ${e.level}] ${e.message}`);
  });
  wc.on('render-process-gone', (_e, d) => log(`[${label}] renderer process gone: ${d.reason} (exit ${d.exitCode})`));
}

export function startLogging(): void {
  log(`--- start: Trance Studio ${app.getVersion()}, Electron ${process.versions.electron}, ${process.platform} ${process.arch}`);
  app.on('child-process-gone', (_e, d) => log(`child process gone: ${d.type} ${d.reason} (exit ${d.exitCode})${d.name ? ' ' + d.name : ''}`));
  app.on('gpu-info-update', () => {});
  // 'complete' waits for the GPU process, so the feature status is accurate.
  void app
    .getGPUInfo('complete')
    .then((info) => {
      const gpu = info as {
        gpuDevice?: { deviceString?: string; active: boolean; driverVersion?: string }[];
        auxAttributes?: { glRenderer?: string };
      };
      const active = (gpu.gpuDevice ?? []).find((d) => d.active);
      log(`gpu: ${active?.deviceString ?? 'unknown'} driver ${active?.driverVersion ?? '?'}; renderer ${gpu.auxAttributes?.glRenderer ?? '?'}`);
      const status = app.getGPUFeatureStatus() as unknown as Record<string, string>;
      log(`gpu features: webgl ${status.webgl}, compositing ${status.gpu_compositing}, rasterization ${status.rasterization}`);
    })
    .catch(() => {});
}

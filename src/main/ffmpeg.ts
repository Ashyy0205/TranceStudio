import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

let cached: string | null = null;

// Prefers the FFmpeg program installed by the ffmpeg-static package, falling
// back to ffmpeg on PATH. The binary is located directly rather than through
// the package's own code: FFmpeg is GPL and only ever runs as a separate
// program. In packaged builds it sits outside the app archive.
export function ffmpegPath(): string {
  if (cached) return cached;
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const p = path.join(__dirname, '..', '..', 'node_modules', 'ffmpeg-static', exe).replace('app.asar', 'app.asar.unpacked');
  return (cached = existsSync(p) ? p : 'ffmpeg');
}

// Finds a GPU H.264 encoder that actually works here (being compiled in isn't
// enough: it also needs the matching GPU and driver). Checked once.
let hardware: Promise<string | null> | null = null;
export function hardwareEncoder(): Promise<string | null> {
  hardware ??= (async () => {
    for (const enc of ['h264_nvenc', 'h264_amf', 'h264_qsv']) {
      try {
        await runFfmpeg([
          '-hide_banner', '-loglevel', 'error',
          '-f', 'lavfi', '-i', 'color=c=black:s=256x256:d=0.2',
          '-frames:v', '2', '-c:v', enc, '-f', 'null', '-',
        ]);
        return enc;
      } catch {
        // Not usable on this machine.
      }
    }
    return null;
  })();
  return hardware;
}

export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

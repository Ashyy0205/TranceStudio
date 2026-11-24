// Video export: the renderer streams raw RGBA frames; ffmpeg encodes H.264
// and mixes the timeline's audio clips into the same MP4.

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import type { ResolvedClip } from '../shared/types';
import { ffmpegPath } from './ffmpeg';

// Encoder arguments per quality setting.
function videoArgs(encoder: string, quality: ExportJob['quality']): string[] {
  const pick = <T>(high: T, medium: T, fast: T) => (quality === 'high' ? high : quality === 'medium' ? medium : fast);
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', pick('p7', 'p5', 'p3'), '-tune', 'hq', '-rc', 'vbr', '-cq', pick('18', '21', '24'), '-b:v', '0'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', pick('quality', 'balanced', 'speed'), '-rc', 'cqp', '-qp_i', pick('18', '21', '24'), '-qp_p', pick('20', '23', '26')];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', pick('slow', 'medium', 'veryfast'), '-global_quality', pick('18', '21', '24')];
    default:
      return ['-c:v', 'libx264', '-preset', pick('slow', 'medium', 'veryfast'), '-crf', pick('17', '20', '23')];
  }
}

export interface ExportJob {
  path: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  quality: 'high' | 'medium' | 'fast';
  audio: ResolvedClip[];
  pixelFormat: 'yuv420p' | 'rgba';
  encoder: string; // libx264 or a detected GPU encoder
}

function audioArgs(job: ExportJob): { inputs: string[]; filters: string[]; label: string | null } {
  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  let input = 1;
  for (const clip of job.audio) {
    const end = Math.min(job.duration, clip.end);
    const len = end - clip.start;
    if (len <= 0 || clip.start >= job.duration) continue;
    inputs.push('-i', clip.path);
    const chain = [`atrim=0:${len.toFixed(3)}`, 'asetpts=PTS-STARTPTS', `volume=${clip.volume.toFixed(3)}`];
    if (clip.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${Math.min(clip.fadeIn, len).toFixed(3)}`);
    if (clip.fadeOut > 0) {
      const d = Math.min(clip.fadeOut, len);
      chain.push(`afade=t=out:st=${(len - d).toFixed(3)}:d=${d.toFixed(3)}`);
    }
    const delay = Math.round(clip.start * 1000);
    if (delay > 0) chain.push(`adelay=${delay}:all=1`);
    const label = `a${labels.length}`;
    filters.push(`[${input}:a]${chain.join(',')}[${label}]`);
    labels.push(label);
    ++input;
  }
  if (!labels.length) return { inputs, filters, label: null };
  if (labels.length === 1) {
    filters.push(`[${labels[0]}]anull[aout]`);
  } else {
    filters.push(`${labels.map((l) => `[${l}]`).join('')}amix=inputs=${labels.length}:normalize=0:duration=longest[aout]`);
  }
  return { inputs, filters, label: 'aout' };
}

export class Exporter {
  private proc: ChildProcessWithoutNullStreams;
  private stderr = '';
  private failed: Error | null = null;
  private done: Promise<void>;
  private cancelled = false;

  constructor(private readonly job: ExportJob) {
    const audio = audioArgs(job);
    // GPU-converted I420 frames need no filtering; RGBA frames are bottom-up.
    const video =
      job.pixelFormat === 'yuv420p'
        ? '[0:v]null[v]'
        : '[0:v]vflip,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]';
    const filters = [video, ...audio.filters];
    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', job.pixelFormat, '-s', `${job.width}x${job.height}`, '-r', String(job.fps),
      '-i', 'pipe:0',
      ...audio.inputs,
      '-filter_complex', filters.join(';'),
      '-map', '[v]',
      ...(audio.label ? ['-map', `[${audio.label}]`, '-c:a', 'aac', '-b:a', '192k'] : []),
      ...videoArgs(job.encoder, job.quality),
      '-pix_fmt', 'yuv420p',
      '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-movflags', '+faststart',
      '-t', job.duration.toFixed(3),
      job.path,
    ];
    this.proc = spawn(ffmpegPath(), args, { windowsHide: true });
    this.proc.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.proc.stdin.on('error', (e) => {
      this.failed ??= e;
    });
    this.done = new Promise((resolve, reject) => {
      this.proc.on('error', (e) => {
        this.failed ??= e;
        reject(e);
      });
      this.proc.on('close', (code) => {
        if (code === 0 || this.cancelled) resolve();
        else {
          this.failed ??= new Error(`ffmpeg exited with code ${code}: ${this.stderr.trim()}`);
          reject(this.failed);
        }
      });
    });
    this.done.catch(() => {});
  }

  async writeFrame(data: Uint8Array): Promise<void> {
    if (this.failed) throw this.failed;
    const expected = (this.job.width * this.job.height * (this.job.pixelFormat === 'yuv420p' ? 3 : 8)) / 2;
    if (data.byteLength !== expected) throw new Error(`bad frame size ${data.byteLength}, expected ${expected}`);
    if (!this.proc.stdin.write(data)) {
      await new Promise<void>((resolve) => this.proc.stdin.once('drain', resolve));
    }
    if (this.failed) throw this.failed;
  }

  async finish(): Promise<void> {
    this.proc.stdin.end();
    await this.done;
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.proc.stdin.destroy();
    this.proc.kill();
    await this.done.catch(() => {});
    await fs.rm(this.job.path, { force: true });
  }
}

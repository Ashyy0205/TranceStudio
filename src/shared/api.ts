import type { AnimationInfo, ExportSettings, ResolvedClip, ScanResult, Session } from './types';

export type FileKind = 'images' | 'animations' | 'media' | 'fonts' | 'audio' | 'text' | 'session';

export interface ExportJobRequest {
  path: string;
  // Frames arrive as GPU-converted I420, or RGBA for unusual sizes.
  pixelFormat: 'yuv420p' | 'rgba';
  // Use a GPU encoder (NVENC / AMF / Quick Sync) when one works.
  hardware: boolean;
  width: number;
  height: number;
  fps: number;
  duration: number;
  quality: ExportSettings['quality'];
  audio: ResolvedClip[];
}

// API exposed by the preload script as window.trance.
export interface TranceApi {
  platform: string;
  openFolder(): Promise<string | null>;
  openFiles(kind: FileKind, multiple?: boolean): Promise<string[]>;
  saveSessionDialog(defaultName: string): Promise<string | null>;
  saveVideoDialog(defaultName: string): Promise<string | null>;
  scanFolder(root: string, classic: boolean): Promise<ScanResult>;
  readTextFile(path: string, classic: boolean): Promise<string[]>;
  loadSession(path: string): Promise<Session>;
  saveSession(path: string, session: Session): Promise<void>;
  prepareAnimations(paths: string[]): Promise<Record<string, AnimationInfo>>;
  listDir(dir: string): Promise<DirListing>;
  listDirRecursive(dir: string): Promise<MediaFile[]>;
  exportBegin(job: ExportJobRequest): Promise<{ encoder: string }>;
  // The GPU encoder ffmpeg can use on this machine, if any.
  hardwareEncoder(): Promise<string | null>;
  exportFrame(data: Uint8Array): Promise<void>;
  exportFinish(): Promise<void>;
  exportCancel(): Promise<void>;
  showItem(path: string): void;
  // Appends a line to the diagnostic log.
  log(message: string): void;
  logPath(): Promise<string>;
  pathForFile(file: File): string;
  // A session file passed on the command line, if any.
  initialFile(): Promise<string | null>;
  // Command-line rendering (--render).
  renderRequest(): Promise<RenderRequest | null>;
  renderProgress(line: string): void;
  renderDone(error: string | null): void;
}

export interface RenderRequest {
  session: string;
  out: string;
  seconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  quality?: string;
  seed?: number;
  software?: boolean; // force x264 instead of a GPU encoder
}

export interface MediaFile {
  path: string;
  name: string;
  kind: 'image' | 'animation';
}

export interface DirListing {
  dirs: { name: string; path: string }[];
  files: MediaFile[];
}

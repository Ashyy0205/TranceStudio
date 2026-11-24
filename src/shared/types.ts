// Session data model. Concepts map onto the original trance tool:
//   Theme   -> trance_pb::Theme (images, animations, fonts, text)
//   Program -> trance_pb::Program, called a "look" in the UI (visual weights,
//              colours, speed). Unlike the original, looks don't choose themes.
//   Look blocks  -> a linear trance_pb playlist (each block plays a program for N seconds)
//   Theme blocks -> a separate, freely-placed row choosing which theme is on
//                   screen. Where no theme block is playing, all themes are used.
//   Audio clips  -> AudioEvents, placed on channels on an absolute timeline.
//                   Clips always play their full length and may overlap.
// No row dictates another's length: the session lasts until the last thing
// on any row ends (the last look keeps playing to the end if it's shorter).

export interface Colour {
  r: number; // 0..1
  g: number;
  b: number;
  a: number;
}

export const VISUAL_TYPES = [
  'ACCELERATE',
  'SLOW_FLASH',
  'SUB_TEXT',
  'FLASH_TEXT',
  'PARALLEL',
  'SUPER_PARALLEL',
  'ANIMATION',
  'SUPER_FAST',
] as const;
export type VisualType = (typeof VISUAL_TYPES)[number];

export const VISUAL_INFO: Record<VisualType, { label: string; description: string }> = {
  ACCELERATE: { label: 'Accelerate', description: 'Image changes speed up over time, with overlaid text.' },
  SLOW_FLASH: {
    label: 'Slow flash',
    description: 'Alternates slow images and videos with rapid-fire images.',
  },
  SUB_TEXT: { label: 'Subtext', description: 'Subtle walls of text behind changing images.' },
  FLASH_TEXT: { label: 'Flash text', description: 'Smooth fades between images, videos and text.' },
  PARALLEL: { label: 'Simple', description: 'Steady images with overlaid text.' },
  SUPER_PARALLEL: { label: 'Triple', description: 'Three images or videos layered at once.' },
  ANIMATION: { label: 'Video', description: 'Videos with overlaid text.' },
  SUPER_FAST: { label: 'Super fast', description: 'Rapid images and text spliced with brief video clips.' },
};

export interface Theme {
  id: string;
  name: string;
  images: string[]; // absolute paths
  animations: string[]; // absolute paths (gif, webm, mp4, ...)
  fonts: string[]; // absolute paths (ttf, otf, woff, woff2)
  texts: string[]; // lines; '\n' splits a line into rows
}

// A theme enabled for playback, with trance's selection weight and pinning.
export interface ProgramTheme {
  themeId: string;
  weight: number;
  pinned: boolean;
}

export interface Program {
  id: string;
  name: string;
  visuals: Record<VisualType, number>; // random weights
  speed: number; // ticks per second (original "global fps"), default 120
  zoomIntensity: number; // 0..1
  spiralColourA: Colour;
  spiralColourB: Colour;
  reverseSpiral: boolean;
  textColour: Colour;
  shadowColour: Colour;
}

export interface Block {
  id: string;
  programId: string;
  duration: number; // seconds
}

// Theme blocks sit anywhere on their own row, independent of the looks, so a
// theme can start or end partway through a look. Gaps are allowed.
export interface ThemeBlock {
  id: string;
  themeId: string;
  start: number; // seconds
  duration: number; // seconds
}

export interface AudioChannel {
  id: string;
  name: string;
  volume: number; // 0..2
  muted: boolean;
}

export interface AudioClip {
  id: string;
  path: string;
  channel: number; // index into Session.audioChannels
  start: number; // seconds on the timeline
  duration: number; // seconds of source audio (cached on import)
  volume: number; // 0..2
  fadeIn: number; // seconds
  fadeOut: number; // seconds
}

export interface PlaybackSettings {
  imageCacheSize: number;
  animationBufferSize: number;
  drawDepth: number; // 0..1
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  quality: 'high' | 'medium' | 'fast';
  path: string;
  hardware: boolean; // GPU encoding when available
}

export interface Session {
  version: 1;
  name: string;
  themes: Theme[];
  programs: Program[];
  blocks: Block[];
  themeBlocks: ThemeBlock[];
  audioChannels: AudioChannel[];
  audio: AudioClip[];
  playback: PlaybackSettings;
  export: ExportSettings;
}

export function colour(r: number, g: number, b: number, a: number): Colour {
  return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Same defaults as trance's set_default_program().
export function defaultProgram(name = 'Default'): Program {
  const visuals = {} as Record<VisualType, number>;
  for (const v of VISUAL_TYPES) visuals[v] = 1;
  return {
    id: newId(),
    name,
    visuals,
    speed: 120,
    zoomIntensity: 0.5,
    spiralColourA: colour(255, 150, 200, 50),
    spiralColourB: colour(0, 0, 0, 50),
    reverseSpiral: false,
    textColour: colour(255, 150, 200, 224),
    shadowColour: colour(0, 0, 0, 192),
  };
}

export function defaultSession(): Session {
  const program = defaultProgram();
  return {
    version: 1,
    name: 'Untitled session',
    themes: [],
    programs: [program],
    blocks: [{ id: newId(), programId: program.id, duration: 300 }],
    themeBlocks: [],
    audioChannels: defaultAudioChannels(),
    audio: [],
    playback: { imageCacheSize: 64, animationBufferSize: 32, drawDepth: 0.5 },
    export: { width: 1920, height: 1080, fps: 30, quality: 'medium', path: '', hardware: true },
  };
}

export function defaultAudioChannels(): AudioChannel[] {
  return [
    { id: newId(), name: 'Foreground', volume: 1, muted: false },
    { id: newId(), name: 'Background', volume: 1, muted: false },
  ];
}

// A copy of a look with a new id (e.g. for a duplicated block).
export function cloneProgram(p: Program, name = p.name): Program {
  return { ...JSON.parse(JSON.stringify(p)), id: newId(), name };
}

// Each look block owns its look: blocks never share one, and looks that are
// no longer on the timeline are removed. Returns true if anything changed.
export function ownLooks(s: Session): boolean {
  let changed = false;
  const used = new Set<string>();
  for (const b of s.blocks) {
    const p = s.programs.find((x) => x.id === b.programId);
    if (!p) {
      const fresh = defaultProgram('Look');
      s.programs.push(fresh);
      b.programId = fresh.id;
      changed = true;
    } else if (used.has(p.id)) {
      const copy = cloneProgram(p);
      s.programs.push(copy);
      b.programId = copy.id;
      changed = true;
    }
    used.add(b.programId);
  }
  const before = s.programs.length;
  s.programs = s.programs.filter((p) => used.has(p.id));
  return changed || s.programs.length !== before;
}

// Whether ownLooks() has anything to do (cheap check run after every edit).
export function looksNeedTidy(s: Session): boolean {
  const ids = new Set(s.blocks.map((b) => b.programId));
  return ids.size !== s.blocks.length || s.programs.length !== ids.size || s.blocks.some((b) => !s.programs.some((p) => p.id === b.programId));
}

// Length of the looks row.
export function looksDuration(s: Session): number {
  return s.blocks.reduce((t, b) => t + b.duration, 0);
}

// The whole session: until the last look, theme block or audio clip ends.
export function sessionDuration(s: Session): number {
  let end = looksDuration(s);
  for (const b of s.themeBlocks) end = Math.max(end, b.start + b.duration);
  for (const a of s.audio) end = Math.max(end, a.start + a.duration);
  return end;
}

// Index of the block (looks or themes track) playing at `seconds`, or -1.
export function blockIndexAt(blocks: { duration: number }[], seconds: number): number {
  let t = 0;
  for (let i = 0; i < blocks.length; ++i) {
    t += blocks[i].duration;
    if (seconds < t) return i;
  }
  return -1;
}

// Themes in play at `seconds`: the theme block there, or every theme if none.
export function themeBlockAt(s: Session, seconds: number): ThemeBlock | null {
  let found: ThemeBlock | null = null;
  for (const b of s.themeBlocks) {
    if (seconds >= b.start && seconds < b.start + b.duration && (!found || b.start >= found.start)) found = b;
  }
  return found;
}

export function activeThemes(s: Session, seconds: number): ProgramTheme[] {
  const block = themeBlockAt(s, seconds);
  if (block) return [{ themeId: block.themeId, weight: 1, pinned: false }];
  return s.themes.map((t) => ({ themeId: t.id, weight: 1, pinned: false }));
}

// An audio clip with its final timing and gain worked out, as played/exported.
export interface ResolvedClip {
  id: string;
  path: string;
  start: number;
  end: number; // session time where it stops
  sourceDuration: number;
  volume: number; // clip volume x channel volume
  fadeIn: number;
  fadeOut: number;
}

// Every clip on an unmuted channel, playing its full length. Clips on the same
// channel may overlap; they're mixed together.
export function resolveAudio(s: Session): ResolvedClip[] {
  const out: ResolvedClip[] = [];
  s.audioChannels.forEach((channel, ci) => {
    if (channel.muted) return;
    for (const a of s.audio.filter((x) => x.channel === ci)) {
      const end = a.start + a.duration;
      if (end <= a.start) continue;
      out.push({
        id: a.id,
        path: a.path,
        start: a.start,
        end,
        sourceDuration: a.duration,
        volume: a.volume * channel.volume,
        fadeIn: a.fadeIn,
        fadeOut: a.fadeOut,
      });
    }
  });
  return out;
}

// Media classification shared by the folder scanner.
export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'avif'];
export const ANIMATION_EXTS = ['gif', 'webm', 'mp4', 'mov', 'mkv', 'm4v'];
export const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];
export const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'opus', 'aiff'];
export const TEXT_EXTS = ['txt'];

export function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i < 0 ? '' : path.slice(i + 1).toLowerCase();
}

// Result of scanning a media folder (mirrors trance's search_resources()).
export interface ScanResult {
  root: string;
  themes: { name: string; images: string[]; animations: string[]; fonts: string[]; texts: string[] }[];
  audio: string[];
}

// Frames extracted from an animation file, ready for playback.
export interface AnimationInfo {
  frames: string[]; // absolute paths of extracted frame images
  fps: number; // the file's own frame rate
}

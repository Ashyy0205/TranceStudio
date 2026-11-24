import {
  ownLooks,
  defaultSession,
  newId,
  type Program,
  type Session,
  VISUAL_TYPES,
  defaultProgram,
} from '../shared/types';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));

// Fills in missing fields and clamps values, like trance's validate_session().
export function normalizeSession(raw: Partial<Session>): Session {
  const base = defaultSession();
  const s: Session = {
    ...base,
    ...raw,
    playback: { ...base.playback, ...(raw.playback ?? {}) },
    export: { ...base.export, ...(raw.export ?? {}) },
    themes: (raw.themes ?? []).map((t) => ({
      id: t.id || newId(),
      name: t.name || 'Theme',
      images: t.images ?? [],
      animations: t.animations ?? [],
      fonts: t.fonts ?? [],
      texts: t.texts ?? [],
    })),
    programs: [],
    blocks: [],
    themeBlocks: [],
    audioChannels: (raw.audioChannels?.length ? raw.audioChannels : base.audioChannels).map((c, i) => ({
      id: c.id || newId(),
      name: c.name || `Channel ${i + 1}`,
      volume: clamp(c.volume ?? 1, 0, 2),
      muted: !!c.muted,
    })),
    audio: (raw.audio ?? []).map((a) => ({
      ...a,
      id: a.id || newId(),
      volume: clamp(a.volume ?? 1, 0, 2),
      fadeIn: Math.max(0, a.fadeIn ?? 0),
      fadeOut: Math.max(0, a.fadeOut ?? 0),
      start: Math.max(0, a.start ?? 0),
      duration: Math.max(0, a.duration ?? 0),
      channel: Math.max(0, Math.floor(a.channel ?? 0)),
    })),
  };
  // Older sessions had a single audio track.
  while (s.audioChannels.length < 2) s.audioChannels.push({ id: newId(), name: 'Background', volume: 1, muted: false });
  // The default channels used to be called Voice and Music.
  if (s.audioChannels[0].name === 'Voice') s.audioChannels[0].name = 'Foreground';
  if (s.audioChannels[1].name === 'Music') s.audioChannels[1].name = 'Background';
  // Clips no longer loop (a clip's length is always its file's length).
  for (const a of s.audio) delete (a as unknown as { loop?: unknown }).loop;
  for (const a of s.audio) a.channel = Math.min(a.channel, s.audioChannels.length - 1);
  const themeIds = new Set(s.themes.map((t) => t.id));
  s.programs = (raw.programs ?? base.programs).map((p) => normalizeProgram(p, themeIds));
  s.blocks = (raw.blocks ?? base.blocks).map((b) => ({
    id: b.id || newId(),
    programId: b.programId,
    duration: clamp(b.duration, 1, 24 * 3600),
  }));
  // The looks row may be empty; every block gets its own look.
  ownLooks(s);
  let cursor = 0;
  s.themeBlocks = (raw.themeBlocks ?? [])
    .filter((b) => themeIds.has(b.themeId))
    .map((b) => {
      const duration = clamp(b.duration, 1, 24 * 3600);
      // Blocks saved without a start were laid end to end.
      const start = Number.isFinite(b.start) ? Math.max(0, b.start) : cursor;
      cursor = start + duration;
      return { id: b.id || newId(), themeId: b.themeId, start, duration };
    });
  s.playback.imageCacheSize = clamp(s.playback.imageCacheSize, 16, 512);
  s.playback.animationBufferSize = clamp(s.playback.animationBufferSize, 8, 128);
  s.playback.drawDepth = clamp(s.playback.drawDepth, 0, 1);
  // Sessions saved while animation speed was a setting.
  delete (s.playback as unknown as { animationRate?: unknown }).animationRate;
  return s;
}

export function normalizeProgram(p: Partial<Program> & { themes?: unknown }, _themeIds?: Set<string>): Program {
  const d = defaultProgram(p.name ?? 'Look');
  const visuals = { ...d.visuals };
  for (const v of VISUAL_TYPES) visuals[v] = Math.max(0, Math.round(p.visuals?.[v] ?? d.visuals[v]));
  if (!VISUAL_TYPES.some((v) => visuals[v] > 0)) for (const v of VISUAL_TYPES) visuals[v] = 1;
  // Older sessions stored theme weights on looks; themes now live on the timeline.
  const { themes: _legacyThemes, ...rest } = p;
  return {
    ...d,
    ...rest,
    id: p.id || newId(),
    name: p.name || 'Look',
    visuals,
    speed: clamp(p.speed ?? 120, 1, 240),
    zoomIntensity: clamp(p.zoomIntensity ?? 0.5, 0, 1),
  } as Program;
}

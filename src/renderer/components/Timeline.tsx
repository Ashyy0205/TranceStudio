import { useEffect, useRef, useState } from 'react';
import {
  AUDIO_EXTS,
  cloneProgram,
  defaultProgram,
  extOf,
  looksDuration,
  newId,
  resolveAudio,
  type Session,
  sessionDuration,
} from '../../shared/types';
import { probeAudioDuration } from '../engine/audio';
import { thumbUrl } from '../engine/media';
import { lookColour, themeColour } from '../presets';
import { useStudio } from '../store';
import { basename, formatTime, formatTimecode } from '../util';
import { colourToCss, HelpButton } from './controls';
import { Icon } from './Icon';
import { readDropPaths } from './Library';
import { preview, usePlayback } from './Preview';

const TRACK_LABEL_W = 156;
const SNAP_PX = 8;
// Length of a theme block dropped after the last look.
const DEFAULT_THEME_BLOCK = 300;
// Height of one lane in an audio channel.
const LANE_H = 40;

// Drag type for dragging a theme from the Themes panel onto the timeline.
export const THEME_MIME = 'application/x-trance-theme';

function tickStep(pps: number): number {
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  return steps.find((s) => s * pps >= 70) ?? 3600;
}

// Adds audio files to a channel, at `at` seconds or after the channel's last clip.
export async function addAudioFiles(paths: string[], at?: number, channel = 0): Promise<void> {
  const files = paths.filter((p) => AUDIO_EXTS.includes(extOf(p)));
  if (!files.length) return;
  const durations = await Promise.all(files.map((p) => probeAudioDuration(p)));
  const { edit, select } = useStudio.getState();
  let firstId = '';
  edit((s) => {
    const ch = Math.min(channel, s.audioChannels.length - 1);
    let start = at ?? s.audio.filter((a) => a.channel === ch).reduce((t, a) => Math.max(t, a.start + a.duration), 0);
    files.forEach((path, i) => {
      const id = newId();
      firstId ||= id;
      s.audio.push({ id, path, channel: ch, start, duration: durations[i], volume: 1, fadeIn: 0, fadeOut: 2 });
      start += durations[i];
    });
  });
  select({ kind: 'audio', id: firstId });
}

// Places a theme block dropped at `at` seconds. It lines up with the look block
// there: it starts where that look starts (or where the free space starts, if
// another theme block is in the way) and runs to the end of that look. Past the
// last look it starts at the drop point.
export function addThemeBlock(themeId: string, at: number): void {
  const { edit, select, session } = useStudio.getState();
  if (!session) return;
  const others = [...session.themeBlocks].sort((a, b) => a.start - b.start);
  let t = Math.max(0, at);
  // Dropped onto an existing block: go after it.
  const hit = others.find((b) => t >= b.start && t < b.start + b.duration);
  if (hit) t = hit.start + hit.duration;
  const gapStart = Math.max(0, ...others.filter((b) => b.start + b.duration <= t).map((b) => b.start + b.duration));
  const next = others.find((b) => b.start >= t);
  let look: { start: number; end: number } | null = null;
  let lookStart = 0;
  for (const b of session.blocks) {
    if (t < lookStart + b.duration) {
      look = { start: lookStart, end: lookStart + b.duration };
      break;
    }
    lookStart += b.duration;
  }
  const start = Math.round(Math.max(gapStart, look ? look.start : t) * 10) / 10;
  const end = Math.min(look ? look.end : start + DEFAULT_THEME_BLOCK, next ? next.start : Infinity);
  const duration = Math.round((end - start) * 10) / 10;
  if (duration < 1) {
    useStudio.getState().notify('No free space there on the themes row');
    return;
  }
  const id = newId();
  edit((s) => void s.themeBlocks.push({ id, themeId, start, duration }));
  select({ kind: 'themeBlock', id });
}

// Lays every theme out end to end across the session.
function layOutThemes(): void {
  const { edit, session } = useStudio.getState();
  if (!session?.themes.length) return;
  const total = sessionDuration(session);
  const n = session.themes.length;
  edit((s) => {
    let at = 0;
    s.themeBlocks = s.themes.map((t, i) => {
      const duration = Math.max(1, Math.floor(total / n) + (i < total % n ? 1 : 0));
      const b = { id: newId(), themeId: t.id, start: at, duration };
      at += duration;
      return b;
    });
  });
}

// Edges that dragged items snap to.
function snapPoints(s: Session, excludeId: string, playhead: number): number[] {
  const pts = [0, playhead];
  let t = 0;
  for (const b of s.blocks) pts.push((t += b.duration));
  for (const b of s.themeBlocks) if (b.id !== excludeId) pts.push(b.start, b.start + b.duration);
  for (const a of s.audio) if (a.id !== excludeId) pts.push(a.start, a.start + a.duration);
  return pts;
}

function snap(t: number, pts: number[], pps: number, enabled: boolean): number {
  if (!enabled) return t;
  let best = t;
  let dist = SNAP_PX / pps;
  for (const p of pts) {
    const d = Math.abs(p - t);
    if (d < dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}

function Playhead({ pps }: { pps: number }) {
  const time = usePlayback((s) => s.time);
  return <div className="playhead" style={{ left: TRACK_LABEL_W + time * pps }} />;
}

// Runs a pointer drag until release.
function track(onMove: (ev: PointerEvent) => void): void {
  const up = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', up);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', up);
}

export function Timeline() {
  const session = useStudio((s) => s.session)!;
  const selection = useStudio((s) => s.selection);
  const { edit, select } = useStudio.getState();
  const scrollRef = useRef<HTMLDivElement>(null);
  const themesRowRef = useRef<HTMLDivElement>(null);
  const channelRows = useRef<(HTMLDivElement | null)[]>([]);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [dropRow, setDropRow] = useState<string | null>(null);

  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const duration = sessionDuration(session);
  const looksEnd = looksDuration(session);
  const resolved = new Map(resolveAudio(session).map((c) => [c.id, c]));
  const contentEnd = Math.max(
    duration,
    ...session.themeBlocks.map((b) => b.start + b.duration),
    ...session.audio.map((a) => a.start + a.duration),
  );
  const fitPps = (width - TRACK_LABEL_W - 90) / Math.max(30, contentEnd);
  const pps = fitPps * zoom;
  const step = tickStep(pps);
  const contentW = TRACK_LABEL_W + contentEnd * pps + 80;

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - TRACK_LABEL_W;
    return Math.max(0, x / pps);
  };
  const channelAt = (clientY: number): number | null => {
    const i = channelRows.current.findIndex((r) => {
      const rect = r?.getBoundingClientRect();
      return rect && clientY >= rect.top && clientY < rect.bottom;
    });
    return i >= 0 ? i : null;
  };
  const overThemes = (clientY: number) => {
    const rect = themesRowRef.current?.getBoundingClientRect();
    return !!rect && clientY >= rect.top && clientY < rect.bottom;
  };

  const seekDrag = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    preview.seek(Math.min(duration, timeAt(e.clientX)));
    track((ev) => preview.seek(Math.min(duration, timeAt(ev.clientX))));
  };

  // Looks: a continuous run; resizing changes the block's length.
  const resizeLook = (e: React.PointerEvent, id: string, original: number) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    track((ev) => {
      const step = ev.shiftKey ? 1 : 5;
      const d = Math.max(5, Math.round((original + (ev.clientX - startX) / pps) / step) * step);
      edit((s) => {
        const b = s.blocks.find((x) => x.id === id);
        if (b) b.duration = d;
      }, `resize-${id}`);
    });
  };

  // Themes: free blocks that stop at their neighbours.
  const dragTheme = (e: React.PointerEvent, id: string, mode: 'move' | 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    select({ kind: 'themeBlock', id });
    const s0 = useStudio.getState().session!;
    const block = s0.themeBlocks.find((b) => b.id === id)!;
    const others = s0.themeBlocks.filter((b) => b.id !== id);
    const prevEnd = Math.max(0, ...others.filter((b) => b.start + b.duration <= block.start).map((b) => b.start + b.duration));
    const nextStart = Math.min(Infinity, ...others.filter((b) => b.start >= block.start + block.duration).map((b) => b.start));
    const pts = snapPoints(s0, id, usePlayback.getState().time);
    const startX = e.clientX;
    let moved = false;
    track((ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      const dt = (ev.clientX - startX) / pps;
      const free = !ev.altKey;
      let start = block.start;
      let len = block.duration;
      if (mode === 'move') {
        start = block.start + dt;
        const sStart = snap(start, pts, pps, free);
        const sEnd = snap(start + len, pts, pps, free);
        start = Math.abs(sStart - start) <= Math.abs(sEnd - (start + len)) ? sStart : sEnd - len;
        start = Math.max(prevEnd, Math.min(nextStart - len, start));
      } else if (mode === 'start') {
        const end = block.start + block.duration;
        start = Math.max(prevEnd, Math.min(end - 1, snap(block.start + dt, pts, pps, free)));
        len = end - start;
      } else {
        const end = Math.min(nextStart, Math.max(block.start + 1, snap(block.start + block.duration + dt, pts, pps, free)));
        len = end - block.start;
      }
      start = Math.round(start * 10) / 10;
      len = Math.round(len * 10) / 10;
      edit((s) => {
        const b = s.themeBlocks.find((x) => x.id === id);
        if (b) {
          b.start = start;
          b.duration = len;
        }
      }, `theme-${mode}-${id}`);
    });
  };

  // Audio: clips move freely, and between channels.
  const dragClip = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    select({ kind: 'audio', id });
    const s0 = useStudio.getState().session!;
    const clip = s0.audio.find((a) => a.id === id)!;
    const pts = snapPoints(s0, id, usePlayback.getState().time);
    const startX = e.clientX;
    let moved = false;
    track((ev) => {
      if (!moved && Math.abs(ev.clientX - startX) < 3) return;
      moved = true;
      const raw = clip.start + (ev.clientX - startX) / pps;
      const free = !ev.altKey;
      const sStart = snap(raw, pts, pps, free);
      const sEnd = snap(raw + clip.duration, pts, pps, free);
      const t = Math.abs(sStart - raw) <= Math.abs(sEnd - (raw + clip.duration)) ? sStart : sEnd - clip.duration;
      const ch = channelAt(ev.clientY) ?? clip.channel;
      edit((s) => {
        const a = s.audio.find((x) => x.id === id);
        if (a) {
          a.start = Math.max(0, Math.round(t * 10) / 10);
          a.channel = ch;
        }
      }, `move-${id}`);
    });
  };

  const addLook = () => {
    const id = newId();
    edit((s) => {
      const last = s.blocks[s.blocks.length - 1];
      // Continue the previous block's look as a separate copy, or start fresh.
      const prev = last && s.programs.find((p) => p.id === last.programId);
      const look = prev ? cloneProgram(prev) : defaultProgram('Classic');
      s.programs.push(look);
      s.blocks.push({ id, programId: look.id, duration: 60 });
    });
    select({ kind: 'block', id });
  };

  const addThemeAtPlayhead = () => {
    if (!session.themes.length) {
      useStudio.getState().notify('Add a theme first (Themes panel or the Media page)');
      return;
    }
    // Use the theme after the last one placed, so repeated clicks walk the list.
    const last = [...session.themeBlocks].sort((a, b) => b.start - a.start)[0];
    const i = last ? (session.themes.findIndex((t) => t.id === last.themeId) + 1) % session.themes.length : 0;
    addThemeBlock(session.themes[i].id, usePlayback.getState().time);
  };

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey) return;
    setZoom((z) => Math.max(1, Math.min(60, z * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    const isTheme = e.dataTransfer.types.includes(THEME_MIME);
    if (isTheme) setDropRow('themes');
    else {
      const ch = channelAt(e.clientY);
      setDropRow(`a${ch ?? 0}`);
    }
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropRow(null);
    const themeId = e.dataTransfer.getData(THEME_MIME);
    const at = timeAt(e.clientX);
    if (themeId) {
      addThemeBlock(themeId, at);
      return;
    }
    void addAudioFiles(readDropPaths(e), at, channelAt(e.clientY) ?? 0);
  };

  const ticks: number[] = [];
  for (let t = 0; t <= contentEnd; t += step) ticks.push(t);

  let cursor = 0;
  return (
    <div className="timeline">
      <div className="timeline-head">
        <span className="panel-tab active">Timeline</span>
        <span className="timeline-meta">{session.name || 'Untitled session'}</span>
        <span className="grow" />
        <span className="timeline-hint">Edges snap to other blocks and the playhead. Hold Alt to move freely.</span>
        <HelpButton topic="timeline" label="the timeline" />
        <button className="icon-btn" title="Zoom out (Ctrl+scroll)" onClick={() => setZoom((z) => Math.max(1, z / 1.5))}>
          <Icon name="zoomOut" />
        </button>
        <button className="icon-btn" title="Zoom in (Ctrl+scroll)" onClick={() => setZoom((z) => Math.min(60, z * 1.5))}>
          <Icon name="zoomIn" />
        </button>
      </div>
      <div
        className="timeline-scroll"
        ref={scrollRef}
        onWheel={onWheel}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropRow(null);
        }}
        onDrop={onDrop}
      >
        <div className="timeline-content" style={{ width: contentW }}>
          <div className="ruler" onPointerDown={seekDrag}>
            {ticks.map((t) => (
              <div key={t} className="tick" style={{ left: TRACK_LABEL_W + t * pps }}>
                <span>{formatTimecode(t)}</span>
              </div>
            ))}
            <div className="session-end" style={{ left: TRACK_LABEL_W + duration * pps }} title="End of session" />
          </div>

          {/* Looks */}
          <div className="track pinned looks-row" data-tour="row-looks">
            <div
              className="track-label"
              title={'Looks\nHow things are shown: visual styles, speed and colours. Blocks play one after another; click one to change its look.'}
            >
              <span className="track-id">V1</span>
              <span className="track-name">Looks</span>
            </div>
            {session.blocks.map((b, i) => {
              const left = TRACK_LABEL_W + cursor * pps;
              cursor += b.duration;
              const look = session.programs.find((p) => p.id === b.programId);
              const selected = selection?.kind === 'block' && selection.id === b.id;
              return (
                <div
                  key={b.id}
                  className={`block ${selected ? 'selected' : ''}`}
                  style={{ left, width: Math.max(4, b.duration * pps - 2), '--clip': lookColour(b.programId, session.programs) } as React.CSSProperties}
                  onPointerDown={(e) => e.button === 0 && select({ kind: 'block', id: b.id })}
                  title={`${look?.name ?? 'Look'}, ${formatTime(b.duration)}`}
                >
                  <span className="block-head">
                    {look && (
                      <span
                        className="look-swatch"
                        style={{ background: `linear-gradient(90deg, ${colourToCss(look.spiralColourA, 1)} 50%, ${colourToCss(look.spiralColourB, 1)} 50%)` }}
                      />
                    )}
                    <span className="block-name">{look?.name ?? 'Look'}</span>
                  </span>
                  <span className="block-time">{formatTime(b.duration)}</span>
                  <div className="block-handle" onPointerDown={(e) => resizeLook(e, b.id, b.duration)} title="Drag to resize (hold Shift for 1s steps)" />
                  <span className="sr-only">Look block {i + 1}</span>
                </div>
              );
            })}
            {duration > looksEnd && (
              <div
                className="look-continues"
                style={{ left: TRACK_LABEL_W + looksEnd * pps, width: (duration - looksEnd) * pps }}
                title={session.blocks.length ? "The last look keeps playing until the session ends" : "No look blocks: the default look plays"}
              />
            )}
            <button className="track-add" style={{ left: TRACK_LABEL_W + looksEnd * pps + 6 }} onClick={addLook} title={'Add a look block\nStarts as a copy of the last look'}>
              <Icon name="plus" size={16} />
            </button>
          </div>

          {/* Themes */}
          <div className={`track pinned themes-row ${dropRow === 'themes' ? 'drop' : ''}`} ref={themesRowRef} data-tour="row-themes">
            <div
              className="track-label"
              title={'Themes\nWhich theme is shown when. Drag themes here from the Themes panel. Where the row is empty, every theme plays.'}
            >
              <span className="track-id theme">TH</span>
              <span className="track-name">Themes</span>
              <button className="icon-btn small" title={'Add a theme block at the playhead\nEach click adds the next theme in the Themes panel'} onClick={addThemeAtPlayhead}>
                <Icon name="plus" size={14} />
              </button>
            </div>
            {session.themeBlocks.map((b) => {
              const theme = session.themes.find((t) => t.id === b.themeId);
              const selected = selection?.kind === 'themeBlock' && selection.id === b.id;
              return (
                <div
                  key={b.id}
                  className={`block theme-block ${selected ? 'selected' : ''}`}
                  style={{ left: TRACK_LABEL_W + b.start * pps, width: Math.max(4, b.duration * pps - 1), '--clip': themeColour(b.themeId, session.themes) } as React.CSSProperties}
                  onPointerDown={(e) => dragTheme(e, b.id, 'move')}
                  title={`${theme?.name ?? 'Theme'}, ${formatTime(b.start)} to ${formatTime(b.start + b.duration)}`}
                >
                  <span className="block-head">
                    {theme?.images[0] && <img className="theme-chip" src={thumbUrl(theme.images[0])} alt="" draggable={false} />}
                    <span className="block-name">{theme?.name ?? 'Theme'}</span>
                  </span>
                  <span className="block-time">{formatTime(b.duration)}</span>
                  <div className="block-handle left" onPointerDown={(e) => dragTheme(e, b.id, 'start')} title="Drag to change the start" />
                  <div className="block-handle" onPointerDown={(e) => dragTheme(e, b.id, 'end')} title="Drag to change the end" />
                </div>
              );
            })}
            {!session.themeBlocks.length && (
              <div className="track-empty-group" style={{ left: TRACK_LABEL_W + 8 }}>
                <span className="muted">All themes play. </span>
                <button className="track-empty static" onClick={layOutThemes} disabled={!session.themes.length}>
                  Lay out themes one after another
                </button>
                <span className="muted">or drag a theme here from the Themes panel</span>
              </div>
            )}
          </div>

          {/* Audio channels. Clips keep their full length, so overlapping clips
              on one channel stack into extra lanes and play together. */}
          {session.audioChannels.map((ch, ci) => {
            const clips = session.audio.filter((a) => a.channel === ci).sort((a, b) => a.start - b.start);
            const laneEnds: number[] = [];
            const laneOf = new Map<string, number>();
            for (const a of clips) {
              let lane = laneEnds.findIndex((end) => end <= a.start + 1e-6);
              if (lane < 0) lane = laneEnds.push(0) - 1;
              laneEnds[lane] = a.start + a.duration;
              laneOf.set(a.id, lane);
            }
            const lanes = Math.max(1, laneEnds.length);
            const selectedChannel = selection?.kind === 'channel' && selection.index === ci;
            return (
              <div
                key={ch.id}
                className={`track audio-track ${dropRow === `a${ci}` ? 'drop' : ''} ${ch.muted ? 'muted-track' : ''}`}
                style={{ minHeight: lanes * LANE_H + 8 }}
                ref={(el) => (channelRows.current[ci] = el)}
                data-tour="row-audio"
              >
                <div className={`track-label channel-label ${selectedChannel ? 'selected' : ''}`} onClick={() => select({ kind: 'channel', index: ci })} title={`${ch.name} channel\nClick for channel settings. Drop audio files on this row; clips always play in full.`}>
                  <div className="channel-inner">
                    <div className="channel-top">
                      <span className="track-id audio">A{ci + 1}</span>
                      <span className="track-name ellipsis">{ch.name}</span>
                      <button
                        className={`mute-btn ${ch.muted ? 'on' : ''}`}
                        title={ch.muted ? 'Unmute channel' : 'Mute channel'}
                        onClick={(e) => {
                          e.stopPropagation();
                          edit((s) => void (s.audioChannels[ci].muted = !s.audioChannels[ci].muted));
                        }}
                      >
                        M
                      </button>
                    </div>
                    <input
                      type="range"
                      className="slider channel-fader"
                      min={0}
                      max={200}
                      value={Math.round(ch.volume * 100)}
                      style={{ '--pct': `${ch.volume * 50}%` } as React.CSSProperties}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => edit((s) => void (s.audioChannels[ci].volume = Number(e.target.value) / 100), `ch-vol-${ci}`)}
                      onDoubleClick={() => edit((s) => void (s.audioChannels[ci].volume = 1))}
                      title={`${ch.name} volume: ${Math.round(ch.volume * 100)}% (double-click to reset)`}
                      aria-label={`${ch.name} volume`}
                  />
                  </div>
                </div>
                {clips.map((a) => {
                  const selected = selection?.kind === 'audio' && selection.id === a.id;
                  const w = Math.max(6, a.duration * pps - 1);
                  const lane = laneOf.get(a.id) ?? 0;
                  return (
                    <div
                      key={a.id}
                      className={`clip ${selected ? 'selected' : ''} ${resolved.has(a.id) ? '' : 'inactive'}`}
                      style={{ left: TRACK_LABEL_W + a.start * pps, width: w, top: 4 + lane * LANE_H, height: LANE_H - 4, bottom: 'auto' }}
                      onPointerDown={(e) => dragClip(e, a.id)}
                      title={`${basename(a.path)}, ${formatTime(a.start)} to ${formatTime(a.start + a.duration)}. Drag to move, or up and down to change channel.`}
                    >
                      {a.fadeIn > 0 && <span className="fade in" style={{ width: Math.min(a.fadeIn * pps, w / 2) }} />}
                      {a.fadeOut > 0 && <span className="fade out" style={{ width: Math.min(a.fadeOut * pps, w / 2) }} />}
                      <span className="clip-name">{basename(a.path)}</span>
                    </div>
                  );
                })}
                {!clips.length && (
                  <button
                    className="track-empty"
                    style={{ left: TRACK_LABEL_W + 8 }}
                    onClick={async () => addAudioFiles(await window.trance.openFiles('audio'), 0, ci)}
                  >
                    <Icon name="plus" size={14} /> Add audio or drop files here
                  </button>
                )}
              </div>
            );
          })}
          <Playhead pps={pps} />
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { sessionDuration } from '../../shared/types';
import { SessionPlayer } from '../engine/player';
import { useStudio } from '../store';
import { formatTimecode } from '../util';
import { Icon } from './Icon';

// Playback state shared with the timeline (kept separate from the main store
// so 60fps time updates don't re-render the whole editor).
export const usePlayback = create<{ time: number; playing: boolean; ready: boolean }>(() => ({
  time: 0,
  playing: false,
  ready: false,
}));

let player: SessionPlayer | null = null;
// The viewer's stage element, for fullscreen.
let stageEl: HTMLDivElement | null = null;
let playerGeneration = 0;
// Debug access from the devtools console.
(window as unknown as { __preview: unknown }).__preview = null;

export const preview = {
  get player() {
    return player;
  },
  toggle() {
    if (!player) return;
    if (player.isPlaying) this.pause();
    else this.play();
  },
  play() {
    if (!player) return;
    player.play();
    usePlayback.setState({ playing: true });
  },
  pause() {
    player?.pause();
    usePlayback.setState({ playing: false });
  },
  // Fills the screen with the viewer (Esc returns to the editor).
  enterFullscreen() {
    if (stageEl && !document.fullscreenElement) void stageEl.requestFullscreen().catch(() => {});
  },
  exitFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
  },
  get isFullscreen() {
    return !!document.fullscreenElement;
  },
  stats() {
    return player?.stats() ?? null;
  },
  seek(t: number) {
    if (player) player.seek(t);
    usePlayback.setState({ time: t });
  },
};

export function Preview() {
  const session = useStudio((s) => s.session)!;
  const frames = useStudio((s) => s.frames);
  const preparing = useStudio((s) => s.preparing.length);
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped to rebuild the player after the graphics context was lost.
  const [recoveries, setRecoveries] = useState(0);
  // Bumped when the viewer changes size a lot (e.g. fullscreen), so the
  // player re-renders at the new resolution instead of being stretched.
  const [sizeKey, setSizeKey] = useState(0);
  const builtSize = useRef({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [lost, setLost] = useState(false);
  const lossTimes = useRef<number[]>([]);
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);

  // Rebuild the player only when media or playback settings change; look and
  // timeline edits are applied live.
  // Only media changes need a rebuild; phrase and name edits apply live.
  const mediaKey = useMemo(
    () =>
      session.themes
        .map((t) => [t.id, t.images.join('|'), t.animations.join('|'), t.fonts.join('|')].join('#'))
        .join('\n'),
    [session.themes],
  );
  const frameKey = Object.keys(frames).length;
  const aspectKey = `${session.export.width}x${session.export.height}`;
  const generation = useMemo(
    () => ++playerGeneration,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mediaKey, session.playback, frameKey, preparing, aspectKey, recoveries, sizeKey],
  );
  useEffect(() => {
    const resume = usePlayback.getState();
    const old = player;
    player = null;
    old?.dispose();
    old?.canvas.remove();
    setLoading(true);
    setError(null);
    if (preparing) return;

    // Every player gets its own canvas. Sharing one (e.g. when React mounts
    // the preview twice in development) meant disposing the old player also
    // destroyed the new player's WebGL context, leaving a white box.
    let cancelled = false;
    const box = boxRef.current!;
    const canvas = document.createElement('canvas');
    canvas.className = 'preview-canvas';
    canvas.addEventListener('click', () => preview.toggle());
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(320, Math.round(box.clientWidth * dpr));
    canvas.height = Math.max(180, Math.round(box.clientHeight * dpr));
    builtSize.current = { w: canvas.width, h: canvas.height };
    hostRef.current!.appendChild(canvas);

    SessionPlayer.create(canvas, useStudio.getState().session!, {
      mode: 'realtime',
      animationFrames: new Map(Object.entries(useStudio.getState().frames)),
      startTime: resume.time,
      onTime: (t) => usePlayback.setState({ time: t }),
      onEnd: () => usePlayback.setState({ playing: false }),
      onContextLost: () => {
        if (cancelled) return;
        const now = Date.now();
        lossTimes.current = [...lossTimes.current.filter((t) => now - t < 60_000), now];
        setLost(true);
        // Rebuild automatically, unless it keeps happening.
        if (lossTimes.current.length <= 3) setTimeout(() => setRecoveries((r) => r + 1), 800);
      },
    })
      .then((p) => {
        if (cancelled) {
          p.dispose();
          canvas.remove();
          return;
        }
        player = p;
        setLoading(false);
        setLost(false);
        usePlayback.setState({ ready: true });
        if (resume.playing) preview.play();
      })
      .catch((e) => {
        canvas.remove();
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
      usePlayback.setState({ ready: false });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  useEffect(() => {
    player?.updateSession(session);
  }, [session]);

  useEffect(() => {
    stageEl = stageRef.current;
    const onChange = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onChange);
    const box = boxRef.current!;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = box.clientWidth * dpr;
      const built = builtSize.current;
      if (!built.w || Math.abs(w - built.w) / built.w < 0.25) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSizeKey((k) => k + 1), 200);
    });
    ro.observe(box);
    return () => {
      if (stageEl === stageRef.current) stageEl = null;
      document.removeEventListener('fullscreenchange', onChange);
      ro.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(
    () => () => {
      player?.dispose();
      player?.canvas.remove();
      player = null;
      usePlayback.setState({ playing: false, ready: false, time: 0 });
    },
    [],
  );

  const duration = sessionDuration(session);
  const blockIndex = (() => {
    let acc = 0;
    for (let i = 0; i < session.blocks.length; ++i) {
      acc += session.blocks[i].duration;
      if (time < acc) return i;
    }
    return session.blocks.length - 1;
  })();
  const block = session.blocks[blockIndex];
  const look = session.programs.find((p) => p.id === block?.programId);
  const empty = !session.themes.some((t) => t.images.length || t.animations.length || t.texts.length);

  const fps = session.export.fps;
  const step = (d: number) => preview.seek(Math.max(0, Math.min(duration, time + d)));

  return (
    <div className="viewer">
      <div className="panel-tab-bar">
        <span className="panel-tab active">Viewer</span>
        <span className="grow" />
        {look && (
          <span className="viewer-look" title="Look playing at the playhead">
            {look.name}
          </span>
        )}
      </div>
      <div className="preview-stage" ref={stageRef}>
        <div
          className="preview-frame"
          ref={boxRef}
          style={{ '--ar': session.export.width / session.export.height } as React.CSSProperties}
        >
          <div ref={hostRef} className="preview-canvas-host" />
          {(loading || preparing > 0) && !error && (
            <div className="preview-overlay">
              <div className="spinner" />
              {preparing > 0 ? `Preparing ${preparing} video${preparing === 1 ? '' : 's'}...` : 'Loading media...'}
            </div>
          )}
          {error && <div className="preview-overlay error">Preview failed: {error}</div>}
          {fullscreen && <div className="fullscreen-hint">Esc to exit, Space to pause</div>}
          {lost && (
            <div className="preview-overlay lost">
              {lossTimes.current.length <= 3 ? (
                <>
                  <div className="spinner" />
                  The graphics driver reset the preview. Restoring...
                </>
              ) : (
                <>
                  <p>The graphics driver keeps resetting the preview. Your GPU may be running out of memory.</p>
                  <p className="muted">Try fewer images in memory (session settings), or close other GPU-heavy apps.</p>
                  <button
                    className="btn"
                    onClick={() => {
                      lossTimes.current = [];
                      setRecoveries((r) => r + 1);
                    }}
                  >
                    Restart preview
                  </button>
                </>
              )}
            </div>
          )}
          {empty && !loading && (
            <div className="preview-overlay">Add images, videos or phrases to a theme to see the session here.</div>
          )}
        </div>
      </div>
      <div className="transport">
        <span className="timecode current" title="Playhead">
          {formatTimecode(time, fps)}
        </span>
        <div className="transport-buttons">
          <button className="icon-btn" onClick={() => preview.seek(0)} title="Go to start (Home)">
            <Icon name="toStart" />
          </button>
          <button className="icon-btn" onClick={() => step(-10)} title="Back 10 seconds">
            <Icon name="back" />
          </button>
          <button className="icon-btn play" onClick={() => preview.toggle()} title="Play / pause (Space)">
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <button className="icon-btn" onClick={() => step(10)} title="Forward 10 seconds">
            <Icon name="forward" />
          </button>
        </div>
        <span className="timecode total" title="Session length">
          {formatTimecode(duration, fps)}
        </span>
      </div>
    </div>
  );
}

(window as unknown as { __preview: typeof preview }).__preview = preview;

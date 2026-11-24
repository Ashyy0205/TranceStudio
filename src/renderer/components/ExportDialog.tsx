import { useEffect, useRef, useState } from 'react';
import { sessionDuration } from '../../shared/types';
import { type ExportProgress, exportSession } from '../engine/exporter';
import { markDone } from '../onboarding';
import { useStudio } from '../store';
import { basename, formatTime } from '../util';
import { Modal, Toggle } from './controls';
import { Icon } from './Icon';
import { preview } from './Preview';

const RESOLUTIONS = [
  { id: '720p', label: '720p', w: 1280, h: 720 },
  { id: '1080p', label: '1080p', w: 1920, h: 1080 },
  { id: '1440p', label: '1440p', w: 2560, h: 1440 },
  { id: '4k', label: '4K', w: 3840, h: 2160 },
  { id: 'vertical', label: 'Vertical 1080x1920', w: 1080, h: 1920 },
  { id: 'square', label: 'Square 1080', w: 1080, h: 1080 },
];

const QUALITIES = [
  { id: 'fast', label: 'Fast', hint: 'Quick to export, larger file' },
  { id: 'medium', label: 'Balanced', hint: 'Good for most uses' },
  { id: 'high', label: 'High', hint: 'Best quality, slowest' },
] as const;

type Phase = { kind: 'setup' } | { kind: 'running'; progress: ExportProgress | null } | { kind: 'done'; path: string } | { kind: 'error'; message: string };

export function ExportDialog() {
  const session = useStudio((s) => s.session)!;
  const { setModal, edit } = useStudio.getState();
  const settings = session.export;
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const [gpuEncoder, setGpuEncoder] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void window.trance.hardwareEncoder().then(setGpuEncoder);
  }, []);
  const encoderNames: Record<string, string> = { h264_nvenc: 'NVIDIA NVENC', h264_amf: 'AMD AMF', h264_qsv: 'Intel Quick Sync' };
  const abort = useRef<AbortController | null>(null);
  const duration = sessionDuration(session);
  const res = RESOLUTIONS.find((r) => r.w === settings.width && r.h === settings.height);
  const set = (fn: (e: typeof settings) => void) => edit((s) => fn(s.export), 'export');

  const choosePath = async () => {
    const p = await window.trance.saveVideoDialog(settings.path || `${session.name || 'session'}.mp4`);
    if (p) set((e) => (e.path = p));
    return p;
  };

  const start = async () => {
    const path = settings.path || (await choosePath());
    if (!path) return;
    preview.pause();
    abort.current = new AbortController();
    setPhase({ kind: 'running', progress: null });
    try {
      await exportSession(useStudio.getState().session!, {
        path,
        width: settings.width,
        height: settings.height,
        fps: settings.fps,
        quality: settings.quality,
        hardware: settings.hardware,
        signal: abort.current.signal,
        onProgress: (progress) => setPhase({ kind: 'running', progress }),
      });
      setPhase({ kind: 'done', path });
      markDone('export');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') setPhase({ kind: 'setup' });
      else setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  if (phase.kind === 'running') {
    const p = phase.progress;
    const pct = p ? (100 * p.frame) / p.totalFrames : 0;
    return (
      <Modal title="Exporting video">
        <div className="export-progress">
          <div className="progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="row">
            <b>{Math.floor(pct)}%</b>
            <span className="muted">
              {p ? `frame ${p.frame.toLocaleString()} of ${p.totalFrames.toLocaleString()}` : 'Preparing media...'}
            </span>
            <span className="grow" />
            {p && <span className="muted">{formatTime(p.etaSeconds)} left</span>}
          </div>
          <p className="muted small">The export renders every frame exactly as the preview does. You can keep this window open in the background.</p>
        </div>
        <div className="modal-foot inline">
          <button className="btn" onClick={() => abort.current?.abort()}>
            Cancel export
          </button>
        </div>
      </Modal>
    );
  }

  if (phase.kind === 'done') {
    return (
      <Modal
        title="Export complete"
        onClose={() => setModal(null)}
        footer={
          <>
            <button className="btn" onClick={() => window.trance.showItem(phase.path)}>
              <Icon name="folder" /> Show in folder
            </button>
            <button className="btn primary" onClick={() => setModal(null)}>
              Done
            </button>
          </>
        }
      >
        <p>
          <Icon name="check" /> Saved <b>{basename(phase.path)}</b>
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="Export video"
      onClose={() => setModal(null)}
      footer={
        <>
          <span className="summary">
            <span>{formatTime(duration)}</span>
            <span>
              {settings.width}x{settings.height}
            </span>
            <span>{settings.fps} fps</span>
            <span>MP4 (H.264, AAC)</span>
          </span>
          <button className="btn ghost" onClick={() => setModal(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={start}>
            <Icon name="export" /> Export
          </button>
        </>
      }
    >
      {phase.kind === 'error' && <div className="error-box">Export failed: {phase.message}</div>}
      <div className="field-label">Resolution</div>
      <div className="chip-row">
        {RESOLUTIONS.map((r) => (
          <button
            key={r.id}
            className={`chip ${res?.id === r.id ? 'on' : ''}`}
            onClick={() => set((e) => ((e.width = r.w), (e.height = r.h)))}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="field-label">Frame rate</div>
      <div className="segmented">
        {[30, 60].map((f) => (
          <button key={f} className={settings.fps === f ? 'on' : ''} onClick={() => set((e) => (e.fps = f))}>
            {f} fps
          </button>
        ))}
      </div>
      <div className="field-label">Quality</div>
      <div className="segmented">
        {QUALITIES.map((q) => (
          <button key={q.id} className={settings.quality === q.id ? 'on' : ''} title={q.hint} onClick={() => set((e) => (e.quality = q.id))}>
            {q.label}
          </button>
        ))}
      </div>
      <div className="field-label">Encoder</div>
      {gpuEncoder === undefined ? (
        <p className="muted small">Checking for a GPU encoder...</p>
      ) : gpuEncoder ? (
        <Toggle
          checked={settings.hardware}
          onChange={(v) => set((e) => void (e.hardware = v))}
          label={`Use GPU encoding (${encoderNames[gpuEncoder] ?? gpuEncoder}): several times faster, slightly larger files`}
        />
      ) : (
        <p className="muted small">No GPU encoder found on this computer; using x264 (CPU).</p>
      )}
      <div className="field-label" style={{ marginTop: 12 }}>Save to</div>
      <div className="row gap-s">
        <span className="path-pill grow" title={settings.path}>
          {settings.path || 'Choose a file...'}
        </span>
        <button className="btn" onClick={choosePath}>
          Browse...
        </button>
      </div>
    </Modal>
  );
}

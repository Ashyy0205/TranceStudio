import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DirListing, MediaFile } from '../../shared/api';
import { newId, type Theme } from '../../shared/types';
import { mediaUrl, thumbUrl } from '../engine/media';
import { useStudio } from '../store';
import { basename, plural } from '../util';
import { HelpButton, Toggle } from './controls';
import { Icon } from './Icon';
import { addFilesToTheme, PATHS_MIME, readDropPaths } from './Library';

// Source folders (remembered per machine)

const SOURCES_KEY = 'trance-studio.sources';

function loadSources(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SOURCES_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveSources(list: string[]): void {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable.
  }
}

// Browser state that should survive switching pages.
const memory = {
  dir: null as string | null,
  recursive: false,
  kind: 'all' as 'all' | 'image' | 'animation',
  hideUsed: false,
  size: 150,
  target: null as string | null,
};

// What the media page is showing, for the tutorial to check progress against.
export const mediaStatus = { sources: 0, items: 0, selected: 0 };

// Opens the media page with a theme as the target for new media.
export function browseForTheme(themeId: string): void {
  memory.target = themeId;
  useStudio.getState().setPage('media');
}

// Folder tree

function FolderNode({
  path,
  name,
  depth,
  current,
  onOpen,
  onRemove,
}: {
  path: string;
  name: string;
  depth: number;
  current: string | null;
  onOpen: (p: string) => void;
  onRemove?: () => void;
}) {
  const [open, setOpen] = useState(depth === 0 && current?.startsWith(path) === true);
  const [children, setChildren] = useState<DirListing['dirs'] | null>(null);
  useEffect(() => {
    if (!open || children) return;
    window.trance
      .listDir(path)
      .then((l) => setChildren(l.dirs))
      .catch(() => setChildren([]));
  }, [open, children, path]);
  return (
    <>
      <div
        className={`tree-row ${current === path ? 'current' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => onOpen(path)}
        title={path}
      >
        <button
          className={`tree-caret ${open ? 'open' : ''} ${children && !children.length ? 'empty' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(!open);
          }}
          aria-label={open ? 'Collapse' : 'Expand'}
        >
          <Icon name="caret" size={11} />
        </button>
        <Icon name="folder" size={14} />
        <span className="ellipsis grow">{name}</span>
        {onRemove && (
          <button
            className="icon-btn small tree-remove"
            title="Remove from sources (files are not deleted)"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      {open &&
        children?.map((c) => (
          <FolderNode key={c.path} path={c.path} name={c.name} depth={depth + 1} current={current} onOpen={onOpen} />
        ))}
    </>
  );
}

// Theme targets

function TargetRow({
  theme,
  active,
  onPick,
  onDropPaths,
}: {
  theme: Theme;
  active: boolean;
  onPick: () => void;
  onDropPaths: (paths: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  return (
    <div
      className={`target-row ${active ? 'active' : ''} ${over ? 'drop' : ''}`}
      onClick={onPick}
      onDoubleClick={() => setRenaming(true)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDropPaths(readDropPaths(e));
      }}
      title="Click to make this the target. Drop media here to add it. Double-click to rename."
    >
      <div className="target-thumb">
        {theme.images[0] ? <img src={thumbUrl(theme.images[0])} alt="" /> : <Icon name="image" size={14} />}
      </div>
      <div className="target-info">
        {renaming ? (
          <input
            className="input"
            autoFocus
            defaultValue={theme.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => {
              const name = e.target.value.trim();
              if (name)
                useStudio.getState().edit((s) => {
                  const t = s.themes.find((x) => x.id === theme.id);
                  if (t) t.name = name;
                });
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
        ) : (
          <span className="target-name ellipsis">{theme.name}</span>
        )}
        <span className="theme-counts">
          <span title="Images">
            <Icon name="image" size={12} /> {theme.images.length}
          </span>
          <span title="Videos">
            <Icon name="film" size={12} /> {theme.animations.length}
          </span>
        </span>
      </div>
    </div>
  );
}

// Lightbox

function Lightbox({
  items,
  index,
  selected,
  onIndex,
  onToggle,
  onClose,
}: {
  items: MediaFile[];
  index: number;
  selected: boolean;
  onIndex: (i: number) => void;
  onToggle: () => void;
  onClose: () => void;
}) {
  const item = items[index];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') onIndex(Math.min(items.length - 1, index + 1));
      else if (e.key === 'ArrowLeft') onIndex(Math.max(0, index - 1));
      else if (e.key === ' ') onToggle();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, onClose, onIndex, onToggle]);
  if (!item) return null;
  const isVideo = item.kind === 'animation' && !item.name.toLowerCase().endsWith('.gif');
  return (
    <div className="lightbox" onClick={onClose}>
      <div className="lightbox-media" onClick={(e) => e.stopPropagation()}>
        {isVideo ? (
          <video key={item.path} src={mediaUrl(item.path)} autoPlay loop muted controls />
        ) : (
          <img key={item.path} src={mediaUrl(item.path)} alt={item.name} />
        )}
      </div>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="ellipsis grow" title={item.path}>
          {item.name}
        </span>
        <span className="muted">
          {index + 1} of {items.length}
        </span>
        <button className={`btn small ${selected ? 'primary' : ''}`} onClick={onToggle}>
          {selected ? 'Selected' : 'Select'} (Space)
        </button>
        <button className="icon-btn" onClick={onClose} aria-label="Close preview">
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}

// Page

const GAP = 6;
const LABEL_H = 20;

export function MediaPage() {
  const session = useStudio((s) => s.session)!;
  const [sources, setSources] = useState(loadSources);
  const [dir, setDir] = useState<string | null>(memory.dir ?? loadSources()[0] ?? null);
  const [recursive, setRecursive] = useState(memory.recursive);
  const [kind, setKind] = useState(memory.kind);
  const [hideUsed, setHideUsed] = useState(memory.hideUsed);
  const [size, setSize] = useState(memory.size);
  const [search, setSearch] = useState('');
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [subdirs, setSubdirs] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [target, setTarget] = useState<string | null>(memory.target);
  const gridRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ width: 800, height: 600, scrollTop: 0 });

  Object.assign(memory, { dir, recursive, kind, hideUsed, size, target });

  const targetTheme = session.themes.find((t) => t.id === target) ?? null;
  useEffect(() => {
    if (!targetTheme && session.themes.length) setTarget(session.themes[0].id);
  }, [targetTheme, session.themes]);

  // List the current folder.
  useEffect(() => {
    if (!dir) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const job = recursive
      ? window.trance.listDirRecursive(dir).then((f) => ({ files: f, dirs: 0 }))
      : window.trance.listDir(dir).then((l) => ({ files: l.files, dirs: l.dirs.length }));
    job
      .then((r) => {
        if (cancelled) return;
        setFiles(r.files);
        setSubdirs(r.dirs);
        setSelected(new Set());
        setAnchor(null);
        gridRef.current?.scrollTo(0, 0);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [dir, recursive]);

  // Which themes use each file.
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of session.themes) for (const p of [...t.images, ...t.animations]) m.set(p, (m.get(p) ?? 0) + 1);
    return m;
  }, [session.themes]);
  const inTarget = useMemo(
    () => new Set(targetTheme ? [...targetTheme.images, ...targetTheme.animations] : []),
    [targetTheme],
  );

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    return files.filter(
      (f) =>
        (kind === 'all' || f.kind === kind) &&
        (!hideUsed || !usage.has(f.path)) &&
        (!q || f.name.toLowerCase().includes(q)),
    );
  }, [files, kind, hideUsed, usage, search]);
  Object.assign(mediaStatus, { sources: sources.length, items: items.length, selected: selected.size });
  useEffect(() => () => void Object.assign(mediaStatus, { sources: 0, items: 0, selected: 0 }), []);

  // Grid geometry (only visible rows are rendered).
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const update = () => setView({ width: el.clientWidth, height: el.clientHeight, scrollTop: el.scrollTop });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, [dir]);
  const cols = Math.max(1, Math.floor((view.width - GAP) / (size + GAP)));
  const cellW = Math.floor((view.width - GAP) / cols) - GAP;
  const rowH = Math.round(cellW * 0.75) + LABEL_H + GAP;
  const rows = Math.ceil(items.length / cols);
  const firstRow = Math.max(0, Math.floor(view.scrollTop / rowH) - 2);
  const lastRow = Math.min(rows, Math.ceil((view.scrollTop + view.height) / rowH) + 2);

  const addSources = async () => {
    const f = await window.trance.openFolder();
    if (!f) return;
    const next = [...new Set([...sources, f])];
    setSources(next);
    saveSources(next);
    setDir(f);
  };

  const selectedList = useCallback(() => items.filter((f) => selected.has(f.path)).map((f) => f.path), [items, selected]);

  const addTo = async (paths: string[], themeId: string | null) => {
    if (!paths.length) return;
    const prior = useStudio.getState().session!.themes.find((t) => t.id === themeId);
    const before = prior ? prior.images.length + prior.animations.length : 0;
    const id = await addFilesToTheme(paths, themeId ?? undefined);
    if (id) setTarget(id);
    const theme = useStudio.getState().session!.themes.find((t) => t.id === id);
    const added = theme ? theme.images.length + theme.animations.length - before : paths.length;
    useStudio.getState().notify(
      themeId ? `Added ${plural(Math.max(0, added), 'item')} to ${theme?.name}` : `Created ${theme?.name} with ${plural(paths.length, 'item')}`,
    );
  };

  const removeFromTarget = (paths: string[]) => {
    if (!targetTheme) return;
    const drop = new Set(paths);
    useStudio.getState().edit((s) => {
      const t = s.themes.find((x) => x.id === targetTheme.id);
      if (!t) return;
      t.images = t.images.filter((p) => !drop.has(p));
      t.animations = t.animations.filter((p) => !drop.has(p));
    });
  };

  const newThemeFromSelection = async () => {
    const paths = selectedList();
    if (paths.length) {
      await addTo(paths, null);
    } else {
      const id = newId();
      useStudio.getState().edit((s) => {
        s.themes.push({ id, name: `Theme ${s.themes.length + 1}`, images: [], animations: [], fonts: [], texts: [] });
      });
      setTarget(id);
    }
  };

  // Uses functional updates and a ref so rapid clicks never see stale state.
  const anchorRef = useRef<number | null>(null);
  anchorRef.current = anchor;
  const clickItem = (e: React.MouseEvent, index: number) => {
    const path = items[index].path;
    const additive = e.ctrlKey || e.metaKey;
    const from = anchorRef.current;
    if (e.shiftKey && from !== null) {
      const [a, b] = from < index ? [from, index] : [index, from];
      setSelected((prev) => {
        const next = additive ? new Set(prev) : new Set<string>();
        for (let i = a; i <= b; ++i) next.add(items[i].path);
        return next;
      });
      return;
    }
    if (additive) {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    } else {
      setSelected(new Set([path]));
    }
    anchorRef.current = index;
    setAnchor(index);
  };

  const onGridKey = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      setSelected(new Set(items.map((f) => f.path)));
    } else if (e.key === 'Escape') {
      setSelected(new Set());
    } else if (e.key === 'Enter' && selected.size) {
      e.preventDefault();
      void addTo(selectedList(), target);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
      e.preventDefault();
      removeFromTarget(selectedList());
    }
  };

  const selCount = selected.size;
  const selInTarget = selectedList().filter((p) => inTarget.has(p)).length;
  const visible: JSX.Element[] = [];
  for (let r = firstRow; r < lastRow; ++r) {
    for (let c = 0; c < cols; ++c) {
      const i = r * cols + c;
      const f = items[i];
      if (!f) break;
      const isSel = selected.has(f.path);
      const uses = usage.get(f.path) ?? 0;
      visible.push(
        <div
          key={f.path}
          className={`tile ${isSel ? 'selected' : ''}`}
          style={{ left: GAP + c * (cellW + GAP), top: GAP + r * rowH, width: cellW }}
          onClick={(e) => clickItem(e, i)}
          onDoubleClick={() => setLightbox(i)}
          draggable
          onDragStart={(e) => {
            let paths = selectedList();
            if (!selected.has(f.path)) {
              paths = [f.path];
              setSelected(new Set(paths));
              setAnchor(i);
            }
            e.dataTransfer.setData(PATHS_MIME, JSON.stringify(paths));
            e.dataTransfer.effectAllowed = 'copy';
          }}
          title={f.path}
        >
          <div className="tile-thumb" style={{ height: Math.round(cellW * 0.75) }}>
            <img
              src={thumbUrl(f.path)}
              decoding="async"
              draggable={false}
              alt=""
              onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
            />
            {f.kind === 'animation' && (
              <span className="tile-badge kind" title="Video">
                <Icon name="film" size={12} />
              </span>
            )}
            {uses > 0 && (
              <span
                className={`tile-badge used ${inTarget.has(f.path) ? 'here' : ''}`}
                title={inTarget.has(f.path) ? `In ${targetTheme?.name}` : `In ${plural(uses, 'theme')}`}
              >
                {inTarget.has(f.path) ? <Icon name="check" size={12} /> : uses}
              </span>
            )}
          </div>
          <div className="tile-name">{f.name}</div>
        </div>,
      );
    }
  }

  return (
    <div className="media-page">
      <aside className="sources">
        <div className="panel-tab-bar">
          <span className="panel-tab active">Sources</span>
          <span className="grow" />
          <HelpButton topic="media-and-themes#the-media-page" label="the Media page" />
          <button className="icon-btn" title="Add a source folder" onClick={addSources}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="tree">
          {sources.map((p) => (
            <FolderNode
              key={p}
              path={p}
              name={basename(p) || p}
              depth={0}
              current={dir}
              onOpen={setDir}
              onRemove={() => {
                const next = sources.filter((s) => s !== p);
                setSources(next);
                saveSources(next);
                if (dir?.startsWith(p)) setDir(next[0] ?? null);
              }}
            />
          ))}
          {!sources.length && (
            <div className="library-empty">
              <p>Add the folders where you keep your images and videos. They stay listed here for every session.</p>
              <button className="btn" onClick={addSources}>
                <Icon name="folder" /> Add folder...
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="browser">
        <div className="browser-toolbar">
          <span className="browser-path ellipsis" title={dir ?? ''}>
            {dir ? basename(dir) : 'No folder'}
          </span>
          <span className="muted">{loading ? 'Listing...' : plural(items.length, 'item')}</span>
          <span className="grow" />
          <div className="segmented">
            {(['all', 'image', 'animation'] as const).map((k) => (
              <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                {k === 'all' ? 'All' : k === 'image' ? 'Images' : 'Videos'}
              </button>
            ))}
          </div>
          <Toggle checked={recursive} onChange={setRecursive} label="Include subfolders" />
          <Toggle checked={hideUsed} onChange={setHideUsed} label="Hide used" />
          <input
            className="input browser-search"
            placeholder="Filter by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <input
            type="range"
            className="slider size-slider"
            min={90}
            max={300}
            value={size}
            style={{ '--pct': `${((size - 90) / 210) * 100}%` } as React.CSSProperties}
            onChange={(e) => setSize(Number(e.target.value))}
            title="Thumbnail size"
            aria-label="Thumbnail size"
          />
        </div>

        <div
          className="grid-scroll"
          ref={gridRef}
          tabIndex={0}
          onKeyDown={onGridKey}
          onClick={(e) => e.target === e.currentTarget && setSelected(new Set())}
        >
          <div className="grid-content" style={{ height: rows * rowH + GAP }}>
            {visible}
          </div>
          {!loading && dir && !items.length && !error && (
            <div className="grid-empty">
              {files.length
                ? 'Nothing matches the current filters.'
                : subdirs
                  ? `No images or videos directly in this folder. Turn on "Include subfolders" or pick one of its ${plural(subdirs, 'subfolder')}.`
                  : 'No images or videos in this folder.'}
            </div>
          )}
          {error && <div className="grid-empty error">Couldn't read this folder: {error}</div>}
          {!dir && <div className="grid-empty">Add a source folder to browse your media.</div>}
        </div>

        <div className={`selection-bar ${selCount ? 'active' : ''}`}>
          {selCount ? (
            <>
              <b>{plural(selCount, 'item')} selected</b>
              <span className="muted">Drag onto a theme, or</span>
              <button className="btn primary small" disabled={!targetTheme} onClick={() => void addTo(selectedList(), target)}>
                Add to {targetTheme?.name ?? 'theme'} (Enter)
              </button>
              <button className="btn small" onClick={() => void newThemeFromSelection()}>
                New theme from selection
              </button>
              {selInTarget > 0 && (
                <button className="btn small" onClick={() => removeFromTarget(selectedList())}>
                  Remove {selInTarget} from {targetTheme?.name}
                </button>
              )}
              <span className="grow" />
              <button className="btn small ghost" onClick={() => setSelected(new Set())}>
                Clear selection
              </button>
            </>
          ) : (
            <span className="muted">
              Click to select. Ctrl-click and Shift-click select more, Ctrl+A selects everything. Double-click to preview.
            </span>
          )}
        </div>
        {lightbox !== null && (
          <Lightbox
            items={items}
            index={lightbox}
            selected={!!items[lightbox] && selected.has(items[lightbox].path)}
            onIndex={setLightbox}
            onToggle={() => {
              const p = items[lightbox]?.path;
              if (!p) return;
              const next = new Set(selected);
              if (next.has(p)) next.delete(p);
              else next.add(p);
              setSelected(next);
            }}
            onClose={() => {
              setLightbox(null);
              gridRef.current?.focus();
            }}
          />
        )}
      </section>

      <aside className="targets">
        <div className="panel-tab-bar">
          <span className="panel-tab active">Themes</span>
          <span className="grow" />
          <button className="icon-btn" title="New theme (from the selection, if any)" onClick={() => void newThemeFromSelection()}>
            <Icon name="plus" />
          </button>
        </div>
        <div className="target-list">
          {session.themes.map((t) => (
            <TargetRow
              key={t.id}
              theme={t}
              active={t.id === target}
              onPick={() => setTarget(t.id)}
              onDropPaths={(paths) => void addTo(paths, t.id)}
            />
          ))}
          <div
            className="target-new"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void addTo(readDropPaths(e), null);
            }}
            onClick={() => void newThemeFromSelection()}
          >
            <Icon name="plus" size={14} /> Drop here for a new theme
          </div>
        </div>
      </aside>
    </div>
  );
}

import { useState } from 'react';
import {
  ANIMATION_EXTS,
  AUDIO_EXTS,
  extOf,
  FONT_EXTS,
  IMAGE_EXTS,
  newId,
  type Session,
  type Theme,
  TEXT_EXTS,
} from '../../shared/types';
import { thumbUrl } from '../engine/media';
import { themesFromScan } from '../presets';
import { useStudio } from '../store';
import { plural } from '../util';
import { HelpButton } from './controls';
import { Icon } from './Icon';
import { addAudioFiles, THEME_MIME } from './Timeline';

// Drag type used when dragging media from the browser grid.
export const PATHS_MIME = 'application/x-trance-paths';

// Paths from a drop: an in-app media selection, or files from the OS.
export function readDropPaths(e: React.DragEvent): string[] {
  const internal = e.dataTransfer.getData(PATHS_MIME);
  if (internal) {
    try {
      return JSON.parse(internal) as string[];
    } catch {
      return [];
    }
  }
  return [...e.dataTransfer.files].map((f) => window.trance.pathForFile(f));
}

export async function addFolderAsThemes(folder: string): Promise<void> {
  const { edit, select, notify } = useStudio.getState();
  const scan = await window.trance.scanFolder(folder, true);
  const themes = themesFromScan(scan);
  if (!themes.length && !scan.audio.length) {
    notify('No usable media found in that folder');
    return;
  }
  edit((s) => {
    for (const t of themes) {
      s.themes.push(t);
    }
  });
  if (themes.length) select({ kind: 'theme', id: themes[0].id });
  notify(`Added ${plural(themes.length, 'theme')}`);
}

// Adds loose files to a theme (creating one if needed).
export async function addFilesToTheme(paths: string[], themeId?: string, name?: string): Promise<string | undefined> {
  const { edit, select } = useStudio.getState();
  const texts: string[] = [];
  for (const p of paths.filter((p) => TEXT_EXTS.includes(extOf(p)))) {
    texts.push(...(await window.trance.readTextFile(p, true)));
  }
  const pick = (exts: string[]) => paths.filter((p) => exts.includes(extOf(p)));
  const images = pick(IMAGE_EXTS);
  const animations = pick(ANIMATION_EXTS);
  const fonts = pick(FONT_EXTS);
  if (!images.length && !animations.length && !fonts.length && !texts.length) return themeId;
  let target = themeId;
  edit((s) => {
    let theme = s.themes.find((t) => t.id === target);
    if (!theme) {
      theme = { id: newId(), name: name ?? `Theme ${s.themes.length + 1}`, images: [], animations: [], fonts: [], texts: [] };
      s.themes.push(theme);
      target = theme.id;
    }
    const add = (list: string[], items: string[]) => {
      const have = new Set(list);
      for (const i of items) if (!have.has(i)) (have.add(i), list.push(i));
    };
    add(theme.images, images);
    add(theme.animations, animations);
    add(theme.fonts, fonts);
    theme.texts.push(...texts);
  });
  select({ kind: 'theme', id: target! });
  return target;
}

export async function handleDroppedPaths(paths: string[], themeId?: string): Promise<void> {
  const audio = paths.filter((p) => AUDIO_EXTS.includes(extOf(p)));
  const known = [...IMAGE_EXTS, ...ANIMATION_EXTS, ...FONT_EXTS, ...TEXT_EXTS, ...AUDIO_EXTS];
  // Anything without a known extension is treated as a folder.
  const folders = paths.filter((p) => !known.includes(extOf(p)));
  for (const f of folders) await addFolderAsThemes(f);
  await addFilesToTheme(paths.filter((p) => !folders.includes(p) && !audio.includes(p)), themeId);
  if (audio.length) await addAudioFiles(audio);
}

function ThemeCard({ theme, selected, placed }: { theme: Theme; selected: boolean; placed: boolean }) {
  const [over, setOver] = useState(false);
  const thumbs = theme.images.slice(0, 4);
  return (
    <button
      className={`theme-card ${selected ? 'selected' : ''} ${over ? 'drop' : ''}`}
      onClick={() => useStudio.getState().select({ kind: 'theme', id: theme.id })}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(THEME_MIME, theme.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      title="Click to edit. Drag onto the Themes row of the timeline to schedule it."
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        if (e.dataTransfer.types.includes(THEME_MIME)) return;
        void handleDroppedPaths(readDropPaths(e), theme.id);
      }}
    >
      <div className={`theme-mosaic n${Math.max(1, thumbs.length)}`}>
        {thumbs.map((p) => (
          <img key={p} src={thumbUrl(p)} loading="lazy" decoding="async" alt="" />
        ))}
        {!thumbs.length && (
          <div className="thumb-empty">
            <Icon name={theme.animations.length ? 'film' : 'text'} size={22} />
          </div>
        )}
      </div>
      <div className="theme-info">
        <div className="theme-name ellipsis">{theme.name}</div>
        <div className="theme-counts">
          <span title="Images">
            <Icon name="image" size={13} /> {theme.images.length}
          </span>
          <span title="Videos">
            <Icon name="film" size={13} /> {theme.animations.length}
          </span>
          <span title="Phrases">
            <Icon name="text" size={13} /> {theme.texts.length}
          </span>
        </div>
        {!placed && <div className="theme-unplaced">Not on the timeline</div>}
      </div>
    </button>
  );
}

export function Library() {
  const session = useStudio((s) => s.session)!;
  const selection = useStudio((s) => s.selection);
  const preparing = useStudio((s) => s.preparing.length);
  const [dropping, setDropping] = useState(false);

  const newTheme = () => {
    const id = newId();
    useStudio.getState().edit((s) => {
      s.themes.push({ id, name: `Theme ${s.themes.length + 1}`, images: [], animations: [], fonts: [], texts: [] });
    });
    useStudio.getState().select({ kind: 'theme', id });
  };

  return (
    <aside
      className={`library ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        void handleDroppedPaths(readDropPaths(e));
      }}
    >
      <div className="panel-tab-bar">
        <span className="panel-tab active">Themes</span>
        <span className="grow" />
        <HelpButton topic="media-and-themes#the-themes-panel" label="themes" />
        <button className="icon-btn" title="Add a folder (each subfolder becomes a theme)" onClick={async () => {
          const f = await window.trance.openFolder();
          if (f) await addFolderAsThemes(f);
        }}>
          <Icon name="folder" />
        </button>
        <button className="icon-btn" title="New empty theme" onClick={newTheme}>
          <Icon name="plus" />
        </button>
      </div>
      <div className="library-list">
        {session.themes.map((t) => (
          <ThemeCard
            key={t.id}
            theme={t}
            selected={selection?.kind === 'theme' && selection.id === t.id}
            placed={!session.themeBlocks.length || session.themeBlocks.some((b) => b.themeId === t.id)}
          />
        ))}
        {!session.themes.length && (
          <div className="library-empty">
            <p>No themes yet. A theme is a set of images, videos and phrases that are shown together.</p>
            <button className="btn primary" onClick={() => useStudio.getState().setPage('media')}>
              <Icon name="image" /> Pick media
            </button>
            <p className="muted">
              Or drop a folder here. Each subfolder becomes its own theme.
            </p>
          </div>
        )}
      </div>
      {preparing > 0 && (
        <div className="library-status">
          <div className="spinner small" /> Preparing {plural(preparing, 'video')}...
        </div>
      )}
    </aside>
  );
}

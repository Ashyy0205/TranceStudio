import { useEffect, useState } from 'react';
import {
  ANIMATION_EXTS,
  AUDIO_EXTS,
  defaultSession,
  extOf,
  FONT_EXTS,
  IMAGE_EXTS,
  sessionDuration,
  TEXT_EXTS,
} from '../shared/types';

const KNOWN_EXTS = [...IMAGE_EXTS, ...ANIMATION_EXTS, ...FONT_EXTS, ...TEXT_EXTS, ...AUDIO_EXTS, 'trance'];
import { ExportDialog } from './components/ExportDialog';
import { contextTopic, HelpPanel } from './components/Help';
import { Icon, Logo } from './components/Icon';
import { Inspector } from './components/Inspector';
import { MediaPage } from './components/MediaBrowser';
import { addFolderAsThemes, handleDroppedPaths, Library } from './components/Library';
import { Modal } from './components/controls';
import { Preview, preview } from './components/Preview';
import { Timeline } from './components/Timeline';
import { TooltipLayer } from './components/Tooltip';
import { ChecklistButton, TourOverlay, TourPrompt, useChecklistWatch } from './components/Tour';
import { forgetRecent, openSessionFile, recentSessions, saveSession, useStudio } from './store';
import { basename } from './util';

const WARNING_KEY = 'trance-studio.flash-warning-accepted';

function newSession(): void {
  const { session, dirty, load } = useStudio.getState();
  if (session && dirty && !window.confirm('Start a new session? Unsaved changes to this one will be lost.')) return;
  load(defaultSession(), null);
}

function toggleHelp(): void {
  const { help, openHelp } = useStudio.getState();
  openHelp(help === null ? contextTopic() : null);
}

async function playFullscreen(): Promise<void> {
  const { session, setModal, page, setPage } = useStudio.getState();
  if (!session) return;
  if (preview.isFullscreen) return preview.exitFullscreen();
  if (page !== 'edit') setPage('edit');
  let accepted = false;
  try {
    accepted = localStorage.getItem(WARNING_KEY) === '1';
  } catch {
    // Storage unavailable.
  }
  if (!accepted) {
    setModal('warning');
    return;
  }
  preview.enterFullscreen();
  preview.play();
}

function FlashWarning() {
  const setModal = useStudio((s) => s.setModal);
  return (
    <Modal
      title="Before you play"
      onClose={() => setModal(null)}
      footer={
        <>
          <button className="btn ghost" onClick={() => setModal(null)}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              try {
                localStorage.setItem(WARNING_KEY, '1');
              } catch {
                // Storage unavailable.
              }
              setModal(null);
              void playFullscreen();
            }}
          >
            I understand, play
          </button>
        </>
      }
    >
      <div className="warning">
        <Icon name="warning" size={28} />
        <p>
          Sessions contain rapidly flashing images, text and spinning patterns. They may trigger seizures in people with
          photosensitive epilepsy. Don't watch if that applies to you, and stop immediately if you feel unwell.
        </p>
      </div>
      <p className="muted small">Press Esc at any time to exit fullscreen playback.</p>
    </Modal>
  );
}

function Welcome() {
  const { load } = useStudio.getState();
  const [dropping, setDropping] = useState(false);
  const [recent, setRecent] = useState(recentSessions);
  return (
    <div
      className={`welcome ${dropping ? 'dropping' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const paths = [...e.dataTransfer.files].map((f) => window.trance.pathForFile(f));
        const sessionFile = paths.find((p) => extOf(p) === 'trance');
        if (sessionFile) {
          window.trance
            .loadSession(sessionFile)
            .then((s) => load(s, sessionFile))
            .catch((err) => useStudio.getState().notify(`Couldn't open ${basename(sessionFile)}: ${err instanceof Error ? err.message : err}`));
          return;
        }
        load(defaultSession(), null);
        // Folders become themes (one per subfolder); loose files go into a theme.
        const folders = paths.filter((p) => !KNOWN_EXTS.includes(extOf(p)));
        void Promise.all(folders.map((f) => addFolderAsThemes(f))).then(() =>
          handleDroppedPaths(paths.filter((p) => !folders.includes(p))),
        );
      }}
    >
      <div className="project-manager">
        <div className="pm-head">
          <Logo size={20} />
          <span>Trance Studio</span>
        </div>
        <div className="pm-body">
          <nav className="pm-actions">
            <button className="pm-action primary" onClick={newSession}>
              <Icon name="plus" />
              <span>
                <b>New session</b>
                <small>Opens the editor with an empty session</small>
              </span>
            </button>
            <button className="pm-action" onClick={() => void openSessionFile()}>
              <Icon name="open" />
              <span>
                <b>Open session...</b>
                <small>A saved .trance file</small>
              </span>
            </button>
            <button className="pm-action" onClick={() => useStudio.getState().openHelp('getting-started')}>
              <Icon name="help" />
              <span>
                <b>Read the manual</b>
                <small>How sessions are put together (F1)</small>
              </span>
            </button>
          </nav>
          <section className="pm-recent">
            <div className="pm-recent-head">Recent sessions</div>
            {recent.length ? (
              <ul>
                {recent.map((p) => (
                  <li key={p}>
                    <button
                      onClick={async () => {
                        try {
                          load(await window.trance.loadSession(p), p);
                        } catch {
                          forgetRecent(p);
                          setRecent(recentSessions());
                          useStudio.getState().notify(`Couldn't open ${basename(p)}. It may have been moved or deleted.`);
                        }
                      }}
                      title={p}
                    >
                      <span className="pm-recent-name">{basename(p).replace(/.trance$/i, '')}</span>
                      <span className="pm-recent-path">{p}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="pm-empty">
                Sessions you save will be listed here. You can also drop a media folder onto this window to start a
                session with one theme for each subfolder.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function TopBar() {
  const session = useStudio((s) => s.session)!;
  const path = useStudio((s) => s.path);
  const dirty = useStudio((s) => s.dirty);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const page = useStudio((s) => s.page);
  const { undo, redo, setModal, close, setPage } = useStudio.getState();
  return (
    <header className="topbar">
      <button
        className="app-glyph"
        title="Close session and return to the session list"
        onClick={() => {
          if (useStudio.getState().dirty && !window.confirm('Close this session? Unsaved changes will be lost.')) return;
          close();
        }}
      >
        <Logo size={20} />
      </button>
      <div className="toolbar-group">
        <button className="tool-btn" onClick={newSession} title="New session">
          New
        </button>
        <button className="tool-btn" onClick={() => void openSessionFile()} title="Open a session (Ctrl+O)">
          Open
        </button>
        <button className="tool-btn" data-tour="save" onClick={() => void saveSession()} title={'Save (Ctrl+S)\nCtrl+Shift+S saves a copy under a new name'}>
          Save
        </button>
      </div>
      <div className="toolbar-group">
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">
          <Icon name="redo" />
        </button>
      </div>
      <div className="page-tabs" role="tablist">
        <button
          role="tab"
          data-tour="media-tab"
          aria-selected={page === 'media'}
          className={page === 'media' ? 'on' : ''}
          onClick={() => setPage('media')}
          title={'Media page (Ctrl+1)\nBrowse your folders and add images and videos to themes'}
        >
          Media
        </button>
        <button
          role="tab"
          data-tour="edit-tab"
          aria-selected={page === 'edit'}
          className={page === 'edit' ? 'on' : ''}
          onClick={() => setPage('edit')}
          title={'Edit page (Ctrl+2)\nArrange the timeline, change looks and watch the session'}
        >
          Edit
        </button>
      </div>
      <div className="session-title" title={path ?? 'Not saved yet'}>
        {session.name || 'Untitled session'}
        {dirty && <span className="unsaved">Edited</span>}
      </div>
      <div className="toolbar-group help-group" data-tour="help">
        <ChecklistButton />
        <button className="icon-btn" onClick={toggleHelp} title={'Manual (F1)\nOpens at the topic for what you have selected'}>
          <Icon name="help" />
        </button>
      </div>
      <button className="btn" data-tour="output" onClick={() => void playFullscreen()} title={'Watch fullscreen (F5)\nEsc returns to the editor and Space pauses'}>
        <Icon name="fullscreen" /> Fullscreen
      </button>
      <button className="btn primary" data-tour="output" onClick={() => setModal('export')} title={'Export video (Ctrl+E)\nSaves the session as an MP4 file'}>
        <Icon name="export" /> Export
      </button>
    </header>
  );
}

function Editor() {
  const page = useStudio((s) => s.page);
  useChecklistWatch();
  return (
    <div className="editor">
      <TopBar />
      {page === 'media' ? (
        <MediaPage />
      ) : (
        <div className="workspace">
          <div className="upper">
            <Library />
            <Preview />
            <Inspector />
          </div>
          <Timeline />
        </div>
      )}
      <TourPrompt />
    </div>
  );
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.closest('input, textarea, select, [contenteditable]');
      const { session, undo, redo, selection, edit, select, setModal, modal, page, setPage } = useStudio.getState();
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveSession(e.shiftKey);
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openSessionFile();
      } else if (e.key === 'F1') {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if (!session || modal) return;
      if (mod && (e.key === '1' || e.key === '2')) {
        e.preventDefault();
        setPage(e.key === '1' ? 'media' : 'edit');
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        setModal('export');
      } else if (e.key === 'F5') {
        e.preventDefault();
        void playFullscreen();
      }
      if (typing) return;
      // The media page handles its own keys (selection, Delete removes from a theme).
      if (page !== 'edit' && !mod) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (e.key === ' ') {
        e.preventDefault();
        preview.toggle();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        preview.seek(e.key === 'Home' ? 0 : sessionDuration(session));
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selection) {
        if (selection.kind === 'block') {
          edit((s) => void (s.blocks = s.blocks.filter((b) => b.id !== selection.id)));
          select(null);
        } else if (selection.kind === 'themeBlock') {
          edit((s) => void (s.themeBlocks = s.themeBlocks.filter((b) => b.id !== selection.id)));
          select(null);
        } else if (selection.kind === 'audio') {
          edit((s) => void (s.audio = s.audio.filter((a) => a.id !== selection.id)));
          select(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const session = useStudio((s) => s.session);
  const modal = useStudio((s) => s.modal);
  const toast = useStudio((s) => s.toast);
  const dirty = useStudio((s) => s.dirty);
  useShortcuts();

  useEffect(() => {
    void window.trance.initialFile().then(async (file) => {
      if (!file) return;
      try {
        useStudio.getState().load(await window.trance.loadSession(file), file);
      } catch (e) {
        useStudio.getState().notify(`Couldn't open ${file}: ${e instanceof Error ? e.message : e}`);
      }
    });
  }, []);

  useEffect(() => {
    document.title = session ? `${session.name || 'Untitled'}${dirty ? ' *' : ''} - Trance Studio` : 'Trance Studio';
  }, [session, dirty]);

  // Ask before closing the window with unsaved changes (main process shows the dialog).
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useStudio.getState().dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <>
      {session ? <Editor /> : <Welcome />}
      <HelpPanel />
      {modal === 'export' && session && <ExportDialog />}
      {modal === 'warning' && <FlashWarning />}
      {toast && <div className="toast">{toast}</div>}
      <TourOverlay />
      <TooltipLayer />
    </>
  );
}

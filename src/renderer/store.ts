import { produce } from 'immer';
import { create } from 'zustand';
import { type AnimationInfo, looksNeedTidy, ownLooks, type Session } from '../shared/types';
import { markDone } from './onboarding';
import { normalizeSession } from './session';

export type Selection =
  | { kind: 'block'; id: string }
  | { kind: 'audio'; id: string }
  | { kind: 'theme'; id: string }
  | { kind: 'themeBlock'; id: string }
  | { kind: 'channel'; index: number }
  | null;

export type Page = 'media' | 'edit';

export type Modal = 'export' | 'warning' | null;

interface StudioState {
  session: Session | null;
  path: string | null;
  dirty: boolean;
  past: Session[];
  future: Session[];
  lastEditKey: string | null;
  lastEditTime: number;
  selection: Selection;
  modal: Modal;
  page: Page;
  // Manual topic shown in the help panel, or null when it is closed.
  help: string | null;
  // Animation path -> extracted frames and frame rate.
  frames: Record<string, AnimationInfo>;
  preparing: string[];
  toast: string | null;

  load(session: Session, path: string | null): void;
  // Applies an edit (immer recipe). Rapid edits with the same key (e.g. a
  // slider drag) collapse into one undo step.
  edit(recipe: (s: Session) => void, key?: string): void;
  undo(): void;
  redo(): void;
  select(sel: Selection): void;
  setModal(m: Modal): void;
  setPage(p: Page): void;
  openHelp(topic: string | null): void;
  setPath(path: string): void;
  markSaved(): void;
  notify(msg: string): void;
  close(): void;
}

const HISTORY = 200;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudio = create<StudioState>((set, get) => ({
  session: null,
  path: null,
  dirty: false,
  past: [],
  future: [],
  lastEditKey: null,
  lastEditTime: 0,
  selection: null,
  modal: null,
  page: 'edit',
  help: null,
  frames: {},
  preparing: [],
  toast: null,

  load(session, path) {
    const s = normalizeSession(session);
    set({ session: s, path, dirty: false, past: [], future: [], selection: null, lastEditKey: null, page: 'edit' });
    if (path) rememberRecent(path);
    void prepareAnimations(s);
  },

  edit(recipe, key) {
    const { session, past, lastEditKey, lastEditTime } = get();
    if (!session) return;
    // Recipes only mutate the draft. Ignore any return value: Immer would
    // otherwise replace the whole session with it (e.g. "(e) => (e.fps = 30)"
    // returns 30), which crashed the editor from the export dialog.
    let next = produce(session, (draft) => {
      recipe(draft);
    });
    // Looks belong to blocks: drop looks that left the timeline, split shared ones.
    if (looksNeedTidy(next)) next = produce(next, (s) => void ownLooks(s));
    if (next === session) return;
    const now = Date.now();
    const coalesce = !!key && key === lastEditKey && now - lastEditTime < 1500;
    set({
      session: next,
      dirty: true,
      past: coalesce ? past : [...past.slice(-HISTORY + 1), session],
      future: [],
      lastEditKey: key ?? null,
      lastEditTime: now,
    });
    if (next.themes !== session.themes) void prepareAnimations(next);
  },

  undo() {
    const { session, past, future } = get();
    if (!session || !past.length) return;
    set({ session: past[past.length - 1], past: past.slice(0, -1), future: [session, ...future], dirty: true, lastEditKey: null });
  },

  redo() {
    const { session, past, future } = get();
    if (!session || !future.length) return;
    set({ session: future[0], past: [...past, session], future: future.slice(1), dirty: true, lastEditKey: null });
  },

  select: (selection) => set({ selection }),
  setModal: (modal) => set({ modal }),
  setPage: (page) => set({ page }),
  openHelp: (help) => set({ help }),
  setPath: (path) => set({ path }),
  markSaved: () => set({ dirty: false }),
  notify(msg) {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
  close: () => set({ session: null, path: null, dirty: false, past: [], future: [], selection: null }),
}));

// Extracts frames for any animations that haven't been prepared yet.
async function prepareAnimations(session: Session): Promise<void> {
  const { frames, preparing } = useStudio.getState();
  const todo = [...new Set(session.themes.flatMap((t) => t.animations))].filter(
    (p) => !(p in frames) && !preparing.includes(p),
  );
  if (!todo.length) return;
  useStudio.setState((s) => ({ preparing: [...s.preparing, ...todo] }));
  await Promise.all(
    todo.map(async (p) => {
      let result: AnimationInfo = { frames: [], fps: 15 };
      try {
        result = (await window.trance.prepareAnimations([p]))[p] ?? result;
      } catch (e) {
        console.warn('animation prep failed', p, e);
      }
      useStudio.setState((s) => ({
        frames: { ...s.frames, [p]: result },
        preparing: s.preparing.filter((x) => x !== p),
      }));
    }),
  );
}

export async function saveSession(saveAs = false): Promise<boolean> {
  const { session, path, setPath, markSaved, notify } = useStudio.getState();
  if (!session) return false;
  let target = path;
  if (!target || saveAs) {
    target = await window.trance.saveSessionDialog(`${session.name || 'session'}.trance`);
    if (!target) return false;
  }
  await window.trance.saveSession(target, session);
  setPath(target);
  rememberRecent(target);
  markSaved();
  markDone('save');
  notify('Saved');
  return true;
}

export async function openSessionFile(): Promise<void> {
  const [file] = await window.trance.openFiles('session', false);
  if (!file) return;
  try {
    const s = await window.trance.loadSession(file);
    useStudio.getState().load(s, file);
  } catch (e) {
    useStudio.getState().notify(`Couldn't open session: ${e instanceof Error ? e.message : e}`);
  }
}

// Exposed for debugging from the devtools console.
(window as unknown as { __studio: typeof useStudio }).__studio = useStudio;

// Recent sessions (per-machine convenience; stored locally)

const RECENT_KEY = 'trance-studio.recent';

export function recentSessions(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberRecent(path: string): void {
  try {
    const list = [path, ...recentSessions().filter((p) => p !== path)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage unavailable.
  }
}

export function forgetRecent(path: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentSessions().filter((p) => p !== path)));
  } catch {
    // Storage unavailable.
  }
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { defaultProgram, type Program } from '../../shared/types';
import { type ChecklistId, markDone, type TourStep, useOnboarding } from '../onboarding';
import { useStudio } from '../store';
import { Icon, Logo } from './Icon';
import { mediaStatus } from './MediaBrowser';
import { usePlayback } from './Preview';

const studio = () => useStudio.getState();

const DEFAULT_LOOK = defaultProgram();
const lookChanged = (p: Program) =>
  (Object.keys(DEFAULT_LOOK) as (keyof Program)[]).some(
    (k) => k !== 'id' && k !== 'name' && JSON.stringify(p[k]) !== JSON.stringify(DEFAULT_LOOK[k]),
  );

// The first-session tutorial. Every step is something to do in the user's own
// session, and it waits until it has been done, so by the end the session is
// built, saved and exported and the checklist is complete.
export function tutorialSteps(): TourStep[] {
  const session = () => studio().session;
  let lookBefore = '';
  return [
    {
      title: 'Build your first session',
      body:
        'This tutorial walks you through making a short session from your own media. Each step asks you to do one ' +
        'thing and waits until you have done it. If a step does not apply to you, use Skip step. At the end you ' +
        'will have a saved session and a video.',
    },
    {
      target: '[data-tour="media-tab"]',
      title: 'Open the Media page',
      body: 'Sessions start with your images and videos. The Media page is where you browse your folders and pick what goes into each theme.',
      action: 'Click the Media tab.',
      done: () => studio().page === 'media',
    },
    {
      target: '.sources',
      page: 'media',
      title: 'Add a source folder',
      body:
        'Sources are the folders where you keep your media. Add one with Add folder or the + button. It stays ' +
        'listed for every session, so you only do this once.',
      action: 'Add a folder that has images or videos in it.',
      done: () => mediaStatus.sources > 0,
    },
    {
      target: '.sources, .browser',
      page: 'media',
      title: 'Find your media',
      body:
        'Click a folder on the left to show what is in it. If a folder only has subfolders, open one of them, or ' +
        'turn on Include subfolders at the top to see everything at once.',
      action: 'Show a folder with images or videos.',
      done: () => mediaStatus.items > 0,
    },
    {
      target: '.browser',
      page: 'media',
      title: 'Select some media',
      body:
        'Click a thumbnail to select it. Ctrl-click and Shift-click select more, and Ctrl+A selects everything ' +
        'shown. Double-click shows an item full size. Ten or more images works well.',
      action: 'Select some images or videos, then click Next.',
      done: () => mediaStatus.selected > 0,
      autoAdvance: false,
    },
    {
      target: '.targets, .selection-bar',
      page: 'media',
      title: 'Make a theme',
      body:
        'A theme is a set of images, videos and phrases that are shown together. Click "Drop here for a new theme" ' +
        'to make one from your selection, or drag the selection onto it.',
      action: 'Put your selection into a theme.',
      done: () => !!session()?.themes.some((t) => t.images.length || t.animations.length),
    },
    {
      target: '[data-tour="edit-tab"]',
      title: 'Go to the Edit page',
      body: 'The Edit page is where you arrange the session on the timeline and watch it.',
      action: 'Click the Edit tab.',
      done: () => studio().page === 'edit',
    },
    {
      target: '.library .theme-card',
      page: 'edit',
      title: 'Open your theme',
      body: 'Your themes are listed here. Clicking one shows its phrases and media in the inspector on the right.',
      action: 'Click your theme.',
      done: () => ['theme', 'themeBlock'].includes(studio().selection?.kind ?? ''),
    },
    {
      target: '[data-tour="phrases"]',
      page: 'edit',
      title: 'Write some phrases',
      body:
        'Phrases are the words that flash on screen. Type one per line; a "/" splits a phrase over two rows. ' +
        'Phrases in .txt files are added automatically when you add a folder.',
      action: 'Type a few phrases, then click Next.',
      missing: 'Click your theme in the Themes panel on the left to show its Phrases box.',
      done: () => !!session()?.themes.some((t) => t.texts.length),
      autoAdvance: false,
    },
    {
      target: '.library .theme-card, [data-tour="row-themes"]',
      page: 'edit',
      title: 'Put the theme on the timeline',
      body:
        'The Themes row decides which theme is shown when. Drag your theme card onto the row, or click "Lay out ' +
        "themes one after another\". Later you can drag a block's edges to change when it starts and stops.",
      action: 'Add your theme to the Themes row.',
      done: () => !!session()?.themeBlocks.length,
    },
    {
      target: '[data-tour="row-audio"]',
      page: 'edit',
      title: 'Add audio',
      body:
        'Drop a voice track onto Foreground and music onto Background, or click "Add audio" on a row. Clips always ' +
        'play in full and can go anywhere. No audio to hand? Skip this step.',
      action: 'Add an audio file.',
      done: () => !!session()?.audio.length,
    },
    {
      target: '[data-tour="row-looks"]',
      page: 'edit',
      title: 'Select the look',
      body:
        'The Looks row decides how things are shown: which visual styles appear, how fast, and in what colours. The ' +
        'session starts with one look block.',
      action: 'Click the look block.',
      done: () => studio().selection?.kind === 'block',
    },
    {
      target: '[data-tour="look-preset"]',
      page: 'edit',
      title: 'Choose a style',
      body:
        'A preset sets the visual styles and speed in one go: Gentle suits an induction and Intense a peak. You can ' +
        'also turn single styles on and off below it, or pick colours further down.',
      action: 'Apply a preset or change a style, then click Next.',
      missing: 'Click the look block on the Looks row to show its settings.',
      enter: () => (lookBefore = JSON.stringify(session()?.programs)),
      done: () => JSON.stringify(session()?.programs) !== lookBefore || !!session()?.programs.some(lookChanged),
      autoAdvance: false,
    },
    {
      target: '.viewer',
      page: 'edit',
      title: 'Watch it',
      body:
        'The viewer plays the session exactly as it will be exported, and changes as you edit. Click the picture or ' +
        'press Space to play and pause. F5 watches fullscreen.',
      action: 'Play the session.',
      done: () => usePlayback.getState().playing,
    },
    {
      target: '[data-tour="save"]',
      title: 'Save your session',
      body: 'Sessions are saved as .trance files that you can open again later. Ctrl+S saves at any time.',
      action: 'Click Save and choose where to keep the file.',
      done: () => !!studio().path,
    },
    {
      target: '.topbar .btn.primary[data-tour="output"]',
      title: 'Export a video',
      body: 'Export turns the session into an MP4 video you can watch anywhere.',
      action: 'Click Export.',
      done: () => studio().modal === 'export' || !!useOnboarding.getState().done.export,
    },
    {
      target: '.modal',
      title: 'Start the export',
      body:
        'Choose a resolution and quality, and where to save the video, then start the export. It can take a few ' +
        'minutes; you can skip this step and export later.',
      action: 'Export the video.',
      missing: 'Wait for the export to finish. If you closed the export window, click Export at the top right.',
      done: () => !!useOnboarding.getState().done.export,
    },
    {
      title: 'Your session is ready',
      body:
        'You have built, saved and exported a session. From here, add more themes on the Media page, add look ' +
        'blocks with the + at the end of the Looks row, and drag blocks to shape the session. Hover over anything ' +
        'for a description, and press F1 for the manual.',
    },
  ];
}

export const startTutorial = () => useOnboarding.getState().startTour(tutorialSteps());

interface ChecklistItem {
  id: ChecklistId;
  label: string;
  show: TourStep;
}

const CHECKLIST: ChecklistItem[] = [
  {
    id: 'media',
    label: 'Add images or videos to a theme',
    show: {
      target: '.targets',
      page: 'media',
      title: 'Add media to a theme',
      body: 'Add a source folder on the left, select some images or videos, and drag them onto a theme here.',
    },
  },
  {
    id: 'phrases',
    label: 'Write some phrases',
    show: {
      target: '.library',
      page: 'edit',
      title: 'Write some phrases',
      body: 'Click a theme here, then type phrases into the Phrases box in the inspector, one per line.',
    },
  },
  {
    id: 'placed',
    label: 'Put a theme on the timeline',
    show: {
      target: '[data-tour="row-themes"]',
      page: 'edit',
      title: 'Put a theme on the timeline',
      body: 'Drag a theme from the Themes panel onto this row, or click + on the row label to add one at the playhead.',
    },
  },
  {
    id: 'audio',
    label: 'Add audio',
    show: {
      target: '[data-tour="row-audio"]',
      page: 'edit',
      title: 'Add audio',
      body: 'Drop an audio file onto one of these rows, or click "Add audio" on an empty row.',
    },
  },
  {
    id: 'look',
    label: 'Change the look',
    show: {
      target: '[data-tour="row-looks"]',
      page: 'edit',
      title: 'Change the look',
      body: 'Click the look block, then pick a preset or change the visual styles, speed and colours in the inspector.',
    },
  },
  {
    id: 'play',
    label: 'Watch it in the viewer',
    show: {
      target: '.viewer',
      page: 'edit',
      title: 'Watch it',
      body: 'Press Space or click the picture to play. F5 watches fullscreen.',
    },
  },
  {
    id: 'save',
    label: 'Save the session',
    show: {
      target: '[data-tour="save"]',
      title: 'Save the session',
      body: 'Click Save or press Ctrl+S. Sessions are saved as .trance files.',
    },
  },
  {
    id: 'export',
    label: 'Export a video',
    show: {
      target: '.topbar .btn.primary[data-tour="output"]',
      title: 'Export a video',
      body: 'Click Export or press Ctrl+E to save the session as an MP4 video.',
    },
  },
];

// Ticks checklist items off as the user does them.
export function useChecklistWatch(): void {
  useEffect(() => {
    const check = () => {
      const s = studio().session;
      if (!s) return;
      if (s.themes.some((t) => t.images.length || t.animations.length)) markDone('media');
      if (s.themes.some((t) => t.texts.length)) markDone('phrases');
      if (s.themeBlocks.length) markDone('placed');
      if (s.audio.length) markDone('audio');
      if (s.blocks.length > 1 || s.programs.some(lookChanged)) markDone('look');
    };
    check();
    const unsub = useStudio.subscribe((st, prev) => st.session !== prev.session && check());
    const unsubPlay = usePlayback.subscribe((p) => p.playing && markDone('play'));
    return () => {
      unsub();
      unsubPlay();
    };
  }, []);
}

// Getting started button and checklist for the top bar.
export function ChecklistButton() {
  const done = useOnboarding((s) => s.done);
  const hidden = useOnboarding((s) => s.hidden);
  const open = useOnboarding((s) => s.checklistOpen);
  const { setChecklistOpen, setHidden, startTour } = useOnboarding.getState();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setChecklistOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, setChecklistOpen]);

  if (hidden) return null;
  const count = CHECKLIST.filter((c) => done[c.id]).length;
  const complete = count === CHECKLIST.length;
  return (
    <div className="checklist-wrap" ref={wrapRef}>
      <button
        className={`checklist-pill ${open ? 'on' : ''} ${complete ? 'complete' : ''}`}
        onClick={() => setChecklistOpen(!open)}
        title={'Getting started\nThe steps of a first session, ticked off as you do them'}
      >
        <span className="checklist-ring" style={{ '--pct': `${(count / CHECKLIST.length) * 100}%` } as React.CSSProperties} />
        Getting started
        <span className="checklist-count">
          {count}/{CHECKLIST.length}
        </span>
      </button>
      {open && (
        <div className="checklist-pop" role="dialog" aria-label="Getting started">
          <div className="checklist-head">
            <b>{complete ? 'All done' : 'Your first session'}</b>
            <span className="muted small">
              {complete ? 'You have used every part of the editor.' : 'Each step ticks itself off when you do it.'}
            </span>
          </div>
          {!complete && (
            <button className="btn primary checklist-start" onClick={startTutorial}>
              <Icon name="play" size={12} /> Build your first session step by step
            </button>
          )}
          <ul>
            {CHECKLIST.map((c) => (
              <li key={c.id} className={done[c.id] ? 'done' : ''}>
                <span className="check-box">{done[c.id] && <Icon name="check" size={12} />}</span>
                <span className="grow">{c.label}</span>
                {!done[c.id] && (
                  <button className="btn small ghost" onClick={() => startTour([c.show])}>
                    Show me
                  </button>
                )}
              </li>
            ))}
          </ul>
          <div className="checklist-foot">
            <button className="btn small ghost" onClick={() => useStudio.getState().openHelp('getting-started')}>
              Open the manual
            </button>
            <span className="grow" />
            <button className="btn small ghost" onClick={() => setHidden(true)} title="Hide the checklist. The manual can bring it back.">
              Hide
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Offers the tutorial the first time the editor opens.
export function TourPrompt() {
  const offered = useOnboarding((s) => s.tourOffered);
  const touring = useOnboarding((s) => !!s.tour);
  if (offered || touring) return null;
  const { setTourOffered } = useOnboarding.getState();
  return (
    <div className="tour-prompt" role="dialog" aria-label="Build your first session">
      <Logo size={36} />
      <div className="grow">
        <b>New to Trance Studio?</b>
        <p className="muted">
          Build a short session from your own media, one step at a time. It takes about five minutes, and you can
          start it later from the Getting started checklist.
        </p>
      </div>
      <button className="btn ghost" onClick={setTourOffered}>
        Not now
      </button>
      <button
        className="btn primary"
        onClick={() => {
          setTourOffered();
          startTutorial();
        }}
      >
        Start
      </button>
    </div>
  );
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 4;

// Visible areas matching `selector`, kept inside the window.
function targetRects(selector?: string): Rect[] {
  if (!selector) return [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return [...document.querySelectorAll(selector)]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width && r.height && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw)
    .map((r) => {
      const left = Math.max(PAD, r.left);
      const top = Math.max(PAD, r.top);
      return {
        left,
        top,
        width: Math.min(vw - PAD, r.right) - left,
        height: Math.min(vh - PAD, r.bottom) - top,
      };
    });
}

const sameRects = (a: Rect[], b: Rect[]) => JSON.stringify(a) === JSON.stringify(b);

const CARD_W = 330;

// Somewhere for the card that covers none of the highlighted areas or dialogs.
function placeCard(w: number, h: number, targets: Rect[], avoid: Rect[]): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 14;
  const blockers = [...targets, ...avoid].map((r) => ({ l: r.left - 8, t: r.top - 8, r: r.left + r.width + 8, b: r.top + r.height + 8 }));
  const candidates: { left: number; top: number }[] = [];
  for (const r of targets) {
    candidates.push({ left: r.left + r.width + gap, top: r.top });
    candidates.push({ left: r.left - w - gap, top: r.top });
    candidates.push({ left: r.left + r.width / 2 - w / 2, top: r.top + r.height + gap });
    candidates.push({ left: r.left + r.width / 2 - w / 2, top: r.top - h - gap });
  }
  candidates.push(
    { left: vw - w - 16, top: vh - h - 16 },
    { left: 16, top: vh - h - 16 },
    { left: vw - w - 16, top: 52 },
    { left: 16, top: 52 },
  );
  for (const c of candidates) {
    const left = Math.max(8, Math.min(vw - w - 8, c.left));
    const top = Math.max(8, Math.min(vh - h - 8, c.top));
    if (!blockers.some((b) => left < b.r && left + w > b.l && top < b.b && top + h > b.t)) return { left, top };
  }
  return { left: vw - w - 16, top: vh - h - 16 };
}

const PAGE_NAMES = { media: 'Media', edit: 'Edit' };

export function TourOverlay() {
  const tour = useOnboarding((s) => s.tour);
  const step = useOnboarding((s) => s.step);
  const page = useStudio((s) => s.page);
  const [rects, setRects] = useState<Rect[]>([]);
  const [avoid, setAvoid] = useState<Rect[]>([]);
  const [isDone, setIsDone] = useState(false);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const current = tour?.[step];
  const guided = (tour?.length ?? 0) > 1;
  const lastStep = useRef(-1);

  useEffect(() => {
    lastStep.current = -1;
  }, [tour]);

  useEffect(() => {
    if (!current) return;
    const forward = step > lastStep.current;
    lastStep.current = step;
    current.enter?.();
    const doneAtStart = current.done?.() ?? false;
    // Steps that are already done are skipped on the way forward (a theme made
    // on the Media page is already selected, for example), but shown when going
    // back.
    if (guided && forward && doneAtStart && tour && step < tour.length - 1) {
      useOnboarding.getState().goTo(step + 1);
      return;
    }
    if (current.page && studio().page !== current.page) studio().setPage(current.page);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const next = targetRects(current.target);
      setRects((prev) => (sameRects(prev, next) ? prev : next));
      const dialogs = targetRects('.modal');
      setAvoid((prev) => (sameRects(prev, dialogs) ? prev : dialogs));
      const done = current.done?.() ?? false;
      setIsDone(done);
      if (done && !doneAtStart && current.autoAdvance !== false && guided && !timer) {
        timer = setTimeout(() => {
          const st = useOnboarding.getState();
          if (st.tour?.[st.step] === current) st.goTo(Math.min(st.tour.length - 1, st.step + 1));
        }, 700);
      }
    };
    update();
    const interval = setInterval(update, 200);
    return () => {
      clearInterval(interval);
      if (timer) clearTimeout(timer);
    };
  }, [current, guided, step, tour]);

  // Esc closes a single "show me" hint. The tutorial ignores it, because Esc
  // also closes things inside the editor (the media preview, dialogs).
  useEffect(() => {
    if (!tour || guided) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useOnboarding.getState().endTour();
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tour, guided]);

  const wrongPage = !!current?.page && page !== current.page;
  const missing = !!current?.target && !rects.length && !wrongPage;

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card || !current) return;
    const h = card.offsetHeight;
    if (!current.target) {
      setCardPos({ left: (window.innerWidth - CARD_W) / 2, top: Math.max(8, (window.innerHeight - h) / 2) });
    } else {
      setCardPos(placeCard(CARD_W, h, rects, avoid));
    }
  }, [rects, avoid, current, wrongPage, missing, isDone]);

  if (!tour || !current) return null;
  const { goTo, endTour, setChecklistOpen } = useOnboarding.getState();
  const last = step === tour.length - 1;
  const waiting = guided && !!current.action && !isDone;
  const leave = () => {
    if (guided && !last && !window.confirm('Leave the tutorial? You can start it again from the Getting started checklist.')) return;
    endTour();
  };
  const shade = !current.target || rects.length > 0;

  return (
    <div className="tour-layer">
      {shade && (
        <svg className="tour-svg" width="100%" height="100%">
          <defs>
            <mask id="tour-holes">
              <rect width="100%" height="100%" fill="white" />
              {rects.map((r, i) => (
                <rect key={i} x={r.left - PAD} y={r.top - PAD} width={r.width + PAD * 2} height={r.height + PAD * 2} rx={3} fill="black" />
              ))}
            </mask>
          </defs>
          <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.5)" mask="url(#tour-holes)" />
          {rects.map((r, i) => (
            <rect
              key={i}
              className="tour-outline"
              x={r.left - PAD}
              y={r.top - PAD}
              width={r.width + PAD * 2}
              height={r.height + PAD * 2}
              rx={3}
            />
          ))}
        </svg>
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-label={current.title}
        style={cardPos ? { left: cardPos.left, top: cardPos.top, width: CARD_W } : { visibility: 'hidden', width: CARD_W }}
      >
        <div className="tour-card-head">
          <b>{current.title}</b>
          {guided && (
            <span className="muted small">
              {step + 1} of {tour.length}
            </span>
          )}
          <button className="icon-btn small" onClick={leave} title={guided ? 'Leave the tutorial' : 'Close (Esc)'}>
            <Icon name="close" size={14} />
          </button>
        </div>
        {guided && (
          <div className="tour-progress">
            <div style={{ width: `${((step + 1) / tour.length) * 100}%` }} />
          </div>
        )}
        <p>{current.body}</p>
        {wrongPage && current.page && (
          <div className="tour-note">
            <span className="grow">This step is on the {PAGE_NAMES[current.page]} page.</span>
            <button className="btn small" onClick={() => studio().setPage(current.page!)}>
              Go there
            </button>
          </div>
        )}
        {missing && (
          <div className="tour-note">{current.missing ?? "The part to use isn't on screen at the moment."}</div>
        )}
        {guided && current.action && (
          <div className={`tour-action ${isDone ? 'done' : ''}`}>
            {isDone ? <Icon name="check" size={14} /> : <span className="tour-wait" />}
            <span>
              {isDone ? (current.autoAdvance === false ? 'Done. Click Next when you are ready.' : 'Done.') : current.action}
            </span>
          </div>
        )}
        <div className="tour-card-foot">
          {guided && step > 0 && (
            <button className="btn small ghost" onClick={() => goTo(step - 1)}>
              Back
            </button>
          )}
          <span className="grow" />
          {waiting && (
            <button className="btn small ghost" onClick={() => goTo(step + 1)} title="Move on without doing this step">
              Skip step
            </button>
          )}
          <button
            className="btn small primary"
            disabled={waiting}
            onClick={() => {
              if (!guided) return endTour();
              if (!last) return goTo(step + 1);
              endTour();
              setChecklistOpen(true);
            }}
          >
            {!guided ? 'Got it' : last ? 'Finish' : step === 0 ? 'Start' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

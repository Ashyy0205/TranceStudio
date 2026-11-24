import { create } from 'zustand';

// Getting-started checklist and guided tour state. Progress is per machine
// (kept in localStorage) because it is about learning the editor, not about
// one session.

export type ChecklistId = 'media' | 'phrases' | 'placed' | 'audio' | 'look' | 'play' | 'save' | 'export';

export interface TourStep {
  // CSS selector for the areas to highlight. Every match is highlighted.
  target?: string;
  // Page the step happens on.
  page?: 'media' | 'edit';
  title: string;
  body: string;
  // What to do. Next stays disabled until `done` returns true (Skip step is
  // always available).
  action?: string;
  done?: () => boolean;
  // Move on as soon as the step is done. Off for steps where the user may want
  // to carry on (typing phrases, trying presets).
  autoAdvance?: boolean;
  // Runs when the step is shown.
  enter?: () => void;
  // Shown when the target isn't on screen, saying how to bring it back.
  missing?: string;
}

interface Stored {
  done: Partial<Record<ChecklistId, boolean>>;
  hidden: boolean;
  tourOffered: boolean;
}

const KEY = 'trance-studio.onboarding';

function load(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { done: v.done ?? {}, hidden: !!v.hidden, tourOffered: !!v.tourOffered };
  } catch {
    return { done: {}, hidden: false, tourOffered: false };
  }
}

interface OnboardingState extends Stored {
  checklistOpen: boolean;
  tour: TourStep[] | null;
  step: number;
  markDone(id: ChecklistId): void;
  setHidden(hidden: boolean): void;
  setChecklistOpen(open: boolean): void;
  setTourOffered(): void;
  startTour(steps: TourStep[]): void;
  goTo(step: number): void;
  endTour(): void;
  resetProgress(): void;
}

export const useOnboarding = create<OnboardingState>((set, get) => {
  const save = () => {
    const { done, hidden, tourOffered } = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ done, hidden, tourOffered }));
    } catch {
      // Storage unavailable.
    }
  };
  return {
    ...load(),
    checklistOpen: false,
    tour: null,
    step: 0,
    markDone(id) {
      if (get().done[id]) return;
      set((s) => ({ done: { ...s.done, [id]: true } }));
      save();
    },
    setHidden(hidden) {
      set({ hidden, checklistOpen: false });
      save();
    },
    setChecklistOpen: (checklistOpen) => set({ checklistOpen }),
    setTourOffered() {
      set({ tourOffered: true });
      save();
    },
    startTour: (tour) => set({ tour, step: 0, checklistOpen: false }),
    goTo: (step) => set({ step }),
    endTour: () => set({ tour: null, step: 0 }),
    resetProgress() {
      set({ done: {}, hidden: false });
      save();
    },
  };
});

export const markDone = (id: ChecklistId) => useOnboarding.getState().markDone(id);

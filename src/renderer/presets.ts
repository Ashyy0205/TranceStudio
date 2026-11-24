import {
  type Colour,
  colour,
  newId,
  type Program,
  type ScanResult,
  type Theme,
  VISUAL_TYPES,
  type VisualType,
} from '../shared/types';

export interface LookPreset {
  id: string;
  name: string;
  description: string;
  speed: number;
  visuals: Partial<Record<VisualType, number>>;
}

export const LOOK_PRESETS: LookPreset[] = [
  {
    id: 'classic',
    name: 'Classic',
    description: 'Every visual style at the original speed.',
    speed: 120,
    visuals: Object.fromEntries(VISUAL_TYPES.map((v) => [v, 1])),
  },
  {
    id: 'gentle',
    name: 'Gentle',
    description: 'Slower fades and steady images. Good for inductions.',
    speed: 100,
    visuals: { SLOW_FLASH: 2, FLASH_TEXT: 2, PARALLEL: 2, SUB_TEXT: 1, ANIMATION: 1 },
  },
  {
    id: 'intense',
    name: 'Intense',
    description: 'Accelerating, rapid-fire images and text.',
    speed: 140,
    visuals: { ACCELERATE: 2, SUPER_FAST: 2, SUPER_PARALLEL: 1, SUB_TEXT: 1 },
  },
  {
    id: 'text',
    name: 'Text heavy',
    description: 'Puts your words front and centre.',
    speed: 110,
    visuals: { SUB_TEXT: 2, FLASH_TEXT: 2, ACCELERATE: 1, SLOW_FLASH: 1 },
  },
  {
    id: 'animation',
    name: 'Video heavy',
    description: 'Favours GIFs and video clips.',
    speed: 120,
    visuals: { ANIMATION: 3, SLOW_FLASH: 1, SUPER_PARALLEL: 1, SUPER_FAST: 1 },
  },
];

export interface ColourPreset {
  id: string;
  name: string;
  spiralA: Colour;
  spiralB: Colour;
  text: Colour;
  shadow: Colour;
}

export const COLOUR_PRESETS: ColourPreset[] = [
  {
    id: 'pink',
    name: 'Pink',
    spiralA: colour(255, 150, 200, 50),
    spiralB: colour(0, 0, 0, 50),
    text: colour(255, 150, 200, 224),
    shadow: colour(0, 0, 0, 192),
  },
  {
    id: 'violet',
    name: 'Violet',
    spiralA: colour(170, 110, 255, 50),
    spiralB: colour(0, 0, 0, 50),
    text: colour(205, 165, 255, 224),
    shadow: colour(0, 0, 0, 192),
  },
  {
    id: 'ocean',
    name: 'Ocean',
    spiralA: colour(80, 170, 255, 50),
    spiralB: colour(0, 0, 30, 50),
    text: colour(160, 215, 255, 224),
    shadow: colour(0, 0, 20, 192),
  },
  {
    id: 'mono',
    name: 'Mono',
    spiralA: colour(255, 255, 255, 40),
    spiralB: colour(0, 0, 0, 60),
    text: colour(255, 255, 255, 224),
    shadow: colour(0, 0, 0, 200),
  },
  {
    id: 'ember',
    name: 'Ember',
    spiralA: colour(255, 90, 50, 50),
    spiralB: colour(20, 0, 0, 50),
    text: colour(255, 175, 120, 224),
    shadow: colour(20, 0, 0, 192),
  },
  {
    id: 'bold',
    name: 'Bold spiral',
    spiralA: colour(255, 150, 200, 110),
    spiralB: colour(0, 0, 0, 110),
    text: colour(255, 150, 200, 235),
    shadow: colour(0, 0, 0, 210),
  },
];

export function applyLookPreset(p: Program, preset: LookPreset): void {
  for (const v of VISUAL_TYPES) p.visuals[v] = preset.visuals[v] ?? 0;
  p.speed = preset.speed;
}

export function applyColourPreset(p: Program, preset: ColourPreset): void {
  p.spiralColourA = { ...preset.spiralA };
  p.spiralColourB = { ...preset.spiralB };
  p.textColour = { ...preset.text };
  p.shadowColour = { ...preset.shadow };
}

export function themesFromScan(scan: ScanResult): Theme[] {
  return scan.themes.map((t) => ({ id: newId(), ...t }));
}

// Muted clip label colours, in the style of editing software.
export const CLIP_COLOURS = ["#3f6d9e", "#4f8a7a", "#8a6d3b", "#6e5a92", "#8d4f4f", "#5d7f3f", "#3f7f8f", "#86577a"];

// Stable label colour for each look on the timeline.
export function lookColour(id: string, programs: { id: string }[]): string {
  const i = Math.max(0, programs.findIndex((p) => p.id === id));
  return CLIP_COLOURS[i % CLIP_COLOURS.length];
}

// Label colour for a theme on the timeline (offset from the look colours).
export function themeColour(id: string, themes: { id: string }[]): string {
  const i = Math.max(0, themes.findIndex((t) => t.id === id));
  return CLIP_COLOURS[(i + 4) % CLIP_COLOURS.length];
}

// Port of the logic half of trance's Director: chooses visuals by weight,
// advances them each tick and renders them.

import { VISUAL_TYPES, type Program, type VisualType } from '../../shared/types';
import { VisualApi } from './api';
import type { GLRenderer } from './gl';
import { random } from './random';
import type { FontCache } from './text';
import type { ThemeBank } from './themeBank';
import {
  AccelerateVisual,
  AnimationVisual,
  FlashTextVisual,
  ParallelVisual,
  SimpleVisual,
  SlowFlashVisual,
  SubTextVisual,
  SuperFastVisual,
  Visual,
} from './visuals';

function makeVisual(t: VisualType, api: VisualApi): Visual {
  switch (t) {
    case 'ACCELERATE':
      return new AccelerateVisual(api);
    case 'SLOW_FLASH':
      return new SlowFlashVisual(api);
    case 'SUB_TEXT':
      return new SubTextVisual(api);
    case 'FLASH_TEXT':
      return new FlashTextVisual(api);
    case 'PARALLEL':
      return new SimpleVisual(api);
    case 'SUPER_PARALLEL':
      return new ParallelVisual(api);
    case 'ANIMATION':
      return new AnimationVisual(api);
    case 'SUPER_FAST':
      return new SuperFastVisual(api);
  }
}

export class Director {
  private _program: Program;
  private visual: Visual | null = null;
  private lastVisualSelection: VisualType | null = null;
  private readonly api: VisualApi;

  constructor(
    readonly gl: GLRenderer,
    themes: ThemeBank,
    fonts: FontCache,
    program: Program,
  ) {
    this._program = program;
    this.api = new VisualApi(this, themes, fonts);
    this.changeVisual(0);
  }

  program(): Program {
    return this._program;
  }

  setProgram(program: Program): void {
    this._program = program;
  }

  // Called when the timeline moves to a new block. The original only swapped
  // visuals when a cycle completed (up to ~20s later); on a timeline the new
  // block's look should start on time, so switch now if the current visual
  // isn't part of the new program.
  enterProgram(program: Program): void {
    this._program = program;
    const current = this.lastVisualSelection;
    if (!current || !(program.visuals[current] > 0)) this.changeVisual(0);
  }

  currentVisual(): VisualType | null {
    return this.lastVisualSelection;
  }

  update(): void {
    this.api.update();
    const cycler = this.visual!.cycler();
    cycler.advance(true);
    if (cycler.complete()) this.changeVisual(cycler.length());
  }

  render(): void {
    this.gl.beginFrame();
    this.visual!.render(this.api);
  }

  private changeVisual(length: number): void {
    const weights = this._program.visuals;
    // Always change if the current visual isn't in the program.
    const included =
      !!this.visual && !!this.lastVisualSelection && (weights[this.lastVisualSelection] ?? 0) > 0;
    // Roughly 1/2 chance to keep the visual for a cycle of length 2048.
    const fps = this._program.speed;
    if (included && length && random(Math.floor((2 * fps * length) / 2048)) >= 120) return;

    let total = 0;
    for (const v of VISUAL_TYPES) total += weights[v] ?? 0;
    let t: VisualType = VISUAL_TYPES[0];
    if (total > 0) {
      const r = random(total);
      let acc = 0;
      for (const v of VISUAL_TYPES) {
        acc += weights[v] ?? 0;
        if (r < acc) {
          t = v;
          break;
        }
      }
    }

    if (this.visual && t === this.lastVisualSelection) {
      this.visual.reset();
      return;
    }
    this.visual = makeVisual(t, this.api);
    this.lastVisualSelection = t;
    // Run the new visual's first tick now. In trance a frame could be drawn
    // between creating a visual and its first tick, showing a black frame
    // (no image picked yet) at roughly every other style change.
    this.visual.cycler().advance(true);
  }
}

// Port of trance's visual/cyclers.cpp. Cyclers are composable timers that
// drive every visual pattern; the timing must match the original exactly.

export abstract class Cycler {
  private _active = true;

  abstract length(): number;
  abstract position(): number;
  abstract reset(): void;
  abstract advance(triggerActions?: boolean): void;

  activate(active: boolean): void {
    this._active = active;
  }

  active(): boolean {
    return this._active;
  }

  complete(): boolean {
    return this.position() === this.length();
  }

  frame(): number {
    const p = this.position();
    return p ? p - 1 : this.length() - 1;
  }

  progress(): number {
    return this.frame() / this.length();
  }
}

type Action = () => void;
const noop: Action = () => {};

export class ActionCycler extends Cycler {
  private _position = 0;
  private readonly _length: number;
  private readonly _actionFrame: number;
  private readonly _action: Action;

  // ActionCycler(action)                       -> length 1, action at frame 0
  // ActionCycler(length)                       -> no action
  // ActionCycler(length, action)               -> action at frame 0
  // ActionCycler(length, actionFrame, action)
  constructor(a: number | Action, b?: number | Action, c?: Action) {
    super();
    if (typeof a === 'function') {
      this._length = 1;
      this._actionFrame = 0;
      this._action = a;
    } else if (b === undefined) {
      this._length = a;
      this._actionFrame = 0;
      this._action = noop;
    } else if (typeof b === 'function') {
      this._length = a;
      this._actionFrame = 0;
      this._action = b;
    } else {
      this._length = a;
      this._actionFrame = b;
      this._action = c ?? noop;
    }
  }

  length(): number {
    return this._length;
  }

  position(): number {
    return this._position;
  }

  reset(): void {
    this._position = 0;
  }

  advance(triggerActions = true): void {
    if (this.complete()) this.reset();
    if (triggerActions && this._position === this._actionFrame) this._action();
    if (this._length) ++this._position;
  }
}

export class OneShotCycler extends Cycler {
  private readonly subcycles: Cycler[];

  constructor(subcycles: Cycler[]) {
    super();
    this.subcycles = subcycles;
    this.calculateActive();
  }

  length(): number {
    let result = 0;
    for (const c of this.subcycles) result = Math.max(result, c.length());
    return result;
  }

  position(): number {
    let result = 0;
    for (const c of this.subcycles) result = Math.max(result, c.position());
    return result;
  }

  reset(): void {
    for (const c of this.subcycles) c.reset();
    this.calculateActive();
  }

  advance(triggerActions = true): void {
    let anyAdvance = false;
    for (const c of this.subcycles) {
      if (!c.complete()) {
        c.advance(triggerActions);
        anyAdvance = true;
      }
    }
    if (!anyAdvance) {
      this.reset();
      for (const c of this.subcycles) {
        if (!c.complete()) c.advance(triggerActions);
      }
    }
    this.calculateActive();
  }

  activate(active: boolean): void {
    super.activate(active);
    this.calculateActive();
  }

  private calculateActive(): void {
    // Guard: called from the base constructor path before subcycles exist.
    if (!this.subcycles) return;
    const p = this.position();
    for (const c of this.subcycles) c.activate(this.active() && p <= c.position());
  }
}

function gcd(a: number, b: number): number {
  if (a < b) [a, b] = [b, a];
  while (b) {
    const r = a % b;
    a = b;
    b = r;
  }
  return a;
}

function lcm(a: number, b: number): number {
  if (a < b) [a, b] = [b, a];
  if (!b) return a;
  return b * (a / gcd(a, b));
}

export class ParallelCycler extends Cycler {
  private readonly subcycles: Cycler[];
  private _position = 0;
  private readonly _length: number;

  constructor(subcycles: Cycler[]) {
    super();
    this.subcycles = subcycles;
    let length = 0;
    if (subcycles.length) {
      length = subcycles[0].length();
      for (let i = 1; i < subcycles.length; ++i) length = lcm(length, subcycles[i].length());
    }
    this._length = length;
  }

  length(): number {
    return this._length;
  }

  position(): number {
    return this._position;
  }

  reset(): void {
    for (const c of this.subcycles) c.reset();
    this._position = 0;
  }

  advance(triggerActions = true): void {
    if (this.complete()) this._position = 0;
    for (const c of this.subcycles) c.advance(triggerActions);
    ++this._position;
  }

  activate(active: boolean): void {
    super.activate(active);
    if (!this.subcycles) return;
    for (const c of this.subcycles) c.activate(active);
  }
}

export class SequenceCycler extends Cycler {
  private readonly subcycles: Cycler[];

  constructor(subcycles: Cycler[]) {
    super();
    this.subcycles = subcycles;
    this.calculateActive();
  }

  index(): number {
    let total = 0;
    let index = 0;
    const f = this.frame();
    for (const c of this.subcycles) {
      total += c.length();
      if (f < total) return index;
      ++index;
    }
    return 0;
  }

  length(): number {
    let result = 0;
    for (const c of this.subcycles) result += c.length();
    return result;
  }

  position(): number {
    let result = 0;
    for (const c of this.subcycles) result += c.position();
    return result;
  }

  reset(): void {
    for (const c of this.subcycles) c.reset();
    this.calculateActive();
  }

  advance(triggerActions = true): void {
    for (const c of this.subcycles) {
      if (!c.complete()) {
        c.advance(triggerActions);
        this.calculateActive();
        return;
      }
    }
    this.reset();
    for (const c of this.subcycles) {
      if (!c.complete()) {
        c.advance(triggerActions);
        this.calculateActive();
        return;
      }
    }
  }

  activate(active: boolean): void {
    super.activate(active);
    this.calculateActive();
  }

  private calculateActive(): void {
    if (!this.subcycles) return;
    for (const c of this.subcycles) c.activate(false);
    if (!this.active()) return;
    for (let i = 0; i + 1 < this.subcycles.length; ++i) {
      if (this.subcycles[i].position() && !this.subcycles[i + 1].position()) {
        this.subcycles[i].activate(true);
        return;
      }
    }
    if (this.subcycles.length) this.subcycles[this.subcycles.length - 1].activate(true);
  }
}

export class RepeatCycler extends Cycler {
  private readonly subcycle: Cycler;
  private readonly repetitions: number;
  private _index = 0;

  constructor(repetitions: number, subcycle: Cycler) {
    super();
    this.subcycle = subcycle;
    this.repetitions = repetitions;
  }

  index(): number {
    return Math.floor(this.frame() / this.subcycle.length());
  }

  length(): number {
    return this.repetitions * this.subcycle.length();
  }

  position(): number {
    return this.subcycle.position() + this._index * this.subcycle.length();
  }

  reset(): void {
    this._index = 0;
    this.subcycle.reset();
  }

  advance(triggerActions = true): void {
    if (this.subcycle.complete()) this._index = (1 + this._index) % this.repetitions;
    this.subcycle.advance(triggerActions);
  }

  activate(active: boolean): void {
    super.activate(active);
    if (!this.subcycle) return;
    this.subcycle.activate(active);
  }
}

export class OffsetCycler extends Cycler {
  private readonly subcycle: Cycler;
  private readonly offset: number;
  private _position = 0;

  constructor(offset: number, subcycle: Cycler) {
    super();
    this.subcycle = subcycle;
    this.offset = offset;
    this.advanceToOffset();
  }

  length(): number {
    return this.subcycle.length();
  }

  position(): number {
    return this._position;
  }

  reset(): void {
    this._position = 0;
    this.subcycle.reset();
    this.advanceToOffset();
  }

  advance(triggerActions = true): void {
    ++this._position;
    this.subcycle.advance(triggerActions);
  }

  activate(active: boolean): void {
    super.activate(active);
    if (!this.subcycle) return;
    this.subcycle.activate(active);
  }

  private advanceToOffset(): void {
    const frames = this.length() - (this.offset % this.length());
    for (let i = 0; i < frames; ++i) this.subcycle.advance(false);
  }
}

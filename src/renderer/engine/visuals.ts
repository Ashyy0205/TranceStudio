// Port of trance's visual/visual.cpp. Every constant, cycler length and
// branch is kept as in the original so the patterns look identical,
// including original quirks (noted inline) that contribute to the feel.

import { Anim, SplitType, VisualApi } from './api';
import {
  ActionCycler,
  Cycler,
  OffsetCycler,
  OneShotCycler,
  ParallelCycler,
  RepeatCycler,
  SequenceCycler,
} from './cyclers';
import { random, randomChance } from './random';
import type { Img } from './texture';

export abstract class Visual {
  private _cycler!: Cycler;
  private _render!: (api: VisualApi) => void;

  reset(): void {}

  cycler(): Cycler {
    return this._cycler;
  }

  render(api: VisualApi): void {
    this._render(api);
  }

  protected setCycler(c: Cycler): void {
    this._cycler = c;
  }

  protected setRender(f: (api: VisualApi) => void): void {
    this._render = f;
  }
}

export class AccelerateVisual extends Visual {
  private animationCounter = 0;
  private animationMod = 0;
  private animationOn = false;
  private animationAlternate = false;
  private textOn = false;
  private current: Img = null;

  constructor(api: VisualApi) {
    super();
    const mainImage: Cycler[] = [];
    const mainText: Cycler[] = [];
    const mainSequence: Cycler[] = [];

    for (let imageLength = 56; imageLength >= 12; --imageLength) {
      const d = BigInt(56 - imageLength);
      const imageCount = 1 + Number((d * d * d * d * d * d) / (56n * 56n * 56n * 56n * 56n));
      const spiralSpeed = 1 + (56 - imageLength) / 16;
      const alternate = Math.floor(imageLength / 12) % 2 === 0;

      const spiral = new ActionCycler(() => api.rotateSpiral(spiralSpeed));
      mainImage.push(
        new ActionCycler(imageLength, () => {
          this.current = api.getImage(alternate);
          this.animationOn = false;
          if (++this.animationCounter === this.animationMod) {
            this.animationOn = true;
            api.changeAnimation(alternate);
            this.animationAlternate = alternate;
            this.animationCounter = 0;
          }
        }),
      );

      const fastest = imageLength < 16;
      const textAction = () => {
        this.textOn = !this.textOn || fastest;
        if (this.textOn) {
          api.changeText(fastest ? SplitType.SPLIT_WORD : SplitType.SPLIT_LINE, alternate);
        }
      };
      mainText.push(new ActionCycler(fastest ? imageLength : 8, textAction));
      const upload =
        imageLength > 24
          ? new ActionCycler(imageLength, Math.floor(imageLength / 2), () => api.maybeUploadNext())
          : new ActionCycler(imageLength);

      const parallel = new ParallelCycler([mainImage[mainImage.length - 1], spiral, upload]);
      const oneshot = new OneShotCycler([parallel, mainText[mainText.length - 1]]);
      mainSequence.push(new RepeatCycler(imageCount, oneshot));
    }
    const main = new SequenceCycler(mainSequence);

    const oneshot = new ActionCycler(() => {
      this.animationCounter = 0;
      const r = random(3);
      this.animationMod = 2 << r;
      api.changeFont();
      api.changeSpiral();
      api.changeThemes();
    });

    this.setCycler(new OneShotCycler([oneshot, main]));
    this.setRender((api) => {
      const zoomOrigin = 0.4 * main.progress();
      const zoom = zoomOrigin + 0.1 * mainImage[main.index()].progress();
      api.renderAnimationOrImage(
        !this.animationOn ? Anim.NONE : this.animationAlternate ? Anim.ANIM_ALTERNATE : Anim.ANIM,
        this.current,
        1,
        zoomOrigin,
        zoom,
      );
      api.renderSpiral();
      if (this.textOn && mainText[main.index()].active()) {
        api.renderText(0.6 + 0.2 * main.progress(), 0.6 + 0.2 * main.progress(), zoom, zoom);
      }
    });
  }
}

export class SubTextVisual extends Visual {
  private animationCounter = 0;
  private animationMod = 0;
  private animationOn = false;
  private current: Img = null;
  private alternate = true;
  private subSpeedMultiplier = 0;

  constructor(api: VisualApi) {
    super();
    const oneshot = new ActionCycler(() => {
      this.animationCounter = 0;
      const r = random(3);
      this.animationMod = !r ? 3 : r === 1 ? 5 : 7;
      api.changeThemes();
      api.changeFont();
      api.changeSpiral();
      ++this.subSpeedMultiplier;
    });
    const maybeUploadNext = new ActionCycler(48, 24, () => api.maybeUploadNext());
    const image = new ActionCycler(48, () => {
      this.alternate = !this.alternate;
      this.current = api.getImage(this.alternate);
      this.animationOn = false;
      if (++this.animationCounter === this.animationMod) {
        this.animationOn = true;
        api.changeAnimation(this.alternate);
        this.animationCounter = 0;
      }
      // Original quirk: always requests an animation change too.
      api.changeAnimation(this.alternate);
    });

    const textReset = new ActionCycler(4, () => api.changeText(SplitType.SPLIT_WORD, this.alternate));
    const text = new ActionCycler(4, () => api.changeText(SplitType.SPLIT_ONCE_ONLY));
    const textLoop = new SequenceCycler([textReset, new RepeatCycler(23, text)]);

    const sub0 = new ActionCycler(12, () => {
      if (this.subSpeedMultiplier === 1) api.changeSubtext(this.alternate);
    });
    const sub1 = new ActionCycler(24, () => {
      if (this.subSpeedMultiplier === 2) api.changeSubtext(this.alternate);
    });
    const sub2 = new ActionCycler(48, () => {
      if (this.subSpeedMultiplier >= 3) api.changeSubtext(this.alternate);
    });

    const loop = new ParallelCycler([image, maybeUploadNext, textLoop, sub0, sub1, sub2]);
    const main = new RepeatCycler(16, loop);

    const spiral = new ActionCycler(() => api.rotateSpiral(4));
    this.setCycler(new ParallelCycler([spiral, new OneShotCycler([oneshot, main])]));

    this.setRender((api) => {
      const imageZoom = 0.375 * image.progress();
      api.renderAnimationOrImage(
        !this.animationOn ? Anim.NONE : this.alternate ? Anim.ANIM_ALTERNATE : Anim.ANIM,
        this.current,
        1,
        0,
        imageZoom,
      );
      api.renderSubtext(1 / 4, imageZoom);
      api.renderSpiral();
      api.renderText(0.75, 0.75, imageZoom, imageZoom);
    });
  }
}

export class SlowFlashVisual extends Visual {
  private current: Img = null;

  constructor(api: VisualApi) {
    super();
    const slowLoop = new ActionCycler(64, () => {
      this.current = api.getImage();
      api.changeAnimation(false);
      api.changeText(SplitType.SPLIT_LINE);
      api.changeSmallSubtext(true);
    });
    const slowOneshot = new ActionCycler(() => {
      api.changeSpiral();
      api.changeFont();
    });
    const slowRepeat = new RepeatCycler(16, slowLoop);
    const slowMain = new OneShotCycler([slowOneshot, slowRepeat]);
    const slowSpiral = new ActionCycler(() => api.rotateSpiral(2));
    const slowUpload = new ActionCycler(64, 32, () => api.maybeUploadNext());
    const slowCycler = new ParallelCycler([slowMain, slowSpiral, slowUpload]);

    const fastImage = new ActionCycler(8, () => {
      this.current = api.getImage(true);
    });
    const fastText = new ActionCycler(16, 8, () => api.changeText(SplitType.SPLIT_WORD, true));
    const fastLoop = new ParallelCycler([fastImage, fastText]);
    const fastOneshot = new ActionCycler(() => {
      api.changeSpiral();
      api.changeFont();
    });
    const fastRepeat = new RepeatCycler(32, fastLoop);
    const fastMain = new OneShotCycler([fastOneshot, fastRepeat]);
    const fastSubtext = new ActionCycler(16, 0, () => api.changeSmallSubtext(true, true));
    const fastSpiral = new ActionCycler(() => api.rotateSpiral(4));
    const fastCycler = new ParallelCycler([fastMain, fastSubtext, fastSpiral]);

    const oneshot = new ActionCycler(() => api.changeThemes());
    const mainRepeat = new RepeatCycler(2, new SequenceCycler([slowCycler, fastCycler]));
    this.setCycler(new OneShotCycler([oneshot, mainRepeat]));

    this.setRender((api) => {
      const zoomOrigin = slowLoop.active() ? 0.25 * slowMain.progress() : fastRepeat.index() / 48;
      const zoom = slowLoop.active()
        ? 0.25 * slowMain.progress() + 0.5 * slowLoop.progress()
        : (fastRepeat.index() + 8 * fastLoop.progress()) / 48;
      api.renderAnimationOrImage(
        slowLoop.active() && slowRepeat.index() % 2 ? Anim.ANIM : Anim.NONE,
        this.current,
        1,
        zoomOrigin,
        zoom,
      );
      api.renderSpiral();
      if (fastLoop.active() || (slowLoop.active() && slowLoop.frame() < slowLoop.length() / 2)) {
        api.renderSmallSubtext(1 / 5, 0.5);
      }
      if (slowLoop.active() && slowLoop.frame() >= slowLoop.length() / 2) {
        api.renderText(0.8, 0.8, zoom, zoom);
      }
      if (fastCycler.active() && fastText.frame() >= fastText.length() / 2) {
        api.renderText(7 / 8, 1 - fastMain.progress() / 8, 7 / 8, 1 - fastMain.progress() / 8);
      }
    });
  }
}

export class FlashTextVisual extends Visual {
  private animated: boolean;
  private alternate = true;
  private start: Img = null;
  private end: Img;

  constructor(api: VisualApi) {
    super();
    this.animated = randomChance();
    this.end = api.getImage(true);

    const image = new ActionCycler(64, () => {
      this.start = this.end;
      if (this.animated) api.changeAnimation(this.alternate);
      this.end = api.getImage(this.alternate);
    });

    const alternate = new ActionCycler(() => {
      this.alternate = !this.alternate;
      api.changeText(SplitType.SPLIT_LINE, this.alternate);
    });
    const imageRepeat = new RepeatCycler(2, image);
    const mainOneshot = new OneShotCycler([alternate, imageRepeat]);
    const mainRepeat = new RepeatCycler(8, mainOneshot);

    const spiral = new ActionCycler(() => api.rotateSpiral(2.5));
    const font = new ActionCycler(64, () => api.changeFont(true));
    const subtextCounter = new RepeatCycler(2, new ActionCycler(32));
    const smallSubtext = new ActionCycler(32, () => api.changeSmallSubtext(true));
    const upload = new ActionCycler(64, 32, () => api.maybeUploadNext());

    const parallel = new ParallelCycler([spiral, font, subtextCounter, smallSubtext, upload, mainRepeat]);
    const oneshot = new ActionCycler(() => {
      api.changeThemes();
      // No change spiral in this visual, too distracting.
    });

    this.setCycler(new OneShotCycler([parallel, oneshot]));

    this.setRender((api) => {
      const progress = image.progress();
      const anim = this.alternate ? Anim.ANIM_ALTERNATE : Anim.ANIM;
      api.renderAnimationOrImage(
        !this.animated || !imageRepeat.index() ? Anim.NONE : anim,
        this.start,
        1,
        0,
        0.4 * (1 + progress),
      );
      api.renderAnimationOrImage(
        !this.animated || imageRepeat.index() ? Anim.NONE : anim,
        this.end,
        image.progress(),
        0,
        0.4 * progress,
      );
      api.renderSpiral();
      if (subtextCounter.index()) api.renderSmallSubtext(1 / 5, 0.25);
      if (imageRepeat.index()) {
        api.renderText(0.85 - 0.05 * progress, 0.9 - 0.1 * progress, 0.75, 0.8 - 0.05 * progress);
      }
    });
  }

  reset(): void {
    this.animated = randomChance();
  }
}

// trance's "PARALLEL" visual type.
export class SimpleVisual extends Visual {
  private animCycle = 2;
  private image: Img;

  constructor(api: VisualApi) {
    super();
    this.image = api.getImage();
    const counter = new RepeatCycler(4, new ActionCycler(32));
    const image = new ActionCycler(64, () => {
      ++this.animCycle;
      this.image = api.getImage(this.animCycle % 3 === 1);
      if (++this.animCycle % 3 === 2) api.changeAnimation(false);
    });

    const text = new ActionCycler(128, () => api.changeText(SplitType.SPLIT_LINE, randomChance()));

    const main = new ParallelCycler([counter, image, text]);
    const repeat = new RepeatCycler(16, main);

    const spiral = new ActionCycler(() => api.rotateSpiral(3));
    const smallSubtext = new ActionCycler(32, () => api.changeSmallSubtext(true));
    const upload = new ActionCycler(32, 16, () => api.maybeUploadNext());

    const parallel = new ParallelCycler([spiral, smallSubtext, upload, repeat]);
    const oneshot = new ActionCycler(() => {
      api.changeSpiral();
      api.changeFont();
      api.changeThemes();
    });

    this.setCycler(new OneShotCycler([oneshot, parallel]));

    this.setRender((api) => {
      const anim = this.animCycle % 3 === 2 ? Anim.ANIM : Anim.NONE;
      api.renderAnimationOrImage(anim, this.image, 1, 0, 0.5 * image.progress());
      api.renderSpiral();
      api.renderSmallSubtext(1 / 5, 0.25);
      if (counter.index() === 1 || counter.index() === 2) {
        api.renderText(0.75, 0.75, 0.5 * image.progress(), 0.5 * image.progress());
      }
    });
  }
}

// trance's "SUPER_PARALLEL" visual type.
export class ParallelVisual extends Visual {
  private alternateAnimation = true;
  private images: Img[] = [];

  constructor(api: VisualApi) {
    super();
    const mainLoops: Cycler[] = [];
    const progress: Cycler[] = [];
    const single: Cycler[] = [];

    for (let i = 0; i < 3; ++i) {
      this.images.push(api.getImage(i >= 2));
      const set = new ActionCycler(16, () => {
        this.images[i] = api.getImage(i >= 2);
        if (i === 0) api.changeAnimation(this.alternateAnimation);
      });
      single.push(new ActionCycler(16));
      progress.push(new SequenceCycler([set, single[single.length - 1], new ActionCycler(64)]));
      mainLoops.push(new OffsetCycler(i * 32, progress[progress.length - 1]));
    }

    const alternate = new ActionCycler(() => {
      this.alternateAnimation = !this.alternateAnimation;
    });
    const repeat = new RepeatCycler(12, new OneShotCycler([alternate, new ParallelCycler(mainLoops)]));
    const text = new ActionCycler(32, () => api.changeText(SplitType.SPLIT_WORD, randomChance()));
    const spiral = new ActionCycler(() => api.rotateSpiral(3.5));
    const upload = new ActionCycler(32, 16, () => api.maybeUploadNext());

    const parallel = new ParallelCycler([spiral, upload, text, repeat]);
    const oneshot = new ActionCycler(() => {
      api.changeSpiral();
      api.changeFont();
      api.changeThemes();
    });

    const main = new OneShotCycler([oneshot, parallel]);
    this.setCycler(main);

    this.setRender((api) => {
      const isSingle = single.some((c) => c.active());
      for (let i = 0; i < this.images.length; ++i) {
        const anim = i !== 0 ? Anim.NONE : this.alternateAnimation ? Anim.ANIM_ALTERNATE : Anim.ANIM;
        if (!isSingle || single[i].active()) {
          const zoomOrigin = 0.125 * main.progress();
          api.renderAnimationOrImage(
            anim,
            this.images[i],
            isSingle ? 1 : 1 / (1 + i),
            zoomOrigin,
            zoomOrigin + 0.875 * progress[i].progress(),
          );
        }
      }
      api.renderSpiral();
      if (text.frame() < text.length() / 2) api.renderText(0.875, 0.875, 0.75, 0.75);
    });
  }
}

export class AnimationVisual extends Visual {
  private animationBackup: Img = null;
  private current: Img = null;

  constructor(api: VisualApi) {
    super();
    const imageTimer = new ActionCycler(16);
    const image = new ActionCycler(32, () => {
      this.animationBackup = api.getImage();
    });
    const imageAlt = new ActionCycler(64, 32, () => {
      this.current = api.getImage(true);
    });

    const change = new ActionCycler(64, 0, () => {
      api.changeText(SplitType.SPLIT_LINE);
      api.changeAnimation(false);
    });
    const changeAlt = new ActionCycler(64, 0, () => {
      api.changeText(SplitType.SPLIT_LINE, true);
      api.changeAnimation(true);
    });
    const changeBoth = new SequenceCycler([change, changeAlt]);
    const halfCounter = new ActionCycler(32);
    const changeCounter = new RepeatCycler(2, halfCounter);

    const spiral = new ActionCycler(() => api.rotateSpiral(3.5));
    const smallSubtext = new ActionCycler(32, () => api.changeSmallSubtext(true, randomChance()));
    const upload = new ActionCycler(32, 24, () => api.maybeUploadNext());

    const parallel = new ParallelCycler([
      spiral,
      smallSubtext,
      upload,
      image,
      imageAlt,
      imageTimer,
      changeBoth,
      changeCounter,
    ]);
    const repeat = new RepeatCycler(8, parallel);
    const oneshot = new ActionCycler(() => {
      api.changeSpiral();
      api.changeFont();
      api.changeThemes();
    });

    const startEndTimer = new SequenceCycler([new ActionCycler(32), new ActionCycler(64 * 15), new ActionCycler(32)]);
    this.setCycler(new OneShotCycler([oneshot, repeat, startEndTimer]));

    this.setRender((api) => {
      const whichAnim = changeAlt.active() ? Anim.ANIM_ALTERNATE : Anim.ANIM;
      const imageZoom = 0.625 * changeCounter.progress();
      api.renderAnimationOrImage(whichAnim, this.animationBackup, 1, 0, imageZoom);
      if (changeCounter.frame() < 16 && startEndTimer.index() === 1) {
        const t = 15 - changeCounter.frame();
        api.renderImage(this.current, Math.min(1, t / 16), 0.5, 0.625 + (0.125 * changeCounter.frame()) / 16);
      }
      if (changeCounter.frame() >= 48 && startEndTimer.index() === 1) {
        const t = changeCounter.frame() - 48;
        api.renderImage(this.current, Math.min(1, t / 16), 0.5, 0.5 + (0.125 * t) / 16);
      }
      api.renderSpiral();
      api.renderSmallSubtext(1 / 5, 0.5);
      if (!changeCounter.index()) api.renderText(0.75, 0.75, 0.5, 0.5);
    });
  }
}

enum FastState {
  RAPID = 0,
  START_ANIMATION = 1,
  ANIMATION = 2,
  END_ANIMATION = 3,
}

export class SuperFastVisual extends Visual {
  private state = FastState.RAPID;
  private alternate = false;
  private textMod = 0;
  private cooldownTimer = 0;
  private animationTimer = 0;
  private current: Img = null;
  private next: Img = null;

  constructor(api: VisualApi) {
    super();
    const length = new ActionCycler(2048);
    const rapid = new ActionCycler(8, () => {
      if (this.animationTimer === 4) api.maybeUploadNext();
      if (this.cooldownTimer) --this.cooldownTimer;
      if (this.state === FastState.RAPID) this.textMod = (1 + this.textMod) % 4;
      if (this.state === FastState.END_ANIMATION) {
        this.textMod = 0;
        this.cooldownTimer = 8;
        this.state = FastState.RAPID;
      }
      if (this.state === FastState.ANIMATION) {
        // uint32 underflow in the original is unreachable here.
        --this.animationTimer;
        if (!this.animationTimer) this.state = FastState.END_ANIMATION;
      }
      if (this.state === FastState.START_ANIMATION) {
        this.state = FastState.ANIMATION;
        --this.animationTimer;
      }
      if (this.state === FastState.RAPID && !this.cooldownTimer && randomChance(12)) {
        this.state = FastState.START_ANIMATION;
        this.animationTimer = 8 + random(9);
        this.alternate = !this.alternate;
        api.changeAnimation(this.alternate);
      }
      if (this.state !== FastState.ANIMATION) {
        this.current = this.next;
        if (!this.current) this.current = api.getImage(this.alternate);
        this.next = api.getImage(this.alternate);
        if (this.textMod === 0) api.changeText(SplitType.SPLIT_WORD, this.alternate);
      }
    });
    const spiral = new ActionCycler(() => api.rotateSpiral(3));

    const parallel = new ParallelCycler([length, rapid, spiral]);
    const oneshot = new ActionCycler(() => {
      api.changeSpiral();
      api.changeFont();
      api.changeThemes();
    });

    this.setCycler(new OneShotCycler([oneshot, parallel]));

    this.setRender((api) => {
      const animProgress = (8 * (16 - this.animationTimer) + rapid.frame()) / 128;
      const nextAlpha = (5 - rapid.length() + rapid.frame()) / 5;
      const imageZoom = 0.125 * (0.5 + rapid.progress());
      const nextZoom = 0.125 * (rapid.progress() - 0.5);
      const anim = this.alternate ? Anim.ANIM_ALTERNATE : Anim.ANIM;
      if (this.state === FastState.ANIMATION || this.state === FastState.END_ANIMATION) {
        api.renderAnimationOrImage(anim, this.current, 1, 0, animProgress);
      } else {
        api.renderImage(this.current, 1, 0, imageZoom);
      }
      if (rapid.frame() >= rapid.length() - 4) {
        if (this.state === FastState.START_ANIMATION) {
          api.renderAnimationOrImage(anim, null, nextAlpha, 0, animProgress);
        } else if (this.state === FastState.RAPID || this.state === FastState.END_ANIMATION) {
          api.renderImage(this.next, nextAlpha, nextZoom, nextZoom);
        }
      }
      if (this.state === FastState.RAPID && !this.textMod) api.renderText(0.75, 0.75, imageZoom, imageZoom);
      api.renderSpiral();
    });
  }
}

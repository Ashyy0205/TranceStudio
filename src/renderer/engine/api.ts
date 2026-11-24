// Port of trance's VisualApiImpl: the control/render API used by visuals.

import type { Colour } from '../../shared/types';
import type { Director } from './director';
import { random, randomChance } from './random';
import { FontCache } from './text';
import type { ThemeBank } from './themeBank';
import type { Img } from './texture';

const SPIRAL_TYPE_MAX = 7;

export enum SplitType {
  SPLIT_WORD = 0,
  SPLIT_LINE = 1,
  SPLIT_WORD_GAPS = 2,
  SPLIT_LINE_GAPS = 3,
  SPLIT_ONCE_ONLY = 4,
}

export enum Anim {
  NONE,
  ANIM,
  ANIM_ALTERNATE,
}

// sf::Color conversion truncates to 8 bits.
function colour8(c: Colour, alphaMul = 1): [number, number, number, number] {
  const q = (v: number) => Math.floor(Math.round(v * 255 * 1000) / 1000) / 255;
  const a8 = Math.floor(Math.round(c.a * 255 * 1000) / 1000);
  return [q(c.r), q(c.g), q(c.b), Math.floor(a8 * alphaMul) / 255];
}

function splitText(text: string, splitWords: boolean): string[] {
  const parts = text.split(splitWords ? /[ \t\r\n]/ : /[\r\n]/).filter((s) => s.length);
  return parts.length ? parts : [''];
}

export class VisualApi {
  private switchThemes = 0;
  private spiral = 0;
  private spiralType = 0;
  private spiralWidth = 60;
  private currentFont = '';
  private currentSubfont = '';
  private currentText: string[] = [];
  private subtext: string[] = [];
  private smallSubtext = '';
  private smallSubtextX = 0;
  private smallSubtextY = 0;
  private readonly fonts: FontCache;

  constructor(
    private readonly director: Director,
    private readonly themes: ThemeBank,
    fonts: FontCache,
  ) {
    this.fonts = fonts;
    this.changeFont(true);
    this.changeSpiral();
    this.changeSubtext();
  }

  update(): void {
    ++this.switchThemes;
  }

  // VisualControl

  getImage(alternate = false): Img {
    return this.themes.getImage(alternate);
  }

  maybeUploadNext(): void {
    this.themes.maybeUploadNext();
  }

  rotateSpiral(amount: number): void {
    if (!this.director.program().reverseSpiral) amount *= -1;
    this.spiral += amount / (32 * Math.sqrt(this.spiralWidth));
    while (this.spiral > 1) this.spiral -= 1;
    while (this.spiral < 0) this.spiral += 1;
  }

  changeSpiral(): void {
    if (randomChance(4)) return;
    this.spiralType = random(SPIRAL_TYPE_MAX);
    this.spiralWidth = Math.floor(360 / (1 + random(6)));
  }

  changeAnimation(alternate = false): void {
    this.themes.changeAnimation(alternate);
  }

  changeFont(force = false): void {
    if (force || randomChance(4)) this.currentFont = this.themes.getFont(false);
    if (force || randomChance(4)) this.currentSubfont = this.themes.getFont(false);
  }

  changeText(splitType: SplitType, alternate = false): void {
    const gaps = splitType === SplitType.SPLIT_LINE_GAPS || splitType === SplitType.SPLIT_WORD_GAPS;
    const splitWord = splitType === SplitType.SPLIT_WORD || splitType === SplitType.SPLIT_WORD_GAPS;
    const onceOnly = splitType === SplitType.SPLIT_ONCE_ONLY;

    if (!this.currentText.length && onceOnly) return;
    if (this.currentText.length) {
      this.currentText.shift();
      if (this.currentText.length || gaps || onceOnly) return;
    }
    this.currentText = splitText(this.themes.getText(alternate, true), splitWord);
  }

  changeSubtext(alternate = false): void {
    this.subtext = [];
    for (let i = 0; i < 16; ++i) {
      const s = this.themes.getText(alternate, false).replace(/\n/g, ' ');
      if (s) this.subtext.push(s);
    }
  }

  changeSmallSubtext(force = false, alternate = false): void {
    if (force || !this.smallSubtext) {
      this.smallSubtext = this.themes.getText(alternate, false).replace(/\n/g, ' ');
      let x = this.smallSubtextX;
      let y = this.smallSubtextY;
      while (Math.abs(x - this.smallSubtextX) < 1 / 8) {
        x = ((randomChance() ? 1 : -1) * random(64)) / 128;
      }
      while (Math.abs(y - this.smallSubtextY) < 1 / 4) {
        y = ((randomChance() ? 1 : -1) * (16 + random(112))) / 128;
      }
      this.smallSubtextX = x;
      this.smallSubtextY = y;
    } else {
      this.smallSubtext = '';
    }
  }

  changeThemes(): boolean {
    if (this.switchThemes < 2048 || randomChance(4)) return false;
    if (this.themes.changeThemes()) {
      this.switchThemes = 0;
      if (!this.currentFont) this.changeFont(true);
      return true;
    }
    return false;
  }

  // VisualRender

  renderAnimationOrImage(type: Anim, image: Img, alpha: number, zoomOrigin: number, zoom: number): void {
    let anim: Img = null;
    if (type !== Anim.NONE) anim = this.themes.getAnimation(type === Anim.ANIM_ALTERNATE);
    this.renderImage(anim && anim.width && anim.height ? anim : image, alpha, zoomOrigin, zoom);
  }

  renderImage(image: Img, alpha: number, zoomOrigin: number, zoom: number): void {
    this.director.gl.renderImage(image, alpha, zoomOrigin, this.zoomIntensity(zoomOrigin, zoom));
  }

  renderText(zoomOrigin: number, zoom: number, shadowZoomOrigin: number, shadowZoom: number): void {
    if (!this.currentFont || !this.currentText.length || !this.currentText[0]) return;
    const text = this.currentText[0];
    const program = this.director.program();
    const font = this.fonts.get(this.currentFont);
    if (!font) return;
    const gl = this.director.gl;

    const size = gl.textSize(font, text, true);
    if (!size.x || !size.y) return;
    const targetX = 5 / 8;
    const targetY = 1 / 3;
    const scale = Math.min(targetX / size.x, targetY / size.y);

    const shadow = colour8(program.shadowColour);
    const main = colour8(program.textColour);
    gl.renderText(font, text, true, shadow, 1.2 * scale, { x: 0, y: 0 }, shadowZoomOrigin,
      this.zoomIntensity(shadowZoomOrigin, shadowZoom));
    gl.renderText(font, text, true, main, scale, { x: 0, y: 0 }, zoomOrigin, this.zoomIntensity(zoomOrigin, zoom));
  }

  renderSubtext(alpha: number, zoomOrigin: number): void {
    if (!this.currentSubfont || !this.subtext.length) return;
    const font = this.fonts.get(this.currentSubfont);
    if (!font) return;
    const gl = this.director.gl;
    const targetY = 1 / 16;

    let size = { x: 0, y: 0 };
    let text = '';
    let n = 0;
    const makeText = () => {
      text = '';
      let iterations = 0;
      do {
        text += ' ' + this.subtext[n];
        n = (n + 1) % this.subtext.length;
        size = gl.textSize(font, text, false);
        ++iterations;
      } while ((size.x * targetY) / size.y < 1 && iterations < 64);
    };

    makeText();
    if (!size.x || !size.y) return;
    const scale = targetY / size.y;
    const colour = colour8(this.director.program().shadowColour, alpha);
    gl.renderText(font, text, false, colour, scale, { x: 0, y: 0 }, 0, 0);

    const offset = 2 * targetY + 1 / 512;
    const z = this.zoomIntensity(zoomOrigin, zoomOrigin);
    for (let i = 1; (i - 1) * 2 * targetY < 1; ++i) {
      makeText();
      if (size.x && size.y) gl.renderText(font, text, false, colour, scale, { x: 0, y: i * offset }, zoomOrigin, z);
      makeText();
      if (size.x && size.y) gl.renderText(font, text, false, colour, scale, { x: 0, y: -i * offset }, zoomOrigin, z);
    }
  }

  renderSmallSubtext(alpha: number, zoomOrigin: number): void {
    if (!this.currentSubfont || !this.smallSubtext) return;
    const font = this.fonts.get(this.currentSubfont);
    if (!font) return;
    const gl = this.director.gl;
    const size = gl.textSize(font, this.smallSubtext, false);
    if (!size.x || !size.y) return;
    const targetY = 1 / 8;
    const scale = targetY / size.y;
    const colour = colour8(this.director.program().shadowColour, alpha);
    gl.renderText(font, this.smallSubtext, false, colour, scale,
      { x: this.smallSubtextX / 2, y: this.smallSubtextY / 2 }, zoomOrigin,
      this.zoomIntensity(zoomOrigin, zoomOrigin));
  }

  renderSpiral(): void {
    const p = this.director.program();
    this.director.gl.renderSpiral(this.spiral, this.spiralWidth, this.spiralType, {
      a: p.spiralColourA,
      b: p.spiralColourB,
    });
  }

  private zoomIntensity(zoomOrigin: number, zoom: number): number {
    return zoomOrigin + (zoom - zoomOrigin) * this.director.program().zoomIntensity;
  }
}

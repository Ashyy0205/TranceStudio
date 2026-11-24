// Port of trance's Font / FontCache. SFML rendered glyph quads from a font
// atlas; here each string is rasterised once with the same layout rules
// (ink bounding box, centred, SFML-style line spacing) and drawn as a single
// textured quad, which produces the same on-screen result.

import defaultFontLatin from '@fontsource/anton/files/anton-latin-400-normal.woff2?url';
import defaultFontLatinExt from '@fontsource/anton/files/anton-latin-ext-400-normal.woff2?url';
import { mediaUrl } from './media';

export const DEFAULT_FONT = '<default>';

export interface TextBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TextTexture {
  texture: WebGLTexture;
  // Quad bounds in pixels at the font's char size, relative to the text centre.
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const families = new Map<string, string>();
const loading = new Map<string, Promise<string | null>>();
let familyCounter = 0;

// Loads a font file (or the bundled default) and returns its CSS family name.
export function loadFont(path: string): Promise<string | null> {
  const existing = loading.get(path);
  if (existing) return existing;
  const promise = (async () => {
    const family = `trance-font-${familyCounter++}`;
    try {
      if (path === DEFAULT_FONT) {
        const a = new FontFace(family, `url(${defaultFontLatin})`, {
          unicodeRange:
            'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
        });
        const b = new FontFace(family, `url(${defaultFontLatinExt})`, {
          unicodeRange:
            'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
        });
        await Promise.all([a.load(), b.load()]);
        document.fonts.add(a);
        document.fonts.add(b);
      } else {
        const face = new FontFace(family, `url("${mediaUrl(path)}")`);
        await face.load();
        document.fonts.add(face);
      }
      families.set(path, family);
      return family;
    } catch (e) {
      console.warn('couldn\'t load font', path, e);
      return null;
    }
  })();
  loading.set(path, promise);
  return promise;
}

export function fontFamily(path: string): string | null {
  return families.get(path) ?? null;
}

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d')!;

// Mirrors Font::compute_size(): bounding box of the inked glyphs, with
// lines advanced by the font's line spacing.
function layout(family: string, size: number, text: string) {
  const ctx = measureCtx;
  ctx.font = `${size}px "${family}"`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  const ref = ctx.measureText('M');
  const lineSpacing = ref.fontBoundingBoxAscent + ref.fontBoundingBoxDescent;
  const lines = text.split('\n');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const rows: { text: string; y: number }[] = [];
  let y = 0;
  for (const line of lines) {
    const printable = line.replace(/\t/g, '    ');
    if (printable.trim().length) {
      const m = ctx.measureText(printable);
      minX = Math.min(minX, -m.actualBoundingBoxLeft);
      maxX = Math.max(maxX, m.actualBoundingBoxRight);
      minY = Math.min(minY, y - m.actualBoundingBoxAscent);
      maxY = Math.max(maxY, y + m.actualBoundingBoxDescent);
      rows.push({ text: printable, y });
    }
    y += lineSpacing;
  }
  if (!rows.length) return null;
  return { box: { minX, minY, maxX, maxY }, rows };
}

const PAD = 2;

// A font at two char sizes (large = height/3, small = height/12), like
// trance's Font object. Measurements and textures are cached.
export class Font {
  private sizeCache = new Map<string, { x: number; y: number }>();

  constructor(
    readonly family: string,
    readonly largeSize: number,
    readonly smallSize: number,
    private readonly textures: TextTextureCache,
  ) {}

  charSize(large: boolean): number {
    return large ? this.largeSize : this.smallSize;
  }

  getSize(text: string, large: boolean): { x: number; y: number } {
    const key = (large ? 'L' : 'S') + text;
    let s = this.sizeCache.get(key);
    if (!s) {
      const l = layout(this.family, this.charSize(large), text);
      s = l ? { x: l.box.maxX - l.box.minX, y: l.box.maxY - l.box.minY } : { x: 0, y: 0 };
      if (this.sizeCache.size > 4096) this.sizeCache.clear();
      this.sizeCache.set(key, s);
    }
    return s;
  }

  getTexture(text: string, large: boolean): TextTexture | null {
    return this.textures.get(this.family, this.charSize(large), text);
  }
}

export class TextTextureCache {
  private cache = new Map<string, TextTexture>();
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d')!;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly limit = 96,
  ) {}

  get(family: string, size: number, text: string): TextTexture | null {
    const key = `${family}|${size}|${text}`;
    const hit = this.cache.get(key);
    if (hit) {
      // Refresh LRU position.
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const l = layout(family, size, text);
    if (!l) return null;
    const { box, rows } = l;
    const w = Math.ceil(box.maxX - box.minX) + 2 * PAD;
    const h = Math.ceil(box.maxY - box.minY) + 2 * PAD;
    if (w <= 0 || h <= 0 || w > 16384 || h > 16384) return null;

    const canvas = this.canvas;
    canvas.width = w;
    canvas.height = h;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `${size}px "${family}"`;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    for (const row of rows) ctx.fillText(row.text, PAD - box.minX, PAD - box.minY + row.y);

    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    const cx = box.minX + (box.maxX - box.minX) / 2;
    const cy = box.minY + (box.maxY - box.minY) / 2;
    const entry: TextTexture = {
      texture,
      x1: box.minX - PAD - cx,
      y1: box.minY - PAD - cy,
      x2: box.minX - PAD + w - cx,
      y2: box.minY - PAD + h - cy,
    };
    this.cache.set(key, entry);
    while (this.cache.size > this.limit) {
      const oldest = this.cache.keys().next().value!;
      gl.deleteTexture(this.cache.get(oldest)!.texture);
      this.cache.delete(oldest);
    }
    return entry;
  }

  disposeAll(): void {
    for (const t of this.cache.values()) this.gl.deleteTexture(t.texture);
    this.cache.clear();
  }
}

// LRU of Font objects keyed by path, like trance's FontCache.
export class FontCache {
  private fonts = new Map<string, Font>();

  constructor(
    private readonly largeSize: number,
    private readonly smallSize: number,
    private readonly textures: TextTextureCache,
  ) {}

  get(path: string): Font | null {
    let font = this.fonts.get(path);
    if (font) return font;
    const family = fontFamily(path) ?? fontFamily(DEFAULT_FONT);
    if (!family) return null;
    font = new Font(family, this.largeSize, this.smallSize, this.textures);
    this.fonts.set(path, font);
    return font;
  }
}

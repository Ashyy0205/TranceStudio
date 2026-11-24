// A decoded image (still image or animation frame) that is uploaded to the GPU
// on first use. Mirrors trance's Image class: width/height plus a lazily
// uploaded texture. Release is deferred so visuals that still hold a
// reference keep rendering until they naturally move on.

export class Tex {
  readonly width: number;
  readonly height: number;
  source: ImageBitmap | null;
  texture: WebGLTexture | null = null;
  lastUsed = 0;
  released = false;
  // Frames to keep after release once it stops being drawn.
  grace = 0;
  disposed = false;

  constructor(source: ImageBitmap) {
    this.source = source;
    this.width = source.width;
    this.height = source.height;
  }
}

// Used in place of a still image when a theme has none (only animations).
// trance handed out a frozen copy of the current animation frame, so styles
// that change images rapidly (Accelerate, Super fast) showed the video in
// jerky freeze-frame steps. This draws whatever frame is playing right now.
export class LiveImage {
  constructor(readonly current: () => Tex | null) {}
}

export type Img = Tex | LiveImage | null;

export function resolveImg(img: Img): Tex | null {
  return img instanceof LiveImage ? img.current() : img;
}

// Frames to wait after a texture is released before freeing GPU memory.
const RELEASE_GRACE_FRAMES = 600;
// Animation frames churn constantly, so they are freed much sooner.
export const FRAME_GRACE_FRAMES = 120;

export class TextureManager {
  private frame = 0;
  private graveyard: Tex[] = [];

  constructor(private readonly gl: WebGL2RenderingContext) {}

  // Returns a bindable texture, uploading it if needed. Mirrors
  // Image::ensure_texture_uploaded.
  use(tex: Tex): WebGLTexture | null {
    if (tex.disposed) return null;
    tex.lastUsed = this.frame;
    if (tex.texture) return tex.texture;
    if (!tex.source) return null;
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    tex.texture = t;
    ++this.live;
    // The bitmap is no longer needed once it lives on the GPU.
    tex.source.close();
    tex.source = null;
    return t;
  }

  private live = 0;
  liveCount(): number {
    return this.live;
  }

  upload(tex: Tex | null): void {
    if (tex) this.use(tex);
  }

  // Frees the texture once it has gone `grace` frames without being drawn
  // (anything still on screen keeps refreshing lastUsed, so it survives).
  release(tex: Tex | null, grace = RELEASE_GRACE_FRAMES): void {
    if (!tex || tex.released || tex.disposed) return;
    tex.released = true;
    tex.grace = grace;
    this.graveyard.push(tex);
  }

  releaseFrame(tex: Tex | null): void {
    this.release(tex, FRAME_GRACE_FRAMES);
  }

  // Called once per rendered frame.
  collect(): void {
    ++this.frame;
    if (!this.graveyard.length) return;
    const keep: Tex[] = [];
    for (const tex of this.graveyard) {
      if (this.frame - tex.lastUsed > tex.grace) this.dispose(tex);
      else keep.push(tex);
    }
    this.graveyard = keep;
  }

  dispose(tex: Tex): void {
    if (tex.disposed) return;
    tex.disposed = true;
    if (tex.texture) {
      this.gl.deleteTexture(tex.texture);
      --this.live;
    }
    tex.texture = null;
    tex.source?.close();
    tex.source = null;
  }

  disposeAll(): void {
    for (const tex of this.graveyard) this.dispose(tex);
    this.graveyard = [];
  }
}

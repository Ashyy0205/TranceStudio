// Port of the drawing half of trance's Director (render_image, render_text,
// render_spiral). Geometry, projection and blending match the original.

import type { Colour } from '../../shared/types';
import { IMAGE_FRAGMENT, IMAGE_VERTEX, SPIRAL_FRAGMENT, SPIRAL_VERTEX, YUV_FRAGMENT } from './shaders';
import { Img, resolveImg, TextureManager } from './texture';
import type { Font } from './text';

// trance's default System::eye_spacing. Only affects how many mirrored tiles
// are drawn around an image on a monitor.
const EYE_SPACING = 1 / 16;

function compile(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('shader compile failed: ' + gl.getShaderInfoLog(s));
    }
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, make(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, make(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('shader link failed: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

type Uniforms = Record<string, WebGLUniformLocation | null>;

function uniforms(gl: WebGL2RenderingContext, p: WebGLProgram, names: string[]): Uniforms {
  const u: Uniforms = {};
  for (const n of names) u[n] = gl.getUniformLocation(p, n);
  return u;
}

export interface SpiralColours {
  a: Colour;
  b: Colour;
}

export class GLRenderer {
  readonly textures: TextureManager;
  private readonly imageProgram: WebGLProgram;
  private readonly spiralProgram: WebGLProgram;
  private readonly imageU: Uniforms;
  private readonly spiralU: Uniforms;
  private readonly imagePosLoc: number;
  private readonly imageTexLoc: number;
  private readonly spiralPosLoc: number;
  private readonly quadBuffer: WebGLBuffer;
  private readonly positionBuffer: WebGLBuffer;
  private readonly texcoordBuffer: WebGLBuffer;
  private readonly vao: WebGLVertexArrayObject;
  private readonly blackTexture: WebGLTexture;
  drawDepth = 0.5;
  // Export: the scene renders into this offscreen target, then a YUV pass.
  private exportTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private yuvTarget: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private yuvProgram: WebGLProgram | null = null;

  constructor(readonly gl: WebGL2RenderingContext) {
    this.textures = new TextureManager(gl);
    this.imageProgram = compile(gl, IMAGE_VERTEX, IMAGE_FRAGMENT);
    this.spiralProgram = compile(gl, SPIRAL_VERTEX, SPIRAL_FRAGMENT);
    this.imageU = uniforms(gl, this.imageProgram, ['tex', 'near_plane', 'far_plane', 'eye_offset', 'colour']);
    this.spiralU = uniforms(gl, this.spiralProgram, [
      'near_plane',
      'far_plane',
      'eye_offset',
      'aspect_ratio',
      'width',
      'spiral_type',
      'time',
      'acolour',
      'bcolour',
    ]);
    this.imagePosLoc = gl.getAttribLocation(this.imageProgram, 'virtual_position');
    this.imageTexLoc = gl.getAttribLocation(this.imageProgram, 'texture_coord');
    this.spiralPosLoc = gl.getAttribLocation(this.spiralProgram, 'device_position');

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, -1, 1, 1, -1, 1]),
      gl.STATIC_DRAW,
    );
    this.positionBuffer = gl.createBuffer()!;
    this.texcoordBuffer = gl.createBuffer()!;

    // An empty Image in trance binds texture 0, which samples as opaque black.
    this.blackTexture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blackTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  }

  get width(): number {
    return this.gl.drawingBufferWidth;
  }

  get height(): number {
    return this.gl.drawingBufferHeight;
  }

  get viewWidth(): number {
    return this.width;
  }

  private farPlaneDistance(): number {
    return this.drawDepth * 256;
  }

  beginFrame(): void {
    const gl = this.gl;
    this.textures.collect();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.exportTarget?.fbo ?? null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  renderSpiral(spiral: number, spiralWidth: number, spiralType: number, colours: SpiralColours): void {
    const gl = this.gl;
    const u = this.spiralU;
    gl.useProgram(this.spiralProgram);
    gl.uniform1f(u.near_plane, 1);
    gl.uniform1f(u.far_plane, 1 + this.farPlaneDistance());
    gl.uniform1f(u.eye_offset, 0);
    gl.uniform1f(u.aspect_ratio, this.viewWidth / this.height);
    gl.uniform1f(u.width, spiralWidth);
    gl.uniform1f(u.spiral_type, spiralType);
    gl.uniform1f(u.time, spiral);
    gl.uniform4f(u.acolour, colours.a.r, colours.a.g, colours.a.b, colours.a.a);
    gl.uniform4f(u.bcolour, colours.b.r, colours.b.g, colours.b.b, colours.b.a);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(this.spiralPosLoc);
    gl.vertexAttribPointer(this.spiralPosLoc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(this.spiralPosLoc);
  }

  // Diagnostics: images drawn as empty (black) because nothing was loaded.
  emptyImageDraws = 0;

  renderImage(img: Img, alpha: number, zoomOrigin: number, zoom: number): void {
    const image = resolveImg(img);
    let texture: WebGLTexture | null = null;
    let iw = 0;
    let ih = 0;
    if (image) {
      texture = this.textures.use(image);
      if (texture) {
        iw = image.width;
        ih = image.height;
      }
    }

    const xScale = iw / this.width;
    const yScale = ih / this.height;
    // std::min(1.f, NaN) returns 1, so empty images fill the screen.
    const fit = (v: number) => (Number.isNaN(v) ? 1 : Math.min(1, v));
    const xSize = fit(xScale / yScale);
    const ySize = fit(yScale / xScale);

    const pos: number[] = [];
    const uv: number[] = [];
    let vertexCount = 0;
    const addQuad = (x: number, y: number, xFlip: boolean, yFlip: boolean) => {
      const xo = 2 * x * xSize;
      const yo = 2 * y * ySize;
      vertexCount += 6;
      pos.push(
        xo - xSize, yo - ySize, zoom, zoomOrigin,
        xo + xSize, yo - ySize, zoom, zoomOrigin,
        xo - xSize, yo + ySize, zoom, zoomOrigin,
        xo + xSize, yo - ySize, zoom, zoomOrigin,
        xo + xSize, yo + ySize, zoom, zoomOrigin,
        xo - xSize, yo + ySize, zoom, zoomOrigin,
      );
      const a = xFlip ? 1 : 0;
      const b = xFlip ? 0 : 1;
      const c = yFlip ? 0 : 1;
      const d = yFlip ? 1 : 0;
      uv.push(a, c, b, c, a, d, b, c, b, d, a, d);
    };

    for (let x = 0; xSize * (2 * x - 1) < 1 + Math.abs(EYE_SPACING); ++x) {
      for (let y = 0; ySize * (2 * y - 1) < 1; ++y) {
        addQuad(x, y, x % 2 === 1, y % 2 === 1);
        if (x) addQuad(-x, y, x % 2 === 1, y % 2 === 1);
        if (y) addQuad(x, -y, x % 2 === 1, y % 2 === 1);
        if (x && y) addQuad(-x, -y, x % 2 === 1, y % 2 === 1);
      }
    }
    // Avoids the very edge of images.
    const epsilon = 1 / 256;
    for (let i = 0; i < uv.length; ++i) uv[i] = uv[i] * (1 - epsilon) + epsilon / 2;

    if (!texture && alpha > 0.5) ++this.emptyImageDraws;
    this.drawTextured(texture ?? this.blackTexture, pos, uv, vertexCount, [1, 1, 1, alpha]);
  }

  textSize(font: Font, text: string, large: boolean): { x: number; y: number } {
    const s = font.getSize(text, large);
    return { x: s.x / this.viewWidth, y: s.y / this.height };
  }

  renderText(
    font: Font,
    text: string,
    large: boolean,
    colour: [number, number, number, number],
    scale: number,
    offset: { x: number; y: number },
    zoomOrigin: number,
    zoom: number,
  ): void {
    const t = font.getTexture(text, large);
    if (!t) return;
    const px = (vx: number) => offset.x + (2 * scale * vx) / this.viewWidth;
    const py = (vy: number) => offset.y - (2 * scale * vy) / this.height;
    const x1 = px(t.x1);
    const x2 = px(t.x2);
    const y1 = py(t.y1);
    const y2 = py(t.y2);
    const pos = [
      x1, y1, zoom, zoomOrigin,
      x2, y1, zoom, zoomOrigin,
      x2, y2, zoom, zoomOrigin,
      x1, y1, zoom, zoomOrigin,
      x2, y2, zoom, zoomOrigin,
      x1, y2, zoom, zoomOrigin,
    ];
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    this.drawTextured(t.texture, pos, uv, 6, colour);
  }

  private drawTextured(
    texture: WebGLTexture,
    pos: number[],
    uv: number[],
    vertexCount: number,
    colour: [number, number, number, number],
  ): void {
    const gl = this.gl;
    const u = this.imageU;
    gl.useProgram(this.imageProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(u.tex, 0);
    gl.uniform1f(u.near_plane, 1);
    gl.uniform1f(u.far_plane, 1 + this.farPlaneDistance());
    gl.uniform1f(u.eye_offset, 0);
    gl.uniform4f(u.colour, colour[0], colour[1], colour[2], colour[3]);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.imagePosLoc);
    gl.vertexAttribPointer(this.imagePosLoc, 4, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(this.imageTexLoc);
    gl.vertexAttribPointer(this.imageTexLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
    gl.disableVertexAttribArray(this.imagePosLoc);
    gl.disableVertexAttribArray(this.imageTexLoc);
  }

  // Whether frames can be read back as I420 (dimensions must suit 4:2:0 packing).
  supportsYuvExport(): boolean {
    return this.width % 4 === 0 && this.height % 2 === 0;
  }

  // Renders subsequent frames offscreen so they can be converted for export.
  enableExportTarget(): void {
    if (this.exportTarget) return;
    const gl = this.gl;
    this.exportTarget = this.makeTarget(this.width, this.height);
    const w = this.width / 4;
    const h = (this.height * 3) / 2;
    this.yuvTarget = { ...this.makeTarget(w, h), w, h };
    this.yuvProgram = compile(gl, SPIRAL_VERTEX, YUV_FRAGMENT);
  }

  private makeTarget(w: number, h: number): { fbo: WebGLFramebuffer; tex: WebGLTexture } {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('export framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fbo, tex };
  }

  // Converts the last rendered frame to I420 and reads it into `out`
  // (width * height * 3/2 bytes).
  readYuv420(out: Uint8Array): void {
    const gl = this.gl;
    const target = this.yuvTarget!;
    const program = this.yuvProgram!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.viewport(0, 0, target.w, target.h);
    gl.disable(gl.BLEND);
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.exportTarget!.tex);
    gl.uniform1i(gl.getUniformLocation(program, 'src'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'W'), this.width);
    gl.uniform1i(gl.getUniformLocation(program, 'H'), this.height);
    const loc = gl.getAttribLocation(program, 'device_position');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disableVertexAttribArray(loc);
    gl.readPixels(0, 0, target.w, target.h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
  }

  // Reads the last rendered frame as RGBA (bottom-up rows).
  readRgba(out: Uint8Array): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.exportTarget?.fbo ?? null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    for (const t of [this.exportTarget, this.yuvTarget]) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fbo);
      gl.deleteTexture(t.tex);
    }
    if (this.yuvProgram) gl.deleteProgram(this.yuvProgram);
    this.textures.disposeAll();
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.positionBuffer);
    gl.deleteBuffer(this.texcoordBuffer);
    gl.deleteTexture(this.blackTexture);
    gl.deleteProgram(this.imageProgram);
    gl.deleteProgram(this.spiralProgram);
    gl.deleteVertexArray(this.vao);
  }
}

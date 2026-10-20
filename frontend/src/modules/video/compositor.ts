// WebGL2 compositor for video effects, shared by the live preview and the
// export: draws a source frame (rotated), then each layer — image overlays
// and area blurs — at its animated state, and finally mixes in the next
// part during a transition and applies fades. Coordinates are output pixels
// with y down; frame and FBO textures keep row 0 at the top.

import { stateAt, visibleAt, type Layer, type TransitionKind } from './project';

const VERT = `#version 300 es
in vec2 p;
uniform mat3 m;
uniform vec2 size;
uniform bool flipY;
out vec2 uv;
out vec2 px;
void main() {
  vec3 q = m * vec3(p, 1.0);
  px = q.xy;
  uv = p;
  vec2 c = q.xy / size * 2.0 - 1.0;
  gl_Position = vec4(c.x, flipY ? -c.y : c.y, 0.0, 1.0);
}`;

const DRAW = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D tex;
uniform float opacity;
void main() { vec4 c = texture(tex, uv); o = vec4(c.rgb, c.a * opacity); }`;

const BLUR = `#version 300 es
precision highp float;
in vec2 px;
out vec4 o;
uniform sampler2D src;
uniform vec2 size, c, hs, dir;
uniform float angle, feather, amount, opacity;
uniform int kind, shape, n;
vec4 at(vec2 p) { return texture(src, clamp(p, vec2(0.5), size - 0.5) / size); }
void main() {
  vec4 orig = at(px);
  float ca = cos(-angle), sa = sin(-angle);
  vec2 d = px - c;
  vec2 l = vec2(d.x * ca - d.y * sa, d.x * sa + d.y * ca) / max(hs, vec2(1.0));
  float r = shape == 0 ? max(abs(l.x), abs(l.y)) : length(l);
  float mask = 1.0 - smoothstep(1.0 - max(feather, 0.002), 1.0, r);
  if (mask <= 0.0) { o = orig; return; }
  vec4 acc = vec4(0.0);
  if (kind == 1) {
    vec2 b = vec2(max(amount, 1.0));
    acc = at((floor(px / b) + 0.5) * b);
  } else {
    for (int i = 0; i < n; i++) {
      float k = (float(i) + 0.5) / float(n);
      vec2 q;
      if (kind == 2) q = px + dir * (k - 0.5) * 2.0 * amount;
      else if (kind == 3) q = c + (px - c) * (1.0 - amount / 200.0 * k);
      else { float t = float(i) * 2.39996323; q = px + amount * sqrt(k) * vec2(cos(t), sin(t)); }
      acc += at(q);
    }
    acc /= float(n);
  }
  o = mix(orig, acc, mask * opacity);
}`;

const MIX = `#version 300 es
precision highp float;
in vec2 px;
out vec4 o;
uniform sampler2D a, b;
uniform vec2 size;
uniform bool hasB;
uniform int kind;
uniform float k, light;
void main() {
  vec2 uv = px / size;
  vec3 col = texture(a, uv).rgb;
  if (hasB) {
    float e = k * k * (3.0 - 2.0 * k);
    vec3 B = texture(b, uv).rgb;
    if (kind == 0) col = mix(col, B, e);
    else if (kind == 2) col = mix(B, col, smoothstep(e * 1.1 - 0.05, e * 1.1 + 0.05, uv.x));
    else if (kind == 3) col = uv.x < 1.0 - e ? texture(a, uv + vec2(e, 0.0)).rgb : texture(b, uv - vec2(1.0 - e, 0.0)).rgb;
    else if (kind == 4) col = mix(texture(a, 0.5 + (uv - 0.5) / (1.0 + e)).rgb, B, e);
  }
  o = vec4(col * light, 1.0);
}`;

const TRANS: Record<TransitionKind, number> = { crossfade: 0, dip: 0, wipe: 2, slide: 3, zoom: 4 };
const BLURS: Record<string, number> = { gaussian: 0, lens: 0, pixelate: 1, motion: 2, zoom: 3 };

type Mat = number[]; // column-major 3×3
const mul = (a: Mat, b: Mat): Mat => {
  const r = new Array(9).fill(0);
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) for (let k = 0; k < 3; k++) r[c * 3 + rr] += a[k * 3 + rr] * b[c * 3 + k];
  return r;
};
const T = (x: number, y: number): Mat => [1, 0, 0, 0, 1, 0, x, y, 1];
const S = (x: number, y: number): Mat => [x, 0, 0, 0, y, 0, 0, 0, 1];
const R = (deg: number): Mat => {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];
};

/** Maps the unit quad onto a w×h source rotated by `rot` and centred in an W×H target. */
export function frameMatrix(rot: number, w: number, h: number, W: number, H: number): Mat {
  return mul(T(W / 2, H / 2), mul(R(rot), mul(T(-w / 2, -h / 2), S(w, h))));
}

/** Maps the unit quad onto a layer of size w×h at the given state. */
export function layerMatrix(x: number, y: number, w: number, h: number, scale: number, rotation: number): Mat {
  return mul(T(x, y), mul(R(rotation), mul(S(w * scale, h * scale), T(-0.5, -0.5))));
}

export type FrameSource = TexImageSource;

export interface Side {
  frame: FrameSource;
  frameW: number;
  frameH: number;
  t: number; // source time for the layers
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
}

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private draw: WebGLProgram;
  private blur: WebGLProgram;
  private mixP: WebGLProgram;
  private frameTex: WebGLTexture;
  private targets: Target[] = [];
  private images = new Map<string, WebGLTexture>();
  private scratch: HTMLCanvasElement | null = null;
  private W = 0;
  private H = 0;

  constructor(canvas?: HTMLCanvasElement) {
    this.canvas = canvas ?? document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.draw = this.program(DRAW);
    this.blur = this.program(BLUR);
    this.mixP = this.program(MIX);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.frameTex = this.texture();
  }

  private program(frag: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Output size (after rotation). */
  resize(W: number, H: number) {
    if (W === this.W && H === this.H) return;
    this.W = this.canvas.width = W;
    this.H = this.canvas.height = H;
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    this.targets = [0, 1, 2, 3].map(() => {
      const tex = this.texture();
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return { tex, fb };
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private upload(tex: WebGLTexture, src: TexImageSource, w: number, h: number) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    } catch {
      // Some webviews can't upload a VideoFrame directly; go through a 2D canvas.
      const c = (this.scratch ??= document.createElement('canvas'));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
      }
      c.getContext('2d')!.drawImage(src as CanvasImageSource, 0, 0, w, h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    }
  }

  /** Register an overlay image (asset id → bitmap). */
  setImage(id: string, img: TexImageSource) {
    let t = this.images.get(id);
    if (!t) {
      t = this.texture();
      this.images.set(id, t);
    }
    const w = (img as ImageBitmap).width;
    const h = (img as ImageBitmap).height;
    this.upload(t, img, w, h);
  }

  hasImage(id: string) {
    return this.images.has(id);
  }

  private quad(p: WebGLProgram, m: Mat, fb: WebGLFramebuffer | null) {
    const gl = this.gl;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.viewport(0, 0, this.W, this.H);
    gl.uniformMatrix3fv(gl.getUniformLocation(p, 'm'), false, m);
    gl.uniform2f(gl.getUniformLocation(p, 'size'), this.W, this.H);
    gl.uniform1i(gl.getUniformLocation(p, 'flipY'), fb ? 0 : 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Frame + layers into targets[base] (uses base and base+1); returns the target holding the result. */
  private scene(side: Side, rotate: number, layers: Layer[], base: number): Target {
    const gl = this.gl;
    let cur = this.targets[base];
    let other = this.targets[base + 1];
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.upload(this.frameTex, side.frame, side.frameW, side.frameH);
    gl.useProgram(this.draw);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(gl.getUniformLocation(this.draw, 'tex'), 0);
    gl.uniform1f(gl.getUniformLocation(this.draw, 'opacity'), 1);
    this.quad(this.draw, frameMatrix(rotate, side.frameW, side.frameH, this.W, this.H), cur.fb);
    const full = S(this.W, this.H);
    for (const l of layers) {
      if (!visibleAt(l, side.t)) continue;
      const s = stateAt(l, side.t);
      if (s.opacity <= 0.001) continue;
      if (l.kind === 'image' && l.asset && this.images.has(l.asset)) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.draw);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.images.get(l.asset)!);
        gl.uniform1f(gl.getUniformLocation(this.draw, 'opacity'), s.opacity);
        this.quad(this.draw, layerMatrix(s.x, s.y, l.w, l.h, s.scale, s.rotation), cur.fb);
        gl.disable(gl.BLEND);
      } else if (l.kind === 'blur' && l.blur) {
        const b = l.blur;
        const p = this.blur;
        gl.useProgram(p);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, cur.tex);
        const u = (k: string) => gl.getUniformLocation(p, k);
        gl.uniform1i(u('src'), 0);
        gl.uniform2f(u('c'), s.x, s.y);
        gl.uniform2f(u('hs'), (l.w * s.scale) / 2, (l.h * s.scale) / 2);
        gl.uniform1f(u('angle'), (s.rotation * Math.PI) / 180);
        gl.uniform1f(u('feather'), b.feather);
        const amount = b.amount;
        gl.uniform1f(u('amount'), amount);
        gl.uniform1f(u('opacity'), s.opacity);
        const kind = BLURS[b.kind] ?? 0;
        gl.uniform1i(u('kind'), kind);
        gl.uniform1i(u('shape'), b.shape === 'ellipse' ? 1 : 0);
        const ang = (b.angle * Math.PI) / 180;
        gl.uniform2f(u('dir'), Math.cos(ang), Math.sin(ang));
        gl.uniform1i(u('n'), Math.max(8, Math.min(kind === 0 ? 128 : 96, Math.ceil(kind === 0 ? amount * amount * 0.6 : amount * 2))));
        this.quad(p, full, other.fb);
        [cur, other] = [other, cur];
      }
    }
    return cur;
  }

  /** Render one output frame into the canvas. */
  render(opts: { a: Side; b?: (Side & { kind: TransitionKind; progress: number }) | null; light: number; rotate: number; layers: Layer[] }) {
    const gl = this.gl;
    const ra = this.scene(opts.a, opts.rotate, opts.layers, 0);
    const rb = opts.b ? this.scene(opts.b, opts.rotate, opts.layers, 2) : null;
    const p = this.mixP;
    gl.useProgram(p);
    const u = (k: string) => gl.getUniformLocation(p, k);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, ra.tex);
    gl.uniform1i(u('a'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (rb ?? ra).tex);
    gl.uniform1i(u('b'), 1);
    gl.uniform1i(u('hasB'), rb ? 1 : 0);
    gl.uniform1i(u('kind'), opts.b ? TRANS[opts.b.kind] : 0);
    gl.uniform1f(u('k'), opts.b ? Math.min(1, Math.max(0, opts.b.progress)) : 0);
    gl.uniform1f(u('light'), opts.light);
    gl.activeTexture(gl.TEXTURE0);
    this.quad(p, S(this.W, this.H), null);
  }

  destroy() {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

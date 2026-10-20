// Colour and detail adjustments on the GPU (WebGL2): the source canvas is
// uploaded once, every slider change re-renders in a few milliseconds, and
// the result canvas can be shown directly as the live preview. Canvas
// `filter` isn't available in every webview, and per-pixel JavaScript would
// block the UI on large photos.

export interface Adjustments {
  exposure: number; // stops, -2..2
  brightness: number; // -1..1
  contrast: number; // -1..1
  highlights: number; // -1..1
  shadows: number; // -1..1
  saturation: number; // -1..1 (-1 = grayscale)
  vibrance: number; // -1..1
  temperature: number; // -1..1 (cool..warm)
  tint: number; // -1..1 (green..magenta)
  hue: number; // degrees, -180..180
  sharpen: number; // 0..1
  blur: number; // amount in px, 0..100 (radius; length for motion; % for zoom; degrees for spin)
  blurType: BlurType;
  blurAngle: number; // degrees, motion direction / tilt-shift band angle
  blurX: number; // 0..1, centre for zoom, spin, tilt-shift
  blurY: number; // 0..1
  blurBand: number; // 0..1, tilt-shift: half-height of the sharp band (fraction of the image)
  vignette: number; // 0..1
  grayscale: boolean;
  sepia: boolean;
  invert: boolean;
}

export type BlurType = 'gaussian' | 'motion' | 'zoom' | 'spin' | 'lens' | 'tiltshift' | 'surface';
export const BLUR_TYPES: { id: BlurType; label: string; help: string }[] = [
  { id: 'gaussian', label: 'Gaussian', help: 'Soft, even blur' },
  { id: 'motion', label: 'Motion', help: 'Streaks along a direction, like a moving camera' },
  { id: 'zoom', label: 'Zoom', help: 'Radial streaks from the centre point, like zooming during the exposure' },
  { id: 'spin', label: 'Spin', help: 'Circular blur around the centre point' },
  { id: 'lens', label: 'Lens', help: 'Round out-of-focus blur with bright bokeh highlights' },
  { id: 'tiltshift', label: 'Tilt-shift', help: 'Sharp band, increasingly blurred above and below (miniature look)' },
  { id: 'surface', label: 'Surface', help: 'Smooths surfaces and noise but keeps edges sharp' },
];

export const NEUTRAL: Adjustments = {
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  sharpen: 0,
  blur: 0,
  blurType: 'gaussian',
  blurAngle: 0,
  blurX: 0.5,
  blurY: 0.5,
  blurBand: 0.15,
  vignette: 0,
  grayscale: false,
  sepia: false,
  invert: false,
};

const BLUR_SHAPE: (keyof Adjustments)[] = ['blurType', 'blurAngle', 'blurX', 'blurY', 'blurBand'];

/** True when nothing would change (blur shape settings alone don't count). */
export function isNeutral(a: Adjustments): boolean {
  return (Object.keys(NEUTRAL) as (keyof Adjustments)[]).every((k) => BLUR_SHAPE.includes(k) || a[k] === NEUTRAL[k]);
}

const VERT = `#version 300 es
in vec2 p;
out vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// One-dimensional Gaussian blur; run horizontally then vertically.
const BLUR = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform vec2 dir;   // texel step in the blur direction
uniform float sigma;
void main() {
  float r = ceil(sigma * 2.5);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (float i = -64.0; i <= 64.0; i += 1.0) {
    if (abs(i) > r) continue;
    float w = exp(-(i * i) / (2.0 * sigma * sigma));
    vec4 c = texture(src, uv + dir * i);
    acc += vec4(c.rgb * c.a, c.a) * w; // premultiplied, so transparent pixels don't bleed colour
    wsum += w;
  }
  acc /= wsum;
  o = acc.a > 0.0 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
}`;

// Shaped blurs, one pass over n taps (premultiplied). kind: 1 motion, 2 zoom,
// 3 spin, 4 lens, 5 surface. Positions are in pixels; the texture is flipped
// (FLIP_Y), so image y grows towards uv.y = 0.
const FX = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform int kind, n;
uniform float amount;
uniform vec2 size, dir, center;
vec4 tap(vec2 p) { vec4 c = texture(src, p / size); return vec4(c.rgb * c.a, c.a); }
void main() {
  vec2 px = uv * size;
  vec4 c0 = texture(src, uv);
  vec4 acc = vec4(0.0);
  float ws = 0.0;
  for (int i = 0; i < n; i++) {
    float k = (float(i) + 0.5) / float(n);
    vec2 p;
    float w = 1.0;
    if (kind == 1) p = px + dir * (k - 0.5) * 2.0 * amount;
    else if (kind == 2) p = center + (px - center) * (1.0 - amount * k);
    else if (kind == 3) {
      float a = (k - 0.5) * amount;
      vec2 v = px - center;
      p = center + vec2(v.x * cos(a) - v.y * sin(a), v.x * sin(a) + v.y * cos(a));
    } else {
      float r = amount * sqrt(k);
      float t = float(i) * 2.39996323; // golden angle: even disc coverage
      p = px + r * vec2(cos(t), sin(t));
    }
    vec4 c = tap(p);
    if (kind == 4) w = 1.0 + 12.0 * pow(max(c.r, max(c.g, c.b)), 6.0); // bright spots bloom into discs
    if (kind == 5) { vec3 d = c.rgb - c0.rgb * c.a; w = exp(-dot(d, d) / 0.02); }
    acc += c * w;
    ws += w;
  }
  acc /= ws;
  o = acc.a > 0.0 ? vec4(acc.rgb / acc.a, acc.a) : vec4(0.0);
}`;

const MAIN = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 o;
uniform sampler2D src;
uniform sampler2D sharpSrc; // small blur, for unsharp mask
uniform sampler2D blurSrc;  // big blur
uniform sampler2D mask;
uniform bool useMask, useSharp, useBlur, tilt;
uniform vec2 tiltC, tiltN, size;
uniform float tiltW;
uniform float exposure, brightness, contrast, highlights, shadows, saturation, vibrance, temperature, tint, hue, sharpen, vignette;
uniform bool grayscale, sepia, invertc;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec4 orig = texture(src, uv);
  vec4 base = useBlur ? texture(blurSrc, uv) : orig;
  if (useBlur && tilt) {
    // Distance from the sharp band's centre line, in units of the image height.
    float d = abs(dot(uv * size - tiltC, tiltN)) / size.y;
    base = mix(orig, base, smoothstep(tiltW, tiltW + 0.2, d));
  }
  vec3 c = base.rgb;
  if (useSharp) c += (c - texture(sharpSrc, uv).rgb) * sharpen * 2.5;
  c *= exp2(exposure);
  // Temperature/tint as channel gains.
  c *= vec3(1.0 + temperature * 0.25, 1.0 - tint * 0.15, 1.0 - temperature * 0.25);
  c.g *= 1.0;
  c += brightness * 0.5;
  c = (c - 0.5) * (contrast >= 0.0 ? 1.0 + contrast * 2.0 : 1.0 + contrast) + 0.5;
  float l = luma(clamp(c, 0.0, 1.0));
  c += shadows * 0.6 * pow(1.0 - l, 3.0);
  c += highlights * 0.6 * pow(l, 3.0);
  if (hue != 0.0) {
    vec3 h = rgb2hsv(clamp(c, 0.0, 1.0));
    h.x = fract(h.x + hue / 360.0);
    c = hsv2rgb(h);
  }
  float g = luma(c);
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(g), c, 1.0 + saturation + vibrance * (1.0 - sat));
  if (grayscale) c = vec3(luma(c));
  if (sepia) {
    c = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
  }
  if (invertc) c = 1.0 - c;
  if (vignette > 0.0) {
    vec2 d = uv - 0.5;
    c *= 1.0 - vignette * smoothstep(0.25, 0.75, length(d) * 1.2);
  }
  vec4 adj = vec4(clamp(c, 0.0, 1.0), base.a);
  if (useMask) adj = mix(orig, adj, texture(mask, uv).a);
  o = adj;
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader: ${gl.getShaderInfoLog(s)}`);
  return s;
}

function program(gl: WebGL2RenderingContext, frag: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'p');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`program: ${gl.getProgramInfoLog(p)}`);
  return p;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
}

/** Renders adjustments of one source image; reuse it while sliders move. */
export class Adjuster {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private main: WebGLProgram;
  private blur: WebGLProgram;
  private fx: WebGLProgram;
  private src: WebGLTexture;
  private mask: WebGLTexture | null = null;
  private tmp: Target;
  private sharpT: Target;
  private blurT: Target;
  private w: number;
  private h: number;
  private lastSharpSigma = -1;
  private lastBlur = '';

  constructor(source: HTMLCanvasElement, mask?: HTMLCanvasElement | null) {
    this.w = source.width;
    this.h = source.height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.main = program(gl, MAIN);
    this.blur = program(gl, BLUR);
    this.fx = program(gl, FX);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    this.src = this.texture(source);
    if (mask) this.mask = this.texture(mask);
    this.tmp = this.target();
    this.sharpT = this.target();
    this.blurT = this.target();
  }

  private texture(img: TexImageSource | null): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return t;
  }

  private target(): Target {
    const gl = this.gl;
    const tex = this.texture(null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb };
  }

  private gaussian(into: Target, sigma: number) {
    const gl = this.gl;
    gl.useProgram(this.blur);
    gl.uniform1f(gl.getUniformLocation(this.blur, 'sigma'), sigma);
    gl.uniform1i(gl.getUniformLocation(this.blur, 'src'), 0);
    gl.activeTexture(gl.TEXTURE0);
    // Horizontal into tmp, vertical into the target. Sigma above ~25 px
    // would exceed the shader's 64-tap window, so large blurs downscale it.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.tmp.fb);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.uniform2f(gl.getUniformLocation(this.blur, 'dir'), 1 / this.w, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
    gl.bindTexture(gl.TEXTURE_2D, this.tmp.tex);
    gl.uniform2f(gl.getUniformLocation(this.blur, 'dir'), 0, 1 / this.h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private shaped(into: Target, a: Adjustments) {
    const gl = this.gl;
    const p = this.fx;
    gl.useProgram(p);
    const u = (k: string) => gl.getUniformLocation(p, k);
    const kinds = { motion: 1, zoom: 2, spin: 3, lens: 4, surface: 5 } as Record<string, number>;
    const kind = kinds[a.blurType];
    const rad = (a.blurAngle * Math.PI) / 180;
    // amount: px for motion/lens/surface, fraction for zoom (0..0.5), radians for spin (0..~60°)
    const amount = kind === 2 ? a.blur / 200 : kind === 3 ? (a.blur * Math.PI) / 300 : a.blur;
    // Enough taps that streaks don't break into dots (capped for slow GPUs).
    const reach = kind === 2 ? amount * Math.hypot(this.w, this.h) / 2 : kind === 3 ? amount * Math.hypot(this.w, this.h) / 2 : amount * 2;
    const n = Math.max(8, Math.min(kind === 4 || kind === 5 ? 160 : 128, Math.ceil(kind === 4 || kind === 5 ? amount * amount * 0.8 : reach)));
    gl.uniform1i(u('kind'), kind);
    gl.uniform1i(u('n'), n);
    gl.uniform1f(u('amount'), amount);
    gl.uniform2f(u('size'), this.w, this.h);
    gl.uniform2f(u('dir'), Math.cos(rad), -Math.sin(rad));
    gl.uniform2f(u('center'), a.blurX * this.w, (1 - a.blurY) * this.h);
    gl.uniform1i(u('src'), 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.bindFramebuffer(gl.FRAMEBUFFER, into.fb);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Render adjustments into `canvas`. */
  render(a: Adjustments) {
    const gl = this.gl;
    gl.viewport(0, 0, this.w, this.h);
    const sharpSigma = a.sharpen > 0 ? 1.4 : 0;
    const useBlur = a.blur > 0.6;
    const gaussian = a.blurType === 'gaussian' || a.blurType === 'tiltshift';
    if (sharpSigma && sharpSigma !== this.lastSharpSigma) this.gaussian(this.sharpT, sharpSigma);
    const key = useBlur ? (gaussian ? `g${a.blur}` : `${a.blurType}:${a.blur}:${a.blurAngle}:${a.blurX}:${a.blurY}`) : '';
    if (useBlur && key !== this.lastBlur) {
      if (gaussian) this.gaussian(this.blurT, Math.min(25, a.blur / 2));
      else this.shaped(this.blurT, a);
    }
    this.lastSharpSigma = sharpSigma;
    this.lastBlur = key;
    const p = this.main;
    gl.useProgram(p);
    const u = (n: string) => gl.getUniformLocation(p, n);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.uniform1i(u('src'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sharpT.tex);
    gl.uniform1i(u('sharpSrc'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.blurT.tex);
    gl.uniform1i(u('blurSrc'), 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.mask ?? this.src);
    gl.uniform1i(u('mask'), 3);
    gl.uniform1i(u('useMask'), this.mask ? 1 : 0);
    gl.uniform1i(u('useSharp'), sharpSigma ? 1 : 0);
    gl.uniform1i(u('useBlur'), useBlur ? 1 : 0);
    const tr = (a.blurAngle * Math.PI) / 180;
    gl.uniform1i(u('tilt'), a.blurType === 'tiltshift' ? 1 : 0);
    gl.uniform2f(u('size'), this.w, this.h);
    gl.uniform2f(u('tiltC'), a.blurX * this.w, (1 - a.blurY) * this.h);
    gl.uniform2f(u('tiltN'), Math.sin(tr), Math.cos(tr)); // normal of a band at angle tr (flipped y)
    gl.uniform1f(u('tiltW'), a.blurBand);
    for (const k of ['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'vibrance', 'temperature', 'tint', 'hue', 'sharpen', 'vignette'] as const) {
      gl.uniform1f(u(k), a[k]);
    }
    gl.uniform1i(u('grayscale'), a.grayscale ? 1 : 0);
    gl.uniform1i(u('sepia'), a.sepia ? 1 : 0);
    gl.uniform1i(u('invertc'), a.invert ? 1 : 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** A 2D canvas copy of the last render (the GL canvas is reused). */
  snapshot(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.w;
    c.height = this.h;
    c.getContext('2d')!.drawImage(this.canvas, 0, 0);
    return c;
  }

  destroy() {
    const ext = this.gl.getExtension('WEBGL_lose_context');
    ext?.loseContext();
  }
}

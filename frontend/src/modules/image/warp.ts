// Corner-pin transforms: skew, distort and perspective (a layer's four
// corners moved), perspective crop (a quadrilateral made a rectangle) and the
// straighten tool's crop. A projective map (homography) takes each output
// pixel back to where it comes from; the GPU samples the picture there
// (bilinear, mipmapped), with a plain loop for when there is no WebGL2.

export interface Pt {
  x: number;
  y: number;
}
/** Corners clockwise from the top left: top left, top right, bottom right, bottom left. */
export type Quad = [Pt, Pt, Pt, Pt];
/** 3×3, row-major. */
export type Mat3 = number[];
export type WarpMode = 'skew' | 'distort' | 'perspective';

/** The homography taking the four points `from` onto `to`. */
export function homography(from: Quad, to: Quad): Mat3 {
  // h33 = 1; eight unknowns, two equations per point.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting.
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      if (f) for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [A[0][8], A[1][8], A[2][8], A[3][8], A[4][8], A[5][8], A[6][8], A[7][8], 1];
}

export function invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

export function apply(m: Mat3, p: Pt): Pt {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  return { x: (m[0] * p.x + m[1] * p.y + m[2]) / w, y: (m[3] * p.x + m[4] * p.y + m[5]) / w };
}

export const rectQuad = (x: number, y: number, w: number, h: number): Quad => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

export function quadBounds(q: Quad): { x: number; y: number; width: number; height: number } {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const x = Math.floor(Math.min(...xs));
  const y = Math.floor(Math.min(...ys));
  return { x, y, width: Math.ceil(Math.max(...xs)) - x, height: Math.ceil(Math.max(...ys)) - y };
}

/** True when the four corners make a quadrilateral that doesn't fold over itself (convex, clockwise or not). */
export function quadOk(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const c = q[(i + 2) % 4];
    const z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-9) return false;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/**
 * Corner i dragged to p (start: the corners when the drag began). Distort
 * moves it alone; perspective moves its neighbour along the edge the drag
 * mostly follows the opposite way (a keystone), as in Photoshop.
 */
export function dragCorner(start: Quad, i: number, p: Pt, mode: WarpMode): Quad {
  const q = start.map((c) => ({ ...c })) as Quad;
  const dx = p.x - start[i].x;
  const dy = p.y - start[i].y;
  if (mode !== 'perspective') {
    q[i] = { ...p };
    return q;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    const j = [1, 0, 3, 2][i]; // the corner on the same top or bottom edge
    q[i].x += dx;
    q[j].x -= dx;
  } else {
    const j = [3, 2, 1, 0][i]; // the corner on the same left or right edge
    q[i].y += dy;
    q[j].y -= dy;
  }
  return q;
}

/**
 * Edge e (0 top, 1 right, 2 bottom, 3 left) dragged by d. Skew slides it
 * along itself; distort moves it freely.
 */
export function dragEdge(start: Quad, e: number, d: Pt, mode: WarpMode): Quad {
  const q = start.map((c) => ({ ...c })) as Quad;
  const a = e;
  const b = (e + 1) % 4;
  let mx = d.x;
  let my = d.y;
  if (mode !== 'distort') {
    const ex = start[b].x - start[a].x;
    const ey = start[b].y - start[a].y;
    const len2 = ex * ex + ey * ey || 1;
    const k = (d.x * ex + d.y * ey) / len2;
    mx = k * ex;
    my = k * ey;
  }
  for (const i of [a, b]) q[i] = { x: start[i].x + mx, y: start[i].y + my };
  return q;
}

/** The rectangle a quadrilateral becomes in a perspective crop: its average width and height. */
export function cropSize(q: Quad): { w: number; h: number } {
  const d = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  return { w: Math.max(1, Math.round((d(q[0], q[1]) + d(q[3], q[2])) / 2)), h: Math.max(1, Math.round((d(q[0], q[3]) + d(q[1], q[2])) / 2)) };
}

/** The turn (degrees, clockwise positive) that makes the line a→b level, or upright when it is closer to that. */
export function straightenAngle(a: Pt, b: Pt): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI; // -180..180, y down
  // The nearest multiple of 90° is the level it should have.
  const target = Math.round(deg / 90) * 90;
  return target - deg;
}

/** The largest upright rectangle inside a w × h picture turned by deg (about its middle). */
export function innerRect(w: number, h: number, deg: number): { w: number; h: number } {
  const a = (deg * Math.PI) / 180;
  const sin = Math.abs(Math.sin(a));
  const cos = Math.abs(Math.cos(a));
  if (sin < 1e-9) return { w, h };
  const wide = w >= h;
  const long = wide ? w : h;
  const short = wide ? h : w;
  let rw: number;
  let rh: number;
  if (short <= 2 * sin * cos * long || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * short;
    [rw, rh] = wide ? [x / sin, x / cos] : [x / cos, x / sin];
  } else {
    const cos2 = cos * cos - sin * sin;
    rw = (w * cos - h * sin) / cos2;
    rh = (h * cos - w * sin) / cos2;
  }
  return { w: Math.max(1, Math.floor(rw)), h: Math.max(1, Math.floor(rh)) };
}

/**
 * The picture at `out` (in output coordinates), each pixel taken from where
 * inv sends it in src: bilinear, edges anti-aliased, transparent outside.
 * RGBA in and out (premultiplied or not alike).
 */
export function warpPixels(src: Uint8ClampedArray, sw: number, sh: number, inv: Mat3, out: { x: number; y: number; width: number; height: number }): Uint8ClampedArray {
  const W = out.width;
  const H = out.height;
  const res = new Uint8ClampedArray(W * H * 4);
  const px = (x: number, y: number, k: number) => src[(y * sw + x) * 4 + k];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const s = apply(inv, { x: out.x + i + 0.5, y: out.y + j + 0.5 });
      const cover = Math.min(1, Math.max(0, Math.min(s.x, sw - s.x, s.y, sh - s.y) + 0.5));
      if (cover <= 0 || !Number.isFinite(s.x)) continue;
      const fx = s.x - 0.5;
      const fy = s.y - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const cx0 = Math.min(sw - 1, Math.max(0, x0));
      const cx1 = Math.min(sw - 1, Math.max(0, x0 + 1));
      const cy0 = Math.min(sh - 1, Math.max(0, y0));
      const cy1 = Math.min(sh - 1, Math.max(0, y0 + 1));
      const o = (j * W + i) * 4;
      for (let k = 0; k < 4; k++) {
        const v = (px(cx0, cy0, k) * (1 - tx) + px(cx1, cy0, k) * tx) * (1 - ty) + (px(cx0, cy1, k) * (1 - tx) + px(cx1, cy1, k) * tx) * ty;
        res[o + k] = k === 3 ? v * cover : v;
      }
    }
  }
  return res;
}

// ---- on the GPU ----

const VS = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FS = `#version 300 es
precision highp float;
uniform sampler2D src;
uniform mat3 inv;
uniform vec2 srcSize;
uniform vec2 origin;
uniform float outH;
out vec4 o;
void main() {
  vec2 p = vec2(gl_FragCoord.x, outH - gl_FragCoord.y) + origin;
  vec3 q = inv * vec3(p, 1.0);
  vec2 s = q.xy / q.z;
  float cover = clamp(min(min(s.x, srcSize.x - s.x), min(s.y, srcSize.y - s.y)) + 0.5, 0.0, 1.0);
  if (q.z <= 0.0) cover = 0.0;
  o = texture(src, s / srcSize) * cover;
}`;

let gpu: { gl: WebGL2RenderingContext; canvas: HTMLCanvasElement; prog: WebGLProgram; tex: WebGLTexture } | null | undefined;

function setup(): typeof gpu {
  if (gpu !== undefined) return gpu;
  gpu = null;
  if (typeof document === 'undefined') return gpu;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return gpu;
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const prog = gl.createProgram()!;
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return gpu;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture()!;
  gpu = { gl, canvas, prog, tex };
  return gpu;
}

/** The last source uploaded (so dragging a corner doesn't upload the picture every frame). */
let uploaded: HTMLCanvasElement | null = null;

/**
 * The picture src drawn through inv (output → src coordinates) into a canvas
 * covering `out`; scale < 1 draws it smaller (a quick preview).
 */
export function warpCanvas(src: HTMLCanvasElement, inv: Mat3, out: { x: number; y: number; width: number; height: number }, scale = 1): HTMLCanvasElement {
  const W = Math.max(1, Math.round(out.width * scale));
  const H = Math.max(1, Math.round(out.height * scale));
  const res = document.createElement('canvas');
  res.width = W;
  res.height = H;
  // Output pixels of the smaller canvas, back to output coordinates first.
  const inv2 = scale === 1 ? inv : mul(inv, [1 / scale, 0, 0, 0, 1 / scale, 0, 0, 0, 1]);
  const o = scale === 1 ? out : { x: out.x * scale, y: out.y * scale, width: W, height: H };
  const g = setup();
  if (g && Math.max(src.width, src.height) <= g.gl.getParameter(g.gl.MAX_TEXTURE_SIZE) && Math.max(W, H) <= g.gl.getParameter(g.gl.MAX_RENDERBUFFER_SIZE)) {
    const { gl, canvas, prog, tex } = g;
    canvas.width = W;
    canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.useProgram(prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (uploaded !== src) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      uploaded = src;
    }
    gl.uniform1i(gl.getUniformLocation(prog, 'src'), 0);
    // GLSL matrices are column-major.
    const m = inv2;
    gl.uniformMatrix3fv(gl.getUniformLocation(prog, 'inv'), false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]);
    gl.uniform2f(gl.getUniformLocation(prog, 'srcSize'), src.width, src.height);
    gl.uniform2f(gl.getUniformLocation(prog, 'origin'), o.x, o.y);
    gl.uniform1f(gl.getUniformLocation(prog, 'outH'), H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    res.getContext('2d')!.drawImage(canvas, 0, 0);
    return res;
  }
  const data = src.getContext('2d')!.getImageData(0, 0, src.width, src.height).data;
  const px = warpPixels(data, src.width, src.height, inv2, o);
  res.getContext('2d')!.putImageData(new ImageData(px as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
  return res;
}

/** Forget the uploaded picture (it changed in place, or is no longer needed). */
export function forgetUpload() {
  uploaded = null;
}

export function mul(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]);
  return r;
}

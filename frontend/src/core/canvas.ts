// Dark canvases: drawings and diagrams follow the dark theme the way
// Excalidraw's own dark mode does — the picture is shown through
// invert(93%) hue-rotate(180deg), so white paper turns near-black, black ink
// turns near-white and colours keep their hue. The file is not changed and
// exports keep its real colours. Images inside a drawing are flipped back.

/** The CSS filter (for HTML boxes and whole <svg> elements). */
export const DARK_FILTER = 'invert(93%) hue-rotate(180deg)';

const A = 0.93;
// hue-rotate(180deg) as in the Filter Effects spec (cos = −1, sin = 0).
const H = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

/** DARK_FILTER as one sRGB colour matrix: hue-rotate(invert(v)). Each row of H sums to 1, so the offset is A. */
export function darkMatrix(): number[][] {
  return H.map((row) => row.map((v) => v * (1 - 2 * A)).concat(A));
}

/** feColorMatrix values that undo the flip on images (invert(100%) hue-rotate(180deg), as Excalidraw does). */
export const IMAGE_UNDO = H.map((row) => row.map((v) => -v).concat(0, 1).join(' ')).join(' ') + ' 0 0 0 1 0';

let ctx: CanvasRenderingContext2D | null = null;

/** [r, g, b, a] (0..255, alpha 0..1) of any CSS colour; null if it doesn't parse. */
export function parseColor(css: string): [number, number, number, number] | null {
  const s = css.trim().toLowerCase();
  if (s === 'transparent') return [0, 0, 0, 0];
  let hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
  if (!hex) {
    if (typeof document === 'undefined') return null;
    ctx ??= document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#010203';
    ctx.fillStyle = s;
    const n = String(ctx.fillStyle);
    if (n === '#010203' && s !== '#010203') return null;
    hex = /^#([0-9a-f]{6})$/.exec(n)?.[1];
    if (!hex) {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(n);
      return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
    }
  }
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) return null;
  const v = (i: number) => parseInt(hex!.slice(i, i + 2), 16);
  return [v(0), v(2), v(4), hex.length === 8 ? v(6) / 255 : 1];
}

/** Whether a background is light enough to be darkened (unparsable and see-through count as white paper). */
export function isLight(css: string): boolean {
  const c = parseColor(css);
  if (!c || c[3] < 0.5) return true;
  return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255 > 0.5;
}

/** A colour as it looks through DARK_FILTER (for things drawn outside the filtered layer). */
export function darkColor(css: string): string {
  const c = parseColor(css);
  if (!c) return css;
  const m = darkMatrix();
  const out = m.map((row) => {
    const v = row[0] * (c[0] / 255) + row[1] * (c[1] / 255) + row[2] * (c[2] / 255) + row[3];
    return Math.round(Math.min(1, Math.max(0, v)) * 255);
  });
  return c[3] < 1 ? `rgba(${out[0]}, ${out[1]}, ${out[2]}, ${c[3]})` : `rgb(${out[0]}, ${out[1]}, ${out[2]})`;
}

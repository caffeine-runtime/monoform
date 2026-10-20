// Colours of an image: the dominant colours (median cut, refined with a few
// k-means passes; transparent pixels ignored) and colour formats for the
// picker.

export interface PaletteColor {
  rgb: [number, number, number];
  /** Share of the (opaque) pixels closest to it, 0–1. */
  share: number;
}

/** Dominant colours of RGBA pixels, most common first. */
export function extractPalette(px: Uint8ClampedArray, n: number, step = 1): PaletteColor[] {
  const pts: number[] = [];
  for (let i = 0; i < px.length; i += 4 * step) if (px[i + 3] >= 128) pts.push(px[i], px[i + 1], px[i + 2]);
  const count = pts.length / 3;
  if (!count) return [];
  // Median cut: split the box with the widest channel range at its median.
  type Box = number[]; // indices of points
  let boxes: Box[] = [Array.from({ length: count }, (_, i) => i)];
  const range = (b: Box, c: number) => {
    let lo = 255;
    let hi = 0;
    for (const i of b) {
      const v = pts[i * 3 + c];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return hi - lo;
  };
  while (boxes.length < n) {
    let best = -1;
    let bestC = 0;
    let bestR = 0;
    boxes.forEach((b, k) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        const r = range(b, c) * Math.sqrt(b.length);
        if (r > bestR) {
          bestR = r;
          best = k;
          bestC = c;
        }
      }
    });
    if (best < 0 || bestR === 0) break;
    const b = boxes[best].sort((x, y) => pts[x * 3 + bestC] - pts[y * 3 + bestC]);
    const mid = b.length >> 1;
    boxes = [...boxes.slice(0, best), b.slice(0, mid), b.slice(mid), ...boxes.slice(best + 1)];
  }
  let centers = boxes.map((b) => {
    const s = [0, 0, 0];
    for (const i of b) for (let c = 0; c < 3; c++) s[c] += pts[i * 3 + c];
    return s.map((v) => v / b.length);
  });
  // k-means refinement.
  const assign = new Int32Array(count);
  for (let iter = 0; iter < 6; iter++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i++) {
      let bi = 0;
      let bd = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const dr = pts[i * 3] - centers[k][0];
        const dg = pts[i * 3 + 1] - centers[k][1];
        const db = pts[i * 3 + 2] - centers[k][2];
        const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (d < bd) {
          bd = d;
          bi = k;
        }
      }
      assign[i] = bi;
      const s = sums[bi];
      s[0] += pts[i * 3];
      s[1] += pts[i * 3 + 1];
      s[2] += pts[i * 3 + 2];
      s[3]++;
    }
    centers = centers.map((c, k) => (sums[k][3] ? [sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]] : c));
  }
  const counts = centers.map(() => 0);
  for (let i = 0; i < count; i++) counts[assign[i]]++;
  const out = centers.map((c, k) => ({ rgb: c.map((v) => Math.round(v)) as [number, number, number], share: counts[k] / count })).filter((c) => c.share > 0);
  // Merge near-identical colours (flat images).
  const merged: PaletteColor[] = [];
  for (const c of out.sort((a, b) => b.share - a.share)) {
    const same = merged.find((m) => Math.abs(m.rgb[0] - c.rgb[0]) + Math.abs(m.rgb[1] - c.rgb[1]) + Math.abs(m.rgb[2] - c.rgb[2]) < 6);
    if (same) same.share += c.share;
    else merged.push({ ...c });
  }
  return merged;
}

export function hex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function hsl([r, g, b]: [number, number, number]): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h *= 60;
  }
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

export function formats(rgb: [number, number, number]): { label: string; value: string }[] {
  const [h, s, l] = hsl(rgb);
  return [
    { label: 'HEX', value: hex(rgb) },
    { label: 'RGB', value: `rgb(${rgb.join(', ')})` },
    { label: 'HSL', value: `hsl(${h}, ${s}%, ${l}%)` },
  ];
}

/** GIMP / Inkscape palette file. */
export function toGpl(name: string, colors: PaletteColor[]): string {
  return `GIMP Palette\nName: ${name}\nColumns: ${Math.min(colors.length, 8)}\n#\n${colors.map((c) => `${c.rgb.map((v) => String(v).padStart(3)).join(' ')}\t${hex(c.rgb)}`).join('\n')}\n`;
}

export function toCss(colors: PaletteColor[]): string {
  return `:root {\n${colors.map((c, i) => `  --color-${i + 1}: ${hex(c.rgb)};`).join('\n')}\n}\n`;
}

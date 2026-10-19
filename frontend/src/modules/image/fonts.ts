// Fonts for the text tool: the bundled ones plus whichever common system
// fonts are installed. document.fonts.check() reports true for fonts that
// don't exist, so availability is detected by measuring text against two
// generic fallbacks.

export const BUNDLED = ['Inter Variable', 'Source Serif 4 Variable'];
export const GENERIC = ['sans-serif', 'serif', 'monospace', 'cursive'];

const CANDIDATES = [
  'Arial', 'Arial Black', 'Helvetica', 'Helvetica Neue', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Segoe UI', 'Calibri', 'Candara',
  'Roboto', 'Open Sans', 'Noto Sans', 'Ubuntu', 'Cantarell', 'DejaVu Sans', 'Liberation Sans', 'Fira Sans', 'Source Sans 3',
  'Avenir', 'Avenir Next', 'Futura', 'Gill Sans', 'Optima', 'Franklin Gothic Medium', 'Bahnschrift', 'SF Pro Display',
  'Georgia', 'Times New Roman', 'Times', 'Garamond', 'EB Garamond', 'Palatino', 'Palatino Linotype', 'Book Antiqua', 'Cambria',
  'Baskerville', 'Didot', 'Rockwell', 'Noto Serif', 'DejaVu Serif', 'Liberation Serif', 'Constantia',
  'Courier New', 'Consolas', 'Menlo', 'Monaco', 'SF Mono', 'Cascadia Code', 'JetBrains Mono', 'Fira Code', 'DejaVu Sans Mono', 'Liberation Mono', 'Ubuntu Mono',
  'Comic Sans MS', 'Impact', 'Brush Script MT', 'Lucida Handwriting', 'Papyrus', 'Chalkboard', 'Marker Felt', 'Copperplate', 'Segoe Script', 'Segoe Print',
];

let cached: string[] | null = null;

/** Installed font families (bundled first, generic families last). */
export function availableFonts(): string[] {
  if (cached) return cached;
  const c = document.createElement('canvas').getContext('2d')!;
  const sample = 'mmmmmmmmmmlli WQ@#';
  const width = (font: string) => {
    c.font = `72px ${font}`;
    return c.measureText(sample).width;
  };
  const baseMono = width('monospace');
  const baseSerif = width('serif');
  const found = CANDIDATES.filter((f) => width(`"${f}", monospace`) !== baseMono || width(`"${f}", serif`) !== baseSerif);
  cached = [...BUNDLED, ...found.sort((a, b) => a.localeCompare(b)), ...GENERIC];
  return cached;
}

/** CSS font-family value for a family name. */
export function cssFamily(name: string): string {
  return GENERIC.includes(name) ? name : `"${name}", sans-serif`;
}

/** Friendly label (bundled variable fonts without the "Variable" suffix). */
export function fontLabel(name: string): string {
  return name.replace(/ Variable$/, '');
}

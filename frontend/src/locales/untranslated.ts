// Finds interface text written directly in the code instead of through
// t()/tn(): text in Svelte markup, title/aria-label/placeholder/alt
// attributes, and strings passed to toasts, dialogs, errors and menu/command
// labels in TypeScript. A line can opt out with an `i18n-ignore` comment
// (names of formats, products, keys and the like aren't translated anyway).
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { SRC, sourceFiles } from './extract';

export interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Text that needs no translation: format/product names, units, symbols, keys, code. */
const NEUTRAL = new RegExp(
  '^(' +
    [
      // Products, formats, standards, units.
      'Monoform|Excalidraw|draw\\.io|Mermaid|Graphviz|Obsidian|Word|Excel|LibreOffice|OpenDocument|SQLite|ONNX|WebGL|WebKitGTK|WebView2|GStreamer|Tesseract|EmbeddingGemma|BiRefNet|U²-Netp|NASA',
      'PDF|SVG|PNG|JPE?G|GIF|WebP|AVIF|HEIC|TIFF|BMP|ICO|ICNS|CSV|TSV|JSON|JSONL|NDJSON|YAML|TOML|XML|HTML|CSS|INI|DXF|DWG|STL|OBJ|GLB|glTF|FBX|3MF|AMF|PLY|USDZ?|MP3|MP4|WAV|FLAC|OGG|Opus|AAC|M4A|WebM|MKV|MOV|AVI|ZIP|RAR|7z|TAR|ISO|DMG|DEB|RPM|MSI|APK|JAR|SHA-?\\d+|MD5|CRC32|BLAKE\\d*|UTF-?8|UTF-16|LF|CRLF|CR|RGB|RGBA|HEX|HSL|CMYK|DPI|PPI|SQL|URL|ID|OK|OCR|AI|API',
      'px|pt|mm|cm|in|ms|s|KB|MB|GB|fps|Hz|kHz|kbit/s|dB|%|×|x',
      // Keys and shortcuts.
      'Ctrl|Alt|Shift|Cmd|Esc|Enter|Tab|Space|Del|Delete|Backspace|Home|End|PgUp|PgDn|F\\d+|Mod',
    ].join('|') +
    ')$',
);

/** Words worth translating in a piece of text (after removing neutral tokens). */
function needsTranslation(text: string): boolean {
  const s = text.replace(/&[a-z]+;|&#\d+;/g, ' ').trim();
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  const words = s.match(/[A-Za-z][A-Za-z0-9²+.\-/]*/g) ?? [];
  return words.some((w) => !NEUTRAL.test(w.replace(/[.\-/]+$/, '')) && w.length > 1);
}

const ATTRS = /\b(title|aria-label|placeholder|alt|aria-description|label|aria-roledescription)="([^"]*)"/g;

/** Hardcoded text in a Svelte component's markup. */
export function scanSvelte(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  const lines = src.split('\n');
  const ignored = new Set(lines.map((l, i) => (/i18n-ignore/.test(l) ? i + 1 : 0)).filter(Boolean));
  // Blank out script, style and comments, keeping line numbers.
  const blank = (m: string) => m.replace(/[^\n]/g, ' ');
  let s = src.replace(/<script[\s\S]*?<\/script>/g, blank).replace(/<style[\s\S]*?<\/style>/g, blank).replace(/<!--[\s\S]*?-->/g, blank);
  const lineAt = (i: number) => s.slice(0, i).split('\n').length;
  const push = (i: number, text: string) => {
    const line = lineAt(i);
    if (!ignored.has(line) && needsTranslation(text)) out.push({ line, text: text.trim().slice(0, 80) });
  };
  // Walk the markup: text outside tags and {expressions}.
  let i = 0;
  let text = '';
  let textStart = 0;
  const flush = () => {
    if (text.trim()) push(textStart, text);
    text = '';
  };
  const skipBraces = (j: number): number => {
    let depth = 0;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === "'" || c === '"' || c === '`') {
        let k = j + 1;
        while (k < s.length && s[k] !== c) k += s[k] === '\\' ? 2 : 1;
        j = k;
      } else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) return j + 1;
    }
    return j;
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '{') {
      flush();
      i = skipBraces(i);
    } else if (c === '<' && /[a-zA-Z/!]/.test(s[i + 1] ?? '')) {
      flush();
      // A tag: scan attributes, respecting quotes and {…}.
      let j = i + 1;
      const tagStart = i;
      while (j < s.length && s[j] !== '>') {
        if (s[j] === '{') j = skipBraces(j);
        else if (s[j] === '"' || s[j] === "'") {
          const q = s[j];
          j++;
          while (j < s.length && s[j] !== q) j = s[j] === '{' ? skipBraces(j) : j + 1;
          j++;
        } else j++;
      }
      const tag = s.slice(tagStart, j + 1);
      for (const m of tag.matchAll(ATTRS)) {
        const literalPart = m[2].replace(/\{[^}]*\}/g, ' ');
        push(tagStart + m.index!, literalPart);
      }
      i = j + 1;
    } else {
      if (!text) textStart = i;
      text += c;
      i++;
    }
  }
  flush();
  return out;
}

const TS_PATTERNS = [
  /\b(?:toast|toastError|confirm|prompt|ask|alert|notify)\((?![^'"`)]*?\btn?\(\s*['"`])[^'"`)]*?(['"`])((?:(?!\1).)*[A-Za-z]{2,}(?:(?!\1).)*)\1/g,
  /\bnew Error\(\s*(['"`])((?:(?!\1).)*[A-Za-z]{3,}(?:(?!\1).)*)\1/g,
  /\b(?:label|title|message|text|description|placeholder|hint|detail|tooltip|confirmLabel|info|empty|type|name|heading|caption|summary|note)\s*:\s*(['"`])([A-Z](?:(?!\1).)*[a-z](?:(?!\1).)*)\1/g,
  /\.(?:textContent|title|placeholder|innerText)\s*=\s*(['"`])([A-Za-z](?:(?!\1).)*[a-z]{2,}(?:(?!\1).)*)\1/g,
];

/** Hardcoded interface text in TypeScript (and Svelte <script>). */
export function scanScript(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  src.split('\n').forEach((l, i) => {
    if (/i18n-ignore/.test(l) || /^\s*(\/\/|\*|\/\*)/.test(l) || /console\.(log|warn|error)|api\.Log\(/.test(l)) return;
    for (const re of TS_PATTERNS) {
      re.lastIndex = 0;
      for (const m of l.matchAll(re)) {
        const text = m[2];
        if (needsTranslation(text.replace(/\$\{[^}]*\}/g, ' '))) out.push({ line: i + 1, text: text.slice(0, 80) });
      }
    }
  });
  return out;
}

/** A component with everything but its <script> blocks blanked (line numbers kept). */
function scriptsOnly(src: string): string {
  let out = '';
  let last = 0;
  for (const m of src.matchAll(/(<script[^>]*>)([\s\S]*?)(<\/script>)/g)) {
    out += src.slice(last, m.index! + m[1].length).replace(/[^\n]/g, ' ') + m[2];
    last = m.index! + m[1].length + m[2].length;
  }
  return out + src.slice(last).replace(/[^\n]/g, ' ');
}

export function untranslated(files = sourceFiles()): Hit[] {
  const hits: Hit[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(SRC, f);
    const found = f.endsWith('.svelte') ? [...scanSvelte(src), ...scanScript(scriptsOnly(src))] : scanScript(src);
    for (const h of found) hits.push({ file: rel, ...h });
  }
  return hits.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

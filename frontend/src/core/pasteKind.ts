// What kind of document a piece of pasted text is (for pasting into an empty
// tab, core/paste.ts): JSON, a table, SVG, a drawing, a diagram, a note…
import { t } from './i18n';

export interface PasteKind {
  /** File extension the content is saved as (it picks the editor). */
  ext: string;
  /** Tab title / default file name, without the extension. */
  name: string;
}

const MERMAID = /^\s*(?:%%.*\n\s*)*(graph\s+(TB|TD|BT|RL|LR)|flowchart|sequenceDiagram|classDiagram|stateDiagram(-v2)?|erDiagram|gantt|pie\b|journey|gitGraph|mindmap|timeline|quadrantChart|sankey-beta|xychart-beta|block-beta)\b/;
const DOT = /^\s*(strict\s+)?(di)?graph\s+("[^"]*"|\w+)?\s*\{/;

/** Is it a table: several lines that split into the same number (>1) of cells? */
function table(text: string): 'tsv' | 'csv' | null {
  const lines = text.replace(/\r?\n$/, '').split(/\r?\n/);
  if (lines.length < 2) return null;
  for (const [sep, ext] of [['\t', 'tsv'], [',', 'csv'], [';', 'csv']] as const) {
    const n = lines[0].split(sep).length;
    if (n > 1 && lines.every((l) => l.split(sep).length === n)) {
      // Commas also appear in prose: ask for short cells, like a table's.
      if (sep !== '\t' && lines.some((l) => l.split(sep).some((c) => c.trim().split(/\s+/).length > 6))) continue;
      return ext;
    }
  }
  return null;
}

function json(text: string): unknown {
  const s = text.trim();
  if (!/^[[{]/.test(s)) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** What kind of document a piece of pasted text is. */
export function classifyText(text: string): PasteKind {
  const s = text.trim();
  const j = json(s);
  if (j !== undefined) {
    const o = j as { type?: string; elements?: unknown };
    if (o && o.type === 'excalidraw' && Array.isArray(o.elements)) return { ext: 'excalidraw', name: t('Pasted drawing') };
    return { ext: 'json', name: t('Pasted data') };
  }
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(s) && /<\/svg>\s*$/i.test(s)) return { ext: 'svg', name: t('Pasted drawing') };
  if (/^<mxfile[\s>]|^<mxGraphModel[\s>]/.test(s)) return { ext: 'drawio', name: t('Pasted diagram') };
  if (/^<!doctype html|^<html[\s>]/i.test(s)) return { ext: 'html', name: t('Pasted page') };
  if (/^<\?xml/.test(s)) return { ext: 'xml', name: t('Pasted data') };
  if (/^-----BEGIN (CERTIFICATE|CERTIFICATE REQUEST|PUBLIC KEY|PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY)-----/.test(s)) return { ext: 'pem', name: t('Pasted certificate') };
  if (MERMAID.test(s)) return { ext: 'mmd', name: t('Pasted diagram') };
  if (DOT.test(s)) return { ext: 'dot', name: t('Pasted diagram') };
  const tab = table(text);
  if (tab) return { ext: tab, name: t('Pasted table') };
  // Markdown: headings, lists, links, emphasis, fences, quotes.
  const md = [/^#{1,6}\s+\S/m, /^\s*[-*+]\s+\S/m, /^\s*\d+[.)]\s+\S/m, /\[[^\]\n]+\]\([^)\s]+\)/, /\*\*[^*\n]+\*\*/, /^```/m, /^>\s/m, /\[\[[^\]\n]+\]\]/].filter((re) => re.test(s)).length;
  if (md >= 2 || /^#{1,6}\s+\S/.test(s)) return { ext: 'md', name: t('Pasted note') };
  return { ext: 'txt', name: t('Pasted text') };
}

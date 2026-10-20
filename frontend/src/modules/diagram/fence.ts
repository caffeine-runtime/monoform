// Which Markdown code fences are diagrams (shared by the Markdown worker,
// which must not pull in the renderers).
export type DiagramKind = 'dot' | 'mermaid';

export function kindOfFence(info: string): DiagramKind | null {
  const lang = info.trim().split(/\s+/)[0].toLowerCase();
  if (lang === 'mermaid') return 'mermaid';
  if (lang === 'dot' || lang === 'graphviz' || lang === 'gv') return 'dot';
  return null;
}

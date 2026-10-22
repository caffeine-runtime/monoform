// Renders markdown off the main thread, and counts words, lists headings and
// links for the status bar and the outline/links panel.
import { createRenderer } from './render';
import { countMarkdown, markdownHeadings } from '../../core/textStats';
import { parseLinks } from './links';

const md = createRenderer();

self.onmessage = (e: MessageEvent<{ id: number; text: string; base: string; token: string; render: boolean }>) => {
  const { id, text, base, token, render } = e.data;
  const facts = { counts: countMarkdown(text), headings: markdownHeadings(text), links: parseLinks(text) };
  try {
    const html = render ? md.render(text, { base, token }) : undefined;
    (self as unknown as Worker).postMessage({ id, html, ...facts });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, html: `<pre>${String(err)}</pre>`, ...facts });
  }
};

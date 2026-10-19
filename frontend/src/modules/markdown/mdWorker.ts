// Renders markdown off the main thread.
import { createRenderer } from './render';

const md = createRenderer();

self.onmessage = (e: MessageEvent<{ id: number; text: string; base: string; token: string }>) => {
  const { id, text, base, token } = e.data;
  try {
    const html = md.render(text, { base, token });
    (self as unknown as Worker).postMessage({ id, html });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, html: `<pre>${String(err)}</pre>` });
  }
};

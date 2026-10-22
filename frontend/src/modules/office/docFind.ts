// Find and replace in the document page: matches are DOM ranges over the
// editable text (never inside pictures, page breaks or kept-as-is parts), one
// paragraph at a time, so a replacement stays inside the run it was typed in.

const BLOCK = /^(P|H[1-6]|DIV|TD|TH|LI)$/;

function blockOf(n: Node, root: HTMLElement): Element | null {
  for (let e = n.parentElement; e && e !== root; e = e.parentElement) if (BLOCK.test(e.tagName)) return e;
  return root;
}

function editable(n: Node, root: HTMLElement): boolean {
  for (let e = n.parentElement; e && e !== root; e = e.parentElement) {
    if (e.classList.contains('atom') || e.classList.contains('opaque') || e.classList.contains('locked') || e.getAttribute('contenteditable') === 'false') return false;
  }
  return true;
}

/** Every match of q (case-insensitive unless matchCase), in document order. */
export function findRanges(root: HTMLElement, q: string, matchCase = false): Range[] {
  if (!q) return [];
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  // Text of each paragraph with where its pieces start.
  const groups: { text: string; pieces: { node: Text; start: number }[] }[] = [];
  let block: Element | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.data || !editable(n, root)) continue;
    const b = blockOf(n, root);
    if (b !== block || !groups.length) {
      groups.push({ text: '', pieces: [] });
      block = b;
    }
    const g = groups[groups.length - 1];
    g.pieces.push({ node: n, start: g.text.length });
    g.text += n.data;
  }
  const needle = matchCase ? q : q.toLowerCase();
  const out: Range[] = [];
  for (const g of groups) {
    const hay = matchCase ? g.text : g.text.toLowerCase();
    const at = (pos: number, end: boolean) => {
      // The piece holding pos (an end position belongs to the piece it closes).
      let k = g.pieces.length - 1;
      while (k > 0 && (end ? g.pieces[k].start >= pos : g.pieces[k].start > pos)) k--;
      return { node: g.pieces[k].node, offset: pos - g.pieces[k].start };
    };
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) {
      const a = at(i, false);
      const b = at(i + needle.length, true);
      const r = doc.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      out.push(r);
    }
  }
  return out;
}

/** Replace a match with text, keeping the formatting of where it starts. */
export function replaceRange(r: Range, text: string) {
  const start = r.startContainer as Text;
  const offset = r.startOffset;
  r.deleteContents();
  if (start.nodeType === 3 && start.isConnected) start.insertData(Math.min(offset, start.data.length), text);
  else r.insertNode(r.startContainer.ownerDocument!.createTextNode(text));
}

/** Replace every match (last first, so earlier ranges stay valid); returns how many. */
export function replaceAll(root: HTMLElement, q: string, text: string, matchCase = false): number {
  const all = findRanges(root, q, matchCase);
  for (let i = all.length - 1; i >= 0; i--) replaceRange(all[i], text);
  return all.length;
}

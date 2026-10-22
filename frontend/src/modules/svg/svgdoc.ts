// SVG source as the single source of truth for visual editing: a small XML
// scanner finds every element's start tag, attributes and extent in the
// text, so a visual change becomes a minimal text change (one attribute, one
// element) that keeps the author's formatting and comments and goes through
// the editor's undo history. Elements are identified by document order,
// which matches DOMParser's getElementsByTagName('*'). Pure; unit-tested.

export interface Attr {
  name: string;
  value: string; // raw (entities not decoded)
  start: number; // attribute start (name)
  end: number; // after the closing quote
  valueStart: number;
  valueEnd: number;
}

export interface El {
  index: number;
  tag: string;
  start: number; // '<'
  tagEnd: number; // after the start tag's '>'
  end: number; // after the element (closing tag, or tagEnd when self-closing)
  selfClosing: boolean;
  attrs: Attr[];
  parent: number; // index, -1 for the root
  depth: number;
  closeStart: number; // '<' of the closing tag (tagEnd when self-closing)
}

export interface Change {
  from: number;
  to: number;
  insert: string;
}

const NAME = /[^\s=/>"'<]+/y;

/** Scan elements in document order. Throws on clearly broken markup. */
export function scan(text: string): El[] {
  const out: El[] = [];
  const stack: El[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const e = text.indexOf('-->', lt + 4);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const e = text.indexOf(']]>', lt + 9);
      i = e < 0 ? n : e + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const e = text.indexOf('?>', lt + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) {
      // DOCTYPE, possibly with an internal subset [...]
      let j = lt + 2;
      let depth = 0;
      for (; j < n; j++) {
        if (text[j] === '[') depth++;
        else if (text[j] === ']') depth--;
        else if (text[j] === '>' && depth <= 0) break;
      }
      i = j + 1;
      continue;
    }
    if (text[lt + 1] === '/') {
      const gt = text.indexOf('>', lt);
      if (gt < 0) throw new Error('unterminated closing tag'); // i18n-ignore: internal parse error, never shown
      const el = stack.pop();
      if (el) {
        el.closeStart = lt;
        el.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    NAME.lastIndex = lt + 1;
    const m = NAME.exec(text);
    if (!m) {
      i = lt + 1;
      continue;
    }
    const tag = m[0];
    let j = NAME.lastIndex;
    const attrs: Attr[] = [];
    let selfClosing = false;
    for (;;) {
      while (j < n && /\s/.test(text[j])) j++;
      if (j >= n) throw new Error(`unterminated <${tag}>`); // i18n-ignore: internal parse error, never shown
      if (text[j] === '>') {
        j++;
        break;
      }
      if (text[j] === '/' && text[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      NAME.lastIndex = j;
      const am = NAME.exec(text);
      if (!am) throw new Error(`bad attribute in <${tag}>`); // i18n-ignore: internal parse error, never shown
      const aStart = j;
      j = NAME.lastIndex;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== '=') {
        attrs.push({ name: am[0], value: '', start: aStart, end: j, valueStart: j, valueEnd: j });
        continue;
      }
      j++;
      while (j < n && /\s/.test(text[j])) j++;
      const q = text[j];
      if (q !== '"' && q !== "'") throw new Error(`unquoted attribute in <${tag}>`); // i18n-ignore: internal parse error, never shown
      const close = text.indexOf(q, j + 1);
      if (close < 0) throw new Error(`unterminated attribute in <${tag}>`); // i18n-ignore: internal parse error, never shown
      attrs.push({ name: am[0], value: text.slice(j + 1, close), start: aStart, end: close + 1, valueStart: j + 1, valueEnd: close });
      j = close + 1;
    }
    const parent = stack[stack.length - 1];
    const el: El = { index: out.length, tag, start: lt, tagEnd: j, end: j, selfClosing, attrs, parent: parent ? parent.index : -1, depth: stack.length, closeStart: j };
    out.push(el);
    if (!selfClosing) stack.push(el);
    i = j;
  }
  return out;
}

export function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function escapeText(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function attr(el: El, name: string): string | null {
  const a = el.attrs.find((x) => x.name === name);
  return a ? a.value.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null;
}

/** Set (or remove, with null) an attribute. */
export function setAttr(text: string, el: El, name: string, value: string | null): Change | null {
  const a = el.attrs.find((x) => x.name === name);
  if (a) {
    if (value === null) {
      // Remove with the whitespace before it.
      let s = a.start;
      while (s > 0 && /[ \t]/.test(text[s - 1])) s--;
      return { from: s, to: a.end, insert: '' };
    }
    const q = text[a.valueStart - 1];
    const v = q === "'" ? value.replace(/&/g, '&amp;').replace(/'/g, '&apos;').replace(/</g, '&lt;') : escapeAttr(value);
    return { from: a.valueStart, to: a.valueEnd, insert: v };
  }
  if (value === null) return null;
  const at = el.selfClosing ? el.tagEnd - 2 : el.tagEnd - 1;
  // Keep "<rect x="1"/>" tidy: no space before "/>" doubling.
  const before = text[at - 1] === ' ' ? '' : ' ';
  return { from: at, to: at, insert: `${before}${name}="${escapeAttr(value)}"${el.selfClosing && before === '' ? ' ' : ''}` };
}

/** Several attribute changes on one element, as non-overlapping changes (applied together). */
export function setAttrs(text: string, el: El, values: Record<string, string | null>): Change[] {
  const out: Change[] = [];
  const inserts: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (el.attrs.some((a) => a.name === k)) {
      const c = setAttr(text, el, k, v);
      if (c) out.push(c);
    } else if (v !== null) inserts.push(`${k}="${escapeAttr(v)}"`);
  }
  if (inserts.length) {
    const at = el.selfClosing ? el.tagEnd - 2 : el.tagEnd - 1;
    const sp = text[at - 1] === ' ' ? '' : ' ';
    out.push({ from: at, to: at, insert: `${sp}${inserts.join(' ')}${el.selfClosing && sp === '' ? ' ' : ''}` });
  }
  return out;
}

/** The element's whole line range when it sits alone on its lines (for tidy removal and moves). */
function lineSpan(text: string, el: El): [number, number] {
  let s = el.start;
  while (s > 0 && /[ \t]/.test(text[s - 1])) s--;
  let e = el.end;
  const aloneBefore = s === 0 || text[s - 1] === '\n';
  if (aloneBefore) {
    while (e < text.length && /[ \t]/.test(text[e])) e++;
    if (text[e] === '\r') e++;
    if (text[e] === '\n') return [s, e + 1];
  }
  return [el.start, el.end];
}

export function removeEl(text: string, el: El): Change {
  const [s, e] = lineSpan(text, el);
  return { from: s, to: e, insert: '' };
}

/** Indentation of the line the element starts on. */
function indentOf(text: string, pos: number): string {
  let s = pos;
  while (s > 0 && text[s - 1] !== '\n') s--;
  return /^[ \t]*/.exec(text.slice(s, pos))![0];
}

/** Append markup as the last child of parent. */
export function appendChild(text: string, parent: El, markup: string, elements: El[]): Change {
  if (parent.selfClosing) {
    return { from: parent.tagEnd - 2, to: parent.tagEnd, insert: `>${markup}</${parent.tag}>` };
  }
  const kids = elements.filter((e) => e.parent === parent.index);
  const last = kids[kids.length - 1];
  const ind = last ? indentOf(text, last.start) : indentOf(text, parent.start) + '  ';
  const at = last ? last.end : parent.tagEnd;
  return { from: at, to: at, insert: `\n${ind}${markup}` };
}

/** Insert a copy right after the element (ids get a suffix so they stay unique). */
export function duplicate(text: string, el: El, ids: Set<string>): Change {
  let copy = text.slice(el.start, el.end);
  copy = copy.replace(/\bid="([^"]*)"/g, (_, id: string) => {
    let n = 2;
    while (ids.has(`${id}-${n}`)) n++;
    ids.add(`${id}-${n}`);
    return `id="${id}-${n}"`;
  });
  return { from: el.end, to: el.end, insert: `\n${indentOf(text, el.start)}${copy}` };
}

/** Swap an element with its previous (-1) or next (+1) sibling: changes paint order. */
export function moveSibling(text: string, el: El, elements: El[], dir: -1 | 1): Change[] | null {
  const sibs = elements.filter((e) => e.parent === el.parent);
  const i = sibs.indexOf(el);
  const other = sibs[i + dir];
  if (!other) return null;
  const [a, b] = dir < 0 ? [other, el] : [el, other];
  // Replace the span from a.start to b.end with b + (between) + a.
  const between = text.slice(a.end, b.start);
  return [{ from: a.start, to: b.end, insert: text.slice(b.start, b.end) + between + text.slice(a.start, a.end) }];
}

/** Replace an element's text content (for <text>/<tspan> without child elements). */
export function setContent(text: string, el: El, content: string): Change | null {
  if (el.selfClosing) return { from: el.tagEnd - 2, to: el.tagEnd, insert: `>${escapeText(content)}</${el.tag}>` };
  return { from: el.tagEnd, to: el.closeStart, insert: escapeText(content) };
}

/** Apply non-overlapping changes (any order) to text. */
export function apply(text: string, changes: Change[]): string {
  const cs = [...changes].sort((a, b) => b.from - a.from);
  for (const c of cs) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}

// ---------- transforms ----------

export type M = [number, number, number, number, number, number]; // a b c d e f
export const I: M = [1, 0, 0, 1, 0, 0];

export function mul(p: M, q: M): M {
  return [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
}

/** Parse an SVG transform list into one matrix. */
export function parseTransform(s: string | null): M {
  let m: M = [...I];
  if (!s) return m;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  let r: RegExpExecArray | null;
  while ((r = re.exec(s))) {
    const v = r[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let t: M = [...I];
    switch (r[1]) {
      case 'matrix':
        if (v.length === 6) t = v as M;
        break;
      case 'translate':
        t = [1, 0, 0, 1, v[0] ?? 0, v[1] ?? 0];
        break;
      case 'scale':
        t = [v[0] ?? 1, 0, 0, v[1] ?? v[0] ?? 1, 0, 0];
        break;
      case 'rotate': {
        const a = ((v[0] ?? 0) * Math.PI) / 180;
        const rot: M = [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];
        t = v.length >= 3 ? mul(mul([1, 0, 0, 1, v[1], v[2]], rot), [1, 0, 0, 1, -v[1], -v[2]]) : rot;
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        t = [1, Math.tan(((v[0] ?? 0) * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = mul(m, t);
  }
  return m;
}

const r3 = (x: number) => {
  const v = Math.round(x * 1000) / 1000;
  return Object.is(v, -0) ? '0' : String(v);
};

/** Shortest readable form: nothing, translate(...) or matrix(...). */
export function formatTransform(m: M): string | null {
  const [a, b, c, d, e, f] = m.map((x) => Math.round(x * 1000) / 1000);
  if (a === 1 && b === 0 && c === 0 && d === 1) return e === 0 && f === 0 ? null : `translate(${r3(e)} ${r3(f)})`;
  return `matrix(${[a, b, c, d, e, f].map(r3).join(' ')})`;
}

/** Point through a matrix. */
export function point(m: M, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Scale by k about (cx, cy) and rotate by deg about it, in parent coordinates. */
export function aboutPoint(cx: number, cy: number, k: number, deg: number): M {
  const a = (deg * Math.PI) / 180;
  const rs: M = [k * Math.cos(a), k * Math.sin(a), -k * Math.sin(a), k * Math.cos(a), 0, 0];
  return mul(mul([1, 0, 0, 1, cx, cy], rs), [1, 0, 0, 1, -cx, -cy]);
}

// ---------- safety ----------

const DROP = new Set(['script', 'foreignObject', 'iframe', 'object', 'embed', 'audio', 'video', 'handler', 'listener']);

/**
 * Make a parsed SVG safe to show inline (defence in depth on top of the page's
 * CSP): no scripts or embedded HTML, no event handlers, no links or references
 * outside the document. Elements are only emptied/neutralised, never removed,
 * so document-order indices stay valid.
 */
export function sanitize(root: Element) {
  const all = [root, ...Array.from(root.getElementsByTagName('*'))];
  for (const el of all) {
    if (DROP.has(el.localName)) {
      el.textContent = '';
      for (const a of Array.from(el.attributes)) if (a.name !== 'data-mf-i') el.removeAttribute(a.name);
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (n.startsWith('on')) el.removeAttribute(a.name);
      else if ((n === 'href' || n === 'xlink:href' || n.endsWith(':href')) && !(v.startsWith('#') || v.startsWith('data:image/'))) el.removeAttribute(a.name);
      else if (n === 'style' && /url\(\s*['"]?(?!#|data:)/i.test(a.value)) el.removeAttribute(a.name);
    }
    if (el.localName === 'style') el.textContent = (el.textContent ?? '').replace(/@import[^;]*;?/gi, '').replace(/url\(\s*['"]?(?!#|data:)[^)]*\)/gi, 'none');
  }
}

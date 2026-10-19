// JSON validation with precise error positions. JSON.parse is used for speed;
// its error messages differ per engine (JavaScriptCore gives no position), so
// on failure this scanner finds the exact line and column.

export interface JsonError {
  message: string;
  offset: number;
  line: number; // 1-based
  col: number; // 1-based, in UTF-16 code units
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: JsonError };

export function lineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, col: offset - last };
}

/** Parse JSON (or JSONC when `comments`), returning a positioned error. */
export function parseJson(text: string, comments = false): ParseResult {
  if (!comments) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch {
      /* locate below */
    }
  }
  const s = new Scanner(text, comments);
  try {
    const v = s.document();
    return { ok: true, value: v };
  } catch (e) {
    if (e instanceof ScanError) return { ok: false, error: { message: e.message, offset: e.offset, ...lineCol(text, e.offset) } };
    throw e;
  }
}

class ScanError extends Error {
  constructor(
    message: string,
    public offset: number,
  ) {
    super(message);
  }
}

const describe = (c: string | undefined) => (c === undefined ? 'end of file' : c === '\n' ? 'line break' : `'${c}'`);

class Scanner {
  i = 0;
  constructor(
    private t: string,
    private comments: boolean,
  ) {}

  fail(msg: string, at = this.i): never {
    throw new ScanError(msg, at);
  }

  ws() {
    const t = this.t;
    for (;;) {
      const c = t.charCodeAt(this.i);
      if (c === 32 || c === 9 || c === 10 || c === 13) this.i++;
      else if (this.comments && c === 47 && t[this.i + 1] === '/') {
        while (this.i < t.length && t[this.i] !== '\n') this.i++;
      } else if (this.comments && c === 47 && t[this.i + 1] === '*') {
        const end = t.indexOf('*/', this.i + 2);
        if (end < 0) this.fail('Unterminated comment');
        this.i = end + 2;
      } else return;
    }
  }

  document(): unknown {
    if (this.t.charCodeAt(0) === 0xfeff) this.i = 1;
    this.ws();
    if (this.i >= this.t.length) this.fail('Empty document: expected a value');
    const v = this.value();
    this.ws();
    if (this.i < this.t.length) this.fail(`Unexpected ${describe(this.t[this.i])} after the end of the value`);
    return v;
  }

  value(): unknown {
    const c = this.t[this.i];
    switch (c) {
      case '{':
        return this.object();
      case '[':
        return this.array();
      case '"':
        return this.string();
      case 't':
        return this.word('true', true);
      case 'f':
        return this.word('false', false);
      case 'n':
        return this.word('null', null);
      default:
        if (c === '-' || (c >= '0' && c <= '9')) return this.number();
        if (c === "'") this.fail('Strings must use double quotes');
        if (c === '}' || c === ']') this.fail(`Unexpected ${describe(c)}: expected a value`);
        this.fail(`Unexpected ${describe(c)}: expected a value`);
    }
  }

  word(w: string, v: unknown): unknown {
    if (this.t.startsWith(w, this.i)) {
      this.i += w.length;
      return v;
    }
    let j = this.i;
    while (j < this.t.length && /[A-Za-z0-9_]/.test(this.t[j])) j++;
    this.fail(`Unknown word '${this.t.slice(this.i, j) || this.t[this.i]}'`);
  }

  number(): number {
    const start = this.i;
    const t = this.t;
    if (t[this.i] === '-') this.i++;
    if (t[this.i] === '0') {
      this.i++;
      if (t[this.i] >= '0' && t[this.i] <= '9') this.fail('Numbers can’t have leading zeros');
    } else if (t[this.i] >= '1' && t[this.i] <= '9') {
      while (t[this.i] >= '0' && t[this.i] <= '9') this.i++;
    } else this.fail('Invalid number');
    if (t[this.i] === '.') {
      this.i++;
      if (!(t[this.i] >= '0' && t[this.i] <= '9')) this.fail('Expected a digit after the decimal point');
      while (t[this.i] >= '0' && t[this.i] <= '9') this.i++;
    }
    if (t[this.i] === 'e' || t[this.i] === 'E') {
      this.i++;
      if (t[this.i] === '+' || t[this.i] === '-') this.i++;
      if (!(t[this.i] >= '0' && t[this.i] <= '9')) this.fail('Expected a digit in the exponent');
      while (t[this.i] >= '0' && t[this.i] <= '9') this.i++;
    }
    return Number(t.slice(start, this.i));
  }

  string(): string {
    const t = this.t;
    const start = this.i;
    this.i++;
    let out = '';
    let chunk = this.i;
    for (;;) {
      if (this.i >= t.length) this.fail('Unterminated string', start);
      const c = t.charCodeAt(this.i);
      if (c === 34) {
        out += t.slice(chunk, this.i);
        this.i++;
        return out;
      }
      if (c === 10 || c === 13) this.fail('Unterminated string (line break inside a string)', this.i);
      if (c < 32) this.fail('Control characters must be escaped in strings');
      if (c === 92) {
        out += t.slice(chunk, this.i);
        const e = t[this.i + 1];
        const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in map) {
          out += map[e];
          this.i += 2;
        } else if (e === 'u') {
          const hex = t.slice(this.i + 2, this.i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail('Invalid \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 6;
        } else this.fail(`Invalid escape '\\${e ?? ''}'`);
        chunk = this.i;
        continue;
      }
      this.i++;
    }
  }

  array(): unknown[] {
    const out: unknown[] = [];
    this.i++;
    this.ws();
    if (this.t[this.i] === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.t[this.i] === ']' ) {
        if (this.comments) {
          this.i++;
          return out;
        }
        this.fail('Trailing comma before ‘]’');
      }
      out.push(this.value());
      this.ws();
      const c = this.t[this.i];
      if (c === ',') {
        this.i++;
        continue;
      }
      if (c === ']') {
        this.i++;
        return out;
      }
      this.fail(`Expected ',' or ']' but found ${describe(c)}`);
    }
  }

  object(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    this.i++;
    this.ws();
    if (this.t[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      const c = this.t[this.i];
      if (c === '}') {
        if (this.comments) {
          this.i++;
          return out;
        }
        this.fail('Trailing comma before ‘}’');
      }
      if (c !== '"') this.fail(c === "'" ? 'Property names must use double quotes' : `Expected a property name in double quotes but found ${describe(c)}`);
      const key = this.string();
      this.ws();
      if (this.t[this.i] !== ':') this.fail(`Expected ':' after property name but found ${describe(this.t[this.i])}`);
      this.i++;
      this.ws();
      // Plain assignment keeps "__proto__" as an own data property.
      Object.defineProperty(out, key, { value: this.value(), enumerable: true, writable: true, configurable: true });
      this.ws();
      const d = this.t[this.i];
      if (d === ',') {
        this.i++;
        continue;
      }
      if (d === '}') {
        this.i++;
        return out;
      }
      this.fail(`Expected ',' or '}' but found ${describe(d)}`);
    }
  }
}

/** JS-style path for display/copy: $.a.b[3]["odd key"] */
export function formatPath(path: (string | number)[]): string {
  let s = '$';
  for (const p of path) {
    if (typeof p === 'number') s += `[${p}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(p)) s += `.${p}`;
    else s += `[${JSON.stringify(p)}]`;
  }
  return s;
}

import { describe, expect, it } from 'vitest';
import { classifyText } from './pasteKind';

const ext = (s: string) => classifyText(s).ext;

describe('pasted text becomes a document of its kind', () => {
  it('recognises data and drawings', () => {
    expect(ext('{"a": 1, "b": [1, 2]}')).toBe('json');
    expect(ext('[1, 2, 3]')).toBe('json');
    expect(ext('{"type":"excalidraw","version":2,"elements":[]}')).toBe('excalidraw');
    expect(ext('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toBe('svg');
    expect(ext('<?xml version="1.0"?>\n<svg width="1"></svg>\n')).toBe('svg');
    expect(ext('<mxfile host="app.diagrams.net"><diagram/></mxfile>')).toBe('drawio');
    expect(ext('<!DOCTYPE html><html><body>x</body></html>')).toBe('html');
    expect(ext('<?xml version="1.0"?><catalog/>')).toBe('xml');
    expect(ext('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----')).toBe('pem');
  });

  it('recognises diagrams', () => {
    expect(ext('flowchart TD\n  A --> B')).toBe('mmd');
    expect(ext('sequenceDiagram\n  A->>B: hi')).toBe('mmd');
    expect(ext('digraph G { a -> b }')).toBe('dot');
    expect(ext('graph { a -- b }')).toBe('dot');
  });

  it('recognises tables copied from a spreadsheet', () => {
    expect(ext('Name\tQty\tPrice\nApple\t3\t1.20\nPear\t5\t0.80\n')).toBe('tsv');
    expect(ext('name,qty\napple,3\npear,5')).toBe('csv');
    expect(ext('a;b;c\n1;2;3')).toBe('csv');
    // Prose with commas isn't a table.
    expect(ext('Hello, this is a sentence that goes on for a while, with commas.\nAnd another line of text here, also long enough.')).toBe('txt');
  });

  it('tells notes from plain text', () => {
    expect(ext('# Shopping\n\n- milk\n- bread')).toBe('md');
    expect(ext('Some **bold** text and a [link](https://example.com).')).toBe('md');
    expect(ext('just a line of text')).toBe('txt');
    expect(classifyText('just text').name).toBe('Pasted text');
  });
});

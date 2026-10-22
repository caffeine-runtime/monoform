import { describe, expect, it } from 'vitest';
import { ExcalidrawBoard, indexKey } from './excalidraw';

const measure = (t: string) => t.length * 10;

const base = { angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'hachure', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], seed: 7, version: 3, versionNonce: 1, isDeleted: false, boundElements: null, updated: 1, link: null, locked: false };
const FILE = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    { ...base, id: 'box', type: 'rectangle', x: 0, y: 0, width: 200, height: 100, roundness: { type: 3 }, backgroundColor: '#a5d8ff', boundElements: [{ type: 'text', id: 'label' }, { type: 'arrow', id: 'arr' }], index: 'a0', customProp: 42 },
    { ...base, id: 'label', type: 'text', x: 60, y: 37.5, width: 80, height: 25, text: 'Hello', originalText: 'Hello', fontSize: 20, fontFamily: 5, textAlign: 'center', verticalAlign: 'middle', containerId: 'box', lineHeight: 1.25, index: 'a1' },
    { ...base, id: 'circ', type: 'ellipse', x: 400, y: 0, width: 100, height: 100, boundElements: [{ type: 'arrow', id: 'arr' }], index: 'a2' },
    { ...base, id: 'arr', type: 'arrow', x: 204, y: 50, width: 192, height: 0, points: [[0, 0], [192, 0]], startBinding: { elementId: 'box', focus: 0, gap: 4 }, endBinding: { elementId: 'circ', focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'arrow', roundness: { type: 2 }, index: 'a3' },
    { ...base, id: 'pen', type: 'freedraw', x: 0, y: 200, width: 30, height: 20, points: [[0, 0], [10, 10], [30, 20]], pressures: [], simulatePressure: true, groupIds: ['g1'], index: 'a4' },
    { ...base, id: 'note', type: 'text', x: 0, y: 260, width: 50, height: 25, text: 'Note', originalText: 'Note', fontSize: 20, fontFamily: 1, textAlign: 'left', verticalAlign: 'top', containerId: null, lineHeight: 1.25, groupIds: ['g1'], index: 'a5' },
  ],
  appState: { viewBackgroundColor: '#fffce8', gridSize: null },
  files: {},
});

describe('Excalidraw board', () => {
  it('lists items without bound text and draws every element', () => {
    const b = new ExcalidrawBoard(FILE, measure);
    expect(b.items().map((i) => i.id)).toEqual(['box', 'circ', 'arr', 'pen', 'note']);
    expect(b.background()).toBe('#fffce8');
    const svg = b.render();
    for (const id of ['box', 'label', 'circ', 'arr', 'pen', 'note']) expect(svg).toContain(`data-id="${id}"`);
    expect(svg).toContain('#a5d8ff'); // hachure fill colour
    expect(svg).toContain('>Hello</tspan>');
    expect(svg).toContain('HiaVirgil');
    expect(b.item('arr')!.linear).toBe(true);
    expect(b.expand(['pen']).sort()).toEqual(['note', 'pen']);
    // Same seed, same drawing.
    expect(new ExcalidrawBoard(FILE, measure).render()).toBe(svg);
  });

  it('moves bound text and connected arrow ends with a shape', () => {
    const b = new ExcalidrawBoard(FILE, measure);
    b.move(['box'], 0, 50);
    const doc = JSON.parse(b.serialize());
    const el = (id: string) => doc.elements.find((e: { id: string }) => e.id === id);
    expect(el('label').y).toBe(87.5);
    expect(el('arr').x).toBe(204);
    expect(el('arr').y).toBe(100); // start moved down, end stayed
    expect(el('arr').points).toEqual([[0, 0], [192, -50]]);
    expect(el('box').version).toBe(4);
    expect(el('box').customProp).toBe(42); // unknown properties kept
  });

  it('resizes, edits text, creates connected arrows, duplicates and removes', () => {
    const b = new ExcalidrawBoard(FILE, measure);
    b.resize('box', { x: 0, y: 0, w: 400, h: 200 });
    const lab = () => JSON.parse(b.serialize()).elements.find((e: { id: string }) => e.id === 'label');
    expect(lab().x).toBe(200 - lab().width / 2);
    b.setText('box', 'A much longer label that has to wrap inside');
    expect(lab().text).toContain('\n');
    expect(lab().originalText).toBe('A much longer label that has to wrap inside');
    // A label on the ellipse is created as bound text.
    b.setText('circ', 'Round');
    const circ = JSON.parse(b.serialize()).elements.find((e: { id: string }) => e.id === 'circ');
    expect(circ.boundElements.map((r: { type: string }) => r.type)).toEqual(['arrow', 'text']);
    // New arrow between the two shapes.
    const id = b.create('arrow', { x: 450, y: 110 }, { x: 100, y: 300 }, { startId: 'circ', endId: 'box' })!;
    const arr = JSON.parse(b.serialize()).elements.find((e: { id: string }) => e.id === id);
    expect(arr.startBinding.elementId).toBe('circ');
    expect(arr.endBinding.elementId).toBe('box');
    expect(arr.index > 'a5').toBe(true);
    const copies = b.duplicate(['pen']);
    expect(copies).toHaveLength(2); // the whole group
    const docAfter = JSON.parse(b.serialize());
    const penCopy = docAfter.elements.find((e: { id: string }) => e.id === copies[0]);
    expect(penCopy.groupIds[0]).not.toBe('g1');
    b.remove(['circ']);
    const after = JSON.parse(b.serialize());
    expect(after.elements.some((e: { id: string }) => e.id === 'circ')).toBe(false);
    expect(after.elements.find((e: { id: string }) => e.id === 'arr').endBinding).toBeNull();
    expect(after.elements.find((e: { id: string }) => e.id === id).startBinding).toBeNull();
  });

  it('styles and reorders', () => {
    const b = new ExcalidrawBoard(FILE, measure);
    b.setStyle(['box'], { stroke: '#e03131', fill: '', dash: 'dashed', fillStyle: 'cross-hatch', roughness: 0 });
    expect(b.style(['box'])).toEqual({ stroke: '#e03131', fill: '', width: 2, dash: 'dashed', fillStyle: 'cross-hatch', roughness: 0, edges: 'round' });
    const doc = JSON.parse(b.serialize());
    expect(doc.elements.find((e: { id: string }) => e.id === 'label').strokeColor).toBe('#e03131'); // text follows
    b.reorder(['box'], 'front');
    const order = JSON.parse(b.serialize()).elements.map((e: { id: string; index: string }) => `${e.id}:${e.index}`);
    expect(order.slice(-2)).toEqual(['box:a4', 'label:a5']);
    expect([indexKey(0), indexKey(61), indexKey(62), indexKey(62 + 3844)]).toEqual(['a0', 'az', 'b00', 'c000']);
  });

  it('rejects files that are not Excalidraw drawings', () => {
    expect(() => new ExcalidrawBoard('{"type":"other","elements":[]}', measure)).toThrow(/Unknown/);
    expect(() => new ExcalidrawBoard('nope', measure)).toThrow(/JSON/);
  });
});

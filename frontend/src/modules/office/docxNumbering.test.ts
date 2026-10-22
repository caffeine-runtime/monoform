// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { formatNumber, markerText, Numbering } from './docxNumbering';
import { DocModel, W } from './docxModel';

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val=""/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%1.%2)"/></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>
</w:numbering>`;

const STYLES = `<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet2"><w:name w:val="List Bullet 2"/><w:basedOn w:val="ListBullet"/><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr></w:style>
</w:styles>`;

const para = (text: string, numId?: string, ilvl = 0, style = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${numId ? `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` : ''}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const docXml = (...paras: string[]) => `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paras.join('')}<w:sectPr/></w:body></w:document>`;

function open(xml: string, numbering = NUMBERING) {
  const model = new DocModel(xml, { styles: { ListBullet: 'list bullet', ListBullet2: 'list bullet 2' }, rels: [], partUrl: () => '', numbering: new Numbering(numbering, STYLES) });
  const page = document.createElement('div');
  page.append(model.render(document));
  model.renumber(page);
  return { model, page, paras: () => Array.from(page.children) as HTMLElement[] };
}

describe('Word lists', () => {
  it('formats numbers like Word', () => {
    expect([1, 4, 9, 14, 40, 1994].map((n) => formatNumber(n, 'upperRoman'))).toEqual(['I', 'IV', 'IX', 'XIV', 'XL', 'MCMXCIV']);
    expect([1, 26, 27, 53].map((n) => formatNumber(n, 'lowerLetter'))).toEqual(['a', 'z', 'aa', 'aaa']);
    expect(formatNumber(3, 'decimalZero')).toBe('03');
    expect([1, 2, 3, 11, 22].map((n) => formatNumber(n, 'ordinal'))).toEqual(['1st', '2nd', '3rd', '11th', '22nd']);
    const lv = (fmt: string, text: string) => ({ fmt, text, start: 1, left: 0, hanging: 0, legal: false });
    expect(markerText([lv('decimal', '%1.'), lv('lowerLetter', '%1.%2)')], [3, 2], 1)).toBe('3.b)');
    expect(markerText([lv('bullet', '')], [1], 0)).toBe('•');
  });

  it('numbers paragraphs in order, restarting deeper levels and honouring start overrides', () => {
    const { paras } = open(docXml(para('one', '2'), para('one a', '2', 1), para('one b', '2', 1), para('two', '2'), para('two a', '2', 1), para('two a i', '2', 2), para('plain'), para('five', '3'), para('six', '3')));
    expect(paras().map((p) => p.dataset.marker ?? '')).toEqual(['1.', '1.a)', '1.b)', '2.', '2.a)', 'i.', '', '5.', '6.']);
    expect(paras()[1].classList.contains('li') && !paras()[6].classList.contains('li')).toBe(true);
    // Indentation from the level: text at 720 twips (48 px), marker 24 px before it.
    expect(paras()[0].style.marginLeft).toBe('24px');
  });

  it('shows lists a paragraph style turns on, with the level from the style chain', () => {
    const { paras } = open(docXml(para('a', undefined, 0, 'ListBullet'), para('b', undefined, 0, 'ListBullet2')));
    expect(paras().map((p) => p.dataset.marker)).toEqual(['•', '◦']);
    expect(paras()[0].dataset.numSrc).toBe('style');
  });

  it('makes, changes and ends lists, and writes numPr and new definitions', () => {
    const { model, page, paras } = open(docXml(para('first'), para('second'), para('third')), '');
    model.toggleList(paras().slice(0, 2), 'number');
    model.renumber(page);
    expect(paras().map((p) => p.dataset.marker ?? '')).toEqual(['1.', '2.', '']);
    model.changeLevel([paras()[1]], 1);
    model.renumber(page);
    expect(paras()[1].dataset.marker).toBe('a.');
    // Joining the list just before continues its numbering.
    model.toggleList([paras()[2]], 'number');
    model.renumber(page);
    expect(paras()[2].dataset.marker).toBe('2.');
    // Same kind again: off; a bullet list is a definition of its own.
    model.toggleList([paras()[2]], 'number');
    model.toggleList([paras()[0]], 'bullet');
    model.renumber(page);
    expect(paras().map((p) => p.dataset.marker ?? '')).toEqual(['•', 'a.', '']);
    expect(model.numbering.changed && model.numbering.isNew).toBe(true);
    const out = model.serialize(page);
    const ids = [...out.matchAll(/<w:numPr><w:ilvl w:val="(\d)"\/><w:numId w:val="(\d+)"\/><\/w:numPr>/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(ids).toEqual(['0:2', '1:1']);
    expect(out).not.toContain('third</w:t></w:r></w:p><w:numPr');
    const num = model.numbering.serialize();
    expect(num).toMatch(/<w:abstractNum w:abstractNumId="0">.*<w:abstractNum w:abstractNumId="1">.*<w:num w:numId="1">.*<w:num w:numId="2">/s);
    expect(num).toContain('w:val="bullet"');
  });

  it('turning a style list off writes an explicit "no list"', () => {
    const { model, page, paras } = open(docXml(para('a', undefined, 0, 'ListBullet')));
    model.toggleList([paras()[0]], 'bullet');
    expect(paras()[0].classList.contains('li')).toBe(false);
    expect(model.serialize(page)).toContain('<w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="0"/></w:numPr>');
  });

  it('leaves untouched lists exactly as they were', () => {
    const src = docXml(para('one', '2'), para('two', '2', 1));
    const { model, page } = open(src);
    const out = model.serialize(page);
    expect(out).toContain('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>');
    expect(out).toContain('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="2"/></w:numPr>');
  });
});

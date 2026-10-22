// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { DocModel, hexColor, W } from './docxModel';

const STYLES = `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style></w:styles>`;
const doc = (...paras: string[]) => `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${paras.join('')}<w:sectPr/></w:body></w:document>`;

function open(xml: string) {
  const model = new DocModel(xml, { styles: { Normal: 'normal', Heading1: 'heading 1' }, rels: [], partUrl: () => '', stylesXml: STYLES });
  const page = document.createElement('div');
  page.append(model.render(document));
  return { model, page, p: (i: number) => page.children[i] as HTMLElement };
}

/** Wrap the text of paragraph p in a span the way the browser's styling commands do. */
function styled(p: HTMLElement, css: Partial<CSSStyleDeclaration>, tag = 'span') {
  const w = document.createElement(tag);
  Object.assign(w.style, css);
  w.append(...Array.from(p.childNodes));
  p.append(w);
}

describe('Word formatting', () => {
  it('reads CSS colours', () => {
    expect([hexColor('rgb(192, 0, 0)'), hexColor('#abc'), hexColor('#00b0F0'), hexColor('rgba(0, 0, 0, 0)'), hexColor('transparent')]).toEqual(['C00000', 'AABBCC', '00B0F0', undefined, undefined]);
  });

  it('writes colour, size, font, highlight, shading and super/subscript into the run', () => {
    const { model, page, p } = open(doc('<w:p><w:r><w:t>a</w:t></w:r></w:p>', '<w:p><w:r><w:t>b</w:t></w:r></w:p>', '<w:p><w:r><w:t>c</w:t></w:r></w:p>', '<w:p><w:r><w:t>d</w:t></w:r></w:p>'));
    styled(p(0), { color: 'rgb(192, 0, 0)', fontSize: '14pt', fontFamily: '"Georgia"' });
    styled(p(1), { backgroundColor: '#fff59d' }); // the yellow highlight
    styled(p(2), { backgroundColor: 'rgb(18, 52, 86)' }, 'sup'); // any colour: shading
    styled(p(3), {}, 'sub');
    const out = model.serialize(page);
    expect(out).toContain('<w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:cs="Georgia" w:eastAsia="Georgia"/><w:color w:val="C00000"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t xml:space="preserve">a</w:t>');
    expect(out).toContain('<w:highlight w:val="yellow"/></w:rPr><w:t xml:space="preserve">b</w:t>');
    expect(out).toContain('<w:shd w:val="clear" w:color="auto" w:fill="123456"/><w:vertAlign w:val="superscript"/></w:rPr><w:t xml:space="preserve">c</w:t>');
    expect(out).toContain('<w:vertAlign w:val="subscript"/></w:rPr><w:t xml:space="preserve">d</w:t>');
  });

  it('keeps run properties it shows unchanged (a theme colour stays a theme colour)', () => {
    const run = '<w:r><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"/><w:color w:val="1F3864" w:themeColor="accent1" w:themeShade="7F"/><w:sz w:val="32"/><w:vertAlign w:val="superscript"/></w:rPr><w:t>x</w:t></w:r>';
    const { model, page } = open(doc(`<w:p>${run}</w:p>`));
    expect(model.serialize(page)).toContain('<w:color w:val="1F3864" w:themeColor="accent1" w:themeShade="7F"/>');
    expect(model.serialize(page)).toContain('<w:vertAlign w:val="superscript"/>');
  });

  it('removes what the editor cleared', () => {
    const { model, page, p } = open(doc('<w:p><w:r><w:rPr><w:color w:val="FF0000"/><w:highlight w:val="green"/><w:sz w:val="40"/></w:rPr><w:t>x</w:t></w:r></w:p>'));
    for (const s of Array.from(p(0).querySelectorAll<HTMLElement>('[style]'))) s.removeAttribute('style');
    const out = model.serialize(page);
    expect(out).not.toMatch(/w:color|w:highlight|w:sz/);
  });

  it('writes alignment, indent and line spacing; leaves what it showed', () => {
    const { model, page, p } = open(doc('<w:p><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:r><w:t>keep</w:t></w:r></w:p>', '<w:p><w:r><w:t>change</w:t></w:r></w:p>'));
    expect(p(0).style.lineHeight).toBe('1.5');
    p(1).style.textAlign = 'center';
    p(1).style.marginLeft = '48px';
    p(1).style.lineHeight = '2';
    const out = model.serialize(page);
    expect(out).toContain('<w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr><w:r><w:t xml:space="preserve">keep');
    expect(out).toContain('<w:pPr><w:spacing w:line="480" w:lineRule="auto"/><w:ind w:left="720"/><w:jc w:val="center"/></w:pPr>');
  });

  it('adds Heading 4 and Title to styles.xml when the document lacks them', () => {
    const { model, page, p } = open(doc('<w:p><w:r><w:t>a</w:t></w:r></w:p>', '<w:p><w:r><w:t>b</w:t></w:r></w:p>', '<w:p><w:r><w:t>c</w:t></w:r></w:p>'));
    const h = (i: number, tag: string, title = false) => {
      const e = document.createElement(tag);
      e.dataset.p = p(i).dataset.p;
      e.append(...Array.from(p(i).childNodes));
      if (title) e.classList.add('title');
      p(i).replaceWith(e);
    };
    h(0, 'h4');
    h(1, 'h1', true);
    h(2, 'h1');
    const out = model.serialize(page);
    expect(out).toContain('<w:pStyle w:val="Heading4"/>');
    expect(out).toContain('<w:pStyle w:val="Title"/>');
    expect(out).toContain('<w:pStyle w:val="Heading1"/>');
    expect(model.stylesChanged).toBe(true);
    const styles = model.serializeStyles();
    expect(styles).toMatch(/<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"\/><w:basedOn w:val="Normal"\/>/);
    expect(styles).toContain('w:styleId="Title"');
    expect(styles.match(/w:styleId="Heading1"/g)?.length).toBe(1);
  });
});

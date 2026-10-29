// Markdown's marks — the ** around bold text, the # of a heading, the
// backticks of code — each get their own colour, so what's formatted and how
// shows at a glance. The parser tags all of them alike (processingInstruction);
// these tags are finer, and fall back to that one in any other highlighter.
import { styleTags, Tag, tags as t } from '@lezer/highlight';

const mark = () => Tag.define(t.processingInstruction);

export const mdMark = {
  strong: mark(),
  emphasis: mark(),
  strike: mark(),
  heading: mark(),
  code: mark(),
  list: mark(),
  quote: mark(),
  link: mark(),
};

/** For markdown({ extensions }): the rules above. Each names its parent, so it wins over the parser's own rule. */
export const mdMarkStyles = {
  props: [
    styleTags({
      'StrongEmphasis/EmphasisMark': mdMark.strong,
      'Emphasis/EmphasisMark': mdMark.emphasis,
      'Strikethrough/StrikethroughMark': mdMark.strike,
      'ATXHeading1/HeaderMark ATXHeading2/HeaderMark ATXHeading3/HeaderMark ATXHeading4/HeaderMark ATXHeading5/HeaderMark ATXHeading6/HeaderMark': mdMark.heading,
      'SetextHeading1/HeaderMark SetextHeading2/HeaderMark': mdMark.heading,
      'InlineCode/CodeMark FencedCode/CodeMark': mdMark.code,
      'ListItem/ListMark Task/TaskMarker': mdMark.list,
      'Blockquote/QuoteMark': mdMark.quote,
      'Link/LinkMark Image/LinkMark': mdMark.link,
    }),
  ],
};

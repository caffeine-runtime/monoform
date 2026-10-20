// Small CodeMirror stream highlighters for DOT and Mermaid sources.
import { StreamLanguage, type StreamParser } from '@codemirror/language';

const DOT_KEYWORDS = /^(?:strict|graph|digraph|subgraph|node|edge)\b/i;
const DOT_ATTRS = /^(?:label|shape|style|color|fillcolor|fontcolor|fontname|fontsize|rankdir|rank|width|height|arrowhead|arrowtail|dir|penwidth|bgcolor|nodesep|ranksep|splines|labelloc|labeljust|xlabel|tooltip|URL|fixedsize|constraint|minlen|weight|compound|lhead|ltail|headlabel|taillabel|peripheries|group|ordering|concentrate|margin)\b/;

const dotParser: StreamParser<{ comment: boolean }> = {
  startState: () => ({ comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.comment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('//') || (stream.sol() && stream.peek() === '#')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.comment = true;
      return 'comment';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^<[^>]*>?/)) return 'string';
    if (stream.match(/^-[->]/)) return 'operator';
    if (stream.match(DOT_KEYWORDS)) return 'keyword';
    if (stream.match(DOT_ATTRS)) return 'attributeName';
    if (stream.match(/^-?(?:\.\d+|\d+(?:\.\d*)?)/)) return 'number';
    if (stream.match(/^[A-Za-z_\u0080-￿][\w\u0080-￿]*/)) return 'variableName';
    if (stream.match(/^[{}[\]]/)) return 'bracket';
    stream.next();
    return 'punctuation';
  },
  languageData: { commentTokens: { line: '//', block: { open: '/*', close: '*/' } } },
};

const MERMAID_TYPES = /^(?:flowchart|graph|sequenceDiagram|classDiagram(?:-v2)?|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|C4Context|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|radar-beta|treemap-beta)\b/;
const MERMAID_KEYWORDS = /^(?:subgraph|end|direction|participant|actor|loop|alt|else|opt|par|and|critical|break|rect|note|over|left of|right of|activate|deactivate|class|classDef|style|linkStyle|click|state|title|section|dateFormat|axisFormat|TD|TB|BT|LR|RL)\b/;

const mermaidParser: StreamParser<null> = {
  startState: () => null,
  token(stream) {
    if (stream.eatSpace()) return null;
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"[^"]*"?/)) return 'string';
    if (stream.match(MERMAID_TYPES)) return 'keyword';
    if (stream.match(MERMAID_KEYWORDS)) return 'keyword';
    if (stream.match(/^(?:<?[-=.]+>+|<?-[-.]+[xo>]?|-->>|->>|--x|--o|-\)|==>|\.->|---|-->|::|:::)/)) return 'operator';
    if (stream.match(/^[[\](){}|]+/)) return 'bracket';
    if (stream.match(/^-?\d+(?:\.\d+)?/)) return 'number';
    if (stream.match(/^[\w\u0080-￿-]+/)) return 'variableName';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '%%' } },
};

export const dotLanguage = StreamLanguage.define(dotParser);
export const mermaidLanguage = StreamLanguage.define(mermaidParser);

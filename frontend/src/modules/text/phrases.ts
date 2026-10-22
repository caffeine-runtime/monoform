// CodeMirror's own interface text (the search panel, Go to line, folding,
// screen-reader announcements) in the interface language. The keys are
// CodeMirror's English phrases; "$" is its placeholder.
import { EditorState, type Extension } from '@codemirror/state';
import { language, t } from '../../core/i18n';

export function editorPhrases(): Extension {
  if (language() === 'en') return [];
  return EditorState.phrases.of({
    Find: t('Find'),
    Replace: t('Replace'),
    next: t('next', {}, 'editor'),
    previous: t('previous', {}, 'editor'),
    all: t('all', {}, 'editor'),
    'match case': t('match case', {}, 'editor'),
    regexp: t('regexp', {}, 'editor'),
    'by word': t('by word', {}, 'editor'),
    replace: t('replace', {}, 'editor'),
    'replace all': t('replace all', {}, 'editor'),
    close: t('close', {}, 'editor'),
    'Go to line': t('Go to line', {}, 'editor'),
    go: t('go', {}, 'editor'),
    'current match': t('current match', {}, 'editor'),
    'on line': t('on line', {}, 'editor'),
    'replaced match on line $': t('replaced match on line $', {}, 'editor'),
    'replaced $ matches': t('replaced $ matches', {}, 'editor'),
    'Fold line': t('Fold line', {}, 'editor'),
    'Unfold line': t('Unfold line', {}, 'editor'),
    'folded code': t('folded code', {}, 'editor'),
    unfold: t('unfold', {}, 'editor'),
    'Folded lines': t('Folded lines', {}, 'editor'),
    'Unfolded lines': t('Unfolded lines', {}, 'editor'),
    to: t('to', {}, 'editor'),
    'Control character': t('Control character', {}, 'editor'),
    'Selection deleted': t('Selection deleted', {}, 'editor'),
    Completions: t('Completions', {}, 'editor'),
  });
}

/** The minimap's tooltip (minimap.ts can't use t: its `t` is Lezer's tags). */
export const minimapTitle = () => t('Minimap — click or drag to scroll');

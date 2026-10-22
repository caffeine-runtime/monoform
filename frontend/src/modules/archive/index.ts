import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { extractHere, extractTo } from '../../core/archives';
import { t } from '../../core/i18n';

const isArchiveTab = () => workspace.active?.moduleId === 'archive' && !!workspace.active.path;
commands.register(
  { id: 'archive.extractAll', title: t('Extract all…'), category: t('Archive'), when: isArchiveTab, run: () => extractTo(workspace.active!.path!) },
  { id: 'archive.extractHere', title: t('Extract here'), category: t('Archive'), when: isArchiveTab, run: () => extractHere(workspace.active!.path!) },
);

export { default } from './ArchiveModule.svelte';

import { commands } from '../../core/commands';
import { workspace } from '../../core/tabs.svelte';
import { extractHere, extractTo } from '../../core/archives';

const isArchiveTab = () => workspace.active?.moduleId === 'archive' && !!workspace.active.path;
commands.register(
  { id: 'archive.extractAll', title: 'Extract all…', category: 'Archive', when: isArchiveTab, run: () => extractTo(workspace.active!.path!) },
  { id: 'archive.extractHere', title: 'Extract here', category: 'Archive', when: isArchiveTab, run: () => extractHere(workspace.active!.path!) },
);

export { default } from './ArchiveModule.svelte';

import { dropHandlers } from '../../core/drop';
import { activeHash } from './controllers';

// A file dropped on the Hash tool is hashed instead of opened.
dropHandlers.unshift((_x, _y, paths) => {
  const h = activeHash();
  if (!h || !paths[0]) return false;
  h.setFile(paths[0]);
  return true;
});

export { default } from './HashModule.svelte';

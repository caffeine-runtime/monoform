// Files dropped from the OS arrive as paths (Wails OnFileDrop). Modules can
// claim a drop at a position (e.g. images dropped into a markdown note);
// otherwise the files are opened.
export type DropHandler = (x: number, y: number, paths: string[]) => boolean;
export const dropHandlers: DropHandler[] = [];

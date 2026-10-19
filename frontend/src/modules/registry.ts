// Built-in modules. Each entry only describes the module; its code is loaded
// with a dynamic import() the first time a file of that type is opened.
import { modules } from '../core/modules';

const TEXT_EXT = [
  'txt', 'log', 'ini', 'cfg', 'conf', 'toml', 'env', 'properties', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'svelte', 'vue', 'go', 'mod', 'sum', 'rs', 'py', 'rb', 'php', 'java', 'kt', 'kts',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'swift', 'm', 'mm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'lua', 'pl', 'r', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'elm', 'jl', 'nim', 'zig', 'tex', 'rst',
  'adoc', 'gitignore', 'gitattributes', 'editorconfig', 'dockerfile', 'makefile', 'cmake', 'gradle', 'diff', 'patch', 'srt', 'vtt', 'jsonc',
];

export function registerBuiltinModules() {
  modules.register({
    id: 'text',
    name: 'Text',
    extensions: TEXT_EXT,
    mimeTypes: ['text/*', 'application/xml', 'application/javascript'],
    load: () => import('./text'),
  });
  modules.register({
    id: 'markdown',
    name: 'Markdown',
    extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx'],
    mimeTypes: ['text/markdown'],
    priority: 10,
    load: () => import('./markdown'),
  });
  modules.register({
    id: 'binary',
    name: 'Binary',
    extensions: ['exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'wasm', 'iso', 'dmg', 'img'],
    mimeTypes: ['application/octet-stream'],
    load: () => import('./binary'),
  });
}

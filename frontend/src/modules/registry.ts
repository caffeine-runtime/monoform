// Built-in modules. Each entry only describes the module; its code is loaded
// with a dynamic import() the first time a file of that type is opened.
import { modules } from '../core/modules';

const TEXT_EXT = [
  'txt', 'log', 'ini', 'cfg', 'conf', 'toml', 'env', 'properties', 'xml', 'html', 'htm', 'css', 'scss', 'less',
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'svelte', 'vue', 'go', 'mod', 'sum', 'rs', 'py', 'rb', 'php', 'java', 'kt', 'kts',
  'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh', 'cs', 'swift', 'm', 'mm', 'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
  'sql', 'lua', 'pl', 'r', 'dart', 'scala', 'clj', 'ex', 'exs', 'erl', 'hs', 'elm', 'jl', 'nim', 'zig', 'tex', 'rst',
  'adoc', 'gitignore', 'gitattributes', 'editorconfig', 'dockerfile', 'makefile', 'cmake', 'gradle', 'diff', 'patch', 'srt', 'vtt',
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
    id: 'image',
    name: 'Image',
    extensions: ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'svg'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml'],
    load: () => import('./image'),
  });
  modules.register({
    id: 'pdf',
    name: 'PDF',
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    load: () => import('./pdf'),
  });
  modules.register({
    id: 'data',
    name: 'Data',
    extensions: ['json', 'jsonc', 'geojson', 'webmanifest', 'yaml', 'yml'],
    mimeTypes: ['application/json', 'application/yaml', 'application/geo+json', 'application/manifest+json'],
    priority: 5,
    load: () => import('./data/dataIndex'),
  });
  modules.register({
    id: 'csv',
    name: 'Table',
    extensions: ['csv', 'tsv', 'tab'],
    mimeTypes: ['text/csv', 'text/tab-separated-values'],
    priority: 5,
    load: () => import('./data/csvIndex'),
  });
  modules.register({
    id: 'sheet',
    name: 'Spreadsheet',
    extensions: ['xlsx', 'xlsm', 'xltx', 'xltm', 'xls'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel'],
    load: () => import('./office/sheet'),
  });
  modules.register({
    id: 'doc',
    name: 'Document',
    extensions: ['docx', 'doc'],
    mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'],
    load: () => import('./office/doc'),
  });
  modules.register({
    id: 'archive',
    name: 'Archive',
    extensions: ['zip', 'tar', 'gz', 'tgz', 'tar.gz', 'tar.bz2', 'tbz2', 'tar.xz', 'txz', 'tar.zst', 'bz2', 'xz', 'zst', '7z', 'rar'],
    mimeTypes: ['application/zip', 'application/x-tar', 'application/gzip', 'application/x-7z-compressed', 'application/vnd.rar', 'application/x-bzip2', 'application/x-xz', 'application/zstd'],
    load: () => import('./archive'),
  });
  modules.register({
    id: 'hash',
    name: 'Hash',
    extensions: [],
    mimeTypes: [],
    tool: true,
    load: () => import('./hash'),
  });
  modules.register({
    id: 'semantic',
    name: 'Search by meaning',
    extensions: [],
    mimeTypes: [],
    tool: true,
    load: () => import('./semantic'),
  });
  modules.register({
    id: 'checksum',
    name: 'Checksums',
    extensions: ['sha256', 'sha1', 'md5', 'sha512', 'b3', 'sha256sum', 'md5sum', 'sha1sum', 'sha512sum'],
    mimeTypes: [],
    priority: 5,
    load: () => import('./hash'),
  });
  modules.register({
    id: 'binary',
    name: 'Binary',
    extensions: ['exe', 'dll', 'so', 'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'wasm', 'iso', 'dmg', 'img'],
    mimeTypes: ['application/octet-stream'],
    load: () => import('./binary'),
  });
}

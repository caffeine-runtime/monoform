// Built-in modules. Each entry only describes the module; its code is loaded
// with a dynamic import() the first time a file of that type is opened.
import { modules } from '../core/modules';
import { XML_EXT } from './data/formatExt';

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
    id: 'cert',
    name: 'Certificate',
    extensions: ['pem', 'crt', 'cer', 'der', 'p12', 'pfx', 'p7b', 'p7c', 'csr', 'crl'],
    mimeTypes: ['application/x-x509-ca-cert', 'application/pkix-cert', 'application/x-pkcs12', 'application/pkcs10', 'application/x-pkcs7-certificates'],
    priority: 10,
    load: () => import('./cert'),
  });
  modules.register({
    id: 'config',
    name: 'Config',
    extensions: ['ini', 'cfg', 'properties', 'env', 'desktop', 'inf', 'reg'],
    fileNames: /^\.env(\..+)?$/i,
    mimeTypes: [],
    priority: 5,
    load: () => import('./config'),
  });
  modules.register({
    id: 'font',
    name: 'Font',
    extensions: ['ttf', 'otf', 'ttc', 'otc', 'woff', 'woff2'],
    mimeTypes: ['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'font/collection'],
    priority: 10,
    load: () => import('./font'),
  });
  modules.register({
    id: 'log',
    name: 'Log',
    extensions: ['log', 'out', 'err'],
    mimeTypes: [],
    priority: 5,
    load: () => import('./log'),
  });
  modules.register({
    id: 'image',
    name: 'Image',
    extensions: ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'ora', 'heic', 'heif', 'avif', 'ico', 'cur', 'icns'],
    mimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/heic', 'image/heif', 'image/avif', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/icns'],
    load: () => import('./image'),
  });
  modules.register({
    id: 'svg',
    name: 'SVG',
    extensions: ['svg'],
    mimeTypes: ['image/svg+xml'],
    priority: 10,
    load: () => import('./svg'),
  });
  modules.register({
    id: 'html',
    name: 'Web page',
    extensions: ['html', 'htm', 'xhtml'],
    mimeTypes: ['text/html'],
    priority: 10,
    load: () => import('./html'),
  });
  modules.register({
    id: 'model3d',
    name: '3D model',
    extensions: ['glb', 'gltf', 'fbx', 'obj', 'stl', 'ply', '3mf', 'dae', '3ds', 'usdz', 'usd', 'usda', 'usdc', 'wrl', 'vrml', 'amf', 'pcd', 'xyz', 'vtk', 'vtp'],
    mimeTypes: ['model/gltf-binary', 'model/gltf+json', 'model/stl', 'model/obj'],
    priority: 10,
    load: () => import('./model3d'),
  });
  modules.register({
    id: 'audio',
    name: 'Audio',
    extensions: ['mp3', 'wav', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'weba', 'mka', 'aif', 'aiff'],
    mimeTypes: ['audio/*'],
    priority: 10,
    load: () => import('./audio'),
  });
  modules.register({
    id: 'database',
    name: 'Database',
    extensions: ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3'],
    mimeTypes: ['application/vnd.sqlite3'],
    priority: 10,
    load: () => import('./database'),
  });
  modules.register({
    id: 'cad',
    name: 'CAD drawing',
    extensions: ['dxf'],
    mimeTypes: ['image/vnd.dxf'],
    priority: 10,
    load: () => import('./cad'),
  });
  modules.register({
    id: 'video',
    name: 'Video',
    extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv', 'avi'],
    mimeTypes: ['video/*'],
    priority: 10,
    load: () => import('./video'),
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
    extensions: ['json', 'jsonc', 'geojson', 'webmanifest', 'yaml', 'yml', 'toml', 'jsonl', 'ndjson', 'jsonlines', ...XML_EXT],
    mimeTypes: ['application/json', 'application/yaml', 'application/geo+json', 'application/manifest+json', 'application/toml', 'application/x-ndjson', 'application/xml', 'text/xml'],
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
    id: 'compare',
    name: 'Compare',
    extensions: [],
    mimeTypes: [],
    tool: true,
    load: () => import('./compare'),
  });
  modules.register({
    id: 'settings',
    name: 'Settings',
    extensions: [],
    mimeTypes: [],
    tool: true,
    load: () => import('./settings'),
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

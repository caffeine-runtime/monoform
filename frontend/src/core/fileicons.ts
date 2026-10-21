import type { Component } from 'svelte';
import { File, FileArchive, FileCheck, FileCode, FileImage, FileJson, FileSpreadsheet, FileText, BookOpen } from './icons';
import { extname } from './paths';

const CODE = new Set(['js', 'ts', 'tsx', 'jsx', 'go', 'rs', 'py', 'rb', 'java', 'c', 'h', 'cpp', 'cs', 'php', 'swift', 'kt', 'sh', 'html', 'css', 'svelte', 'vue', 'sql', 'xml', 'toml', 'lua']);

/** Icon for a file in the tree, by filetype kind (from Go) or extension. */
export function iconFor(name: string, kind?: string): Component<any> {
  switch (kind) {
    case 'markdown':
      return BookOpen;
    case 'pdf':
      return FileText;
    case 'image':
    case 'svg':
    case 'cad':
      return FileImage;
    case 'json':
    case 'yaml':
      return FileJson;
    case 'csv':
    case 'spreadsheet':
      return FileSpreadsheet;
    case 'document':
      return FileText;
    case 'archive':
      return FileArchive;
    case 'checksum':
      return FileCheck;
  }
  if (CODE.has(extname(name))) return FileCode;
  return kind === 'text' ? FileText : File;
}

/** Kind of a file from its extension alone (lists of paths, before Go has looked at them). */
export function kindOf(p: string): string {
  const e = extname(p);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(e)) return 'image';
  if (['md', 'markdown'].includes(e)) return 'markdown';
  if (e === 'pdf') return 'pdf';
  if (['json', 'yaml', 'yml'].includes(e)) return 'json';
  if (['csv', 'tsv'].includes(e)) return 'csv';
  if (['zip', 'tar', 'gz', 'tar.gz', '7z', 'rar', 'tgz'].includes(e)) return 'archive';
  return 'text';
}

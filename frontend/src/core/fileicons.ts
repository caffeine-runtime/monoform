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

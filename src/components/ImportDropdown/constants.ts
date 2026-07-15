import React from 'react';
import { Captions, File, Link, Text } from 'lucide-react';
import type { ImportSource } from './types';

export const IMPORT_OPTIONS: Array<{
  source: ImportSource;
  label: string;
  icon: React.FC<{ size?: string | number }>;
}> = [
  {
    source: 'file',
    label: 'Import File',
    icon: File,
  },
  {
    source: 'url',
    label: 'Import from URL',
    icon: Link,
  },
  {
    source: 'youtube',
    label: 'YouTube Transcript',
    icon: Captions,
  },
  {
    source: 'paste',
    label: 'Paste Text',
    icon: Text,
  },
];

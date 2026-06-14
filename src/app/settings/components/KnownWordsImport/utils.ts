import { WordState } from '@/types';

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

export function lingqStatusToState(status: string): WordState {
  switch (status) {
    case '1':
      return 'level1';
    case '2':
      return 'level2';
    case '3':
      return 'level3';
    case '4':
      return 'level4';
    case 'K':
    case 'k':
    case '5':
      return 'known';
    default:
      return 'level1';
  }
}

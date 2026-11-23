import { VocabType, WordState } from '@/types';

export interface LingQImport {
  word: string;
  type: VocabType;
  state: WordState;
  translation: string;
  sentence: string;
}

/** RFC 4180: quoted fields may hold commas, line breaks, and `""` escapes. */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field.trim());
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((f) => f.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
    }
  }
  endRow();
  return rows;
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

export function isLingQHeader(header: string[]): boolean {
  return header.some((h) => ['term', 'word', 'hint', 'status'].includes(h.toLowerCase()));
}

/**
 * Maps both the LingQ site export (`term, phrase, tag1…, meaning1…`) and the
 * older `term, hint, status, sentence` layout. Returns null without a term column.
 */
export function parseLingQExport(
  rows: string[][],
  fold: (word: string) => string,
): LingQImport[] | null {
  if (rows.length === 0) return null;
  const header = rows[0].map((h) => h.toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));

  const termIdx = col('term', 'word');
  if (termIdx === -1) return null;
  const hintIdx = col('hint', 'translation');
  const meaningIdxs = header.flatMap((h, i) => (/^meaning\d+$/.test(h) ? [i] : []));
  const statusIdx = col('status');
  const sentenceIdx = col('sentence', 'phrase', 'context');

  const imports: LingQImport[] = [];
  for (const fields of rows.slice(1)) {
    const rawTerm = fields[termIdx]?.trim();
    const word = rawTerm ? fold(rawTerm) : '';
    if (!word) continue;

    const translationIdxs = hintIdx >= 0 ? [hintIdx] : meaningIdxs;
    const translation = translationIdxs
      .map((i) => fields[i]?.trim() ?? '')
      .filter((t) => t.length > 0)
      .join('; ');

    imports.push({
      word,
      type: /\s/.test(word) ? 'phrase' : 'word',
      // A LingQ is a word the user still learns, so a missing status is not "known".
      state: lingqStatusToState(statusIdx >= 0 ? (fields[statusIdx]?.trim() ?? '') : ''),
      translation,
      sentence: sentenceIdx >= 0 ? (fields[sentenceIdx]?.trim() ?? '') : '',
    });
  }
  return imports;
}

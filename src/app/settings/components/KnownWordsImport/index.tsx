import { Button } from '@/components/ui/button';
import {
  bulkUpdateWordStates,
  getVocabByText,
  saveVocab,
  updateVocabState,
  WordState,
} from '@/lib/data-layer';
import { useRef, useState } from 'react';
import { lingqStatusToState, parseCSVLine } from './utils';
import { toast } from 'sonner';

export default function KnownWordsImport() {
  const [importText, setImportText] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import words as known
  const importKnownWords = async (words: string[]) => {
    const updates = words.map((word) => ({
      word,
      state: 'known' as WordState,
    }));
    await bulkUpdateWordStates(updates);
  };

  // Handle paste text area import
  const handleTextImport = async () => {
    const words = importText
      .split(/[\r\n]+/)
      .map((word) => word.trim().toLowerCase())
      .filter((word) => word.length > 0);

    if (words.length === 0) {
      toast.info('No words to import.');
      return;
    }

    await importKnownWords(words);
    toast.success(`Successfully imported ${words.length} words as known.`);
    setImportText('');
  };

  // Import LingQ words with their states and translations
  const importLingQWords = async (
    imports: { word: string; state: WordState; translation?: string }[],
  ) => {
    for (const item of imports) {
      // Check if word already exists
      const existing = await getVocabByText(item.word);

      if (existing) {
        // Update state if the LingQ state is "more known"
        const stateRank: Record<WordState, number> = {
          new: 0,
          level1: 1,
          level2: 2,
          level3: 3,
          level4: 4,
          known: 5,
          ignored: -1,
        };
        if (stateRank[item.state] > stateRank[existing.state]) {
          await updateVocabState(existing.id, item.state);
        }
      } else {
        // Create new entry
        await saveVocab({
          id: crypto.randomUUID(),
          text: item.word,
          type: 'word',
          sentence: '',
          translation: item.translation || '',
          state: item.state,
          stateUpdatedAt: new Date(),
          reviewCount: 0,
          createdAt: new Date(),
          pushedToAnki: false,
        });
      }
    }

    // Also update known words table for fast lookup
    const updates = imports.map((i) => ({ word: i.word, state: i.state }));
    await bulkUpdateWordStates(updates);
  };

  // Handle CSV file upload for known words (supports LingQ format)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const lines = text
        .split(/[\r\n]+/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        toast.info('No data found in file.');
        return;
      }

      // Check if this looks like a LingQ export (has header row)
      const firstLine = lines[0].toLowerCase();
      const isLingQFormat =
        firstLine.includes('term') || firstLine.includes('hint') || firstLine.includes('status');

      if (isLingQFormat) {
        // LingQ CSV format: term, hint (translation), status, etc.
        const header = parseCSVLine(lines[0].toLowerCase());
        const termIdx = header.findIndex((h) => h === 'term' || h === 'word');
        const hintIdx = header.findIndex((h) => h === 'hint' || h === 'translation');
        const statusIdx = header.findIndex((h) => h === 'status');

        if (termIdx === -1) {
          toast.error("Could not find 'term' column in LingQ export.");
          return;
        }

        const imports: { word: string; state: WordState; translation?: string }[] = [];

        for (let i = 1; i < lines.length; i++) {
          const fields = parseCSVLine(lines[i]);
          const word = fields[termIdx]?.toLowerCase().trim();
          if (!word) continue;

          const status = statusIdx >= 0 ? fields[statusIdx] : 'K';
          const translation = hintIdx >= 0 ? fields[hintIdx] : undefined;

          imports.push({
            word,
            state: lingqStatusToState(status),
            translation,
          });
        }

        // Import with states and translations
        await importLingQWords(imports);
        const knownCount = imports.filter((i) => i.state === 'known').length;
        const learningCount = imports.length - knownCount;
        toast.success(
          `Imported ${imports.length} words from LingQ: ${knownCount} known, ${learningCount} learning.`,
        );
      } else {
        // Simple format: one word per line or first CSV column
        const words = lines
          .map((line) => {
            const parts = line.split(',');
            return parts[0].trim().toLowerCase();
          })
          .filter((w) => w.length > 0);

        await importKnownWords(words);
        toast.success(`Successfully imported ${words.length} words as known.`);
      }
    } catch (error) {
      toast.error(
        `Error importing file: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <section className="panel p-6">
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Import Known Words
      </h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Import words you already know. Supports <strong>LingQ exports</strong> (with status levels
        and translations) or simple word lists.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        LingQ: Vocabulary → Settings gear → Export LingQs → Upload the CSV here
      </p>

      {/* CSV Upload */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-foreground">
          Upload CSV File
        </label>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-[var(--primary-soft)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-[var(--primary-soft)] dark:text-muted-foreground  "
        />
        <p className="mt-1 text-xs text-muted-foreground">
          CSV with words in the first column, or a plain text file
        </p>
      </div>

      {/* Text Area Import */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-foreground">
          Or Paste Words (one per line)
        </label>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="die&#10;en&#10;is&#10;van&#10;..."
          rows={6}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none  "
        />
      </div>

      <Button variant="secondary" onClick={handleTextImport} disabled={!importText.trim()}>
        Import
      </Button>
    </section>
  );
}

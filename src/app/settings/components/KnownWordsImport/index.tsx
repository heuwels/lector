import { Button } from '@/components/ui/button';
import {
  bulkUpdateWordStates,
  getActivePack,
  getVocabByText,
  saveVocab,
  updateVocabEntry,
  VocabEntry,
  WordState,
} from '@/lib/data-layer';
import { foldWord } from '@/lib/languages';
import { useRef, useState } from 'react';
import { isLingQHeader, LingQImport, parseCSV, parseLingQExport } from './utils';
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
    // Pasted word lists are a text ingress (#289): fold like every other
    // vocab key (NFC + case fold; the API folds again server-side).
    const words = importText
      .split(/[\r\n]+/)
      .map((word) => foldWord(word.trim(), getActivePack()))
      .filter((word) => word.length > 0);

    if (words.length === 0) {
      toast.info('No words to import.');
      return;
    }

    try {
      await importKnownWords(words);
      toast.success(`Successfully imported ${words.length} words as known.`);
      setImportText('');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import known words');
    }
  };

  // Import LingQ words with their states and translations
  const importLingQWords = async (imports: LingQImport[]) => {
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
        const updates: Partial<Pick<VocabEntry, 'state' | 'translation' | 'sentence'>> = {};
        if (stateRank[item.state] > stateRank[existing.state]) updates.state = item.state;
        if (!existing.translation && item.translation) updates.translation = item.translation;
        if (!existing.sentence && item.sentence) updates.sentence = item.sentence;
        if (Object.keys(updates).length > 0) {
          await updateVocabEntry(existing.id, updates);
        }
      } else {
        // Create new entry
        await saveVocab({
          id: crypto.randomUUID(),
          text: item.word,
          type: item.type,
          sentence: item.sentence,
          translation: item.translation,
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
      const rows = parseCSV(text);

      if (rows.length === 0) {
        toast.info('No data found in file.');
        return;
      }

      if (isLingQHeader(rows[0])) {
        const imports = parseLingQExport(rows, (word) => foldWord(word, getActivePack()));
        if (!imports) {
          toast.error("Could not find 'term' column in LingQ export.");
          return;
        }

        await importLingQWords(imports);
        const knownCount = imports.filter((i) => i.state === 'known').length;
        const learningCount = imports.length - knownCount;
        toast.success(
          `Imported ${imports.length} words from LingQ: ${knownCount} known, ${learningCount} learning.`,
        );
      } else {
        // Simple format: one word per line or first CSV column
        const words = rows
          .map((fields) => foldWord(fields[0] ?? '', getActivePack()))
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
      <h2 className="mb-4 text-lg font-semibold text-foreground">Import Known Words</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Import words you already know. Supports <strong>LingQ exports</strong> (with status levels
        and translations) or simple word lists.
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        LingQ: Vocabulary → Settings gear → Export LingQs → Upload the CSV here
      </p>

      {/* CSV Upload */}
      <div className="mb-4">
        <label className="mb-2 block text-sm font-medium text-foreground">Upload CSV File</label>
        <input
          ref={fileInputRef}
          data-testid="known-words-import-file"
          type="file"
          accept=".csv,.txt"
          onChange={handleFileUpload}
          className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-md file:border-0 file:bg-[var(--primary-soft)] file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-[var(--primary-soft)] dark:text-muted-foreground"
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
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
        />
      </div>

      <Button variant="secondary" onClick={handleTextImport} disabled={!importText.trim()}>
        Import
      </Button>
    </section>
  );
}

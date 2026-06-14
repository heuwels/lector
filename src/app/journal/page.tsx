'use client';

import { useState, useEffect, useRef } from 'react';
import { Loader2, Plus } from 'lucide-react';
import {
  type JournalEntry,
  getJournalEntries,
  createJournalEntry,
  updateJournalDraft,
  submitJournalForCorrection,
  deleteJournalEntry,
} from '@/lib/data-layer';
import EntryModal from './components/EntryModal';
import HistoryCard from './components/HistoryCard';
import { formatDate } from './utils';
import { Button } from '@/components/ui/button';

export default function JournalPage() {
  const [bodyText, setBodyText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load entries
  useEffect(() => {
    getJournalEntries(50).then(setEntries);
  }, []);

  const refreshEntries = async () => {
    const updated = await getJournalEntries(50);
    setEntries(updated);
  };

  const handleNewEntry = () => {
    setBodyText('');
    setEditingId(null);
    setShowEditor(true);
    setError(null);
  };

  const handleBodyChange = (text: string) => {
    setBodyText(text);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (editingId && text.trim()) {
      autoSaveTimer.current = setTimeout(async () => {
        try {
          await updateJournalDraft(editingId, text);
          setSaveStatus('Draft saved');
          setTimeout(() => setSaveStatus(null), 2000);
        } catch {
          /* silent */
        }
      }, 3000);
    }
  };

  const handleSaveDraft = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await updateJournalDraft(editingId, bodyText);
      } else {
        const result = await createJournalEntry(bodyText);
        setEditingId(result.id);
      }
      await refreshEntries();
      setSaveStatus('Draft saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setIsSubmitting(true);
    setError(null);
    try {
      let id = editingId;
      if (!id) {
        const result = await createJournalEntry(bodyText);
        id = result.id;
        setEditingId(id);
      } else {
        await updateJournalDraft(id, bodyText);
      }
      await submitJournalForCorrection(id);
      await refreshEntries();
      setShowEditor(false);
      setBodyText('');
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Correction failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this journal entry?')) return;
    await deleteJournalEntry(id);
    if (editingId === id) {
      setShowEditor(false);
      setBodyText('');
      setEditingId(null);
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const handleEditDraft = (entry: JournalEntry) => {
    setBodyText(entry.body);
    setEditingId(entry.id);
    setShowEditor(true);
    setError(null);
  };

  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 pb-24 sm:px-6 sm:pb-8 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Journal</h1>
        {!showEditor && (
          <Button onClick={handleNewEntry}>
            <Plus className="h-4 w-4" />
            New Entry
          </Button>
        )}
      </div>

      {/* Editor */}
      {showEditor && (
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
              {formatDate(new Date().toISOString())}
            </h2>
            <Button
              onClick={() => {
                setShowEditor(false);
                setBodyText('');
                setEditingId(null);
                setError(null);
              }}
              variant="destructive"
            >
              Cancel
            </Button>
          </div>

          <div className="space-y-3">
            <textarea
              value={bodyText}
              onChange={(e) => handleBodyChange(e.target.value)}
              placeholder="Skryf vandag se joernaal inskrywing in Afrikaans..."
              className="min-h-[160px] w-full resize-y rounded-lg border border-zinc-300 bg-white p-4 text-sm leading-relaxed text-zinc-900 placeholder-zinc-400 focus:ring-2 focus:ring-blue-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder-zinc-500"
              disabled={isSubmitting}
              autoFocus
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
                <span>
                  {wordCount} word{wordCount > 1 ? 's' : ''}
                </span>
                {saveStatus && (
                  <span className="text-green-600 dark:text-green-400">{saveStatus}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveDraft}
                  disabled={isSaving || isSubmitting || !bodyText.trim()}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !bodyText.trim()}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isSubmitting ? 'Correcting...' : 'Submit for Correction'}
                </button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}
        </section>
      )}

      {/* Entry list */}
      {entries.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {entries.length} entr{entries.length !== 1 ? 'ies' : 'y'}
          </h2>
          <div className="space-y-2">
            {entries.map((entry) => (
              <HistoryCard
                key={entry.id}
                entry={entry}
                onSelect={(e) => {
                  if (e.status === 'draft') {
                    handleEditDraft(e);
                  } else {
                    setSelectedEntry(e);
                  }
                }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        </section>
      ) : !showEditor ? (
        <div className="py-16 text-center">
          <p className="mb-4 text-zinc-500 dark:text-zinc-400">No journal entries yet</p>
          <Button onClick={handleNewEntry}>Write your first entry</Button>
        </div>
      ) : null}

      {/* Detail modal */}
      {selectedEntry && <EntryModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}
    </main>
  );
}

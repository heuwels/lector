'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus } from 'lucide-react';
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
import { Spinner } from '@/components/ui/spinner';
import PageHeader from '@/components/PageHeader';
import { useActiveLanguage } from '@/utils/hooks';

export default function JournalPage() {
  const activeLang = useActiveLanguage();
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
          const res = await updateJournalDraft(editingId, text);
          if (!res.ok) return;
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
        const res = await updateJournalDraft(editingId, bodyText);
        if (!res.ok) {
          if (res.status !== 429) setError('Failed to save');
          return;
        }
      } else {
        const res = await createJournalEntry(bodyText);
        if (!res.ok) {
          if (res.status !== 429) setError('Failed to save');
          return;
        }
        const result = (await res.json()) as { id: string };
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
        const res = await createJournalEntry(bodyText);
        if (!res.ok) {
          if (res.status !== 429) setError('Correction failed');
          return;
        }
        const result = (await res.json()) as { id: string };
        id = result.id;
        setEditingId(id);
      } else {
        const res = await updateJournalDraft(id, bodyText);
        if (!res.ok) {
          if (res.status !== 429) setError('Correction failed');
          return;
        }
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
    try {
      await deleteJournalEntry(id);
      if (editingId === id) {
        setShowEditor(false);
        setBodyText('');
        setEditingId(null);
      }
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not delete journal entry');
    }
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
      <PageHeader title="Journal">
        {!showEditor && (
          <Button onClick={handleNewEntry}>
            <Plus className="h-4 w-4" />
            New Entry
          </Button>
        )}
      </PageHeader>
      {showEditor && (
        <section className="mb-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
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
              placeholder={`Write today's journal entry in ${activeLang.native}...`}
              className="min-h-[160px] w-full resize-y rounded-lg border border-input bg-background p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
              disabled={isSubmitting}
              autoFocus
            />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>
                  {wordCount} word{wordCount > 1 ? 's' : ''}
                </span>
                {saveStatus && (
                  <span className="text-primary">{saveStatus}</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  onClick={handleSaveDraft}
                  disabled={isSaving || isSubmitting || !bodyText.trim()}
                  variant="secondary"
                >
                  {isSaving ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={isSubmitting || !bodyText.trim()}
                >
                  {isSubmitting && <Spinner />}
                  {isSubmitting ? 'Correcting...' : 'Submit for Correction'}
                </Button>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </section>
      )}
      {entries.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
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
          <p className="mb-4 text-muted-foreground">No journal entries yet</p>
          <Button onClick={handleNewEntry}>Write your first entry</Button>
        </div>
      ) : null}
      {selectedEntry && <EntryModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />}
    </main>
  );
}

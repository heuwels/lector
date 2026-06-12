'use client';

import { useState, useEffect, useRef } from 'react';
import NavHeader from '@/components/NavHeader';
import {
  type JournalEntry,
  type Correction,
  getJournalEntries,
  createJournalEntry,
  updateJournalDraft,
  submitJournalForCorrection,
  deleteJournalEntry,
} from '@/lib/data-layer';
import { EntryModal, HistoryCard } from './components';
import { formatDate } from './utils';

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

  const today = new Date().toISOString().split('T')[0];

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
        } catch { /* silent */ }
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
        const result = await createJournalEntry(bodyText, today);
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
        const result = await createJournalEntry(bodyText, today);
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 pt-[var(--mobile-topbar-h)] sm:pt-0 sm:ml-56">
      <NavHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 pb-24 sm:pb-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Journal</h1>
          {!showEditor && (
            <button
              onClick={handleNewEntry}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Entry
            </button>
          )}
        </div>

        {/* Editor */}
        {showEditor && (
          <section className="mb-10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                {formatDate(today)}
              </h2>
              <button
                onClick={() => { setShowEditor(false); setBodyText(''); setEditingId(null); setError(null); }}
                className="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-3">
              <textarea
                value={bodyText}
                onChange={(e) => handleBodyChange(e.target.value)}
                placeholder="Skryf vandag se joernaal inskrywing in Afrikaans..."
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y min-h-[160px]"
                disabled={isSubmitting}
                autoFocus
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
                  <span>{wordCount} words</span>
                  {saveStatus && (
                    <span className="text-green-600 dark:text-green-400">{saveStatus}</span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSaveDraft}
                    disabled={isSaving || isSubmitting || !bodyText.trim()}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-600 px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 transition-colors"
                  >
                    {isSaving ? 'Saving...' : 'Save Draft'}
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !bodyText.trim()}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                  >
                    {isSubmitting && (
                      <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    )}
                    {isSubmitting ? 'Correcting...' : 'Submit for Correction'}
                  </button>
                </div>
              </div>
            </div>

            {error && (
              <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </div>
            )}
          </section>
        )}

        {/* Entry list */}
        {entries.length > 0 ? (
          <section>
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
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
          <div className="text-center py-16">
            <p className="text-zinc-500 dark:text-zinc-400 mb-4">No journal entries yet</p>
            <button
              onClick={handleNewEntry}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
            >
              Write your first entry
            </button>
          </div>
        ) : null}

        {/* Detail modal */}
        {selectedEntry && (
          <EntryModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        )}
      </main>
    </div>
  );
}

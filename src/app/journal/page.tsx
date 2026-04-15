'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import NavHeader from '@/components/NavHeader';
import {
  type JournalEntry,
  type Correction,
  getJournalEntryByDate,
  getJournalEntries,
  saveJournalDraft,
  updateJournalDraft,
  submitJournalForCorrection,
  deleteJournalEntry,
} from '@/lib/data-layer';

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// ── Correction type badge ───────────────────────────────────────────────────

const correctionTypeLabels: Record<string, { label: string; className: string }> = {
  grammar: { label: 'Grammar', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300' },
  spelling: { label: 'Spelling', className: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
  word_choice: { label: 'Word choice', className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300' },
  word_order: { label: 'Word order', className: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
  missing_word: { label: 'Missing word', className: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300' },
  extra_word: { label: 'Extra word', className: 'bg-zinc-100 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-300' },
};

function CorrectionBadge({ type }: { type: string }) {
  const info = correctionTypeLabels[type] || { label: type, className: 'bg-zinc-100 text-zinc-600' };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${info.className}`}>
      {info.label}
    </span>
  );
}

// ── Correction diff view ────────────────────────────────────────────────────

function CorrectionView({ entry }: { entry: JournalEntry }) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const corrections = entry.corrections || [];

  return (
    <div className="space-y-6">
      {/* Original with corrections summary */}
      <div>
        <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Your text</h3>
        <div className="rounded-lg bg-zinc-50 dark:bg-zinc-900 p-4 text-sm leading-relaxed whitespace-pre-wrap">
          {entry.body}
        </div>
      </div>

      {/* Corrected version */}
      {entry.correctedBody && entry.correctedBody !== entry.body && (
        <div>
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Corrected</h3>
          <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {entry.correctedBody}
          </div>
        </div>
      )}

      {/* Corrections list */}
      {corrections.length > 0 ? (
        <div>
          <h3 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">
            {corrections.length} correction{corrections.length !== 1 ? 's' : ''}
          </h3>
          <div className="space-y-2">
            {corrections.map((c, i) => (
              <button
                key={i}
                onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                className="w-full text-left rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <CorrectionBadge type={c.type} />
                  <span className="text-sm">
                    <span className="line-through text-red-600 dark:text-red-400">{c.original}</span>
                    {' → '}
                    <span className="font-medium text-green-700 dark:text-green-400">{c.corrected}</span>
                  </span>
                </div>
                {expandedIdx === i && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-2">{c.explanation}</p>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 p-4 text-center">
          <p className="text-green-800 dark:text-green-300 font-medium">Perfek! No corrections needed.</p>
        </div>
      )}
    </div>
  );
}

// ── History entry card ──────────────────────────────────────────────────────

function HistoryCard({
  entry,
  onSelect,
  onDelete,
}: {
  entry: JournalEntry;
  onSelect: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
}) {
  const preview = entry.body.length > 120 ? entry.body.slice(0, 120) + '…' : entry.body;
  const correctionCount = entry.corrections?.length ?? 0;

  return (
    <div
      onClick={() => onSelect(entry)}
      className="cursor-pointer rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          {formatDate(entry.entryDate)}
        </span>
        <div className="flex items-center gap-2">
          {entry.status === 'submitted' ? (
            <span className="rounded-full bg-green-100 dark:bg-green-900/40 px-2 py-0.5 text-xs font-medium text-green-800 dark:text-green-300">
              Corrected{correctionCount > 0 ? ` (${correctionCount})` : ''}
            </span>
          ) : (
            <span className="rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
              Draft
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
            className="text-zinc-400 hover:text-red-500 transition-colors"
            title="Delete entry"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-2">{preview}</p>
      <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">{entry.wordCount} words</p>
    </div>
  );
}

// ── Detail modal ────────────────────────────────────────────────────────────

function EntryModal({ entry, onClose }: { entry: JournalEntry; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {formatDate(entry.entryDate)}
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {entry.status === 'submitted' ? (
          <CorrectionView entry={entry} />
        ) : (
          <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-4 text-sm leading-relaxed whitespace-pre-wrap">
            {entry.body}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function JournalPage() {
  const [todayEntry, setTodayEntry] = useState<JournalEntry | null>(null);
  const [bodyText, setBodyText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryIdRef = useRef<string | null>(null);

  const today = getTodayDate();

  // Load today's entry and history
  useEffect(() => {
    getJournalEntryByDate(today).then((entry) => {
      if (entry) {
        setTodayEntry(entry);
        setBodyText(entry.body);
        entryIdRef.current = entry.id;
      }
    });
    getJournalEntries(50).then(setEntries);
  }, [today]);

  // Auto-save debounce
  const debouncedSave = useCallback(async (text: string) => {
    if (!text.trim()) return;
    try {
      if (entryIdRef.current && todayEntry?.status === 'draft') {
        await updateJournalDraft(entryIdRef.current, text);
      } else if (!entryIdRef.current) {
        const result = await saveJournalDraft(text, today);
        entryIdRef.current = result.id;
      }
      setSaveStatus('Draft saved');
      setTimeout(() => setSaveStatus(null), 2000);
    } catch {
      // silent — explicit save still available
    }
  }, [today, todayEntry?.status]);

  const handleBodyChange = (text: string) => {
    setBodyText(text);
    if (todayEntry?.status === 'submitted') return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => debouncedSave(text), 3000);
  };

  const handleSaveDraft = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setIsSaving(true);
    setError(null);
    try {
      if (entryIdRef.current) {
        await updateJournalDraft(entryIdRef.current, bodyText);
      } else {
        const result = await saveJournalDraft(bodyText, today);
        entryIdRef.current = result.id;
      }
      const updated = await getJournalEntryByDate(today);
      if (updated) setTodayEntry(updated);
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
      // Ensure draft is saved first
      if (!entryIdRef.current) {
        const result = await saveJournalDraft(bodyText, today);
        entryIdRef.current = result.id;
      } else {
        await updateJournalDraft(entryIdRef.current, bodyText);
      }

      await submitJournalForCorrection(entryIdRef.current);
      const updated = await getJournalEntryByDate(today);
      if (updated) setTodayEntry(updated);
      // Refresh history
      getJournalEntries(50).then(setEntries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Correction failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this journal entry?')) return;
    await deleteJournalEntry(id);
    if (entryIdRef.current === id) {
      setTodayEntry(null);
      setBodyText('');
      entryIdRef.current = null;
    }
    setEntries((prev) => prev.filter((e) => e.id !== id));
  };

  const wordCount = bodyText.trim().split(/\s+/).filter(Boolean).length;
  const isToday = todayEntry?.status === 'submitted';
  // History excludes today's entry
  const historyEntries = entries.filter((e) => e.entryDate !== today);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
      <NavHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8 pb-24 sm:pb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50 mb-6">Journal</h1>

        {/* Today's entry */}
        <section className="mb-10">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">
            {formatDate(today)}
          </h2>

          {isToday && todayEntry ? (
            <CorrectionView entry={todayEntry} />
          ) : (
            <div className="space-y-3">
              <textarea
                value={bodyText}
                onChange={(e) => handleBodyChange(e.target.value)}
                placeholder="Skryf vandag se joernaal inskrywing in Afrikaans..."
                className="w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y min-h-[160px]"
                disabled={isSubmitting}
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
          )}

          {error && (
            <div className="mt-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 p-3 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </section>

        {/* History */}
        {historyEntries.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-3">Past entries</h2>
            <div className="space-y-2">
              {historyEntries.map((entry) => (
                <HistoryCard
                  key={entry.id}
                  entry={entry}
                  onSelect={setSelectedEntry}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </section>
        )}

        {/* Detail modal */}
        {selectedEntry && (
          <EntryModal entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
        )}
      </main>
    </div>
  );
}

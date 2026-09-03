'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import {
  type JournalEntry,
  type JournalWordStats,
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntries,
  getJournalWordStats,
  saveJournalEntry,
  submitJournalForCorrection,
  updateJournalDraft,
  updateJournalRevision,
} from '@/lib/data-layer';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import { useActiveLanguage } from '@/utils/hooks';
import { countTypedWords } from '@/lib/languages';
import CritiquePanel from './components/CritiquePanel';
import CorrectionView from './components/CorrectionView';
import EntrySidebar from './components/EntrySidebar';
import NotebookPage, { type JournalFace } from './components/NotebookPage';
import RevisionPanel from './components/RevisionPanel';
import WordCountBar from './components/WordCountBar';

const EMPTY_STATS: JournalWordStats = { month: 0, year: 0, lifetime: 0 };

function todayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function pageTitle(body: string, composing: boolean): string {
  if (composing && !body.trim()) return 'New page';
  const firstLine = body.split('\n').find((line) => line.trim()) ?? '';
  if (!firstLine) return 'Journal page';
  return firstLine.length > 42 ? `${firstLine.slice(0, 42)}…` : firstLine;
}

function facesFor(entry: JournalEntry | null, composing: boolean): JournalFace[] {
  if (composing || !entry || entry.status === 'draft') return ['writing'];
  if (entry.corrections === null) return ['writing'];
  return ['writing', 'corrections', 'critique', 'revision'];
}

export default function JournalPage() {
  const activeLang = useActiveLanguage();
  const [bodyText, setBodyText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isSavingRevision, setIsSavingRevision] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [revisionStatus, setRevisionStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [wordStats, setWordStats] = useState<JournalWordStats>(EMPTY_STATS);
  const [activeId, setActiveId] = useState<string | 'new' | null>('new');
  const [face, setFace] = useState<JournalFace>('writing');
  const [revisionText, setRevisionText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const composing = activeId === 'new' || (activeId !== null && editingId === activeId);
  const selected = entries.find((entry) => entry.id === activeId) ?? null;
  const selectedIndex = selected ? entries.findIndex((entry) => entry.id === selected.id) : -1;
  const faces = facesFor(selected, composing && activeId === 'new');
  const wordCount = countTypedWords(bodyText, activeLang);
  const entryDate = selected?.entryDate ?? todayKey();
  const title = pageTitle(composing ? bodyText : (selected?.body ?? ''), composing);

  const refresh = async () => {
    const [nextEntries, nextStats] = await Promise.all([
      getJournalEntries(200),
      getJournalWordStats(),
    ]);
    setEntries(nextEntries);
    setWordStats(nextStats);
    return nextEntries;
  };

  useEffect(() => {
    void (async () => {
      const nextEntries = await refresh();
      if (nextEntries.length > 0) {
        const first = nextEntries[0];
        setActiveId(first.id);
        if (first.status === 'draft') {
          setBodyText(first.body);
          setEditingId(first.id);
        } else {
          setBodyText('');
          setEditingId(null);
          setRevisionText(first.revision ?? '');
        }
        setFace('writing');
      }
    })();
  }, []);

  const pageNav = useRef({ goOlder: () => {}, goNewer: () => {} });

  const flash = (setter: (value: string | null) => void, message: string) => {
    setter(message);
    setTimeout(() => setter(null), 2000);
  };

  const handleNewEntry = () => {
    setBodyText('');
    setEditingId(null);
    setActiveId('new');
    setFace('writing');
    setError(null);
    setRevisionText('');
  };

  const openEntry = (entry: JournalEntry) => {
    setActiveId(entry.id);
    setFace('writing');
    setError(null);
    if (entry.status === 'draft') {
      setBodyText(entry.body);
      setEditingId(entry.id);
      setRevisionText('');
    } else {
      setBodyText('');
      setEditingId(null);
      setRevisionText(entry.revision ?? '');
    }
  };

  const handleBodyChange = (text: string) => {
    setBodyText(text);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    if (editingId && text.trim()) {
      autoSaveTimer.current = setTimeout(async () => {
        try {
          const res = await updateJournalDraft(editingId, text);
          if (!res.ok) return;
          flash(setSaveStatus, 'Draft saved');
        } catch {
          /* silent */
        }
      }, 3000);
    }
  };

  const persistDraft = async (): Promise<string | null> => {
    if (editingId) {
      const res = await updateJournalDraft(editingId, bodyText);
      if (!res.ok) {
        if (res.status !== 429) setError('Failed to save');
        return null;
      }
      return editingId;
    }
    const res = await createJournalEntry(bodyText);
    if (!res.ok) {
      if (res.status !== 429) setError('Failed to save');
      return null;
    }
    const result = (await res.json()) as { id: string };
    setEditingId(result.id);
    return result.id;
  };

  const handleSaveDraft = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setIsSaving(true);
    setError(null);
    try {
      const id = await persistDraft();
      if (!id) return;
      await refresh();
      setActiveId(id);
      flash(setSaveStatus, 'Draft saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setIsSavingEntry(true);
    setError(null);
    try {
      let id = editingId;
      if (!id) {
        const created = await createJournalEntry(bodyText);
        if (!created.ok) {
          if (created.status !== 429) setError('Failed to save');
          return;
        }
        id = ((await created.json()) as { id: string }).id;
        setEditingId(id);
      }
      const res = await saveJournalEntry(id, bodyText);
      if (!res.ok) {
        if (res.status !== 429) setError('Failed to save');
        return;
      }
      const next = await refresh();
      const saved = next.find((entry) => entry.id === id);
      setEditingId(null);
      setActiveId(id);
      setFace('writing');
      if (saved) setRevisionText(saved.revision ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingEntry(false);
    }
  };

  const handleCorrect = async () => {
    if (!selected) return;
    setIsCorrecting(true);
    setError(null);
    try {
      const result = await submitJournalForCorrection(selected.id);
      const next = await refresh();
      const fromServer = next.find((entry) => entry.id === selected.id);
      const updated =
        fromServer && fromServer.corrections !== null
          ? fromServer
          : {
              ...(fromServer ?? selected),
              status: 'submitted' as const,
              correctedBody: result.correctedBody,
              corrections: result.corrections,
              critique: result.critique,
            };
      setEntries((prev) => prev.map((entry) => (entry.id === selected.id ? updated : entry)));
      setRevisionText(updated.revision ?? '');
      setFace(updated.corrections ? 'corrections' : 'writing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Correction failed');
    } finally {
      setIsCorrecting(false);
    }
  };

  const handleSaveRevision = async () => {
    if (!selected) return;
    setIsSavingRevision(true);
    setError(null);
    try {
      const res = await updateJournalRevision(selected.id, revisionText);
      if (!res.ok) {
        if (res.status !== 429) setError('Failed to save');
        return;
      }
      await refresh();
      flash(setRevisionStatus, 'Revision saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingRevision(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this journal entry?')) return;
    try {
      await deleteJournalEntry(id);
      const next = await refresh();
      if (activeId === id || editingId === id) {
        if (next[0]) openEntry(next[0]);
        else handleNewEntry();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete journal entry');
    }
  };

  const goOlder = () => {
    if (activeId === 'new') {
      if (entries[0]) openEntry(entries[0]);
      return;
    }
    if (selectedIndex >= 0 && selectedIndex < entries.length - 1) {
      openEntry(entries[selectedIndex + 1]);
    }
  };

  const goNewer = () => {
    if (activeId === 'new') return;
    if (selectedIndex > 0) openEntry(entries[selectedIndex - 1]);
  };

  pageNav.current = { goOlder, goNewer };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        pageNav.current.goOlder();
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        pageNav.current.goNewer();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const canPrev =
    activeId === 'new'
      ? entries.length > 0
      : selectedIndex >= 0 && selectedIndex < entries.length - 1;
  const canNext = activeId !== 'new' && selectedIndex > 0;

  const showEditor = activeId === 'new' || (selected !== null && selected.status === 'draft');
  const showUncorrected =
    selected !== null && selected.status === 'submitted' && selected.corrections === null;
  const currentFace = faces.includes(face) ? face : 'writing';

  return (
    <main className="mx-auto flex h-full max-w-5xl flex-col px-4 py-8 pb-24 sm:px-6 sm:pb-8 lg:px-8">
      <PageHeader title="Journal">
        <Button onClick={handleNewEntry}>
          <Plus className="h-4 w-4" />
          New Entry
        </Button>
      </PageHeader>
      <div className="mb-5">
        <WordCountBar stats={wordStats} />
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        <EntrySidebar
          entries={entries}
          activeId={typeof activeId === 'string' && activeId !== 'new' ? activeId : null}
          composing={activeId === 'new'}
          onSelect={openEntry}
          onDelete={handleDelete}
        />

        <NotebookPage
          title={title}
          entryDate={entryDate}
          faces={faces}
          face={currentFace}
          onFaceChange={setFace}
          canPrev={canPrev}
          canNext={canNext}
          onPrev={goOlder}
          onNext={goNewer}
        >
          {showEditor && currentFace === 'writing' && (
            <div className="flex h-full min-h-[24rem] flex-col">
              <textarea
                value={bodyText}
                onChange={(event) => handleBodyChange(event.target.value)}
                placeholder={`Write today's journal entry in ${activeLang.native}...`}
                className="min-h-[20rem] flex-1 resize-none bg-transparent px-5 py-1 font-reading text-base leading-8 text-foreground placeholder:text-muted-foreground focus:outline-none"
                disabled={isSavingEntry}
                autoFocus
              />
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {wordCount} word{wordCount === 1 ? '' : 's'}
                  </span>
                  {saveStatus && <span className="text-primary">{saveStatus}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={handleSaveDraft}
                    disabled={isSaving || isSavingEntry || !bodyText.trim()}
                    variant="secondary"
                  >
                    {isSaving ? 'Saving...' : 'Save Draft'}
                  </Button>
                  <Button onClick={handleSave} disabled={isSavingEntry || !bodyText.trim()}>
                    {isSavingEntry && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSavingEntry ? 'Saving...' : 'Save'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {showUncorrected && currentFace === 'writing' && selected && (
            <div className="flex h-full min-h-[24rem] flex-col">
              <div className="flex-1 px-5 py-1 font-reading text-base leading-8 whitespace-pre-wrap">
                {selected.body}
              </div>
              <div className="flex items-center justify-between gap-3 px-5 py-3">
                <span className="text-xs text-muted-foreground">
                  Saved. Correction is optional.
                </span>
                <Button onClick={handleCorrect} disabled={isCorrecting}>
                  {isCorrecting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {isCorrecting ? 'Correcting...' : 'Get AI correction'}
                </Button>
              </div>
            </div>
          )}

          {!showEditor && !showUncorrected && selected && currentFace === 'writing' && (
            <div className="px-5 py-1 font-reading text-base leading-8 whitespace-pre-wrap">
              {selected.body}
            </div>
          )}

          {selected && currentFace === 'corrections' && <CorrectionView entry={selected} />}
          {selected && currentFace === 'critique' && <CritiquePanel critique={selected.critique} />}
          {selected && currentFace === 'revision' && (
            <RevisionPanel
              entry={selected}
              value={revisionText}
              onChange={setRevisionText}
              onSave={handleSaveRevision}
              isSaving={isSavingRevision}
              saveStatus={revisionStatus}
            />
          )}
        </NotebookPage>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-destructive bg-[color-mix(in_srgb,var(--destructive)_12%,var(--card))] p-3 text-sm text-destructive">
          {error}
        </div>
      )}
    </main>
  );
}

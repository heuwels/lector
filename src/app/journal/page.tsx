'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Loader2, Plus, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import {
  type JournalEntry,
  createJournalEntry,
  deleteJournalEntry,
  getJournalEntries,
  saveJournalEntry,
  submitJournalForCorrection,
  updateJournalDraft,
  updateJournalRevision,
} from '@/lib/data-layer';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import { useActiveLanguage } from '@/utils/hooks';
import { countTypedWords } from '@/lib/languages';
import { dateStringInTimeZone } from '@/lib/dates';
import { entryLabel, firstLine } from './utils';
import CritiquePanel from './components/CritiquePanel';
import CorrectionView from './components/CorrectionView';
import EntrySidebar from './components/EntrySidebar';
import NotebookPage, { type JournalFace } from './components/NotebookPage';
import RevisionPanel from './components/RevisionPanel';

function todayKey(): string {
  return dateStringInTimeZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
}

type DraftState = 'idle' | 'dirty' | 'saving' | 'saved';

/** One draft write, bound to the page it was typed on. */
interface PendingSave {
  text: string;
  title: string;
  session: number;
  /** The entry the page already edits, or null for a page not yet on the server. */
  entryId: string | null;
}

function DraftIndicator({ state }: { state: DraftState }) {
  if (state === 'idle') return null;
  if (state === 'saving') return <span>Saving…</span>;
  if (state === 'saved') return <span className="text-primary">Draft saved</span>;
  return <span>Unsaved changes</span>;
}

/** The header text when the learner has not written a title. */
function fallbackTitle(body: string, composing: boolean): string {
  const line = firstLine(body);
  if (line) return line;
  return composing ? 'New page' : 'Journal page';
}

function facesFor(entry: JournalEntry | null, composing: boolean): JournalFace[] {
  if (composing || !entry || entry.status === 'draft') return ['writing'];
  if (entry.corrections === null) return ['writing'];
  return ['writing', 'corrections', 'critique', 'revision'];
}

export default function JournalPage() {
  const activeLang = useActiveLanguage();
  const [bodyText, setBodyText] = useState('');
  const [titleText, setTitleText] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSavingEntry, setIsSavingEntry] = useState(false);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [isSavingRevision, setIsSavingRevision] = useState(false);
  const [draftState, setDraftState] = useState<DraftState>('idle');
  const [revisionStatus, setRevisionStatus] = useState<string | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [activeId, setActiveId] = useState<string | 'new' | null>('new');
  const [face, setFace] = useState<JournalFace>('writing');
  const [revisionText, setRevisionText] = useState('');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors `editingId` for async work, which must not read a stale closure.
  const editingIdRef = useRef<string | null>(null);
  // Which page the learner is composing. Bumps whenever the editor moves to a
  // different page, so a save that finishes late cannot attach its entry to the
  // page that is open now.
  const pageSession = useRef(0);
  // One in-flight create per page, so autosave and Finish never make two entries.
  const pendingCreate = useRef<{ session: number; promise: Promise<string | null> } | null>(null);
  // The autosave that is waiting on its timer, so it can run early on demand.
  const pendingSave = useRef<PendingSave | null>(null);
  // Bumps on every keystroke so a slow save cannot report a newer draft as saved.
  const editSeq = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const setEditing = (id: string | null) => {
    editingIdRef.current = id;
    setEditingId(id);
  };

  const composing = activeId === 'new' || (activeId !== null && editingId === activeId);
  const selected = entries.find((entry) => entry.id === activeId) ?? null;
  const selectedIndex = selected ? entries.findIndex((entry) => entry.id === selected.id) : -1;
  const faces = facesFor(selected, composing && activeId === 'new');
  const wordCount = countTypedWords(bodyText, activeLang);
  const entryDate = selected?.entryDate ?? todayKey();
  const titlePlaceholder = fallbackTitle(bodyText, true);
  const title = composing
    ? titleText
    : selected
      ? entryLabel(selected) || fallbackTitle(selected.body, false)
      : 'Journal page';

  const refresh = async () => {
    const nextEntries = await getJournalEntries(200);
    setEntries(nextEntries);
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
          setTitleText(first.title ?? '');
          setEditing(first.id);
        } else {
          setBodyText('');
          setTitleText('');
          setEditing(null);
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
    void flushAutoSave();
    pageSession.current += 1;
    setBodyText('');
    setTitleText('');
    setEditing(null);
    setDraftState('idle');
    setActiveId('new');
    setFace('writing');
    setRevisionText('');
  };

  const openEntry = (entry: JournalEntry) => {
    if (entry.id !== editingIdRef.current) {
      void flushAutoSave();
      pageSession.current += 1;
    }
    setActiveId(entry.id);
    setFace('writing');
    setDraftState('idle');
    if (entry.status === 'draft') {
      setBodyText(entry.body);
      setTitleText(entry.title ?? '');
      setEditing(entry.id);
      setRevisionText('');
    } else {
      setBodyText('');
      setTitleText('');
      setEditing(null);
      setRevisionText(entry.revision ?? '');
    }
  };

  /**
   * The row on the server for the page in `session`: the entry it already
   * edits, or one new entry created once. Returns null when the server
   * refuses (plan limit or failure). A create that lands after the learner has
   * moved to another page still returns its id, but does not become the
   * editor's entry.
   */
  const ensureEntry = async (save: PendingSave): Promise<string | null> => {
    if (save.entryId) return save.entryId;
    if (pendingCreate.current?.session === save.session) return pendingCreate.current.promise;
    const promise = (async () => {
      try {
        const res = await createJournalEntry(save.text, save.title);
        if (!res.ok) {
          if (res.status !== 429) toast.error('Failed to save');
          return null;
        }
        const { id } = (await res.json()) as { id: string };
        // Only the ref for now: later keystrokes must update this row, but the
        // editor must not switch to it before the list refresh includes it, or
        // the textarea unmounts for a frame and drops the caret.
        if (pageSession.current === save.session) editingIdRef.current = id;
        return id;
      } finally {
        if (pendingCreate.current?.session === save.session) pendingCreate.current = null;
      }
    })();
    pendingCreate.current = { session: save.session, promise };
    return promise;
  };

  /** Write the draft now. Creates the entry on the first save of a new page. */
  const saveDraft = async (save: PendingSave) => {
    const seq = editSeq.current;
    const current = () => pageSession.current === save.session;
    if (current()) setDraftState('saving');
    try {
      const id = await ensureEntry(save);
      if (!id) {
        if (current()) setDraftState('dirty');
        return;
      }
      if (save.entryId) {
        const res = await updateJournalDraft(id, save.text, save.title);
        if (!res.ok) {
          if (current()) setDraftState('dirty');
          return;
        }
      }
      await refresh();
      if (current()) {
        // A new page becomes a draft on the timeline once it exists on the server.
        setEditingId(id);
        setActiveId((active) => (active === 'new' ? id : active));
        if (editSeq.current === seq) setDraftState('saved');
      }
    } catch {
      if (current()) setDraftState('dirty');
    }
  };

  // Autosave a draft three seconds after the last keystroke in either field.
  const scheduleAutoSave = (text: string, title: string) => {
    editSeq.current += 1;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = null;
    pendingSave.current = null;
    if (!text.trim()) return;
    setDraftState('dirty');
    const save: PendingSave = {
      text,
      title,
      session: pageSession.current,
      entryId: editingIdRef.current,
    };
    pendingSave.current = save;
    autoSaveTimer.current = setTimeout(() => {
      autoSaveTimer.current = null;
      pendingSave.current = null;
      void saveDraft(save);
    }, 3000);
  };

  /** Run a pending autosave now, for example before the learner leaves the page. */
  const flushAutoSave = async () => {
    const save = pendingSave.current;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = null;
    pendingSave.current = null;
    if (save) await saveDraft(save);
  };

  const handleBodyChange = (text: string) => {
    setBodyText(text);
    scheduleAutoSave(text, titleText);
  };

  const handleTitleChange = (text: string) => {
    setTitleText(text);
    scheduleAutoSave(bodyText, text);
  };

  /** Create if needed, then finish the page. Returns the id, or null on failure. */
  const saveEntry = async (): Promise<string | null> => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = null;
    pendingSave.current = null;
    const id = await ensureEntry({
      text: bodyText,
      title: titleText,
      session: pageSession.current,
      entryId: editingIdRef.current,
    });
    if (!id) return null;
    const res = await saveJournalEntry(id, bodyText, titleText);
    if (!res.ok) {
      if (res.status !== 429) toast.error('Failed to save');
      return null;
    }
    const next = await refresh();
    const saved = next.find((entry) => entry.id === id);
    // The page is finished: a late autosave for it must not touch the editor.
    pageSession.current += 1;
    setEditing(null);
    setDraftState('idle');
    setActiveId(id);
    setFace('writing');
    if (saved) setRevisionText(saved.revision ?? '');
    return id;
  };

  const handleSave = async () => {
    setIsSavingEntry(true);
    try {
      await saveEntry();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingEntry(false);
    }
  };

  /** Ask the model for a correction of a saved entry and open the corrections face. */
  const correctEntry = async (id: string) => {
    setIsCorrecting(true);
    try {
      const result = await submitJournalForCorrection(id);
      const next = await refresh();
      const fromServer = next.find((entry) => entry.id === id);
      const fallback = fromServer ?? entries.find((entry) => entry.id === id);
      if (!fallback) return;
      const updated =
        fromServer && fromServer.corrections !== null
          ? fromServer
          : {
              ...fallback,
              status: 'submitted' as const,
              correctedBody: result.correctedBody,
              corrections: result.corrections,
              critique: result.critique,
            };
      setEntries((prev) => prev.map((entry) => (entry.id === id ? updated : entry)));
      setRevisionText(updated.revision ?? '');
      setFace(updated.corrections ? 'corrections' : 'writing');
    } catch (err) {
      if ((err as { status?: number }).status !== 429) {
        toast.error(err instanceof Error ? err.message : 'Correction failed');
      }
    } finally {
      setIsCorrecting(false);
    }
  };

  const handleCorrect = async () => {
    if (selected) await correctEntry(selected.id);
  };

  /** Save the page, then send it straight for correction. */
  const handleSaveAndCorrect = async () => {
    setIsSavingEntry(true);
    let id: string | null = null;
    try {
      id = await saveEntry();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSavingEntry(false);
    }
    if (id) await correctEntry(id);
  };

  const handleSaveRevision = async () => {
    if (!selected) return;
    setIsSavingRevision(true);
    try {
      const res = await updateJournalRevision(selected.id, revisionText);
      if (!res.ok) {
        if (res.status !== 429) toast.error('Failed to save');
        return;
      }
      await refresh();
      flash(setRevisionStatus, 'Revision saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
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
      toast.error(err instanceof Error ? err.message : 'Could not delete journal entry');
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

  // Grow the textarea with its text so the whole page scrolls, never the
  // textarea alone. A textarea that scrolls inside itself slides the words
  // off the ruled lines behind it.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.minHeight = '0px';
    el.style.minHeight = `${el.scrollHeight}px`;
  }, [bodyText, showEditor, currentFace]);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col px-4 py-8 pb-24 sm:px-6 sm:pb-8 md:h-dvh lg:px-8">
      <PageHeader title="Journal">
        <Button onClick={handleNewEntry}>
          <Plus className="h-4 w-4" />
          New Entry
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:items-stretch">
        <EntrySidebar
          entries={entries}
          activeId={typeof activeId === 'string' && activeId !== 'new' ? activeId : null}
          composing={activeId === 'new'}
          onSelect={openEntry}
          onDelete={handleDelete}
        />

        <NotebookPage
          title={title}
          titlePlaceholder={titlePlaceholder}
          onTitleChange={composing ? handleTitleChange : undefined}
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
                ref={textareaRef}
                value={bodyText}
                onChange={(event) => handleBodyChange(event.target.value)}
                placeholder={`Write today's journal entry in ${activeLang.native}...`}
                className="flex-1 resize-none overflow-hidden bg-transparent px-5 py-1 font-reading text-base leading-8 text-foreground placeholder:text-muted-foreground focus:outline-none"
                disabled={isSavingEntry || isCorrecting}
                autoFocus
              />
              <div className="journal-actions sticky bottom-16 z-10 -ml-12 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--lip)] bg-card py-3 pr-5 pl-[4.25rem] sm:-ml-16 sm:pl-[5.25rem] md:bottom-0">
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>
                    {wordCount} word{wordCount === 1 ? '' : 's'}
                  </span>
                  <DraftIndicator state={draftState} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    onClick={handleSave}
                    disabled={isSavingEntry || isCorrecting || !bodyText.trim()}
                    variant="secondary"
                  >
                    {isSavingEntry && !isCorrecting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isSavingEntry && !isCorrecting ? 'Finishing...' : 'Finish page'}
                  </Button>
                  <Button
                    onClick={handleSaveAndCorrect}
                    disabled={isSavingEntry || isCorrecting || !bodyText.trim()}
                  >
                    {isCorrecting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {isCorrecting ? 'Correcting...' : 'Finish & get correction'}
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
              <div className="journal-actions sticky bottom-16 z-10 -ml-12 flex items-center justify-between gap-3 border-t border-[var(--lip)] bg-card py-3 pr-5 pl-[4.25rem] sm:-ml-16 sm:pl-[5.25rem] md:bottom-0">
                <span className="text-xs text-muted-foreground">
                  Finished. Correction is optional.
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
    </main>
  );
}

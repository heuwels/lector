'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, ChevronDown, Folder, Plus, Sparkles } from 'lucide-react';
import { ReadingSweep } from '@/components/Loaders';
import AddCollectionTile from './components/AddCollectionTile';
import EmptyState from './components/EmptyState';
import GroupMenu from './components/GroupMenu';
import SortableCollectionCard from './components/SortableCollectionCard';
import CollectionCard from '@/components/CollectionCard';
import ImportDropdown from '@/components/ImportDropdown';
import WebImportModal from '@/components/WebImportModal';
import YouTubeImportModal from '@/components/YouTubeImportModal';
import PasteImportModal from '@/components/PasteImportModal';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import {
  getActiveLanguage,
  getAllCollections,
  getAllGroups,
  getStarterStatus,
  createCollection,
  createGroup,
  updateGroup,
  deleteGroup,
  reorderCollections,
  createStandaloneLesson,
  importEpub,
  importAudio,
  seedStarterContent,
  type Collection,
  type CollectionGroup,
} from '@/lib/data-layer';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import { getOnboardingSnapshot, type OnboardingSnapshot } from '@/lib/onboarding';
import { toast } from 'sonner';

export default function Home() {
  const router = useRouter();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isWebImportOpen, setIsWebImportOpen] = useState(false);
  const [isYouTubeImportOpen, setIsYouTubeImportOpen] = useState(false);
  const [isPasteImportOpen, setIsPasteImportOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [newCollectionTitle, setNewCollectionTitle] = useState('');
  const [starterAvailable, setStarterAvailable] = useState(false);
  const [isAddingStarter, setIsAddingStarter] = useState(false);
  const [onboarding, setOnboarding] = useState<OnboardingSnapshot | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    loadData();
  }, []);

  // Restore collapsed-group state client-side (avoids SSR/hydration mismatch).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('lector-collapsed-groups');
      if (raw) setCollapsedGroups(new Set(JSON.parse(raw) as string[]));
    } catch {
      // ignore malformed storage
    }
  }, []);

  function toggleGroup(groupId: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        localStorage.setItem('lector-collapsed-groups', JSON.stringify([...next]));
      } catch {
        // ignore storage failure
      }
      return next;
    });
  }

  async function loadData() {
    try {
      const [collectionsData, groupsData, onboardingData] = await Promise.all([
        getAllCollections(),
        getAllGroups(),
        getOnboardingSnapshot().catch(() => null),
      ]);

      setCollections(collectionsData);
      setGroups(groupsData);
      setOnboarding(onboardingData);

      // Empty-library CTA (#315): offer the starter pack to users who selected
      // this language before seeding existed. Seeded-once users (flag set)
      // don't get it re-offered after deleting the collection.
      if (collectionsData.length === 0) {
        const status = await getStarterStatus(getActiveLanguage());
        setStarterAvailable(status.available && !status.seeded);
      } else {
        setStarterAvailable(false);
      }
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleAddStarter() {
    setIsAddingStarter(true);
    try {
      const { seeded } = await seedStarterContent(getActiveLanguage());
      if (seeded) {
        setStarterAvailable(false);
        setCollections(await getAllCollections());
      }
    } finally {
      setIsAddingStarter(false);
    }
  }

  async function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleAudioImportClick() {
    audioInputRef.current?.click();
  }

  async function handleAudioFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    try {
      const imported = await importAudio(file);
      setCollections(await getAllCollections());
      const minutes = imported.audioDurationMs
        ? Math.max(1, Math.round(imported.audioDurationMs / 60000))
        : null;
      // Transcription runs in the background; give a rough local-Whisper time
      // estimate (cost only matters on a hosted fallback, where it's cents).
      toast.success(
        `"${imported.title}" uploaded — transcription started` +
          (minutes ? ` (~${minutes} min of audio; usually transcribes in a few minutes)` : ''),
      );
    } catch (error) {
      console.error('Error importing audio:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import audio file.');
    } finally {
      setIsImporting(false);
      if (audioInputRef.current) {
        audioInputRef.current.value = '';
      }
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();

    setIsImporting(true);

    try {
      if (ext === 'epub') {
        // EPUB — parse server-side into collection of lessons
        await importEpub(file);
        // Reload collections to get the new one
        const updated = await getAllCollections();
        setCollections(updated);
      } else if (ext === 'md' || ext === 'markdown') {
        // Markdown — create single-lesson collection
        const textContent = await file.text();
        const titleMatch = textContent.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.[^/.]+$/, '');

        await createStandaloneLesson({ title, author: 'Unknown Author', textContent });
        const updated = await getAllCollections();
        setCollections(updated);
      } else {
        alert('Please select an EPUB or Markdown file');
      }
    } catch (error) {
      console.error('Error importing file:', error);
      alert('Failed to import file. Please ensure it is a valid file.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handlePasteImportSave(article: {
    title: string;
    author: string;
    content: string;
  }) {
    await createStandaloneLesson({
      title: article.title,
      author: article.author,
      textContent: article.content,
    });
    const updated = await getAllCollections();
    setCollections(updated);
  }

  async function handleWebImportSave(article: { title: string; author: string; content: string }) {
    await createStandaloneLesson({
      title: article.title,
      author: article.author,
      textContent: article.content,
    });
    const updated = await getAllCollections();
    setCollections(updated);
  }

  async function handleCreateGroup() {
    if (!newGroupName.trim()) return;
    try {
      await createGroup(newGroupName.trim());
      setNewGroupName('');
      setIsCreatingGroup(false);
      const updated = await getAllGroups();
      setGroups(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create group');
    }
  }

  async function handleRenameGroup(id: string, currentName: string) {
    const name = prompt('Rename group:', currentName);
    if (name === null || !name.trim() || name.trim() === currentName) return;
    try {
      await updateGroup(id, { name: name.trim() });
      const updated = await getAllGroups();
      setGroups(updated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename group');
    }
  }

  async function handleDeleteGroup(id: string, name: string) {
    if (!confirm(`Delete group "${name}"? Collections in this group will become ungrouped.`))
      return;
    try {
      await deleteGroup(id);
      const [updatedGroups, updatedCollections] = await Promise.all([
        getAllGroups(),
        getAllCollections(),
      ]);
      setGroups(updatedGroups);
      setCollections(updatedCollections);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete group');
    }
  }

  async function handleAddCollectionToGroup(groupId: string) {
    const title = newCollectionTitle.trim();
    if (!title) return;
    await createCollection({ title, groupId });
    setNewCollectionTitle('');
    setAddingToGroupId(null);
    const updated = await getAllCollections();
    setCollections(updated);
  }

  // Reorder collections within a single group. The library buckets `collections`
  // by groupId in array order, so we splice the reordered bucket back into the
  // members' original slots and persist the new order optimistically.
  function handleCollectionDragEnd(groupId: string, event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const previous = collections;
    const bucket = previous.filter((c) => c.groupId === groupId);
    const oldIndex = bucket.findIndex((c) => c.id === active.id);
    const newIndex = bucket.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const newBucket = arrayMove(bucket, oldIndex, newIndex);
    let bucketIndex = 0;
    setCollections(previous.map((c) => (c.groupId === groupId ? newBucket[bucketIndex++] : c)));
    void reorderCollections(newBucket.map((c) => c.id)).catch((error) => {
      setCollections(previous);
      toast.error(error instanceof Error ? error.message : 'Could not reorder collections');
    });
  }

  // Group collections by groupId
  const groupedCollections = new Map<string, Collection[]>();
  const ungrouped: Collection[] = [];

  for (const c of collections) {
    if (c.groupId) {
      const list = groupedCollections.get(c.groupId) || [];
      list.push(c);
      groupedCollections.set(c.groupId, list);
    } else {
      ungrouped.push(c);
    }
  }

  // Groups are language-agnostic, but `collections` here is already scoped to the
  // active language. Show a group when it has a collection in this language, or
  // when it has no collections at all (a brand-new/emptied group — kept visible
  // so it can be populated). Hide groups whose collections all belong to other
  // languages. `collectionCount` is the group's total across all languages.
  const visibleGroups = groups.filter(
    (g) => (groupedCollections.get(g.id)?.length ?? 0) > 0 || (g.collectionCount ?? 0) === 0,
  );

  const hasGroups = visibleGroups.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title="Your Library">
        <div className="flex items-center space-x-2">
          {isCreatingGroup ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleCreateGroup();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Group name"
                autoFocus
                data-testid="new-group-input"
                className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
              />
              <Button type="submit" data-testid="new-group-submit">
                Add
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setIsCreatingGroup(false);
                  setNewGroupName('');
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button onClick={() => setIsCreatingGroup(true)} data-testid="new-group-btn">
              <Folder size="16" />
              New Group
            </Button>
          )}

          <ImportDropdown
            onFileImport={handleImportClick}
            onAudioImport={handleAudioImportClick}
            onUrlImport={() => setIsWebImportOpen(true)}
            onYouTubeImport={() => setIsYouTubeImportOpen(true)}
            onPasteImport={() => setIsPasteImportOpen(true)}
            isImporting={isImporting}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".epub,.md,.markdown"
            onChange={handleFileChange}
            data-testid="document-file-input"
            className="hidden"
          />
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/*,.mp3,.m4a,.m4b,.mp4,.wav,.ogg,.oga,.opus,.flac,.aac,.webm"
            onChange={handleAudioFileChange}
            data-testid="audio-file-input"
            className="hidden"
          />
        </div>
      </PageHeader>
      {onboarding?.progress?.status === 'in_progress' && (
        <section
          aria-labelledby="resume-guide-heading"
          data-testid="onboarding-resume"
          className="mb-6 flex flex-col gap-4 rounded-2xl border border-[var(--gold-lip)] bg-[var(--gold-soft)] p-5 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card text-[var(--gold-strong)]">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="resume-guide-heading" className="font-bold text-foreground">
                Continue your first learning loop
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {onboarding.progress.currentStep === 'practice'
                  ? 'Your three saved words are ready for a quick review.'
                  : `Resume ${onboarding.progress.recommendedLessonTitle || 'your starter lesson'} where you left off.`}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() =>
              router.push(
                onboarding.progress?.currentStep === 'practice'
                  ? '/practice?onboarding=1'
                  : `/read/${onboarding.progress?.recommendedLessonId}?onboarding=1`,
              )
            }
            disabled={
              onboarding.progress.currentStep !== 'practice' &&
              !onboarding.progress.recommendedLessonId
            }
            className="self-start sm:self-auto"
          >
            Resume
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </section>
      )}
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <ReadingSweep label="Loading library" />
        </div>
      ) : (
        <section>
          <WebImportModal
            isOpen={isWebImportOpen}
            onClose={() => setIsWebImportOpen(false)}
            onSave={handleWebImportSave}
          />
          <YouTubeImportModal
            isOpen={isYouTubeImportOpen}
            onClose={() => setIsYouTubeImportOpen(false)}
            onImported={({ lessonId }) => {
              setIsYouTubeImportOpen(false);
              router.push(`/read/${lessonId}`);
            }}
          />
          <PasteImportModal
            isOpen={isPasteImportOpen}
            onClose={() => setIsPasteImportOpen(false)}
            onSave={handlePasteImportSave}
          />

          {collections.length > 0 || hasGroups ? (
            <div className="space-y-10">
              {/* Grouped sections */}
              {visibleGroups.map((group) => {
                const items = groupedCollections.get(group.id) || [];
                const isCollapsed = collapsedGroups.has(group.id);
                return (
                  <div key={group.id} data-testid={`group-${group.id}`} className="panel p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <button
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                        data-testid={`group-toggle-${group.id}`}
                        className="-ml-1 flex items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-accent"
                      >
                        <ChevronDown
                          className={`h-4 w-4 text-muted-foreground transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        />
                        <h3 className="text-lg font-semibold text-foreground">{group.name}</h3>
                      </button>
                      <span className="text-sm text-muted-foreground">
                        {items.length} {items.length === 1 ? 'item' : 'items'}
                      </span>
                      <div className="flex-1" />
                      <GroupMenu
                        onRename={() => handleRenameGroup(group.id, group.name)}
                        onDelete={() => handleDeleteGroup(group.id, group.name)}
                      />
                    </div>
                    {!isCollapsed && (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) => handleCollectionDragEnd(group.id, e)}
                      >
                        <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                          <SortableContext
                            items={items.map((c) => c.id)}
                            strategy={rectSortingStrategy}
                          >
                            {items.map((collection) => (
                              <SortableCollectionCard key={collection.id} collection={collection} />
                            ))}
                          </SortableContext>
                          {addingToGroupId === group.id ? (
                            <AddCollectionTile
                              value={newCollectionTitle}
                              onChange={setNewCollectionTitle}
                              onSubmit={() => handleAddCollectionToGroup(group.id)}
                              onCancel={() => {
                                setAddingToGroupId(null);
                                setNewCollectionTitle('');
                              }}
                            />
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setAddingToGroupId(group.id);
                                setNewCollectionTitle('');
                              }}
                              data-testid={`add-collection-${group.id}`}
                              className="group flex min-h-[14rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground transition-all hover:bg-accent hover:text-foreground"
                            >
                              <Plus className="h-8 w-8" strokeWidth={1.5} />
                              <span className="text-sm font-medium">New collection</span>
                            </button>
                          )}
                        </div>
                      </DndContext>
                    )}
                  </div>
                );
              })}

              {/* Ungrouped */}
              {ungrouped.length > 0 && (
                <div data-testid="ungrouped-section" className="panel p-5">
                  {hasGroups && (
                    <h3 className="mb-4 text-lg font-semibold text-foreground">Ungrouped</h3>
                  )}
                  <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {ungrouped.map((collection) => (
                      <CollectionCard key={collection.id} collection={collection} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              onImport={handleImportClick}
              onAddStarter={starterAvailable ? handleAddStarter : undefined}
              isAddingStarter={isAddingStarter}
            />
          )}
        </section>
      )}
    </main>
  );
}

'use client';

import { useEffect, useState, useRef } from 'react';
import { ChevronDown, Folder, Plus } from 'lucide-react';
import AddCollectionTile from './components/AddCollectionTile';
import EmptyState from './components/EmptyState';
import GroupMenu from './components/GroupMenu';
import SortableCollectionCard from './components/SortableCollectionCard';
import CollectionCard from '@/components/CollectionCard';
import ImportDropdown from '@/components/ImportDropdown';
import WebImportModal from '@/components/WebImportModal';
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
  getAllCollections,
  getAllGroups,
  createCollection,
  createGroup,
  updateGroup,
  deleteGroup,
  reorderCollections,
  createStandaloneLesson,
  importEpub,
  type Collection,
  type CollectionGroup,
} from '@/lib/data-layer';
import { Button } from '@/components/ui/button';

export default function Home() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isWebImportOpen, setIsWebImportOpen] = useState(false);
  const [isPasteImportOpen, setIsPasteImportOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);
  const [newCollectionTitle, setNewCollectionTitle] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const [collectionsData, groupsData] = await Promise.all([
        getAllCollections(),
        getAllGroups(),
      ]);

      setCollections(collectionsData);
      setGroups(groupsData);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleImportClick() {
    fileInputRef.current?.click();
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
    await createGroup(newGroupName.trim());
    setNewGroupName('');
    setIsCreatingGroup(false);
    const updated = await getAllGroups();
    setGroups(updated);
  }

  async function handleRenameGroup(id: string, currentName: string) {
    const name = prompt('Rename group:', currentName);
    if (name === null || !name.trim() || name.trim() === currentName) return;
    await updateGroup(id, { name: name.trim() });
    const updated = await getAllGroups();
    setGroups(updated);
  }

  async function handleDeleteGroup(id: string, name: string) {
    if (!confirm(`Delete group "${name}"? Collections in this group will become ungrouped.`))
      return;
    await deleteGroup(id);
    const [updatedGroups, updatedCollections] = await Promise.all([
      getAllGroups(),
      getAllCollections(),
    ]);
    setGroups(updatedGroups);
    setCollections(updatedCollections);
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
    setCollections((prev) => {
      const bucket = prev.filter((c) => c.groupId === groupId);
      const oldIndex = bucket.findIndex((c) => c.id === active.id);
      const newIndex = bucket.findIndex((c) => c.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      const newBucket = arrayMove(bucket, oldIndex, newIndex);
      reorderCollections(newBucket.map((c) => c.id));
      let bi = 0;
      return prev.map((c) => (c.groupId === groupId ? newBucket[bi++] : c));
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

  const hasGroups = groups.length > 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
        </div>
      ) : (
        <section>
          <div className="mb-6 flex items-center gap-3">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Your Library</h2>
            <div className="flex-1" />

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
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-500"
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
              onUrlImport={() => setIsWebImportOpen(true)}
              onPasteImport={() => setIsPasteImportOpen(true)}
              isImporting={isImporting}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".epub,.md,.markdown"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <WebImportModal
            isOpen={isWebImportOpen}
            onClose={() => setIsWebImportOpen(false)}
            onSave={handleWebImportSave}
          />
          <PasteImportModal
            isOpen={isPasteImportOpen}
            onClose={() => setIsPasteImportOpen(false)}
            onSave={handlePasteImportSave}
          />

          {collections.length > 0 || hasGroups ? (
            <div className="space-y-10">
              {/* Grouped sections */}
              {groups.map((group) => {
                const items = groupedCollections.get(group.id) || [];
                const isCollapsed = collapsedGroups.has(group.id);
                return (
                  <div key={group.id} data-testid={`group-${group.id}`}>
                    <div className="mb-4 flex items-center gap-3">
                      <button
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? `Expand ${group.name}` : `Collapse ${group.name}`}
                        data-testid={`group-toggle-${group.id}`}
                        className="-ml-1 flex items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <ChevronDown
                          className={`h-4 w-4 text-zinc-400 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                        />
                        <h3 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                          {group.name}
                        </h3>
                      </button>
                      <span className="text-sm text-zinc-400 dark:text-zinc-500">
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
                              className="group flex min-h-[14rem] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 text-zinc-400 transition-all hover:border-zinc-400 hover:bg-white hover:text-zinc-600 dark:border-zinc-700 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:hover:text-zinc-300"
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
                <div data-testid="ungrouped-section">
                  {hasGroups && (
                    <h3 className="mb-4 text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                      Ungrouped
                    </h3>
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
            <EmptyState onImport={handleImportClick} />
          )}
        </section>
      )}
    </main>
  );
}

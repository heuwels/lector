'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, BookOpen } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ReadingSweep } from '@/components/Loaders';
import { useLectorMode } from '@/lib/use-env';
import { getActiveLanguage, getAllGroups, type CollectionGroup } from '@/lib/data-layer';
import {
  cloneCommunityItem,
  listCommunityItems,
  listMyCommunityItems,
  voteCommunityItem,
  type CommunityItem,
} from '@/lib/community';
import { toast } from 'sonner';

export default function CommunityPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
          <ReadingSweep label="Loading community library" />
        </main>
      }
    >
      <CommunityInner />
    </Suspense>
  );
}

function CommunityInner() {
  const mode = useLectorMode();
  const router = useRouter();
  const search = useSearchParams();
  const mineFirst = search.get('mine') === '1';
  const [tab, setTab] = useState<'catalog' | 'mine'>(mineFirst ? 'mine' : 'catalog');
  const [items, setItems] = useState<CommunityItem[]>([]);
  const [mine, setMine] = useState<CommunityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'score' | 'new'>('score');
  const [cloneItem, setCloneItem] = useState<CommunityItem | null>(null);

  useEffect(() => {
    if (mode !== 'cloud') {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const language = getActiveLanguage();
    void Promise.all([listCommunityItems(language, sort), listMyCommunityItems()])
      .then(([catalog, submissions]) => {
        if (cancelled) return;
        setItems(catalog);
        setMine(submissions);
      })
      .catch((error) => {
        if (!cancelled && error instanceof Error) {
          toast.error(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, sort]);

  if (mode === 'unknown') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <ReadingSweep label="Loading community library" />
      </main>
    );
  }

  if (mode !== 'cloud') {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <PageHeader title="Community" />
        <p className="text-sm text-muted-foreground" data-testid="community-cloud-only">
          The community library is a Cloud-only feature. Turn on Cloud mode to share collections
          with the people on this instance.
        </p>
      </main>
    );
  }

  const list = tab === 'mine' ? mine : items;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <PageHeader title="Community">
        <div className="flex gap-2">
          <Button
            variant={tab === 'catalog' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('catalog')}
            data-testid="community-tab-catalog"
          >
            Catalog
          </Button>
          <Button
            variant={tab === 'mine' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTab('mine')}
            data-testid="community-tab-mine"
          >
            My submissions
          </Button>
        </div>
      </PageHeader>

      {tab === 'catalog' && (
        <div className="mb-4 flex gap-2">
          <Button
            size="sm"
            variant={sort === 'score' ? 'default' : 'outline'}
            onClick={() => setSort('score')}
          >
            Score
          </Button>
          <Button
            size="sm"
            variant={sort === 'new' ? 'default' : 'outline'}
            onClick={() => setSort('new')}
          >
            New
          </Button>
        </div>
      )}

      {loading ? (
        <ReadingSweep label="Loading community library" />
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="community-empty">
          {tab === 'mine'
            ? 'You have not submitted a collection.'
            : 'No published items for this language.'}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {list.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-border bg-card p-4"
              data-testid={`community-item-${item.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <BookOpen className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-foreground">{item.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {item.author} · {item.lessonCount} lessons · {item.submitterLabel}
                  </p>
                  {tab === 'mine' && (
                    <p
                      className="mt-1 text-xs text-muted-foreground"
                      data-testid={`community-status-${item.id}`}
                    >
                      {item.status}
                      {item.rejectReason ? ` · ${item.rejectReason}` : ''}
                    </p>
                  )}
                </div>
              </div>
              {tab === 'catalog' && (
                <div className="mt-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-sm"
                      variant={item.viewerVote === 1 ? 'default' : 'outline'}
                      aria-label="Up-vote"
                      data-testid={`community-up-${item.id}`}
                      onClick={async () => {
                        try {
                          const next = await voteCommunityItem(
                            item.id,
                            item.viewerVote === 1 ? 0 : 1,
                          );
                          setItems((prev) =>
                            prev.map((row) =>
                              row.id === item.id
                                ? { ...row, score: next.score, viewerVote: next.viewerVote }
                                : row,
                            ),
                          );
                        } catch (error) {
                          if (error instanceof Error && error.message !== 'plan_limit') {
                            toast.error(error.message);
                          }
                        }
                      }}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <span
                      className="min-w-6 text-center text-sm"
                      data-testid={`community-score-${item.id}`}
                    >
                      {item.score}
                    </span>
                    <Button
                      size="icon-sm"
                      variant={item.viewerVote === -1 ? 'default' : 'outline'}
                      aria-label="Down-vote"
                      data-testid={`community-down-${item.id}`}
                      onClick={async () => {
                        try {
                          const next = await voteCommunityItem(
                            item.id,
                            item.viewerVote === -1 ? 0 : -1,
                          );
                          setItems((prev) =>
                            prev.map((row) =>
                              row.id === item.id
                                ? { ...row, score: next.score, viewerVote: next.viewerVote }
                                : row,
                            ),
                          );
                        } catch (error) {
                          if (error instanceof Error && error.message !== 'plan_limit') {
                            toast.error(error.message);
                          }
                        }
                      }}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setCloneItem(item)}
                    data-testid={`community-clone-${item.id}`}
                  >
                    {item.cloned ? 'In library' : 'Add to library'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {cloneItem && (
        <CloneDialog
          item={cloneItem}
          onClose={() => setCloneItem(null)}
          onCloned={(collectionId) => {
            setItems((prev) =>
              prev.map((row) => (row.id === cloneItem.id ? { ...row, cloned: true } : row)),
            );
            setCloneItem(null);
            router.push(`/collection/${collectionId}`);
          }}
        />
      )}
    </main>
  );
}

function CloneDialog({
  item,
  onClose,
  onCloned,
}: {
  item: CommunityItem;
  onClose: () => void;
  onCloned: (collectionId: string) => void;
}) {
  const [groups, setGroups] = useState<CollectionGroup[]>([]);
  const [groupId, setGroupId] = useState('__new__');
  const [newName, setNewName] = useState('Community');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void getAllGroups().then(setGroups);
  }, []);

  const mode = useMemo(
    () => (groupId === '__new__' || groups.length === 0 ? 'new' : 'existing'),
    [groupId, groups.length],
  );

  async function handleClone() {
    setPending(true);
    try {
      const result =
        mode === 'new'
          ? await cloneCommunityItem(item.id, { groupName: newName.trim() || 'Community' })
          : await cloneCommunityItem(item.id, { groupId });
      onCloned(result.collectionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not clone';
      if (message !== 'plan_limit') toast.error(message);
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-md p-6" data-testid="community-clone-dialog">
        <DialogTitle>Add to library</DialogTitle>
        <p className="mt-1 text-sm text-muted-foreground">{item.title}</p>
        {groups.length > 0 && (
          <label className="mt-4 block text-sm">
            Group
            <select
              className="mt-1 w-full rounded-md border border-border bg-background p-2"
              value={groupId}
              onChange={(event) => setGroupId(event.target.value)}
              data-testid="community-clone-group"
            >
              <option value="">Pick a group</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
              <option value="__new__">New group…</option>
            </select>
          </label>
        )}
        {(mode === 'new' || groups.length === 0) && (
          <label className="mt-3 block text-sm">
            New group name
            <input
              className="mt-1 w-full rounded-md border border-border bg-background p-2"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              data-testid="community-clone-group-name"
            />
          </label>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button
            onClick={handleClone}
            disabled={pending || (mode === 'existing' && !groupId)}
            data-testid="community-clone-confirm"
          >
            {pending ? 'Add…' : 'Add'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  approveCommunityItem,
  clearCommunityVotes,
  getAdminCommunityItem,
  listAdminCommunity,
  rejectCommunityItem,
  type CommunityAdminRow,
  type CommunityItemDetail,
} from '@/lib/community';

export default function CommunityQueue() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<CommunityAdminRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [preview, setPreview] = useState<CommunityItemDetail | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    const list = await listAdminCommunity(status);
    setRows(list);
  }, [status]);

  useEffect(() => {
    void load().catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Could not load the queue');
    });
  }, [load]);

  async function openItem(id: string) {
    setOpenId(id);
    setPreview(null);
    setPreviewError(null);
    try {
      const detail = await getAdminCommunityItem(id);
      setPreview(detail);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Could not load this submission');
    }
  }

  return (
    <div data-testid="admin-community-queue">
      <div className="mb-4 flex gap-2">
        {(['pending', 'published', 'rejected'] as const).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? 'default' : 'outline'}
            onClick={() => {
              setStatus(value);
              setOpenId(null);
              setPreview(null);
              setPreviewError(null);
            }}
            data-testid={`admin-community-filter-${value}`}
          >
            {value}
          </Button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No items.</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-foreground">{row.title}</h3>
                  <p className="text-sm text-muted-foreground">
                    {row.author} · {row.language} · {row.lessonCount} lessons · score {row.score}
                  </p>
                  {row.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{row.description}</p>
                  )}
                  {row.rejectReason && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.rejectReason}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void openItem(row.id)}>
                    Read
                  </Button>
                  {(row.status === 'pending' || row.status === 'rejected') && (
                    <Button
                      size="sm"
                      disabled={busy}
                      data-testid={`admin-community-approve-${row.id}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await approveCommunityItem(row.id);
                          toast.success('Item published');
                          await load();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Approve failed');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Approve
                    </Button>
                  )}
                  {row.status !== 'rejected' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      data-testid={`admin-community-reject-${row.id}`}
                      onClick={() => {
                        setRejectId(row.id);
                        setRejectReason('');
                      }}
                    >
                      Reject
                    </Button>
                  )}
                  {row.status === 'published' && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      data-testid={`admin-community-clear-votes-${row.id}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await clearCommunityVotes(row.id);
                          toast.success('Votes cleared');
                          await load();
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Clear failed');
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Clear votes
                    </Button>
                  )}
                </div>
              </div>
              {openId === row.id && (
                <div
                  className="mt-4 max-h-80 space-y-3 overflow-auto text-sm"
                  data-testid="admin-community-preview"
                >
                  {previewError && <p className="text-destructive">{previewError}</p>}
                  {!previewError && preview?.id !== row.id && (
                    <p className="text-muted-foreground">Loading preview…</p>
                  )}
                  {preview?.id === row.id &&
                    preview.lessons.map((lesson) => (
                      <article key={`${row.id}-${lesson.sortOrder}`}>
                        <h4 className="font-medium">{lesson.title}</h4>
                        <p className="whitespace-pre-wrap text-muted-foreground">
                          {lesson.textContent}
                        </p>
                      </article>
                    ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {rejectId && (
        <Dialog open onOpenChange={(next) => !next && setRejectId(null)}>
          <DialogContent className="max-w-md p-6" data-testid="admin-community-reject-dialog">
            <DialogTitle>Reject submission</DialogTitle>
            <label className="mt-4 block text-sm">
              Reason
              <textarea
                className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
                value={rejectReason}
                onChange={(event) => setRejectReason(event.target.value)}
                data-testid="admin-community-reject-reason"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setRejectId(null)} type="button">
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy || !rejectReason.trim()}
                data-testid="admin-community-reject-confirm"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await rejectCommunityItem(rejectId, rejectReason.trim());
                    toast.success('Item rejected');
                    setRejectId(null);
                    await load();
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Reject failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Reject
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  approveCommunityItem,
  getAdminCommunityItem,
  listAdminCommunity,
  rejectCommunityItem,
} from '@/lib/community';

interface QueueRow {
  id: string;
  title: string;
  author: string;
  language: string;
  lessonCount: number;
  status: string;
  submitterUserId: string;
  createdAt: string;
  rejectReason: string | null;
}

export default function CommunityQueue() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [lessons, setLessons] = useState<Array<{ title: string; textContent: string }>>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const list = await listAdminCommunity(status);
    setRows(list as unknown as QueueRow[]);
  }, [status]);

  useEffect(() => {
    void load().catch((error) => {
      toast.error(error instanceof Error ? error.message : 'Could not load the queue');
    });
  }, [load]);

  async function openItem(id: string) {
    setOpenId(id);
    const detail = await getAdminCommunityItem(id);
    setLessons(detail.lessons ?? []);
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
                    {row.author} · {row.language} · {row.lessonCount} lessons
                  </p>
                  {row.rejectReason && (
                    <p className="mt-1 text-xs text-muted-foreground">{row.rejectReason}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => void openItem(row.id)}>
                    Read
                  </Button>
                  {row.status === 'pending' && (
                    <Button
                      size="sm"
                      disabled={busy}
                      data-testid={`admin-community-approve-${row.id}`}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          await approveCommunityItem(row.id);
                          toast.success('Published');
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
                      onClick={async () => {
                        const reason = window.prompt('Reject reason:');
                        if (!reason?.trim()) return;
                        setBusy(true);
                        try {
                          await rejectCommunityItem(row.id, reason.trim());
                          toast.success('Rejected');
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
                  )}
                </div>
              </div>
              {openId === row.id && (
                <div
                  className="mt-4 max-h-80 space-y-3 overflow-auto text-sm"
                  data-testid="admin-community-preview"
                >
                  {lessons.map((lesson) => (
                    <article key={lesson.title}>
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
    </div>
  );
}

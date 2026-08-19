import { apiFetch } from './api-base';
import { interceptPlanLimit } from './plan-limits';

export type CommunityStatus = 'pending' | 'published' | 'rejected';

export interface CommunityItem {
  id: string;
  language: string;
  title: string;
  author: string;
  description: string | null;
  coverUrl: string | null;
  lessonCount: number;
  wordCount: number;
  score: number;
  publishedAt: string | null;
  status: CommunityStatus;
  rejectReason: string | null;
  submitterLabel: string;
  viewerVote: 1 | -1 | null;
  cloned: boolean;
}

export interface CommunityItemDetail extends CommunityItem {
  lessons: Array<{
    sortOrder: number;
    title: string;
    textContent: string;
    wordCount: number;
    sourceType: string | null;
    sourceMeta: string | null;
    segments: string | null;
  }>;
}

export interface CommunityCloneResult {
  cloned: boolean;
  reason?: string;
  collectionId: string;
  lessonCount?: number;
}

async function communityRequest(res: Response, fallback: string): Promise<Response> {
  interceptPlanLimit(res);
  if (!res.ok) {
    const body = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: unknown };
    if (body.error === 'plan_limit') throw new Error('plan_limit');
    throw new Error(typeof body.error === 'string' ? body.error : fallback);
  }
  return res;
}

export async function listCommunityItems(
  language: string,
  sort: 'score' | 'new' = 'score',
): Promise<CommunityItem[]> {
  const res = await apiFetch(`/api/community/items?language=${language}&sort=${sort}`);
  await communityRequest(res, 'Could not load the community library');
  return res.json();
}

export async function listMyCommunityItems(): Promise<CommunityItem[]> {
  const res = await apiFetch('/api/community/mine');
  await communityRequest(res, 'Could not load your submissions');
  return res.json();
}

export async function getCommunityItem(id: string): Promise<CommunityItemDetail> {
  const res = await apiFetch(`/api/community/items/${id}`);
  await communityRequest(res, 'Could not load this item');
  return res.json();
}

export async function submitCommunityItem(
  collectionId: string,
  attested: boolean,
  description?: string,
): Promise<{ id: string; status: string }> {
  const res = await apiFetch('/api/community/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId, attested, description }),
  });
  await communityRequest(res, 'Could not submit this collection');
  return res.json();
}

export async function voteCommunityItem(
  id: string,
  value: 1 | -1 | 0,
): Promise<{ score: number; viewerVote: 1 | -1 | null }> {
  const res = await apiFetch(`/api/community/items/${id}/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  await communityRequest(res, 'Could not record your vote');
  return res.json();
}

export async function cloneCommunityItem(
  id: string,
  body: { groupId: string } | { groupName: string },
): Promise<CommunityCloneResult> {
  const res = await apiFetch(`/api/community/items/${id}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await communityRequest(res, 'Could not add this item to your library');
  return res.json();
}

export async function listAdminCommunity(status = 'pending'): Promise<CommunityItemDetail[]> {
  const res = await apiFetch(`/api/admin/community?status=${status}`);
  if (!res.ok) throw new Error('Could not load the queue');
  return res.json();
}

export async function getAdminCommunityItem(id: string): Promise<CommunityItemDetail> {
  const res = await apiFetch(`/api/admin/community/${id}`);
  if (!res.ok) throw new Error('Could not load this submission');
  return res.json();
}

export async function approveCommunityItem(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/community/${id}/approve`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not approve this item');
}

export async function rejectCommunityItem(id: string, reason: string): Promise<void> {
  const res = await apiFetch(`/api/admin/community/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) throw new Error('Could not reject this item');
}

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
  owned: boolean;
  viewerVote: 1 | -1 | null;
  cloned: boolean;
}

export interface CommunityAdminRow {
  id: string;
  language: string;
  title: string;
  author: string;
  description: string | null;
  lessonCount: number;
  wordCount: number;
  score: number;
  status: CommunityStatus;
  submitterUserId: string;
  submitterLabel: string;
  createdAt: string;
  rejectReason: string | null;
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

export function communityError(code: string, fallback: string): string {
  if (code === 'duplicate') return 'This text is already in the catalog.';
  if (code === 'already_pending') return 'This collection is already in the queue.';
  if (code === 'empty_collection') return 'Add a lesson before you submit.';
  if (code === 'own_item') return 'You cannot vote on your own item.';
  if (code === 'starter_not_allowed') return 'Starter collections cannot go in the catalog.';
  if (code === 'audio_not_allowed') return 'Collections with audio cannot go in the catalog.';
  if (code === 'attestation_required') {
    return 'Confirm that you have the right to share this text.';
  }
  if (code === 'pending_limit') return 'You already have three items in the queue.';
  if (code === 'too_large') return 'This collection is too large to submit.';
  if (code === 'vote_rate') return 'Wait a moment before you vote again.';
  if (code === 'not_pending') return 'This item is not waiting for review.';
  if (code === 'submitter_gone') return 'The submitter deleted their account.';
  if (code === 'already-cloned') return 'This item is already in your library.';
  return fallback;
}

async function communityRequest(res: Response, fallback: string): Promise<Response> {
  interceptPlanLimit(res);
  if (!res.ok) {
    const body = (await res
      .clone()
      .json()
      .catch(() => ({}))) as { error?: unknown };
    if (body.error === 'plan_limit') throw new Error('plan_limit');
    const code = typeof body.error === 'string' ? body.error : '';
    throw new Error(communityError(code, fallback));
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
  extras: { description?: string; displayName?: string } = {},
): Promise<{ id: string; status: string }> {
  const res = await apiFetch('/api/community/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ collectionId, attested, ...extras }),
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

export async function listAdminCommunity(status = 'pending'): Promise<CommunityAdminRow[]> {
  const res = await apiFetch(`/api/admin/community?status=${status}`);
  if (!res.ok) throw new Error('Could not load the queue');
  return res.json();
}

export async function clearCommunityVotes(id: string): Promise<{ score: number }> {
  const res = await apiFetch(`/api/admin/community/${id}/clear-votes`, { method: 'POST' });
  if (!res.ok) throw new Error('Could not clear votes');
  return res.json();
}

export async function getAdminCommunityItem(id: string): Promise<CommunityItemDetail> {
  const res = await apiFetch(`/api/admin/community/${id}`);
  if (!res.ok) throw new Error('Could not load this submission');
  return res.json();
}

export async function approveCommunityItem(id: string): Promise<void> {
  const res = await apiFetch(`/api/admin/community/${id}/approve`, { method: 'POST' });
  await communityRequest(res, 'Could not approve this item');
}

export async function rejectCommunityItem(id: string, reason: string): Promise<void> {
  const res = await apiFetch(`/api/admin/community/${id}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  await communityRequest(res, 'Could not reject this item');
}

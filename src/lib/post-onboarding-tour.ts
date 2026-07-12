'use client';

import { useEffect, useState } from 'react';

export type PostOnboardingTourStage = 'practice' | 'vocab' | 'anki';

export interface PostOnboardingTourState {
  completedAt: string;
  stage: PostOnboardingTourStage;
}

const STORAGE_KEY = 'lector-post-onboarding-tour-v1';
const CHANGE_EVENT = 'lector-post-onboarding-tour-change';

function readTour(): PostOnboardingTourState | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || 'null',
    ) as Partial<PostOnboardingTourState> | null;
    if (
      !value ||
      typeof value.completedAt !== 'string' ||
      (value.stage !== 'practice' && value.stage !== 'vocab' && value.stage !== 'anki')
    ) {
      return null;
    }
    return value as PostOnboardingTourState;
  } catch {
    return null;
  }
}

function notifyTourChanged() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function startPostOnboardingTour(completedAt: string): void {
  if (typeof window === 'undefined' || !completedAt) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ completedAt, stage: 'practice' }));
  notifyTourChanged();
}

export function advancePostOnboardingTour(stage: PostOnboardingTourStage): void {
  if (typeof window === 'undefined') return;
  const current = readTour();
  if (!current) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, stage }));
  notifyTourChanged();
}

export function finishPostOnboardingTour(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
  notifyTourChanged();
}

export function usePostOnboardingTour(): PostOnboardingTourState | null {
  const [tour, setTour] = useState<PostOnboardingTourState | null>(null);

  useEffect(() => {
    const sync = () => setTour(readTour());
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener(CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener(CHANGE_EVENT, sync);
    };
  }, []);

  return tour;
}

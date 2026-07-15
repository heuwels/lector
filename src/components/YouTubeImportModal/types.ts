import type { YouTubeCaptionTrack, YouTubeResolveResult } from '@/lib/data-layer';

export interface YouTubeImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a transcript is imported so the caller can open the reader. */
  onImported: (result: { collectionId: string; lessonId: string; title: string }) => void;
}

export type YouTubeModalState =
  | { phase: 'input' }
  | { phase: 'resolving' }
  | { phase: 'select'; data: YouTubeResolveResult }
  | { phase: 'importing'; data: YouTubeResolveResult; track: YouTubeCaptionTrack }
  | { phase: 'error'; message: string };

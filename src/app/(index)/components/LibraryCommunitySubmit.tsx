'use client';

import { useState } from 'react';
import { Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CommunitySubmitDialog from '@/components/CommunitySubmitDialog';
import { useLectorMode } from '@/lib/use-env';
import type { Collection } from '@/lib/data-layer';

export default function LibraryCommunitySubmit({ collection }: { collection: Collection }) {
  const mode = useLectorMode();
  const [open, setOpen] = useState(false);

  if (mode !== 'cloud') return null;
  if (collection.id.startsWith('starter-')) return null;
  if (collection.hasAudio) return null;

  return (
    <>
      <Button
        size="icon-sm"
        variant="secondary"
        className="absolute top-2 right-2 z-10"
        aria-label="Submit to community"
        data-testid={`community-submit-${collection.id}`}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <Share2 className="h-4 w-4" />
      </Button>
      <CommunitySubmitDialog
        open={open}
        onClose={() => setOpen(false)}
        collectionId={collection.id}
        title={collection.title}
        lessonCount={collection.lessonCount}
      />
    </>
  );
}

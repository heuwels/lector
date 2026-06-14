import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import CollectionCard from '@/components/CollectionCard';
import { type Collection } from '@/lib/data-layer';

export default function SortableCollectionCard({ collection }: { collection: Collection }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative ${isDragging ? 'opacity-60' : ''}`}
    >
      <CollectionCard collection={collection} />
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${collection.title}`}
        data-testid={`drag-collection-${collection.id}`}
        className="absolute top-2 left-2 cursor-grab touch-none rounded-md bg-card/90 p-1 text-muted-foreground opacity-70 shadow-sm transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
    </div>
  );
}

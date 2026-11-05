import { Button } from '@/components/ui/button';
import type { JournalEntry } from '@/lib/data-layer';

export default function RevisionPanel({
  entry,
  value,
  onChange,
  onSave,
  isSaving,
  saveStatus,
}: {
  entry: JournalEntry;
  value: string;
  onChange: (text: string) => void;
  onSave: () => void;
  isSaving: boolean;
  saveStatus: string | null;
}) {
  const showCorrected = !!entry.correctedBody && entry.correctedBody !== entry.body;

  return (
    <div className="flex h-full min-h-[24rem] flex-col">
      <div className="space-y-4 px-5 pt-4">
        <section>
          <h3 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Your text
          </h3>
          <p className="font-reading text-base leading-8 whitespace-pre-wrap text-muted-foreground">
            {entry.body}
          </p>
        </section>

        {showCorrected && (
          <section>
            <h3 className="mb-1 text-xs font-medium tracking-wide text-primary uppercase">
              Corrected
            </h3>
            <p className="font-reading text-base leading-8 whitespace-pre-wrap text-foreground">
              {entry.correctedBody}
            </p>
          </section>
        )}

        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Your revision
        </h3>
      </div>

      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Write the page again. Use the corrections."
        className="min-h-[12rem] flex-1 resize-none bg-transparent px-5 py-1 font-reading text-base leading-8 text-foreground placeholder:text-muted-foreground focus:outline-none"
      />

      <div className="flex items-center justify-between gap-3 px-5 py-3">
        {saveStatus ? (
          <span className="text-xs text-primary">{saveStatus}</span>
        ) : (
          <span className="text-xs text-muted-foreground">This save does not call the model.</span>
        )}
        <Button type="button" onClick={onSave} disabled={isSaving || !value.trim()}>
          {isSaving ? 'Saving...' : 'Save revision'}
        </Button>
      </div>
    </div>
  );
}

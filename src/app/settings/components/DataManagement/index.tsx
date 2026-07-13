import { buttonVariants } from '@/components/ui/button';
import { apiUrl } from '@/lib/api-base';
import { importFromDexie } from '@/lib/data-layer';
import { toast } from 'sonner';

export default function DataManagement() {
  // Import a learning-data takeout (legacy backups remain supported server-side).
  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate the takeout metadata before uploading it.
      if (!data.version || !data.exportedAt) {
        throw new Error('Invalid backup file format');
      }

      // Use the server-side import API
      const result = await importFromDexie(data);

      if (result.success) {
        const counts = result.imported;
        toast.success(`Learning data imported`, {
          description: `${counts.collections || 0} collections, ${counts.lessons || 0} lessons, ${counts.vocab || 0} vocab, ${counts.knownWords || 0} known words, ${counts.clozeSentences || 0} cloze sentences.`,
        });
      } else {
        throw new Error('Import failed');
      }
    } catch (error) {
      toast.error(`Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`, {});
    }

    // Reset file input
    e.target.value = '';
  };

  return (
    <section className="rounded-lg border border-destructive/30 bg-card p-6">
      <h2 className="text-lg font-semibold text-foreground">Learning data</h2>
      <p className="mt-1 mb-4 max-w-2xl text-sm text-muted-foreground">
        Download your collections and lessons, reading position, vocabulary, sentence practice and
        review schedule, journal, and stats. API keys and provider endpoints are never included.
      </p>

      <div className="mb-6 flex flex-wrap gap-3">
        <a
          href={apiUrl('/api/data')}
          className={buttonVariants({ variant: 'secondary' })}
          data-testid="export-learning-data"
        >
          Export all learning data
        </a>
        <label className="cursor-pointer rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">
          Import learning data
          <input
            type="file"
            accept=".json"
            onChange={handleBackupImport}
            className="hidden"
            data-testid="import-learning-data"
          />
        </label>
      </div>
    </section>
  );
}

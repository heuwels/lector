import { Button } from '@/components/ui/button';
import { exportAllData, importFromDexie } from '@/lib/data-layer';
import { downloadFile } from '@/utils/browser';
import { toast } from 'sonner';

export default function DataManagement() {
  const exportFullBackup = async () => {
    try {
      const data = await exportAllData();
      const exportData = {
        ...data,
        exportedAt: new Date().toISOString(),
        version: 2,
      };
      const json = JSON.stringify(exportData, null, 2);
      downloadFile(json, 'lector-backup.json', 'application/json');
      toast.success('Full backup exported.');
    } catch (error) {
      toast.error(`Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  // Import backup
  const handleBackupImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate backup format
      if (!data.version || !data.exportedAt) {
        throw new Error('Invalid backup file format');
      }

      // Use the server-side import API
      const result = await importFromDexie(data);

      if (result.success) {
        const counts = result.imported;
        toast.success(`Backup imported`, {
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
    <section className="rounded-lg border border-destructive/30 bg-card p-6 ">
      <h2 className="mb-4 text-lg font-semibold text-foreground">
        Data Management
      </h2>

      <div className="mb-6 flex flex-wrap gap-3">
        <Button
          variant="secondary"
          onClick={exportFullBackup}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          Export Full Backup
        </Button>
        <label className="cursor-pointer rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-accent">
          Import Backup
          <input type="file" accept=".json" onChange={handleBackupImport} className="hidden" />
        </label>
      </div>
    </section>
  );
}

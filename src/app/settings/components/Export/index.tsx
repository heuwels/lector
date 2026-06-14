import { Button } from '@/components/ui/button';
import { getAllKnownWords, getAllVocab } from '@/lib/data-layer';
import { downloadFile } from '@/utils/browser';
import { toast } from 'sonner';

export default function Export() {
  const notifyError = (error: Error | unknown) => {
    toast.error(`Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  };

  const exportVocabCSV = async () => {
    try {
      const vocab = await getAllVocab();
      const csv = [
        'text,type,sentence,translation,state,createdAt',
        ...vocab.map(
          (v) =>
            `"${v.text}","${v.type}","${v.sentence.replace(/"/g, '""')}","${v.translation.replace(/"/g, '""')}","${v.state}","${v.createdAt.toISOString()}"`,
        ),
      ].join('\n');

      downloadFile(csv, 'afrikaans-vocab.csv', 'text/csv');
      toast.success('Vocab exported as CSV.');
    } catch (error) {
      notifyError(error);
    }
  };

  const exportVocabJSON = async () => {
    try {
      const vocab = await getAllVocab();
      const json = JSON.stringify(vocab, null, 2);
      downloadFile(json, 'afrikaans-vocab.json', 'application/json');
      toast.success('Vocab exported as JSON.');
    } catch (error) {
      notifyError(error);
    }
  };

  const exportKnownWords = async () => {
    try {
      const knownWords = await getAllKnownWords();
      const words = knownWords.filter((w) => w.state === 'known').map((w) => w.word);
      const text = words.join('\n');
      downloadFile(text, 'afrikaans-known-words.txt', 'text/plain');
      toast.success(`Exported ${words.length} known words.`);
    } catch (error) {
      notifyError(error);
    }
  };

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">Export Data</h2>
      <div className="flex flex-wrap gap-3">
        <Button onClick={exportVocabCSV}>Export Vocab (CSV)</Button>
        <Button onClick={exportVocabJSON}>Export Vocab (JSON)</Button>
        <Button onClick={exportKnownWords}>Export Known Words</Button>
      </div>
    </section>
  );
}

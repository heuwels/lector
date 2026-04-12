'use client';

import { useEffect, useState, useRef } from 'react';
import NavHeader from '@/components/NavHeader';
import StatsCard from '@/components/StatsCard';
import CollectionCard from '@/components/CollectionCard';
import ImportDropdown from '@/components/ImportDropdown';
import WebImportModal from '@/components/WebImportModal';
import PasteImportModal from '@/components/PasteImportModal';
import {
  getAllCollections,
  createStandaloneLesson,
  importEpub,
  getVocabStats,
  getRecentStats,
  type Collection,
} from '@/lib/data-layer';

export default function Home() {
  const [collections, setCollections] = useState<Collection[]>([]);
  const [knownWordsCount, setKnownWordsCount] = useState(0);
  const [currentStreak, setCurrentStreak] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [isWebImportOpen, setIsWebImportOpen] = useState(false);
  const [isPasteImportOpen, setIsPasteImportOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [collectionsData, vocabStats, recentStats] = await Promise.all([
        getAllCollections(),
        getVocabStats(),
        getRecentStats(30),
      ]);

      setCollections(collectionsData);

      const knownCount =
        vocabStats.byState.level3 +
        vocabStats.byState.level4 +
        vocabStats.byState.known;
      setKnownWordsCount(knownCount);

      const streak = calculateStreak(recentStats);
      setCurrentStreak(streak);
    } catch (error) {
      console.error('Error loading data:', error);
    } finally {
      setIsLoading(false);
    }
  }

  function calculateStreak(stats: { date: string; wordsRead: number }[]): number {
    if (stats.length === 0) return 0;

    const sorted = [...stats].sort((a, b) => b.date.localeCompare(a.date));

    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const hasActivityToday = sorted.some((s) => s.date === today && s.wordsRead > 0);
    const hasActivityYesterday = sorted.some(
      (s) => s.date === yesterday && s.wordsRead > 0
    );

    if (!hasActivityToday && !hasActivityYesterday) return 0;

    let streak = 0;
    let checkDate = hasActivityToday ? today : yesterday;

    for (const stat of sorted) {
      if (stat.date === checkDate && stat.wordsRead > 0) {
        streak++;
        const prevDate = new Date(checkDate);
        prevDate.setDate(prevDate.getDate() - 1);
        checkDate = prevDate.toISOString().split('T')[0];
      }
    }

    return streak;
  }

  async function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().split('.').pop();

    setIsImporting(true);

    try {
      if (ext === 'epub') {
        // EPUB — parse server-side into collection of lessons
        const result = await importEpub(file);
        // Reload collections to get the new one
        const updated = await getAllCollections();
        setCollections(updated);
      } else if (ext === 'md' || ext === 'markdown') {
        // Markdown — create single-lesson collection
        const textContent = await file.text();
        const titleMatch = textContent.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : file.name.replace(/\.[^/.]+$/, '');

        await createStandaloneLesson({ title, author: 'Unknown Author', textContent });
        const updated = await getAllCollections();
        setCollections(updated);
      } else {
        alert('Please select an EPUB or Markdown file');
      }
    } catch (error) {
      console.error('Error importing file:', error);
      alert('Failed to import file. Please ensure it is a valid file.');
    } finally {
      setIsImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handlePasteImportSave(article: { title: string; author: string; content: string }) {
    await createStandaloneLesson({ title: article.title, author: article.author, textContent: article.content });
    const updated = await getAllCollections();
    setCollections(updated);
  }

  async function handleWebImportSave(article: { title: string; author: string; content: string }) {
    await createStandaloneLesson({ title: article.title, author: article.author, textContent: article.content });
    const updated = await getAllCollections();
    setCollections(updated);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
        <NavHeader />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-100" />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 sm:ml-56">
      <NavHeader />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Stats Section */}
        <section className="mb-10 grid gap-4 sm:grid-cols-2">
          <StatsCard
            label="Words Known"
            value={knownWordsCount.toLocaleString()}
            highlight
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            }
          />
          <StatsCard
            label="Current Streak"
            value={`${currentStreak} ${currentStreak === 1 ? 'day' : 'days'}`}
            icon={
              <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z"
                />
              </svg>
            }
          />
        </section>

        {/* Library Section */}
        <section>
          <div className="mb-6 flex items-center justify-between">
            <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">Your Library</h2>
            <ImportDropdown
              onFileImport={handleImportClick}
              onUrlImport={() => setIsWebImportOpen(true)}
              onPasteImport={() => setIsPasteImportOpen(true)}
              isImporting={isImporting}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".epub,.md,.markdown"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          <WebImportModal
            isOpen={isWebImportOpen}
            onClose={() => setIsWebImportOpen(false)}
            onSave={handleWebImportSave}
          />
          <PasteImportModal
            isOpen={isPasteImportOpen}
            onClose={() => setIsPasteImportOpen(false)}
            onSave={handlePasteImportSave}
          />

          {collections.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {collections.map((collection) => (
                <CollectionCard key={collection.id} collection={collection} />
              ))}
            </div>
          ) : (
            <EmptyState onImport={handleImportClick} />
          )}
        </section>
      </main>
    </div>
  );
}

function EmptyState({ onImport }: { onImport: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-200 bg-white px-6 py-16 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
        <svg
          className="h-8 w-8 text-zinc-400 dark:text-zinc-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
          />
        </svg>
      </div>
      <h3 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        No books in your library
      </h3>
      <p className="mb-6 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
        Import an Afrikaans book (EPUB or Markdown) to start learning. Your vocabulary and progress will be
        tracked as you read.
      </p>
      <button
        onClick={onImport}
        className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        Import Book
      </button>
    </div>
  );
}

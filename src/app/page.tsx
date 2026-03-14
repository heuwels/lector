'use client';

import { useEffect, useState, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import NavHeader from '@/components/NavHeader';
import StatsCard from '@/components/StatsCard';
import BookCard from '@/components/BookCard';
import ImportDropdown from '@/components/ImportDropdown';
import WebImportModal from '@/components/WebImportModal';
import PasteImportModal from '@/components/PasteImportModal';
import {
  getAllBooks,
  saveBook,
  getVocabStats,
  getRecentStats,
  type Book,
  type BookProgress,
  type BookFileType,
} from '@/lib/data-layer';

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
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
      const [booksData, vocabStats, recentStats] = await Promise.all([
        getAllBooks(),
        getVocabStats(),
        getRecentStats(30),
      ]);

      setBooks(booksData);

      // Known words = level3 + level4 + known
      const knownCount =
        vocabStats.byState.level3 +
        vocabStats.byState.level4 +
        vocabStats.byState.known;
      setKnownWordsCount(knownCount);

      // Calculate streak from recent stats
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

    // Sort by date descending
    const sorted = [...stats].sort((a, b) => b.date.localeCompare(a.date));

    // Check if today or yesterday has activity
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    const hasActivityToday = sorted.some((s) => s.date === today && s.wordsRead > 0);
    const hasActivityYesterday = sorted.some(
      (s) => s.date === yesterday && s.wordsRead > 0
    );

    if (!hasActivityToday && !hasActivityYesterday) return 0;

    // Count consecutive days
    let streak = 0;
    let checkDate = hasActivityToday ? today : yesterday;

    for (const stat of sorted) {
      if (stat.date === checkDate && stat.wordsRead > 0) {
        streak++;
        // Move to previous day
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

  function getFileType(filename: string): BookFileType | null {
    const ext = filename.toLowerCase().split('.').pop();
    if (ext === 'epub') return 'epub';
    if (ext === 'pdf') return 'pdf';
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    return null;
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    const fileType = getFileType(file.name);
    if (!fileType) {
      alert('Please select an EPUB, PDF, or Markdown file');
      return;
    }

    setIsImporting(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const baseName = file.name.replace(/\.[^/.]+$/, '');

      let newBook: Book = {
        id: uuidv4(),
        title: baseName,
        author: 'Unknown Author',
        coverUrl: undefined,
        fileData: arrayBuffer,
        fileType,
        progress: {
          chapter: 0,
          scrollPosition: 0,
          percentComplete: 0,
        } as BookProgress,
        createdAt: new Date(),
        lastReadAt: new Date(),
      };

      if (fileType === 'epub') {
        // Parse EPUB to extract metadata
        const ePub = await import('epubjs');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const epubBook = ePub.default(arrayBuffer) as any;
        await epubBook.ready;
        const metadata = await epubBook.loaded.metadata;

        newBook.title = metadata.title || baseName;
        newBook.author = metadata.creator || 'Unknown Author';

        // Try to extract cover
        try {
          const cover = await epubBook.coverUrl();
          if (cover) {
            newBook.coverUrl = cover;
          }
        } catch {
          // Cover extraction failed, that's okay
        }
      } else if (fileType === 'markdown') {
        // Store text content for markdown files
        const textContent = new TextDecoder().decode(arrayBuffer);
        newBook.textContent = textContent;

        // Try to extract title from first heading
        const titleMatch = textContent.match(/^#\s+(.+)$/m);
        if (titleMatch) {
          newBook.title = titleMatch[1].trim();
        }
      }
      // PDF metadata extraction could be added later if needed

      await saveBook(newBook);
      setBooks((prev) => [newBook, ...prev]);
    } catch (error) {
      console.error('Error importing file:', error);
      alert('Failed to import file. Please ensure it is a valid file.');
    } finally {
      setIsImporting(false);
      // Reset the input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handlePasteImportSave(article: { title: string; author: string; content: string }) {
    const newBook: Book = {
      id: uuidv4(),
      title: article.title,
      author: article.author,
      coverUrl: undefined,
      fileData: new ArrayBuffer(0),
      fileType: 'markdown',
      textContent: article.content,
      progress: {
        chapter: 0,
        scrollPosition: 0,
        percentComplete: 0,
      } as BookProgress,
      createdAt: new Date(),
      lastReadAt: new Date(),
    };

    await saveBook(newBook);
    setBooks((prev) => [newBook, ...prev]);
  }

  async function handleWebImportSave(article: { title: string; author: string; content: string }) {
    const newBook: Book = {
      id: uuidv4(),
      title: article.title,
      author: article.author,
      coverUrl: undefined,
      fileData: new ArrayBuffer(0), // No file data for web imports
      fileType: 'markdown',
      textContent: article.content,
      progress: {
        chapter: 0,
        scrollPosition: 0,
        percentComplete: 0,
      } as BookProgress,
      createdAt: new Date(),
      lastReadAt: new Date(),
    };

    await saveBook(newBook);
    setBooks((prev) => [newBook, ...prev]);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
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
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
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
              accept=".epub,.pdf,.md,.markdown"
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

          {books.length > 0 ? (
            <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {books.map((book) => (
                <BookCard key={book.id} book={book} />
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
        Import an Afrikaans book (EPUB, PDF, or Markdown) to start learning. Your vocabulary and progress will be
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

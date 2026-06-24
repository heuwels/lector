'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getPageRange } from '@/lib/pagination';
import { PAGE_SIZE_OPTIONS } from '../constants';

interface PaginationControlsProps {
  /** 1-indexed current page. */
  currentPage: number;
  /** Total number of pages (always >= 1). */
  pageCount: number;
  /** Rows shown per page. */
  pageSize: number;
  /** Total number of items across all pages (the filtered set). */
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

/**
 * Footer pagination control for the vocab list: a rows-per-page selector plus
 * an "X–Y of Z" range and prev/next navigation. Page state lives in the parent
 * (VocabList); this component is presentational.
 */
export default function PaginationControls({
  currentPage,
  pageCount,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  const { from, to } = getPageRange(currentPage, pageSize, totalItems);

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-4"
      aria-label="Vocabulary pagination"
      data-testid="vocab-pagination"
    >
      {/* Rows-per-page selector */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <label htmlFor="vocab-page-size">Rows per page</label>
        <select
          id="vocab-page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className="rounded-lg border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:border-ring focus:ring-1 focus:ring-ring focus:outline-none"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>

      {/* Range + page navigation */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-muted-foreground" data-testid="vocab-pagination-range">
          {from}–{to} of {totalItems}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span
            className="px-2 text-sm font-medium text-foreground"
            data-testid="vocab-pagination-page"
            aria-live="polite"
          >
            Page {currentPage} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= pageCount}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </nav>
  );
}

/**
 * Pure pagination helpers for client-side paginated lists.
 *
 * The vocab list (and any future paginated table) loads its full result set
 * into memory, filters/sorts it client-side, then renders one page at a time.
 * These helpers own the page math so it can be unit-tested independently of the
 * React component. Pages are 1-indexed (page 1 is the first page) to match what
 * the UI displays.
 */

/**
 * Total number of pages for `totalItems` split into `pageSize` chunks. Always
 * returns at least 1 so the UI never shows "Page 1 of 0" for an empty list.
 */
export function getPageCount(totalItems: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

/**
 * Clamp a (possibly stale) page number into the valid [1, pageCount] range.
 * Guards against NaN and fractional input so callers can pass user/URL values
 * directly.
 */
export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
}

/**
 * The slice of `items` visible on `page`. Out-of-range pages are clamped first,
 * so an over-large page returns the last page rather than an empty array.
 */
export function paginate<T>(items: T[], page: number, pageSize: number): T[] {
  if (pageSize <= 0) return items;
  const safePage = clampPage(page, getPageCount(items.length, pageSize));
  const start = (safePage - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

/**
 * The 1-indexed item range shown on `page`, for "X–Y of Z" labels. Returns
 * { from: 0, to: 0 } when there are no items.
 */
export function getPageRange(
  page: number,
  pageSize: number,
  totalItems: number,
): { from: number; to: number } {
  if (totalItems <= 0 || pageSize <= 0) return { from: 0, to: 0 };
  const safePage = clampPage(page, getPageCount(totalItems, pageSize));
  const from = (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, totalItems);
  return { from, to };
}

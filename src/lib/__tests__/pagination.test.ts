import { describe, it, expect } from 'vitest';
import { getPageCount, clampPage, paginate, getPageRange } from '../pagination';

describe('getPageCount', () => {
  it('rounds up partial pages', () => {
    expect(getPageCount(10, 4)).toBe(3); // 4 + 4 + 2
    expect(getPageCount(8, 4)).toBe(2);
    expect(getPageCount(1, 50)).toBe(1);
  });

  it('does not add a phantom page for an exact multiple', () => {
    expect(getPageCount(50, 50)).toBe(1);
    expect(getPageCount(100, 50)).toBe(2);
  });

  it('returns at least 1 page for an empty list', () => {
    expect(getPageCount(0, 50)).toBe(1);
  });

  it('guards against a non-positive page size', () => {
    expect(getPageCount(100, 0)).toBe(1);
    expect(getPageCount(100, -5)).toBe(1);
  });
});

describe('clampPage', () => {
  it('keeps an in-range page unchanged', () => {
    expect(clampPage(2, 5)).toBe(2);
  });

  it('clamps below 1 up to 1', () => {
    expect(clampPage(0, 5)).toBe(1);
    expect(clampPage(-3, 5)).toBe(1);
  });

  it('clamps past the last page down to the last page', () => {
    expect(clampPage(99, 5)).toBe(5);
  });

  it('never returns less than 1 even when pageCount is 0', () => {
    expect(clampPage(3, 0)).toBe(1);
  });

  it('handles NaN and fractional input', () => {
    expect(clampPage(NaN, 5)).toBe(1);
    expect(clampPage(2.9, 5)).toBe(2);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 10 }, (_, i) => i); // 0..9

  it('returns the first page', () => {
    expect(paginate(items, 1, 4)).toEqual([0, 1, 2, 3]);
  });

  it('returns a middle page', () => {
    expect(paginate(items, 2, 4)).toEqual([4, 5, 6, 7]);
  });

  it('returns a short final page', () => {
    expect(paginate(items, 3, 4)).toEqual([8, 9]);
  });

  it('clamps an over-large page to the last page rather than returning empty', () => {
    expect(paginate(items, 99, 4)).toEqual([8, 9]);
  });

  it('clamps a page below 1 to the first page', () => {
    expect(paginate(items, 0, 4)).toEqual([0, 1, 2, 3]);
  });

  it('returns everything when the page is larger than the list', () => {
    expect(paginate(items, 1, 50)).toEqual(items);
  });

  it('returns the original list for a non-positive page size', () => {
    expect(paginate(items, 1, 0)).toEqual(items);
  });

  it('returns an empty array for an empty list', () => {
    expect(paginate([], 1, 25)).toEqual([]);
  });
});

describe('getPageRange', () => {
  it('reports the first page range', () => {
    expect(getPageRange(1, 50, 320)).toEqual({ from: 1, to: 50 });
  });

  it('reports a middle page range', () => {
    expect(getPageRange(3, 50, 320)).toEqual({ from: 101, to: 150 });
  });

  it('caps the final page range at the total', () => {
    expect(getPageRange(7, 50, 320)).toEqual({ from: 301, to: 320 });
  });

  it('clamps an out-of-range page before computing the range', () => {
    expect(getPageRange(99, 50, 320)).toEqual({ from: 301, to: 320 });
  });

  it('clamps a NaN page to the first page', () => {
    expect(getPageRange(NaN, 50, 320)).toEqual({ from: 1, to: 50 });
  });

  it('returns a zero range for an empty list', () => {
    expect(getPageRange(1, 50, 0)).toEqual({ from: 0, to: 0 });
  });
});

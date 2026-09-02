import { describe, expect, it } from 'vitest';
import { screenSizeFromWidth } from './hooks';

describe('screenSizeFromWidth', () => {
  it('treats an unknown width as xl so SSR does not report 2xl', () => {
    expect(screenSizeFromWidth(undefined)).toBe('xl');
    expect(screenSizeFromWidth(0)).toBe('xl');
  });

  it('maps Tailwind breakpoints', () => {
    expect(screenSizeFromWidth(639)).toBe('xs');
    expect(screenSizeFromWidth(640)).toBe('sm');
    expect(screenSizeFromWidth(767)).toBe('sm');
    expect(screenSizeFromWidth(768)).toBe('md');
    expect(screenSizeFromWidth(1023)).toBe('md');
    expect(screenSizeFromWidth(1024)).toBe('lg');
    expect(screenSizeFromWidth(1279)).toBe('lg');
    expect(screenSizeFromWidth(1280)).toBe('xl');
    expect(screenSizeFromWidth(1535)).toBe('xl');
    expect(screenSizeFromWidth(1536)).toBe('2xl');
    expect(screenSizeFromWidth(2560)).toBe('2xl');
  });
});

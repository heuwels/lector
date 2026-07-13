import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Spinner } from './spinner';

describe('Spinner', () => {
  it('is decorative by default and uses the requested size', () => {
    const markup = renderToStaticMarkup(<Spinner size="lg" className="text-primary" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).not.toContain('role="status"');
    expect(markup).toContain('size-8');
    expect(markup).toContain('text-primary');
    expect(markup).toContain('border-current/25');
    expect(markup).toContain('border-t-current');
  });

  it('exposes an optional accessible loading label', () => {
    const markup = renderToStaticMarkup(<Spinner label="Loading lessons" />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading lessons"');
    expect(markup).not.toContain('aria-hidden');
  });
});

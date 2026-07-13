import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DeckShuffle, MasteryRipple, PageTurn, ReadingSweep } from './index';

describe('scene loaders', () => {
  it('render decoratively by default (a visible caption usually sits next to them)', () => {
    for (const markup of [
      renderToStaticMarkup(<PageTurn />),
      renderToStaticMarkup(<DeckShuffle />),
      renderToStaticMarkup(<MasteryRipple />),
      renderToStaticMarkup(<ReadingSweep />),
    ]) {
      expect(markup).toContain('aria-hidden="true"');
      expect(markup).not.toContain('role="status"');
    }
  });

  it('announce as status when labelled', () => {
    const markup = renderToStaticMarkup(<ReadingSweep label="Loading library" />);

    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-label="Loading library"');
    expect(markup).not.toContain('aria-hidden');
  });

  it('compose extra classes onto the scene root', () => {
    const markup = renderToStaticMarkup(<DeckShuffle className="mb-4" />);

    expect(markup).toContain('deck-shuffle mb-4');
  });
});

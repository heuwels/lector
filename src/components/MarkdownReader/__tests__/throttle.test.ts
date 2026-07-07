import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTrailingThrottle } from '../throttle';

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('createTrailingThrottle (#234)', () => {
    it('collapses a burst into one trailing call with the latest args', () => {
        const fn = vi.fn();
        const throttled = createTrailingThrottle(fn, 1000);

        throttled(10, 1);
        throttled(20, 2);
        throttled(30, 3);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(30, 3);
    });

    it('fires again for a burst after the window', () => {
        const fn = vi.fn();
        const throttled = createTrailingThrottle(fn, 1000);

        throttled(1);
        vi.advanceTimersByTime(1000);
        throttled(2);
        vi.advanceTimersByTime(1000);

        expect(fn).toHaveBeenCalledTimes(2);
        expect(fn).toHaveBeenNthCalledWith(1, 1);
        expect(fn).toHaveBeenNthCalledWith(2, 2);
    });

    it('flush() fires the pending call immediately, exactly once', () => {
        const fn = vi.fn();
        const throttled = createTrailingThrottle(fn, 1000);

        throttled(42);
        throttled.flush();
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith(42);

        // The flushed timer must not fire again later.
        vi.advanceTimersByTime(2000);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('flush() with nothing pending is a no-op', () => {
        const fn = vi.fn();
        const throttled = createTrailingThrottle(fn, 1000);
        throttled.flush();
        expect(fn).not.toHaveBeenCalled();
    });

    it('cancel() drops the pending call', () => {
        const fn = vi.fn();
        const throttled = createTrailingThrottle(fn, 1000);
        throttled(7);
        throttled.cancel();
        vi.advanceTimersByTime(2000);
        expect(fn).not.toHaveBeenCalled();
    });
});

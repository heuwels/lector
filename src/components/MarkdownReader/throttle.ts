/**
 * Trailing-edge throttle (#234): during a burst of calls, invoke `fn` at most
 * once per `waitMs`, always with the **latest** arguments. `flush()` fires any
 * pending invocation immediately (used on unmount so the final reading
 * position isn't lost); `cancel()` drops it.
 */
export function createTrailingThrottle<T extends unknown[]>(
    fn: (...args: T) => void,
    waitMs: number,
) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingArgs: T | null = null;

    const invoke = () => {
        timer = null;
        if (pendingArgs) {
            const args = pendingArgs;
            pendingArgs = null;
            fn(...args);
        }
    };

    const throttled = (...args: T) => {
        pendingArgs = args;
        if (timer === null) {
            timer = setTimeout(invoke, waitMs);
        }
    };

    throttled.flush = () => {
        if (timer !== null) {
            clearTimeout(timer);
            invoke();
        }
    };

    throttled.cancel = () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        pendingArgs = null;
    };

    return throttled;
}

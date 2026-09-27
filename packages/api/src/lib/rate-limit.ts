export type RateLimiterOptions = {
	/** Requests allowed per key and window. */
	max: number;
	windowMs: number;
	/** The clock, injectable so a spec need not wait out a window. */
	now?: () => number;
};

export type RateLimiter = {
	/** Counts one request for `key`; `false` once its window's allowance is spent. */
	consume: (key: string) => boolean;
	/** Keys with a live window, for specs. */
	size: () => number;
};

/**
 * A fixed window per key, in memory. Only for a route whose limit may reset
 * with the process: a restart forgets every count.
 */
export function createRateLimiter({
	max,
	windowMs,
	now = Date.now,
}: RateLimiterOptions): RateLimiter {
	const windows = new Map<string, { count: number; endsAt: number }>();

	return {
		consume(key) {
			const time = now();

			// Every call, not on a timer: one address per request could otherwise
			// fill the map faster than anything reads it.
			for (const [entry, window] of windows) {
				if (window.endsAt <= time) {
					windows.delete(entry);
				}
			}

			const window = windows.get(key);

			if (window === undefined) {
				windows.set(key, { count: 1, endsAt: time + windowMs });
				return true;
			}

			window.count += 1;

			return window.count <= max;
		},
		size: () => windows.size,
	};
}

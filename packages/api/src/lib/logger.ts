import type { DestinationStream, Logger } from "pino";

import { pino } from "pino";

export type { Logger };

/**
 * The one logger. Lines carry ids, counts, durations and error codes, never an
 * amount, a label or a provider payload (AD-14). The redaction is the last
 * line of defence for headers, which a request log would otherwise copy.
 */
export function createLogger(level: string, destination?: DestinationStream): Logger {
	const options = {
		level,
		redact: { paths: ["req.headers.authorization", "req.headers.cookie"], censor: "[redacted]" },
	};

	return destination === undefined ? pino(options) : pino(options, destination);
}

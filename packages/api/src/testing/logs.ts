import { z } from "zod";

const logLine = z.record(z.string(), z.unknown());

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;

/**
 * The log lines as text that a fixture's figure can only reach by being
 * logged. Pino's time, pid and hostname, a duration and a random UUID hold
 * runs of digits of their own: an account id ending in `…121200` once failed a
 * test forbidding `1200`. A UUID becomes `<uuid>`, so a leaked provider uid or
 * session id is searched in the lines themselves.
 */
export function loggedFigures(lines: readonly string[]): string {
	return lines
		.map((line) => {
			const {
				time: _time,
				pid: _pid,
				hostname: _hostname,
				durationMs: _durationMs,
				...rest
			} = logLine.parse(JSON.parse(line));

			return JSON.stringify(rest).replaceAll(UUID, "<uuid>");
		})
		.join("\n");
}

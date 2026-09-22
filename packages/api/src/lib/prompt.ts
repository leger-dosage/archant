import type { Readable } from "node:stream";

import { createInterface } from "node:readline";
import { Writable } from "node:stream";

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../schemas/setup.ts";

/** Why a pair of typed passwords is refused, before anything is written. */
export type NewPasswordProblem = "password_mismatch" | "password_too_short" | "password_too_long";

/** The checks a prompt can make on its own, so the script holds no logic (AD-1). */
export function checkNewPassword(
	password: string,
	confirmation: string,
): NewPasswordProblem | null {
	if (password !== confirmation) {
		return "password_mismatch";
	}

	if (password.length < PASSWORD_MIN_LENGTH) {
		return "password_too_short";
	}

	if (password.length > PASSWORD_MAX_LENGTH) {
		return "password_too_long";
	}

	return null;
}

type Session = {
	close: () => void;
	nextLine: () => Promise<string>;
};

/**
 * One readline interface per input, kept for the whole run. A fresh interface
 * per question would lose whatever arrived in the same chunk as the answer:
 * two lines written at once give the first question its answer and drop the
 * second on the floor.
 */
const sessions = new WeakMap<Readable, Session>();

function sessionFor(input: Readable): Session {
	const existing = sessions.get(input);

	if (existing !== undefined) {
		return existing;
	}

	// readline writes the echo of each keystroke to its output; here it goes
	// nowhere, so a password never appears on screen, in a scrollback buffer or
	// in a terminal recording. The questions are written to the real output.
	const sink = new Writable({
		write(_chunk: unknown, _encoding: unknown, done: () => void) {
			done();
		},
	});
	// `terminal: true` keeps readline's line editing, backspace included.
	const readline = createInterface({ input, output: sink, terminal: true });
	const read: string[] = [];
	const waiting: ((line: string) => void)[] = [];
	let closed = false;

	readline.on("line", (line: string) => {
		const next = waiting.shift();

		if (next === undefined) {
			read.push(line);
		} else {
			next(line);
		}
	});

	// Ctrl-D, or an input that ended: every question still waiting gets an empty
	// answer, which the checks refuse, rather than a command stopped dead.
	readline.on("close", () => {
		closed = true;

		for (const next of waiting.splice(0)) {
			next("");
		}
	});

	const session: Session = {
		close: () => {
			sessions.delete(input);
			readline.close();
		},
		nextLine: async () => {
			const line = read.shift();

			if (line !== undefined) {
				return line;
			}

			if (closed) {
				return "";
			}

			return new Promise<string>((resolve) => waiting.push(resolve));
		},
	};
	sessions.set(input, session);

	return session;
}

/** Asks a question and reads the answer without echoing it. */
export async function promptSecret(
	question: string,
	input: Readable = process.stdin,
	output: Writable = process.stdout,
): Promise<string> {
	const session = sessionFor(input);
	output.write(question);
	const answer = await session.nextLine();
	// The newline the terminal would have echoed on Enter.
	output.write("\n");

	return answer;
}

/** Releases the input, so a script that has asked everything can exit. */
export function closePrompts(input: Readable = process.stdin): void {
	sessions.get(input)?.close();
}

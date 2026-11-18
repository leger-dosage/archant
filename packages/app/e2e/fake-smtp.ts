import type { SMTPServerDataStream } from "smtp-server";

import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { text } from "node:stream/consumers";
import { callbackify } from "node:util";
import { SMTPServer } from "smtp-server";

import { PASSWORD_RESET_EMAIL, PASSWORD_RESET_LINK_FILE } from "./settings.ts";

const captureResetLink = callbackify(async (stream: SMTPServerDataStream) => {
	const body = await text(stream);
	const link = /^https?:\/\/\S+\/reset-password#token=\w+$/mu.exec(body)?.[0];
	if (!link || stream.sizeExceeded) {
		throw new Error("Missing reset link");
	}

	await writeFile(PASSWORD_RESET_LINK_FILE, link, { mode: 0o600 });
});

export async function startFakeSmtp() {
	const smtp = new SMTPServer({
		authOptional: true,
		disabledCommands: ["AUTH", "STARTTLS"],
		disableReverseLookup: true,
		size: 4096,
		onRcptTo: (recipient, _session, done) => {
			done(recipient.address === PASSWORD_RESET_EMAIL ? null : new Error("Unexpected recipient"));
		},
		onData: (stream, _session, done) => captureResetLink(stream, done),
	});

	const listening = once(smtp.server, "listening");
	smtp.listen(0, "127.0.0.1");
	await listening;
	const address = smtp.server.address();
	if (address === null || typeof address === "string") {
		throw new Error("The fake mail server did not bind a port");
	}

	return { port: address.port, close: () => smtp.close() };
}

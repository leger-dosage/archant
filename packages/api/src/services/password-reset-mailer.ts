import type { Env } from "../env.ts";
import type { SendPasswordReset } from "./email-password-reset.ts";

import { createTransport } from "nodemailer";

export function passwordResetMailer(env: Env): SendPasswordReset | undefined {
	const host = env.SMTP_ADDRESS;
	if (host === undefined) {
		return undefined;
	}

	const auth =
		env.SMTP_USERNAME !== undefined && env.SMTP_PASSWORD !== undefined
			? { user: env.SMTP_USERNAME, pass: env.SMTP_PASSWORD }
			: undefined;
	const localRelay = host === "localhost" || host === "127.0.0.1" || host === "::1";
	const transport = createTransport({
		host,
		port: env.SMTP_PORT,
		secure: env.SMTP_TLS_ENABLED,
		// An unauthenticated relay on the same machine may speak plain SMTP.
		requireTLS: !env.SMTP_TLS_ENABLED && (!localRelay || auth !== undefined),
		tls: { rejectUnauthorized: !env.SMTP_TLS_SKIP_VERIFY },
		...(auth === undefined ? {} : { auth }),
		connectionTimeout: 10_000,
		greetingTimeout: 10_000,
		socketTimeout: 30_000,
	});

	return async (email, link) => {
		await transport.sendMail({
			from: env.EMAIL_SENDER,
			to: email,
			subject: "Reset your Archant password",
			text: `Open this link within 15 minutes to reset your Archant password:\n\n${link.href}\n\nIf you did not request this, you can ignore this email.`,
		});
	};
}

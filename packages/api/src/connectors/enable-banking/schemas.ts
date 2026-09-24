import { z } from "zod";

// Every response is parsed, as any input crossing a boundary: a provider is
// not trusted because it is a bank. Objects drop the keys they do not name,
// so nothing unread travels further than this file.

const httpUrl = z.url({ protocol: /^https?$/u });

export const aspspSchema = z.object({
	name: z.string().min(1),
	country: z.string().length(2),
	// A missing or odd logo costs a picture, not the whole list.
	logo: httpUrl.nullish().catch(null),
	bic: z.string().min(1).nullish().catch(null),
	// Seconds.
	maximum_consent_validity: z.number().int().positive().nullish().catch(null),
});

export const aspspsResponseSchema = z.object({ aspsps: z.array(aspspSchema) });

// The browser is sent there: anything but http(s) would be a script URL.
export const authResponseSchema = z.object({ url: httpUrl });

export const sessionResponseSchema = z.object({
	session_id: z.string().min(1),
	access: z.object({
		valid_until: z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
	}),
});

/**
 * The provider's error code, kept only when it looks like one: a free-text
 * message could carry anything, and the code is all a log line may hold.
 */
export const errorResponseSchema = z.object({ error: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/u) });

import { z } from "zod";

/** Better Auth's default bounds, restated so the form reports them per field (NFR6). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const isEmail = (value: string) => z.email().safeParse(value).success;

/**
 * The first name the dashboard greets, Better Auth's `user.name`. Blank is
 * allowed and stored as `""`: the greeting then reads « Bonjour » alone.
 * Shared by setup, the security form and Better Auth's update hook, so the
 * three refuse the same names.
 */
export const firstNameSchema = z.string().trim().max(60);

// Shared with the setup form, whose resolver runs this same schema. Custom
// issues carry their field code as their message (lib/zod-error.ts).
export const setupSchema = z.object({
	name: firstNameSchema.optional(),
	email: z.string().trim().min(1, { abort: true }).refine(isEmail, "invalid_email"),
	password: z
		.string()
		.refine((value) => value.length >= PASSWORD_MIN_LENGTH, "password_too_short")
		.refine((value) => value.length <= PASSWORD_MAX_LENGTH, "password_too_long"),
});

export type SetupInput = z.infer<typeof setupSchema>;

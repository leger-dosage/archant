import { z } from "zod";

import { USER_ROLES } from "@archant/data/user-roles";

import { emailSchema, firstNameSchema, passwordSchema } from "./setup.ts";

// Shared with the invitation dialog, whose resolver runs this same schema.
export const createInvitationSchema = z.object({
	email: emailSchema,
	role: z.enum(USER_ROLES),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/**
 * The link's token, in the body rather than the path: a failing request's
 * path is logged, and must never hold a usable token. No bound: any string,
 * empty or long, answers `INVITATION_INVALID` like an unknown one, so the
 * link's page never shows a field error; the 64 KB body limit bounds it.
 */
const token = z.string();

export const previewInvitationSchema = z.object({ token });

// As setup: the first name is optional, the password has Better Auth's bounds.
export const acceptInvitationSchema = z.object({
	token,
	name: firstNameSchema.optional(),
	password: passwordSchema,
});

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

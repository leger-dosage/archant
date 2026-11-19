import { z } from "zod";

import { ACCOUNT_PERMISSIONS, BUDGET_PERMISSIONS } from "@archant/data/account-sharing";

const memberId = z.string().min(1);

export const accountShareSchema = z.object({
	userId: memberId,
	permission: z.enum(ACCOUNT_PERMISSIONS).nullable(),
});

export const financeInclusionSchema = z.object({ includeInFinances: z.boolean() });

export const budgetShareSchema = z.object({
	userId: memberId,
	permission: z.enum(BUDGET_PERMISSIONS).nullable(),
});

export const budgetOwnerQuery = z.object({ owner: z.string().min(1).optional() });

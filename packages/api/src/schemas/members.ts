import { z } from "zod";

import { USER_ROLES } from "@archant/data/user-roles";

export const memberRoleSchema = z.object({ role: z.enum(USER_ROLES) });

export type MemberRoleInput = z.infer<typeof memberRoleSchema>;

import { useQuery } from "@tanstack/react-query";

import { canWrite, isAdmin, sessionQuery } from "@/lib/auth-client";

export function useRole() {
	return useQuery(sessionQuery).data?.user.role;
}

export function useIsAdmin(): boolean {
	return isAdmin(useRole());
}

/** Whether to show controls that edit the ledger or the user's preferences (AD-21). */
export function useCanWrite(): boolean {
	return canWrite(useRole());
}

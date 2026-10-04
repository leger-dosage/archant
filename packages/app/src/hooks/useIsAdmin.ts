import { useQuery } from "@tanstack/react-query";

import { isAdmin, sessionQuery } from "@/lib/auth-client";

/**
 * Whether the signed-in user is an administrator, so the interface hides
 * every write from a viewer (AD-21). Only what it shows: the server's refusal
 * stays the authority, and a request it refuses reads the session again
 * (app.tsx), so a member demoted while a page is open sees a viewer's next.
 */
export function useIsAdmin(): boolean {
	return isAdmin(useQuery(sessionQuery).data);
}

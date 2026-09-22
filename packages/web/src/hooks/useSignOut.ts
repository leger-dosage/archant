import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

/**
 * Ends the session and empties the cache before leaving the page, so no
 * account name and no amount survives on screen for the next visitor. The
 * navigation happens whatever Better Auth answers: a sign-out that failed
 * still means the browser must stop showing this household's data.
 */
export function useSignOut(): () => Promise<void> {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	return async () => {
		// Swallowed on purpose: a sign-out the server refused still means this
		// browser must stop showing the household's data.
		await authClient.signOut().catch(() => undefined);
		queryClient.clear();
		await navigate({ to: "/connexion" });
	};
}

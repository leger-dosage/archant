import { queryOptions } from "@tanstack/react-query";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { ApiError, api, errorCodeOf, unwrap } from "./api";
import { queryKeys } from "./query-keys";

// Same origin as the rest of the API: Vite proxies `/api` in development,
// and the API serves the interface in production.
export const authClient = createAuthClient({
	basePath: "/api/auth",
	plugins: [adminClient()],
});

export type Session = typeof authClient.$Infer.Session;

/**
 * The signed-in session, or `null`. Cached until a call answers
 * `UNAUTHORIZED`, which sets it to `null` (main.tsx): asking Better Auth on every
 * navigation would add a round trip to each page for nothing.
 */
export const sessionQuery = queryOptions({
	queryKey: queryKeys.session,
	queryFn: async (): Promise<Session | null> => {
		// better-fetch throws the browser's `TypeError` when no response arrives,
		// and returns an error when one does but is not Better Auth's, such as
		// another server's 404 page: either way the API is not there.
		const { data, error } = await authClient.getSession().catch(() => {
			throw new ApiError("NETWORK_ERROR");
		});

		if (error !== null) {
			throw new ApiError("NETWORK_ERROR");
		}

		return data;
	},
	// Only `NETWORK_ERROR` is thrown: retrying would delay the page that says so by the backoff.
	retry: false,
	staleTime: Number.POSITIVE_INFINITY,
});

/** Whether first-launch setup is still open: no user exists yet. */
export async function isSetupOpen(): Promise<boolean> {
	try {
		await unwrap(api.setup.$get());

		return true;
	} catch (error) {
		if (errorCodeOf(error) === "FORBIDDEN") {
			return false;
		}

		throw error;
	}
}

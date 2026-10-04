import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { initI18n } from "@/lib/i18n";
import { queryKeys } from "@/lib/query-keys";
import { initTheme } from "@/lib/theme";

import { routeTree } from "./routeTree.gen";

initTheme();
await initI18n();

/**
 * The session ended, or never existed: forget it and go sign in, then come
 * back to this very URL. Any read or write can be the one that finds out.
 */
function signInAgain(error: unknown): boolean {
	if (errorCodeOf(error) !== "UNAUTHORIZED") {
		return false;
	}

	// Set to `null` rather than removed: several reads fail at once, and a
	// removal cancels the session fetch the sign-in page has already started.
	queryClient.setQueryData(queryKeys.session, null);

	const { href, pathname } = router.state.location;

	if (pathname !== "/sign-in") {
		void router.navigate({ to: "/sign-in", search: { redirect: href } });
	}

	return true;
}

/**
 * A request refused for the role: an administrator changed it since the
 * session was read. Read it again, and the page hides what this member can
 * no longer do; `_authed` runs the route guards again when the role differs.
 */
function readRoleAgain(error: unknown): void {
	if (errorCodeOf(error) === "FORBIDDEN") {
		void queryClient.invalidateQueries({ queryKey: queryKeys.session });
	}
}

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			// Coming back to the window refetched every query on the page at
			// once. Thirty seconds is shorter than a bank sync, and every write
			// invalidates what it changed anyway.
			staleTime: 30_000,
			// Retrying a lost session only delays the sign-in page by the backoff,
			// seven seconds with the default three retries.
			// A refusal for the role answers the same until the session is read again.
			retry: (failureCount, error) =>
				!["UNAUTHORIZED", "FORBIDDEN"].includes(errorCodeOf(error)) && failureCount < 3,
		},
	},
	// A failed read has no form to show it next to, so it becomes a toast. Writes
	// handle their own errors, where the fields are.
	queryCache: new QueryCache({
		onError: (error, query) => {
			if (signInAgain(error)) {
				return;
			}

			readRoleAgain(error);

			const code = errorCodeOf(error);

			// A detail the page works without, such as the running version, fails
			// silently rather than greeting every visit with a toast.
			if (query.meta?.["optional"] === true) {
				return;
			}

			// A page that shows its own « introuvable » state needs no toast on top.
			if (code === "NOT_FOUND" && query.meta?.["notFoundInline"] === true) {
				return;
			}

			showErrorToast(code);
		},
	}),
	mutationCache: new MutationCache({
		onError: (error) => {
			if (!signInAgain(error)) {
				readRoleAgain(error);
			}
		},
	}),
});

const router = createRouter({ routeTree, context: { queryClient } });

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const container = document.getElementById("root");

if (container === null) {
	throw new Error("The #root element is missing from index.html.");
}

createRoot(container).render(
	<StrictMode>
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
				<Toaster />
			</TooltipProvider>
		</QueryClientProvider>
	</StrictMode>,
);

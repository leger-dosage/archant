import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { isAdmin, isSetupOpen, sessionQuery } from "@/lib/auth-client";

/**
 * Every page behind the sign-in, inside Sure's shell: the rail, the accounts
 * column and the page. Without a session, the visitor goes to setup on a
 * first launch, and to sign-in otherwise, carrying the URL to come back to.
 */
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ context, location }) => {
		const session = await context.queryClient.ensureQueryData(sessionQuery);

		if (session !== null) {
			return { session };
		}

		if (await isSetupOpen()) {
			throw redirect({ to: "/setup" });
		}

		throw redirect({ to: "/sign-in", search: { redirect: location.href } });
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	const router = useRouter();
	const admin = useIsAdmin();
	const loadedAsAdmin = isAdmin(Route.useRouteContext({ select: ({ session }) => session }));

	// The role changed under an open page, read again on a refusal or when the
	// window comes back: the route guards run again, so a demoted member leaves
	// a page kept to administrators.
	useEffect(() => {
		if (admin !== loadedAsAdmin) {
			void router.invalidate();
		}
	}, [admin, loadedAsAdmin, router]);

	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}

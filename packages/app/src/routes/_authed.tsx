import { Outlet, createFileRoute, redirect, useMatches, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppShell } from "@/components/AppShell";
import { useFollowSavedLocale } from "@/hooks/useFollowSavedLocale";
import { useRole } from "@/hooks/usePermissions";
import { isSetupOpen, sessionQuery } from "@/lib/auth-client";

declare module "@tanstack/react-router" {
	interface StaticDataRouteOption {
		/** A page drawn without the shell, such as the reports' print layout. */
		bare?: boolean;
	}
}

/**
 * Every page behind the sign-in, inside Sure's shell, but a `bare` one: the rail, the accounts
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
	const role = useRole();
	useFollowSavedLocale();
	const loadedRole = Route.useRouteContext({ select: ({ session }) => session.user.role });
	const bare = useMatches({ select: (matches) => matches.at(-1)?.staticData.bare === true });

	// The role changed under an open page, read again on a refusal or when the
	// window comes back: the route guards run again, so a demoted user leaves a page
	// their new role cannot open.
	useEffect(() => {
		if (role !== loadedRole) {
			void router.invalidate();
		}
	}, [role, loadedRole, router]);

	return bare ? (
		<Outlet />
	) : (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}

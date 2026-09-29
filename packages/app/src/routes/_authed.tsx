import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/AppShell";
import { isSetupOpen, sessionQuery } from "@/lib/auth-client";

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
	return (
		<AppShell>
			<Outlet />
		</AppShell>
	);
}

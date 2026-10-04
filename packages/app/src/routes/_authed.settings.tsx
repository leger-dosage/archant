import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { isAdmin } from "@/lib/auth-client";

export const Route = createFileRoute("/_authed/settings")({
	// A viewer has one section, their own name, password and two-factor
	// sign-in. Every other, the bank pages included, reads or writes what the
	// server keeps to an administrator (AD-21), and would open on a refusal.
	beforeLoad: ({ context, location }) => {
		if (!isAdmin(context.session) && location.pathname !== "/settings/security") {
			throw redirect({ to: "/settings/security" });
		}
	},
	component: SettingsLayout,
});

/**
 * The settings sections. Their navigation sits in the shell's column
 * (`SettingsNav`); each section draws its own centred `Page`, so its `h1` and
 * its actions top the same 896 px column as its content, as in Sure.
 */
function SettingsLayout() {
	return <Outlet />;
}

import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { canAccessSettings } from "@/components/SettingsNav";

export const Route = createFileRoute("/_authed/settings")({
	beforeLoad: ({ context, location }) => {
		if (!canAccessSettings(location.pathname, context.session.user.role)) {
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

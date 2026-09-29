import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/settings")({
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

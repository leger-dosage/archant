import { createFileRoute, redirect } from "@tanstack/react-router";

// Sécurité is the only section, so `/reglages` opens it rather than showing an
// empty panel next to a one-entry list.
export const Route = createFileRoute("/_authed/reglages/")({
	beforeLoad: () => {
		throw redirect({ to: "/reglages/securite" });
	},
});

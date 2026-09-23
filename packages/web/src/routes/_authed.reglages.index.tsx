import { createFileRoute, redirect } from "@tanstack/react-router";

// `/reglages` opens the first section rather than an empty panel beside the list.
export const Route = createFileRoute("/_authed/reglages/")({
	beforeLoad: () => {
		throw redirect({ to: "/reglages/categories" });
	},
});

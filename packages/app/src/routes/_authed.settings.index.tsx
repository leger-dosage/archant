import { createFileRoute, redirect } from "@tanstack/react-router";

// `/settings` opens Catégories rather than an empty panel beside the list. Not
// Banques, the first section: opening the settings must never call the bank
// provider.
export const Route = createFileRoute("/_authed/settings/")({
	beforeLoad: () => {
		throw redirect({ to: "/settings/categories" });
	},
});

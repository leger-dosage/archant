import { createFileRoute, redirect } from "@tanstack/react-router";

// `/reglages` opens Catégories rather than an empty panel beside the list. Not
// Banques, the first section: opening the settings must never call the bank
// provider.
export const Route = createFileRoute("/_authed/reglages/")({
	beforeLoad: () => {
		throw redirect({ to: "/reglages/categories" });
	},
});

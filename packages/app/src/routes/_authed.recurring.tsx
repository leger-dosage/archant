import { createFileRoute, redirect } from "@tanstack/react-router";

// The former « Récurrences » page: its table is « Toutes les factures », its
// detection and cleanup « Réglages › Transactions récurrentes ». Old links
// and bookmarks land on the table.
export const Route = createFileRoute("/_authed/recurring")({
	beforeLoad: () => {
		throw redirect({ to: "/bills", search: { view: "all" }, replace: true });
	},
});

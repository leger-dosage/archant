import { createFileRoute, redirect } from "@tanstack/react-router";

// The dashboard takes this route with Epic 6; until then the accounts page is home.
export const Route = createFileRoute("/")({
	beforeLoad: () => {
		throw redirect({ to: "/comptes" });
	},
});

import { createFileRoute, redirect } from "@tanstack/react-router";

import { toIsoMonth } from "@/lib/dates";

// `/budgets` opens this month's budget, in the browser's own time zone, as
// the dashboard's month does.
export const Route = createFileRoute("/_authed/budgets/")({
	beforeLoad: () => {
		throw redirect({ to: "/budgets/$month", params: { month: toIsoMonth() }, replace: true });
	},
});

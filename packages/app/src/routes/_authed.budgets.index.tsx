import { createFileRoute, redirect } from "@tanstack/react-router";

import { api, unwrap } from "@/lib/api";

export const Route = createFileRoute("/_authed/budgets/")({
	beforeLoad: async () => {
		const { data } = await unwrap(api.budgets.current.$get());

		throw redirect({ to: "/budgets/$month", params: { month: data.month }, replace: true });
	},
});

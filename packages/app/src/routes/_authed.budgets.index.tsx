import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { api, unwrap } from "@/lib/api";

export const Route = createFileRoute("/_authed/budgets/")({
	validateSearch: z.object({ owner: z.string().optional().catch(undefined) }),
	beforeLoad: async ({ search }) => {
		const { data } = await unwrap(api.budgets.current.$get());

		throw redirect({ to: "/budgets/$month", params: { month: data.month }, search, replace: true });
	},
});

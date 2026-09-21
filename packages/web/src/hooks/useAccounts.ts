import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { CreateAccountInput } from "@archant/api/schemas/accounts";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type AccountListData = InferResponseType<typeof api.accounts.$get, 200>["data"];
export type AccountGroupData = AccountListData["groups"][number];

export function useAccounts() {
	return useQuery({
		queryKey: queryKeys.accounts.all,
		queryFn: async () => (await unwrap(api.accounts.$get())).data,
	});
}

export function useCreateAccount() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: CreateAccountInput) =>
			(await unwrap(api.accounts.$post({ json: input }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
	});
}

import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { CreateAccountInput, UpdateAccountInput } from "@archant/api/schemas/accounts";

import { useInvalidateAccount } from "@/hooks/useInvalidateAccount";
import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type AccountListData = InferResponseType<typeof api.accounts.$get, 200>["data"];
export type AccountGroupData = AccountListData["groups"][number];
export type AccountSummaryData = AccountGroupData["accounts"][number];

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

/** Saves a subset of an account's settings: name, subtype and the two flags. */
export function useUpdateAccount(accountId: string) {
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async (input: UpdateAccountInput) =>
			(await unwrap(api.accounts[":id"].$patch({ param: { id: accountId }, json: input }))).data,
		onSuccess: invalidate,
	});
}

/**
 * Deletes an account, then lands on `/comptes`. The navigation comes first,
 * while the mutation is still pending and nothing re-renders: a component
 * still reading the account would ask for it again once its queries are
 * removed, and fail with a NOT_FOUND toast.
 */
export function useDeleteAccount(accountId: string) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const invalidate = useInvalidateAccount(accountId);

	return useMutation({
		mutationFn: async () =>
			(await unwrap(api.accounts[":id"].$delete({ param: { id: accountId } }))).data,
		onSuccess: async () => {
			await navigate({ to: "/comptes" });
			await queryClient.cancelQueries({ queryKey: queryKeys.accounts.detail(accountId) });
			queryClient.removeQueries({ queryKey: queryKeys.accounts.detail(accountId) });
			queryClient.removeQueries({ queryKey: queryKeys.transactions.ofAccount(accountId) });
			await invalidate();
		},
	});
}

import type { AccountListData } from "@/hooks/useAccounts";
import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import type { GoalInput } from "@archant/api/schemas/goals";
import { canBackGoal } from "@archant/data/goals";
import type { CurrencyCode } from "@archant/data/money";
import { DEFAULT_CURRENCY, isCurrencyCode } from "@archant/data/money";

import { useAccounts } from "@/hooks/useAccounts";
import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type GoalData = InferResponseType<typeof api.goals.$get, 200>["data"][number];

export type GoalStatus = GoalData["status"];

/**
 * The accounts a goal's dialog offers, as Sure's: the active depository and
 * investment accounts, in the order the accounts list shows them, with the
 * currency amounts are read in before one is ticked.
 */
function fundableOf(list: AccountListData) {
	const reported = list.reportingCurrency;
	const reportingCurrency: CurrencyCode = isCurrencyCode(reported) ? reported : DEFAULT_CURRENCY;

	return {
		reportingCurrency,
		accounts: list.groups.flatMap((group) => group.accounts).filter(canBackGoal),
	};
}

export function useFundableAccounts() {
	return useAccounts({ select: fundableOf });
}

export function useGoals() {
	return useQuery({
		queryKey: queryKeys.accounts.goals,
		queryFn: async () => (await unwrap(api.goals.$get())).data,
	});
}

export function useGoal(id: string) {
	return useQuery({
		queryKey: queryKeys.accounts.goal(id),
		queryFn: async () => (await unwrap(api.goals[":id"].$get({ param: { id } }))).data,
		// A deleted goal stays deleted: retrying would only delay saying so.
		retry: (failureCount, error) =>
			!["NOT_FOUND", "UNAUTHORIZED"].includes(errorCodeOf(error)) && failureCount < 3,
	});
}

/** Goals share their accounts: one goal's write can change another's share. */
function useInvalidateGoals() {
	const queryClient = useQueryClient();

	return () => queryClient.invalidateQueries({ queryKey: queryKeys.accounts.goals });
}

export function useCreateGoal() {
	const invalidate = useInvalidateGoals();

	return useMutation({
		mutationFn: async (input: GoalInput) => (await unwrap(api.goals.$post({ json: input }))).data,
		onSuccess: invalidate,
	});
}

export function useUpdateGoal(id: string) {
	const invalidate = useInvalidateGoals();

	return useMutation({
		mutationFn: async (input: GoalInput) =>
			(await unwrap(api.goals[":id"].$put({ param: { id }, json: input }))).data,
		onSuccess: invalidate,
	});
}

/**
 * Deletes a goal, then lands on `/goals`. The navigation comes first, as an
 * account's delete does: the goal's page, still reading it, would ask for it
 * again once its query is removed, and fail with a NOT_FOUND toast.
 */
export function useDeleteGoal(id: string) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();

	return useMutation({
		mutationFn: async () => (await unwrap(api.goals[":id"].$delete({ param: { id } }))).data,
		onSuccess: async () => {
			await navigate({ to: "/goals" });
			await queryClient.cancelQueries({ queryKey: queryKeys.accounts.goal(id) });
			queryClient.removeQueries({ queryKey: queryKeys.accounts.goal(id) });
			await queryClient.invalidateQueries({ queryKey: queryKeys.accounts.goals });
		},
	});
}

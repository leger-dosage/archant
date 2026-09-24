import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BankCountry } from "@archant/data/bank-countries";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const bank = api["bank-connections"];

export type InstitutionData = InferResponseType<typeof bank.institutions.$get, 200>["data"][number];

export type BankConnectionData = InferResponseType<typeof bank.$get, 200>["data"][number];

/** Whether the server can connect a bank, and the variables it lacks otherwise. */
export function useBankSetup() {
	return useQuery({
		queryKey: queryKeys.bankConnections.setup,
		queryFn: async () => (await unwrap(bank.setup.$get())).data,
	});
}

/** A country's banks. Asked only once the setup says the provider is reachable. */
export function useInstitutions(country: BankCountry, enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.bankConnections.institutions(country),
		queryFn: async () => (await unwrap(bank.institutions.$get({ query: { country } }))).data,
		enabled,
		// A bank list moves a few times a year; switching countries back and
		// forth should not ask the provider again.
		staleTime: 60 * 60 * 1000,
	});
}

export function useBankConnections(enabled: boolean) {
	return useQuery({
		queryKey: queryKeys.bankConnections.list,
		queryFn: async () => (await unwrap(bank.$get())).data,
		enabled,
	});
}

/** Starts an authorisation; the caller sends the browser to the returned URL. */
export function useStartBankConnection() {
	return useMutation({
		mutationFn: async (input: { country: BankCountry; institution: string }) =>
			(await unwrap(bank.$post({ json: input }))).data,
	});
}

/** Posts what the bank put in the return URL. */
export function useCompleteBankConnection() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { code: string; state: string }) =>
			(await unwrap(bank.callback.$post({ json: input }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.list }),
	});
}

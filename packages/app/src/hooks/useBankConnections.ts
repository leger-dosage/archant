import type { QueryClient } from "@tanstack/react-query";
import type { InferRequestType, InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import type { BankCountry } from "@archant/data/bank-countries";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const bank = api["bank-connections"];

export type InstitutionData = InferResponseType<typeof bank.institutions.$get, 200>["data"][number];

export type BankConnectionData = InferResponseType<typeof bank.$get, 200>["data"][number];

export type BankConnectionAlert = NonNullable<BankConnectionData["alert"]>;

export type BankAccountData = InferResponseType<
	(typeof bank)[":id"]["accounts"]["$get"],
	200
>["data"][number];

export type BankAccountLink = InferRequestType<
	(typeof bank)[":id"]["accounts"]["$post"]
>["json"]["links"][number];

export type BankSetupData = InferResponseType<typeof bank.setup.$get, 200>["data"];

/**
 * Whether the server can connect a bank, where its Enable Banking
 * credentials come from, and the variable it lacks otherwise.
 */
export function useBankSetup() {
	return useQuery({
		queryKey: queryKeys.bankConnections.setup,
		queryFn: async () => (await unwrap(bank.setup.$get())).data,
	});
}

/**
 * Saves the Enable Banking application ID and the `.pem` file's text, once
 * the server has checked them with the provider. Its answer is the new setup.
 */
export function useSaveBankCredentials() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (input: { applicationId: string; privateKey: string }) =>
			(await unwrap(bank.credentials.$put({ json: input }))).data,
		onSuccess: async (setup) => {
			queryClient.setQueryData(queryKeys.bankConnections.setup, setup);
			await queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.setup });
		},
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

/** How often the list is read again while a sync runs. */
const SYNC_POLL_MS = 2000;

const isSyncing = (connections: BankConnectionData[] | undefined) =>
	connections?.some((connection) => connection.syncing) ?? false;

/**
 * What a sync changes: the connections' state, every account and
 * transaction list, and the recurring patterns, which the sync detects once
 * its lines are in.
 */
function invalidateSynced(queryClient: QueryClient) {
	return Promise.all([
		queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.list }),
		queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
		queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
		queryClient.invalidateQueries({ queryKey: queryKeys.recurring.all }),
	]);
}

/**
 * The connections. The first visit of the day syncs after the server has
 * answered, so while one says it syncs the list is read every two seconds,
 * and once none does, what the sync changed is read again.
 */
export function useBankConnections(enabled: boolean) {
	const queryClient = useQueryClient();
	const query = useQuery({
		queryKey: queryKeys.bankConnections.list,
		queryFn: async () => (await unwrap(bank.$get())).data,
		enabled,
		refetchInterval: (current) => (isSyncing(current.state.data) ? SYNC_POLL_MS : false),
	});
	const syncing = isSyncing(query.data);
	const wasSyncing = useRef(syncing);

	useEffect(() => {
		if (wasSyncing.current && !syncing) {
			void invalidateSynced(queryClient);
		}

		wasSyncing.current = syncing;
	}, [syncing, queryClient]);

	return query;
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
		// A first active connection locks the credentials.
		onSuccess: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.list }),
				queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.setup }),
			]),
	});
}

/** A connection's bank accounts, what each feeds and what it could feed. */
export function useBankAccounts(connectionId: string) {
	return useQuery({
		queryKey: queryKeys.bankConnections.accounts(connectionId),
		queryFn: async () =>
			(await unwrap(bank[":id"].accounts.$get({ param: { id: connectionId } }))).data,
		// An unknown connection stays unknown: the page says so at once rather
		// than after three retries.
		retry: (failureCount, error) =>
			!["NOT_FOUND", "UNAUTHORIZED"].includes(errorCodeOf(error)) && failureCount < 3,
	});
}

/**
 * Creates or links the chosen bank accounts. The answer is the new list;
 * every account query goes stale, since a new account or a new balance
 * shows in the accounts column.
 */
export function useLinkBankAccounts(connectionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (links: BankAccountLink[]) =>
			(await unwrap(bank[":id"].accounts.$post({ param: { id: connectionId }, json: { links } })))
				.data,
		onSuccess: async (list) => {
			queryClient.setQueryData(queryKeys.bankConnections.accounts(connectionId), list);
			await queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all });
		},
	});
}

/**
 * Starts a new consent on an existing connection; the caller sends the
 * browser to the returned URL. The connection keeps syncing on its old
 * consent until the bank sends the browser back.
 */
export function useRenewBankConnection() {
	return useMutation({
		mutationFn: async (connectionId: string) =>
			(await unwrap(bank[":id"].renew.$post({ param: { id: connectionId } }))).data,
	});
}

/**
 * Disconnects a bank. Its accounts stay, as manual ones: every account query
 * goes stale, since they lose their link, and the connection leaves the list.
 */
export function useDisconnectBankConnection() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (connectionId: string) =>
			(await unwrap(bank[":id"].$delete({ param: { id: connectionId } }))).data,
		// The connection's own bank account query is left to the page, which
		// drops it once it has moved on: dropped here, the page would ask for
		// it again and show a connection that no longer exists.
		onSuccess: async () => {
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.list }),
				// The last one gone unlocks the credentials.
				queryClient.invalidateQueries({ queryKey: queryKeys.bankConnections.setup }),
				queryClient.invalidateQueries({ queryKey: queryKeys.accounts.all }),
				queryClient.invalidateQueries({ queryKey: queryKeys.transactions.all }),
			]);
		},
	});
}

/**
 * Syncs a connection now. The answer is its new state, written into the
 * list at once; the bank's lines and balances change every account query,
 * every transaction list and the recurring patterns.
 */
export function useSyncBankConnection(connectionId: string) {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async () =>
			(await unwrap(bank[":id"].sync.$post({ param: { id: connectionId } }))).data,
		onSuccess: async (status) => {
			queryClient.setQueryData<BankConnectionData[]>(queryKeys.bankConnections.list, (list) =>
				list?.map((connection) =>
					connection.id === connectionId ? { ...connection, ...status } : connection,
				),
			);
			await invalidateSynced(queryClient);
		},
	});
}

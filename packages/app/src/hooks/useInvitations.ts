import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
	AcceptInvitationInput,
	CreateInvitationInput,
} from "@archant/api/schemas/invitations";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type InvitationData = InferResponseType<typeof api.invitations.$get, 200>["data"][number];

export type CreatedInvitationData = InferResponseType<typeof api.invitations.$post, 201>["data"];

export function useInvitations() {
	return useQuery({
		queryKey: queryKeys.invitations.all,
		queryFn: async () => (await unwrap(api.invitations.$get())).data,
	});
}

/** Invites an email; the answer holds the link, shown once. */
export function useCreateInvitation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (json: CreateInvitationInput) =>
			(await unwrap(api.invitations.$post({ json }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all }),
	});
}

/** Revokes a pending invitation: its link stops working at once. */
export function useRevokeInvitation() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (id: string) =>
			(await unwrap(api.invitations[":id"].$delete({ param: { id } }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all }),
		// Accepted, expired or revoked in another tab: the list still shows it.
		onError: (error) =>
			errorCodeOf(error) === "NOT_FOUND"
				? queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all })
				: undefined,
	});
}

/**
 * Who invites, as whom and for which email, for the link's page. The page
 * says itself when the link is no longer valid, so no toast, and no retry:
 * an invalid token stays invalid.
 */
export function useInvitationPreview(token: string) {
	return useQuery({
		queryKey: queryKeys.invitations.preview(token),
		queryFn: async () => (await unwrap(api.invitations.preview.$post({ json: { token } }))).data,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		meta: { optional: true },
	});
}

/** Creates the invited person's account; `signedIn` says whether a session came with it. */
export function useAcceptInvitation() {
	return useMutation({
		mutationFn: async (json: AcceptInvitationInput) =>
			(await unwrap(api.invitations.accept.$post({ json }))).data,
	});
}

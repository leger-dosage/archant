import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { MemberRoleInput } from "@archant/api/schemas/members";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type MemberData = InferResponseType<typeof api.members.$get, 200>["data"][number];

export function useMembers() {
	return useQuery({
		queryKey: queryKeys.members.all,
		queryFn: async () => (await unwrap(api.members.$get())).data,
	});
}

/**
 * A change to a member: both the members and the pending invitations are
 * read again, since a demotion or a removal deletes the invitations that
 * member sent. Removed or changed in another tab, `NOT_FOUND`, the list
 * still shows them as they were, so it is read again too.
 */
function useMemberChange<Input>(send: (input: Input) => Promise<unknown>) {
	const queryClient = useQueryClient();
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: queryKeys.members.all }),
			queryClient.invalidateQueries({ queryKey: queryKeys.invitations.all }),
		]);

	return useMutation({
		mutationFn: send,
		onSuccess: refresh,
		onError: (error) => (errorCodeOf(error) === "NOT_FOUND" ? refresh() : undefined),
	});
}

/** Gives another member a role, applied at their next request. */
export function useSetMemberRole() {
	return useMemberChange(async ({ id, role }: MemberRoleInput & { id: string }) =>
		unwrap(api.members[":id"].$patch({ param: { id }, json: { role } })),
	);
}

/** Removes another member, signed out everywhere at once. */
export function useRemoveMember() {
	return useMemberChange(async (id: string) =>
		unwrap(api.members[":id"].$delete({ param: { id } })),
	);
}

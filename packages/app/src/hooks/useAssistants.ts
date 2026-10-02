import type { InferResponseType } from "hono/client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, errorCodeOf, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

type AssistantsData = InferResponseType<typeof api.assistants.$get, 200>["data"];

export type AssistantData = AssistantsData["assistants"][number];

export function useAssistants() {
	return useQuery({
		queryKey: queryKeys.assistants.all,
		queryFn: async () => (await unwrap(api.assistants.$get())).data,
	});
}

/** Disconnects an assistant: its next call is refused, its refresh token too. */
export function useDisconnectAssistant() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (clientId: string) =>
			(await unwrap(api.assistants[":clientId"].$delete({ param: { clientId } }))).data,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.assistants.all }),
		// Disconnected in another tab: the list still shows it.
		onError: (error) =>
			errorCodeOf(error) === "ASSISTANT_NOT_FOUND"
				? queryClient.invalidateQueries({ queryKey: queryKeys.assistants.all })
				: undefined,
	});
}

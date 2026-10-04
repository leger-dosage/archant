import type { InferResponseType } from "hono/client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { api, unwrap } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export type SecuritySearchData = InferResponseType<typeof api.securities.$get, 200>["data"];

/** How long typing pauses before a search leaves: the provider hears every one. */
const DEBOUNCE_MS = 300;

/** The server refuses a longer query; it travels to the provider as is. */
const MAX_QUERY_LENGTH = 64;

/**
 * The trade form's search: the securities already known, then the
 * provider's listings, for the text typed once it pauses. Nothing is asked
 * for an empty text.
 */
export function useSecuritySearch(text: string) {
	const [query, setQuery] = useState(text.trim());

	useEffect(() => {
		const timer = setTimeout(() => setQuery(text.trim().slice(0, MAX_QUERY_LENGTH)), DEBOUNCE_MS);

		return () => clearTimeout(timer);
	}, [text]);

	return useQuery({
		queryKey: queryKeys.securities.search(query),
		queryFn: async () => (await unwrap(api.securities.$get({ query: { q: query } }))).data,
		enabled: query !== "",
		placeholderData: keepPreviousData,
		meta: { optional: true },
	});
}

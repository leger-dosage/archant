import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "./api";
import { authClient } from "./auth-client";

export const signInOptionsQuery = queryOptions({
	queryKey: ["sign-in-options"],
	queryFn: async () => (await unwrap(api["sign-in-options"].$get())).data,
	staleTime: Infinity,
});

export const OPENID_PROVIDER = "openid-connect";

export async function signInWithOpenIdConnect(callbackURL: string, invitationToken?: string) {
	return authClient.signIn.social({
		provider: OPENID_PROVIDER,
		callbackURL,
		...(invitationToken ? { additionalData: { invitationToken } } : {}),
	});
}

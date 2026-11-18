import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

import {
	browserSupportsWebAuthn,
	startAuthentication,
	startRegistration,
} from "@simplewebauthn/browser";
import { queryOptions } from "@tanstack/react-query";

import { authClient } from "./auth-client";

export const passkeyConfigQuery = queryOptions({
	queryKey: ["passkey-config"],
	queryFn: async () => {
		if (!globalThis.isSecureContext || !browserSupportsWebAuthn()) {
			return { available: false, standalone: false };
		}

		const { data } = await authClient.$fetch<{ available: boolean; standalone: boolean }>(
			"/passkey/config",
		);

		return data ?? { available: false, standalone: false };
	},
	staleTime: Infinity,
});

export async function registerPasskey(name: string, code: string) {
	const { data, error } = await authClient.$fetch<PublicKeyCredentialCreationOptionsJSON>(
		"/passkey/registration-options",
		{ method: "POST", body: { name, code } },
	);
	if (error) {
		return error;
	}

	const response = await startRegistration({ optionsJSON: data });
	const result = await authClient.$fetch("/passkey/register", {
		method: "POST",
		body: { response, code },
	});

	return result.error;
}

export async function signInWithPasskey(mode: "standalone" | "second-factor") {
	const { data, error } = await authClient.$fetch<PublicKeyCredentialRequestOptionsJSON>(
		"/passkey/sign-in-options",
		{ method: "POST", body: { mode } },
	);
	if (error) {
		return { data, error };
	}

	const response = await startAuthentication({ optionsJSON: data });

	return authClient.$fetch("/passkey/sign-in", { method: "POST", body: { mode, response } });
}

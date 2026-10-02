import { authClient } from "@/lib/auth-client";

/**
 * Better Auth's calls the sign-in, setup and security pages make, in one
 * place, so a page holds its form and never the client. Each answers Better
 * Auth's own `{ data, error }`; the page decides what an error means.
 */
const AUTH_ACTIONS = {
	signIn: async (credentials: { email: string; password: string }) =>
		authClient.signIn.email(credentials),
	verifyTotp: async (code: string) => authClient.twoFactor.verifyTotp({ code }),
	verifyBackupCode: async (code: string) => authClient.twoFactor.verifyBackupCode({ code }),
	enableTwoFactor: async (password: string) => authClient.twoFactor.enable({ password }),
	generateBackupCodes: async (password: string) =>
		authClient.twoFactor.generateBackupCodes({ password }),
	disableTwoFactor: async (password: string) => authClient.twoFactor.disable({ password }),
	rename: async (name: string) => authClient.updateUser({ name }),
	// Better Auth revokes every other session and hands this browser a fresh
	// cookie; nothing here touches a session itself (AD-13).
	changePassword: async (passwords: { currentPassword: string; newPassword: string }) =>
		authClient.changePassword({ ...passwords, revokeOtherSessions: true }),
	// The assistant asking, by the name it registered under.
	assistantClient: async (clientId: string) =>
		authClient.oauth2.publicClient({ query: { client_id: clientId } }),
	// The answer to the request in the page's signed query, which
	// `oauthProviderClient` attaches; `scope` lists what the owner granted.
	consent: async (answer: { accept: boolean; scope?: string }) => authClient.oauth2.consent(answer),
};

export function useAuthActions(): typeof AUTH_ACTIONS {
	return AUTH_ACTIONS;
}

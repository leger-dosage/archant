import type { secureHeaders } from "hono/secure-headers";

/**
 * The SHA-256 of the inline theme script in `packages/app/index.html`, the
 * one script the page runs that is not a file of its own origin. Any edit to
 * that script changes it; `content-security-policy.spec.ts` fails with the
 * new value.
 */
export const THEME_SCRIPT_HASH = "sha256-rAeCpAn2Kteerk13PeCDOI8kvlaCDjXxkwzZgMe0DQU=";

type Policy = NonNullable<
	NonNullable<Parameters<typeof secureHeaders>[0]>["contentSecurityPolicy"]
>;

/** Where Enable Banking serves the logos its bank list names. */
const BANK_LOGO_ORIGIN = "https://enablebanking.com";

/**
 * Injected text cannot run script, reach another host, load a plugin, move
 * relative URLs elsewhere, post a form away, embed or frame the page. Styles
 * allow `'unsafe-inline'`: sonner, the chart and radix's scroll lock inject
 * `<style>` at runtime. Images allow `data:`, the bank logos on Enable
 * Banking's site, and always `ENABLE_BANKING_API_URL`'s origin: harmless in
 * production, where it is Enable Banking's API, and needed by the end-to-end
 * fake, which serves the logos itself.
 */
export function contentSecurityPolicy(bankApiUrl: string): Policy {
	return {
		defaultSrc: ["'self'"],
		scriptSrc: ["'self'", `'${THEME_SCRIPT_HASH}'`],
		styleSrc: ["'self'", "'unsafe-inline'"],
		imgSrc: ["'self'", "data:", BANK_LOGO_ORIGIN, new URL(bankApiUrl).origin],
		connectSrc: ["'self'"],
		objectSrc: ["'none'"],
		baseUri: ["'none'"],
		formAction: ["'self'"],
		frameSrc: ["'none'"],
		frameAncestors: ["'none'"],
	};
}

/**
 * The policy an attachment is served under: the app's, plus `sandbox`. A
 * file opened in its own tab then runs no script and gets an opaque origin,
 * so a PDF or an SVG crafted to run one could never reach the session or the
 * API, even if a type were ever misread. Chromium's PDF viewer still shows
 * the file under it.
 */
export function attachmentContentSecurityPolicy(bankApiUrl: string): Policy {
	return { ...contentSecurityPolicy(bankApiUrl), sandbox: [] };
}

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

/**
 * Injected text cannot run script, reach another host, load a plugin, move
 * relative URLs elsewhere or frame the page. No `default-src` and no
 * `style-src`: sonner, the chart and radix's scroll lock inject `<style>` at
 * runtime, and bank logos load from Enable Banking's host.
 */
export const CONTENT_SECURITY_POLICY: Policy = {
	scriptSrc: ["'self'", `'${THEME_SCRIPT_HASH}'`],
	connectSrc: ["'self'"],
	objectSrc: ["'none'"],
	baseUri: ["'none'"],
	frameAncestors: ["'none'"],
};

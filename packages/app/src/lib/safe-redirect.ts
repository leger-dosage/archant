/**
 * Browsers drop tabs and newlines from a URL and read a backslash as a slash,
 * so `/<tab>/host` or `/\host` would still reach another host.
 */
function hasUnsafeCharacter(target: string): boolean {
	for (let index = 0; index < target.length; index++) {
		const code = target.charCodeAt(index);

		// 0x5c is the backslash.
		if (code <= 0x1f || code === 0x7f || code === 0x5c) {
			return true;
		}
	}

	return false;
}

/**
 * Where to go after signing in. Only a path on this site is followed: `//`
 * starts a protocol-relative URL, which would send a freshly signed-in user
 * to another host, the classic open redirect.
 */
export function safeRedirect(target: string | undefined): string {
	if (
		target === undefined ||
		!target.startsWith("/") ||
		target.startsWith("//") ||
		hasUnsafeCharacter(target)
	) {
		return "/";
	}

	return target;
}

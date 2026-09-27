import { Hono } from "hono";

export type VersionDeps = {
	/** `APP_VERSION`, such as `1.2.3`; `null` for a development build. */
	version: string | null;
};

/**
 * The running release, for « Réglages ». Behind the session guard, unlike
 * health: an anonymous visitor must not learn which release to attack.
 */
export function versionRoutes(deps: VersionDeps) {
	return new Hono().get("/", (c) => c.json({ data: { version: deps.version } }, 200));
}

import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { type Plugin, loadEnv } from "vite";
import { defineConfig } from "vitest/config";

/**
 * Fails the build when Drizzle reaches the interface. A constant imported from
 * a schema file brought the whole ORM into the browser bundle, though the
 * browser never queries a database; constants the interface needs live in
 * `@archant/data` modules that import no Drizzle.
 */
function noDrizzleInBundle(): Plugin {
	return {
		name: "archant:no-drizzle-in-bundle",
		apply: "build",
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				const drizzle =
					output.type === "chunk"
						? output.moduleIds.find((id) => id.includes("/drizzle-orm/"))
						: undefined;

				if (drizzle !== undefined) {
					this.error(
						`Drizzle must not reach the browser bundle: ${output.fileName} includes ${drizzle}`,
					);
				}
			}
		},
	};
}

export default defineConfig(({ mode }) => {
	// `PORT` is the API's port, read from the same root `.env` the API loads, so
	// the proxy follows it. Only `PORT` is loaded: the prefix keeps the other variables,
	// secrets included, out of Vite. Empty means 8787, as for the API. Vite's
	// own port is a flag, never this variable.
	const { PORT } = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), "PORT");
	const apiTarget = `http://localhost:${PORT || "8787"}`;

	return {
		// The router plugin must run before React's, so the generated route tree
		// exists by the time components are transformed.
		plugins: [
			tanstackRouter({ target: "react", autoCodeSplitting: true }),
			react(),
			tailwindcss(),
			noDrizzleInBundle(),
		],
		resolve: {
			alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
		},
		server: {
			port: 5173,
			// Same origin in the browser, so no CORS and no API URL baked into the
			// bundle; in production the API serves the built interface itself.
			// `/.well-known` too: an assistant pointed at the dev server discovers
			// its authorisation server there, outside `/api`.
			proxy: { "/api": apiTarget, "/.well-known": apiTarget },
		},
		preview: { proxy: { "/api": apiTarget, "/.well-known": apiTarget } },
		test: {
			environment: "node",
			include: ["src/**/*.spec.{ts,tsx}"],
			// Vitest blanks every CSS import by default, `?raw` included; the theme's
			// contrast test reads the tokens from the stylesheet itself.
			css: { include: [/styles\.css/u] },
		},
	};
});

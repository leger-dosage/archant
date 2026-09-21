import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
	// `PORT` is the API's port, read from the same root `.env` the API loads, so
	// the proxy follows it; the end-to-end suite sets it to run beside the dev
	// servers. Only `PORT` is loaded: the prefix keeps the other variables,
	// secrets included, out of Vite. Empty means 8787, as for the API. Vite's
	// own port is a flag, never this variable.
	const { PORT } = loadEnv(mode, fileURLToPath(new URL("../..", import.meta.url)), "PORT");
	const apiTarget = `http://localhost:${PORT || "8787"}`;

	return {
		// The router plugin must run before React's, so the generated route tree
		// exists by the time components are transformed.
		plugins: [tanstackRouter({ target: "react", autoCodeSplitting: true }), react(), tailwindcss()],
		resolve: {
			alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
		},
		server: {
			port: 5173,
			// Same origin in the browser, so no CORS and no API URL baked into the
			// bundle; in production the API will serve the interface (Epic 3).
			proxy: { "/api": apiTarget },
		},
		preview: { proxy: { "/api": apiTarget } },
		test: {
			environment: "node",
			include: ["src/**/*.spec.{ts,tsx}"],
		},
	};
});

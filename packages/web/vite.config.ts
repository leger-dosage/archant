import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const API_TARGET = "http://localhost:8787";

export default defineConfig({
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
		proxy: { "/api": API_TARGET },
	},
	preview: { proxy: { "/api": API_TARGET } },
	test: {
		environment: "node",
		include: ["src/**/*.spec.{ts,tsx}"],
	},
});

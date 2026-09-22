import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./vitest.setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			// Entrypoints are wiring with nothing to assert: they read the
			// environment and call what is covered elsewhere.
			exclude: ["src/**/*.spec.ts", "src/index.ts", "src/cli/**"],
			reporter: ["text-summary"],
			// AD-16: the money paths are covered to the branch. Everything else is
			// held to what its tests naturally reach.
			thresholds: {
				"src/domain/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
				"src/services/ledger.ts": { branches: 100, functions: 100, lines: 100, statements: 100 },
				"src/connectors/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
			},
		},
	},
});

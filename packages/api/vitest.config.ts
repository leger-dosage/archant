import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		setupFiles: ["./vitest.setup.ts"],
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.spec.ts", "src/index.ts"],
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

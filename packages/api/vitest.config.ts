import { configDefaults, defineConfig } from "vitest/config";

// NFR10's timings, apart: beside the other files, and instrumented for
// coverage, a 24,000-line import measured a third slower than on its own, and
// the spec then timed the machine's load rather than the code.
const VOLUME = "src/services/history-volume.spec.ts";

export default defineConfig({
	test: {
		setupFiles: ["./vitest.setup.ts"],
		projects: [
			{ extends: true, test: { name: "unit", exclude: [...configDefaults.exclude, VOLUME] } },
			{ extends: true, test: { name: "volume", include: [VOLUME] } },
		],
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
				"src/services/ledger/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
				"src/connectors/**": { branches: 100, functions: 100, lines: 100, statements: 100 },
			},
		},
	},
});

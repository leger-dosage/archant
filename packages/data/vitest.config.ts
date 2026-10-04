import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: ["goals.ts", "micros.ts", "money.ts", "months.ts"],
			reporter: ["text-summary"],
			// AD-16: the money paths are covered to the branch, and the months the
			// reports sum, the goal transitions and AD-22's millionths are part of them.
			thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
		},
	},
});

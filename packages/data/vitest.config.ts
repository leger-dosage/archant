import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			include: [
				"dashboard-layout.ts",
				"decimals.ts",
				"goals.ts",
				"micros.ts",
				"money.ts",
				"months.ts",
				"report-periods.ts",
				"reports-layout.ts",
			],
			reporter: ["text-summary"],
			// AD-16: the money paths are covered to the branch, and the months the
			// reports sum, the goal transitions and AD-22's millionths and decimals are part of them; the dashboard and reports layouts and the report periods, pure, are held to the bar the API's domain was.
			thresholds: { branches: 100, functions: 100, lines: 100, statements: 100 },
		},
	},
});

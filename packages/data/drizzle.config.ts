import { defineConfig } from "drizzle-kit";

// Only `drizzle-kit generate` reads this file. Applying migrations goes through
// `migrate.ts`, which needs nothing but the runtime driver, so the production
// image can migrate on start without carrying drizzle-kit.
export default defineConfig({
	dialect: "sqlite",
	schema: "./schema/*.ts",
	out: "./drizzle",
});

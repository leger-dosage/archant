import type { ServiceDeps } from "./deps.ts";

import { categories } from "@archant/data/schema/categories";
import { settings } from "@archant/data/schema/settings";

import { DEFAULT_CATEGORIES } from "./default-categories.ts";

const SEEDED_KEY = "defaults_seeded_at";

/**
 * Inserts the default categories once per instance, and returns how many it
 * inserted. The `defaults_seeded_at` row is claimed through its primary key in
 * the same transaction (AD-12): a later start finds it and inserts nothing, so
 * a default the user deleted never comes back, and of two servers starting at
 * once only one seeds.
 */
export async function seedDefaults(deps: Pick<ServiceDeps, "db">): Promise<number> {
	return deps.db.transaction(
		async (tx) => {
			const now = Date.now();
			const claimed = await tx
				.insert(settings)
				.values({ key: SEEDED_KEY, value: String(now), updatedAt: now })
				.onConflictDoNothing()
				.returning({ key: settings.key });

			if (claimed.length === 0) {
				return 0;
			}

			await tx.insert(categories).values(
				DEFAULT_CATEGORIES.map((category) => ({
					id: crypto.randomUUID(),
					...category,
					parentId: null,
					createdAt: now,
					updatedAt: now,
				})),
			);

			return DEFAULT_CATEGORIES.length;
		},
		{ behavior: "immediate" },
	);
}

import type { Page } from "@playwright/test";

import { daysAgo, expect, test } from "./fixtures.ts";

// Story 27.23: a tab opened before an image upgrade asks for chunks the new
// image no longer has. The balance chart is a `React.lazy` chunk an account's
// page asks for once the app has mounted, the case TanStack's own reload of a
// route chunk never covers, so only `main.tsx`'s listener can reload for it.

const BALANCE_CHART = "**/assets/BalanceChart-*.js";

/** Answers `404` for the balance chart's chunk, on its first request or always. */
async function removeBalanceChart(page: Page, { always }: { always: boolean }) {
	let requested = false;
	await page.route(BALANCE_CHART, async (route) => {
		if (always || !requested) {
			requested = true;
			await route.fulfill({ status: 404, body: "" });
			return;
		}

		await route.fallback();
	});
}

/** Counts the documents `page` loads from now on. */
function documentsOf(page: Page): () => number {
	let count = 0;
	page.on("response", (response) => {
		if (response.request().resourceType() === "document") {
			count += 1;
		}
	});

	return () => count;
}

async function navigationType(page: Page): Promise<string> {
	return page.evaluate(() => {
		const [entry] = performance.getEntriesByType("navigation");
		return entry instanceof PerformanceNavigationTiming ? entry.type : "none";
	});
}

const chart = (page: Page) => page.locator(".recharts-wrapper");

const errorHeading = (page: Page) =>
	page.getByRole("heading", { level: 1, name: "Une erreur est survenue" });

test("a chunk gone after an upgrade reloads the page, which then shows", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	await removeBalanceChart(page, { always: false });
	const documents = documentsOf(page);

	await page.goto(`/accounts/${account.id}`);

	await expect(chart(page)).toBeVisible();
	expect(await navigationType(page)).toBe("reload");
	expect(documents()).toBe(2);
});

test("a chunk really missing reloads once, then shows the error and stops", async ({
	page,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	await removeBalanceChart(page, { always: true });
	const documents = documentsOf(page);

	await page.goto(`/accounts/${account.id}`);

	await expect(errorHeading(page)).toBeVisible();
	expect(await navigationType(page)).toBe("reload");
	expect(documents()).toBe(2);
	// No assertion retries for a request that never comes: a third load would
	// start at once, as the second did, so two seconds without one shows the
	// page has stopped reloading.
	await page.waitForTimeout(2000);
	expect(documents()).toBe(2);
	await expect(errorHeading(page)).toBeVisible();
});

test("a second upgrade later in the same tab reloads again", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	await page.addInitScript(() => {
		if (sessionStorage.getItem("archant.reloadedAt") === null) {
			sessionStorage.setItem("archant.reloadedAt", String(Date.now() - 60_000));
		}
	});
	await removeBalanceChart(page, { always: false });
	const documents = documentsOf(page);

	await page.goto(`/accounts/${account.id}`);

	await expect(chart(page)).toBeVisible();
	expect(await navigationType(page)).toBe("reload");
	expect(documents()).toBe(2);
});

test("without storage the page does not reload, it shows the error", async ({ page, api }) => {
	const account = await api.openAccount({ openingDate: daysAgo(60) });
	await page.addInitScript(() => {
		Object.defineProperty(window, "sessionStorage", {
			get() {
				throw new DOMException("disabled", "SecurityError");
			},
		});
	});
	await removeBalanceChart(page, { always: true });
	const documents = documentsOf(page);

	await page.goto(`/accounts/${account.id}`);

	await expect(errorHeading(page)).toBeVisible();
	// As above: a reload would start at once.
	await page.waitForTimeout(2000);
	expect(documents()).toBe(1);
	expect(await navigationType(page)).toBe("navigate");
});

import type { APIRequestContext, Page } from "@playwright/test";

import { z } from "zod";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 32.12: Sure's quick-categorise wizard. The database is shared by the
// run, so the groups of other files sort beside these: each test reads its
// group's position through the API, then opens the wizard there.

test.afterEach(async ({ api }) => {
	await api.deleteRules();
});

const stepBody = z.object({ data: z.object({ group: z.object({ name: z.string() }).nullable() }) });

/** The wizard's position of the group named `name`. */
async function positionOf(request: APIRequestContext, name: string): Promise<number> {
	for (let position = 0; ; position += 1) {
		// oxlint-disable-next-line eslint/no-await-in-loop -- each position depends on the last being another group
		const response = await request.get(`/api/transactions/categorize?position=${position}`);
		// oxlint-disable-next-line eslint/no-await-in-loop -- the same read
		const { group } = stepBody.parse(await response.json()).data;

		if (group === null) {
			throw new Error(`No group named ${name}`);
		}

		if (group.name === name) {
			return position;
		}
	}
}

const listBody = z.object({
	data: z.object({
		items: z.array(z.object({ label: z.string(), categoryId: z.string().nullable() })),
	}),
});

/** The category of each line whose label contains `q`, most recent first. */
async function categoriesOf(request: APIRequestContext, q: string) {
	const response = await request.get(`/api/transactions?q=${encodeURIComponent(q)}`);

	return listBody.parse(await response.json()).data.items.map((item) => item.categoryId);
}

const heading = (page: Page) => page.getByRole("main").getByRole("heading", { level: 2 });

test("categorises a group with Sure's rule, then a group line by line", async ({
	page,
	api,
	request,
}) => {
	const account = await api.openAccount();
	const streaming = uniqueName("PRLV STREAMING");
	const gym = uniqueName("CB SALLE");
	await [0, 1, 2]
		.map((index) => ({ label: streaming, index }))
		.concat([0, 1].map((index) => ({ label: gym, index })))
		.reduce(async (previous, { label, index }) => {
			await previous;
			await api.addTransaction(account.id, { date: daysAgo(index + 2), label, amount: "-12,00" });
		}, Promise.resolve());
	const subscriptions = await api.createCategory({ name: uniqueName("Abonnements") });
	const sport = await api.createCategory({ name: uniqueName("Sport") });
	const leisure = await api.createCategory({ name: uniqueName("Loisirs") });

	await page.goto("/transactions");
	await page.getByRole("link", { name: /^Catégoriser \(\d+\)$/u }).click();
	await expect(page).toHaveURL(/\/transactions\/categorize$/u);
	await expect(page.getByText(/opérations? non catégorisées? restantes?$/u)).toBeVisible();

	await page.goto(`/transactions/categorize?position=${await positionOf(request, streaming)}`);
	await expect(heading(page)).toHaveText(streaming);
	await expect(page.getByText("3 opérations ·")).toBeVisible();
	await expect(
		page.getByRole("checkbox", { name: "Créer une règle de catégorisation" }),
	).toBeChecked();
	await page.getByRole("button", { name: subscriptions.name, exact: true }).click();

	await expect
		.poll(() => categoriesOf(request, streaming))
		.toEqual(Array(3).fill(subscriptions.id));
	const rules = await request.get("/api/rules");
	expect(await rules.json()).toMatchObject({
		data: [
			{
				name: streaming,
				enabled: true,
				conditions: [
					{ conditionType: "transaction_name", operator: "like", value: streaming },
					{ conditionType: "transaction_type", operator: "=", value: "expense" },
				],
				actions: [{ actionType: "set_transaction_category", value: subscriptions.id }],
			},
		],
	});

	await page.goto(`/transactions/categorize?position=${await positionOf(request, gym)}`);
	await expect(heading(page)).toHaveText(gym);
	const lines = page.getByRole("region", { name: "Opérations du groupe" }).getByRole("listitem");
	await expect(lines).toHaveCount(2);
	// Leaving a line out unticks the rule, as Sure's `uncheckRule`.
	await lines
		.first()
		.getByRole("checkbox", { name: `Inclure ${gym}` })
		.click();
	await expect(
		page.getByRole("checkbox", { name: "Créer une règle de catégorisation" }),
	).not.toBeChecked();
	await lines
		.first()
		.getByRole("combobox", { name: `Assigner une catégorie pour ${gym}` })
		.click();
	await page.getByRole("option", { name: leisure.name, exact: true }).click();
	// The group stays, its other line still to do, as Sure's page removes the row alone.
	await expect(lines).toHaveCount(1);
	await expect(heading(page)).toHaveText(gym);
	await expect(
		page.getByRole("checkbox", { name: "Créer une règle de catégorisation" }),
	).not.toBeChecked();
	await page.getByRole("button", { name: sport.name, exact: true }).click();

	await expect.poll(() => categoriesOf(request, gym)).toEqual([leisure.id, sport.id]);
	const after = await request.get("/api/rules");
	expect(z.object({ data: z.array(z.unknown()) }).parse(await after.json()).data).toHaveLength(1);
});

test("an edited rule text previews the lines it matches, which take the category with the rule", async ({
	page,
	api,
	request,
}) => {
	const account = await api.openAccount();
	const prefix = uniqueName("CB PHARMACIE");
	const labels = [`${prefix} CENTRE`, `${prefix} GARE`];
	await labels.reduce(async (previous, label, index) => {
		await previous;
		await api.addTransaction(account.id, { date: daysAgo(index + 2), label, amount: "-8,50" });
	}, Promise.resolve());
	const health = await api.createCategory({ name: uniqueName("Santé") });

	await page.goto(
		`/transactions/categorize?position=${await positionOf(request, labels[0] ?? "")}`,
	);
	const rule = page.getByRole("checkbox", { name: "Créer une règle de catégorisation" });
	// A single line: Sure leaves the rule unticked.
	await expect(rule).not.toBeChecked();
	await rule.click();
	await page.getByRole("button", { name: "Modifier le texte de la règle" }).click();
	await page.getByRole("textbox", { name: "Texte de la règle" }).fill(prefix);
	await page.getByRole("textbox", { name: "Texte de la règle" }).press("Enter");

	await expect(heading(page)).toHaveText(prefix);
	const lines = page.getByRole("region", { name: "Opérations du groupe" }).getByRole("listitem");
	await expect(lines).toHaveCount(2);
	await page.getByRole("button", { name: health.name, exact: true }).click();

	await expect.poll(() => categoriesOf(request, prefix)).toEqual([health.id, health.id]);
	const rules = await request.get("/api/rules");
	expect(await rules.json()).toMatchObject({
		data: [{ name: prefix, conditions: [{ value: prefix }, { value: "expense" }] }],
	});
});

test("past the last group, the wizard goes back to « Opérations », as Sure's « all_done »", async ({
	page,
}) => {
	await page.goto("/transactions/categorize?position=100000");

	await expect(page).toHaveURL(/\/transactions$/u);
	await expect(page.getByText("Toutes les opérations sont catégorisées")).toBeVisible();
});

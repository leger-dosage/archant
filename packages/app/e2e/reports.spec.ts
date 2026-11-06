import { readFile } from "node:fs/promises";

import { daysAgo, expect, test, uniqueName } from "./fixtures.ts";

// Story 34.7: Sure's « Rapports », its CSV and its print layout. Reordering
// and collapsing the sections changes the single administrator's layout, so
// those tests live in `reports-layout.spec.ts`, in the `layout` project.

/** The quarter `back` quarters before today's: its label, first and last days. */
function quarter(back: number) {
	const today = daysAgo(0);
	const index = Number(today.slice(0, 4)) * 4 + Math.ceil(Number(today.slice(5, 7)) / 3) - 1 - back;
	const year = Math.floor(index / 4);
	const first = (index % 4) * 3 + 1;
	const last = new Date(Date.UTC(year, first + 2, 0)).toISOString().slice(0, 10);

	return {
		label: `Q${(index % 4) + 1} ${year}`,
		from: `${year}-${String(first).padStart(2, "0")}-01`,
		to: last,
	};
}

/** `2026-10-01` as the print layout writes it: « 1 octobre 2026 ». */
const longDate = (iso: string) =>
	new Intl.DateTimeFormat("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${iso}T00:00:00Z`));

/** The button naming the period, which opens the picker. */
const periodButton = (label: string) => ({ name: new RegExp(`^${label},`, "u") });

test("« Rapports » opens from the navigation, steps a quarter by keyboard, exports its CSV and prints the period shown", async ({
	page,
	context,
	api,
}) => {
	const account = await api.openAccount({ openingDate: daysAgo(70) });
	const category = await api.createCategory({ name: uniqueName("Rapport") });
	const recent = await api.addTransaction(account.id, {
		date: daysAgo(0),
		label: "Courses",
		amount: "-42,00",
	});
	const older = await api.addTransaction(account.id, {
		date: daysAgo(35),
		label: "Courses",
		amount: "-18,00",
	});
	await api.categorise([recent, older], category.id);
	// Sure's print layout opens the dialog itself, which would hold the test:
	// the stub counts the calls instead.
	await context.addInitScript(() => {
		window.print = () => {
			Reflect.set(window, "printed", Number(Reflect.get(window, "printed") ?? 0) + 1);
		};
	});
	const current = quarter(0);

	await page.goto("/");
	await page
		.getByRole("navigation", { name: "Navigation principale" })
		.getByRole("link", { name: "Rapports" })
		.click();
	await expect(page.getByRole("heading", { level: 1, name: "Rapports" })).toBeVisible();
	await expect(page.getByRole("region", { name: "Répartition des activités" })).toContainText(
		category.name,
	);

	await page.getByRole("link", { name: "Trimestriel" }).click();
	await expect(page.getByRole("button", periodButton(current.label))).toBeVisible();
	await expect(page.getByRole("button", { name: "Période suivante" })).toBeDisabled();

	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("button", periodButton(quarter(1).label))).toBeVisible();
	await expect(page.getByRole("link", { name: "Période suivante" })).toBeVisible();

	await page.getByRole("link", { name: "Aujourd'hui" }).click();
	await expect(page.getByRole("button", periodButton(current.label))).toBeVisible();

	// The arrows are off while the picker is open.
	await page.getByRole("button", periodButton(current.label)).click();
	await expect(page.getByRole("dialog")).toBeVisible();
	const pickerUrl = page.url();
	await page.keyboard.press("ArrowLeft");
	await expect(page.getByRole("dialog")).toBeVisible();
	expect(page.url()).toBe(pickerUrl);
	await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toBeHidden();

	const download = page.waitForEvent("download");
	await page.getByRole("link", { name: "CSV" }).click();
	const file = await download;
	expect(file.suggestedFilename()).toBe(
		`transactions_breakdown_${current.from.replaceAll("-", "")}_to_${current.to.replaceAll("-", "")}.csv`,
	);
	const csv = await readFile(await file.path(), "utf8");
	expect(csv.split("\n")[0]).toMatch(/^Category,[A-Z][a-z]{2} \d{4},.*Total$/u);
	expect(csv).toContain(category.name);

	const printed = context.waitForEvent("page");
	await page.getByRole("link", { name: "Imprimer le rapport" }).click();
	const print = await printed;
	await expect(print.getByRole("heading", { level: 1, name: "Rapport financier" })).toBeVisible();
	await expect(
		print.getByText(`${longDate(current.from)} – ${longDate(current.to)}`),
	).toBeVisible();
	await expect(print.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(0);
	await expect
		.poll(() => print.evaluate(() => Number(Reflect.get(window, "printed") ?? 0)))
		.toBe(1);
	await print.close();

	await page
		.getByRole("region", { name: "Répartition des activités" })
		.getByRole("link", { name: category.name })
		.click();
	await expect(page).toHaveURL(/\/transactions\?/u);
	const search = decodeURIComponent(new URL(page.url()).search);
	expect(search).toContain(category.id);
	expect(search).toContain(current.from);
	expect(search).toContain(current.to);
});

test("a reversed custom range is swapped and says so", async ({ page }) => {
	await page.goto(`/reports?periodType=custom&startDate=${daysAgo(5)}&endDate=${daysAgo(20)}`);

	await expect(page.getByRole("alert")).toHaveText(
		"La date de fin ne peut pas être antérieure à la date de début. Les dates ont été inversées.",
	);
	await expect(page.getByRole("button", { name: "Période précédente" })).toHaveCount(0);
});

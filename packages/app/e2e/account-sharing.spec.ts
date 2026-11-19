import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";

import { acceptInvitation, expect, test, uniqueName } from "./fixtures.ts";
import { ADMIN_FIRST_NAME, WEB_URL } from "./settings.ts";

test("shares an account and opens a shared personal budget", async ({
	page,
	api,
	request,
	browser,
}, testInfo) => {
	const memberName = uniqueName("Sacha");
	const email = `sharing-${randomUUID()}@archant.test`;
	const account = await api.openAccount({ name: uniqueName("Compte à partager") });
	const { url } = await api.invite(email, "member");
	const context = await browser.newContext({
		baseURL: WEB_URL,
		locale: "fr-FR",
		extraHTTPHeaders: { "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.14` },
	});

	try {
		const member = await context.newPage();
		await acceptInvitation(member.request, url, {
			name: memberName,
			password: "mot de passe personnel",
		});

		await page.goto(`/accounts/${account.id}`);
		await page.getByRole("button", { name: "Partage de compte" }).click();
		const accountSharing = page.getByRole("dialog", { name: "Partage de compte" });
		await accountSharing.getByRole("combobox", { name: memberName }).click();
		await page.getByRole("option", { name: "Aucun accès" }).click();
		await expect(accountSharing.getByRole("combobox", { name: memberName })).toHaveText(
			"Aucun accès",
		);
		expect((await member.request.get(`/api/accounts/${account.id}`)).status()).toBe(404);
		await member.goto(`/accounts/${account.id}`);
		await expect(
			member.getByRole("heading", { level: 1, name: "Compte introuvable" }),
		).toBeVisible();
		await testInfo.attach("before-sharing", {
			body: await member.screenshot(),
			contentType: "image/png",
		});

		await accountSharing.getByRole("combobox", { name: memberName }).click();
		await page.getByRole("option", { name: "Lecture seule" }).click();
		await expect(accountSharing.getByRole("combobox", { name: memberName })).toHaveText(
			"Lecture seule",
		);
		await member.goto(`/accounts/${account.id}`);
		await expect(member.getByRole("heading", { level: 1, name: account.name })).toBeVisible();
		await expect(member.getByRole("button", { name: "Ajouter une opération" })).toHaveCount(0);
		await expect(member.getByText("Ajoutez-en une à la main ou importez un relevé.")).toHaveCount(
			0,
		);
		await testInfo.attach("after-sharing", {
			body: await member.screenshot(),
			contentType: "image/png",
		});

		await page.goto("/settings/preferences");
		await page.getByRole("switch", { name: "Budgets personnels" }).click();
		await expect(page.getByRole("switch", { name: "Budgets personnels" })).toBeChecked();
		await page.goto("/budgets");
		await expect(page.getByRole("combobox", { name: "Choisir un budget" })).toHaveText(
			"Mon budget",
		);
		await page.getByRole("button", { name: "Partage de budget" }).click();
		const budgetSharing = page.getByRole("dialog", { name: "Partage de budget" });
		await budgetSharing.getByRole("combobox", { name: memberName }).click();
		await page.getByRole("option", { name: "Lecture seule" }).click();
		await expect(budgetSharing.getByRole("combobox", { name: memberName })).toHaveText(
			"Lecture seule",
		);
		await member.goto("/budgets");
		await expect(member.getByRole("combobox", { name: "Choisir un budget" })).toHaveText(
			"Mon budget",
		);
		await member.getByRole("combobox", { name: "Choisir un budget" }).click();
		await expect(member.getByRole("option", { name: "Budget commun" })).toBeVisible();
		await member.getByRole("option", { name: ADMIN_FIRST_NAME, exact: true }).click();
		await expect(member.getByRole("combobox", { name: "Choisir un budget" })).toHaveText(
			ADMIN_FIRST_NAME,
		);
		await expect(member.getByRole("link", { name: "Définir le budget" })).toHaveCount(0);
	} finally {
		const restored = await request.patch("/api/preferences", { data: { personalBudgets: false } });
		expect(restored.ok(), await restored.text()).toBe(true);
		const listed = await request.get("/api/members");
		const memberId = z
			.object({ data: z.array(z.object({ id: z.string(), email: z.string() })) })
			.parse(await listed.json())
			.data.find((row) => row.email === email)?.id;
		if (memberId !== undefined) {
			const removed = await request.delete(`/api/members/${memberId}`, {
				headers: { origin: WEB_URL },
			});
			expect(removed.ok(), await removed.text()).toBe(true);
		}
		const deleted = await request.delete(`/api/accounts/${account.id}`, {
			headers: { origin: WEB_URL },
		});
		expect(deleted.ok(), await deleted.text()).toBe(true);
		await context.close();
	}
});

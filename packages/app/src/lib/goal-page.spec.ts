import { createInstance } from "i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { goalPageText } from "@/lib/goal-page";
import fr from "@/locales/fr.json";

const i18n = createInstance();
const today = "2026-01-31";
const goal = {
	state: "active",
	status: "behind",
	currency: "EUR",
	targetDate: "2026-04-01",
	targetAmount: toMinorUnits(100_000),
	saved: toMinorUnits(40_000),
	remaining: toMinorUnits(60_000),
	pace: toMinorUnits(10_000),
	monthlyNeeded: toMinorUnits(30_000),
	catchUpAmount: toMinorUnits(20_000),
} as const;

beforeAll(async () => {
	await i18n.init({
		lng: "fr",
		resources: { fr: { translation: fr } },
		interpolation: { escapeValue: false },
	});
});

const text = (overrides: Partial<Parameters<typeof goalPageText>[0]> = {}) =>
	goalPageText({ ...goal, ...overrides }, today, i18n.t);

describe("goal page explanations", () => {
	it("names the target date and the time left, or says it has passed", () => {
		expect(text().target).toMatch(/^Objectif .* d'ici le /u);
		expect(text().daysLeft).toBe("60 jours restants");
		expect(text({ targetDate: "2026-02-01" }).daysLeft).toBe("1 jour restant");
		expect(text({ targetDate: today }).daysLeft).toBeNull();
		const overdue = text({ targetDate: "2026-01-30" });
		expect(overdue.target).toContain("attendu le");
		expect(overdue.daysLeft).toBeNull();
	});

	it("shows how much more is needed at the measured pace and offers to edit the goal", () => {
		const behind = text();
		expect(behind.status).toMatch(/^Épargnez 200,00\s€\/mois de plus pour rattraper le retard$/u);
		expect(behind.panel).toMatchObject({ title: behind.status, action: "adjust" });
		expect(behind.projection).toBe("Insuffisant au rythme actuel.");
	});

	it("uses the remaining shortfall after pending pledges", () => {
		const partial = text({ catchUpAmount: toMinorUnits(5_000) });
		expect(partial.status).toMatch(/^Épargnez 50,00\s€\/mois de plus pour rattraper le retard$/u);
		expect(partial.panel).toMatchObject({ title: partial.status, action: "adjust" });

		const covered = text({ catchUpAmount: toMinorUnits(0) });
		expect(covered).toMatchObject({
			status: "Les promesses en attente comblent le retard.",
			panel: null,
			projection: "Insuffisant au rythme actuel.",
		});
	});

	it("distinguishes zero and negative measured pace from insufficient history", () => {
		const zero = text({ pace: toMinorUnits(0) });
		const negative = text({ pace: toMinorUnits(-500), catchUpAmount: toMinorUnits(30_500) });
		expect(zero.projection).toContain("rythme net est de zéro");
		expect(zero.panel?.action).toBe("adjust");
		expect(negative.projection).toBe("Insuffisant au rythme actuel.");
		expect(negative.panel?.title).toContain("305,00");
		const unknown = text({ pace: null, status: "pace_unknown" });
		expect(unknown.projection).toContain("opérations éligibles des 90 derniers jours");
		expect(unknown.projection).toContain("un an d'historique de soldes");
		expect(unknown.status).toContain("Rythme inconnu");
		expect(unknown.panel).toBeNull();
	});

	it("uses the next calendar month when the measured pace covers the remaining amount", () => {
		const onTrack = text({ status: "on_track", pace: toMinorUnits(60_000) });
		expect(onTrack.status).toContain("févr");
		expect(onTrack.projection).toMatch(
			/^Au rythme actuel, vous atteindrez cet objectif vers .*févr/u,
		);
		expect(onTrack.panel).toBeNull();
	});

	it("offers a date only for an undated and unreached one-off goal", () => {
		const undated = text({ status: "no_target_date", targetDate: null });
		expect(undated.target).toMatch(/^Cible /u);
		expect(undated).toMatchObject({
			daysLeft: null,
			status: "Définissez une date cible pour projeter une date de fin.",
			panel: { title: "Ajouter une date cible", action: "setDate" },
		});
		expect(undated.projection).toContain("Aucune date cible");
	});

	it("offers to close a reached goal and drops its countdown or overdue label", () => {
		const reached = text({ status: "reached", remaining: toMinorUnits(0) });
		expect(reached).toMatchObject({
			daysLeft: null,
			status: null,
			panel: { title: "Cible atteinte", action: "complete" },
			projection: "Vous avez atteint la cible.",
		});
		expect(reached.panel?.body).toContain("Vous avez atteint votre cible");
		expect(text({ status: "reached", targetDate: "2026-01-30" }).target).not.toContain(
			"attendu le",
		);
	});

	it("explains whether a reserve is full or short without offering a date or closure", () => {
		const funded = text({ status: "funded", targetDate: null });
		expect(funded).toMatchObject({
			status: null,
			panel: { title: "Réserve constituée", action: null },
		});
		const depleted = text({ status: "depleted", targetDate: null });
		expect(depleted.status).toContain("pour ramener la réserve à son solde cible");
		expect(depleted.panel).toMatchObject({ title: "Réserve sous son solde cible", action: null });
		expect(depleted.projection).toBe(funded.projection);
	});

	it.each(["paused", "archived", "completed"] as const)(
		"leaves lifecycle actions to the existing banner for a %s goal",
		(state) => {
			expect(text({ state })).toMatchObject({ status: null, panel: null });
		},
	);
});

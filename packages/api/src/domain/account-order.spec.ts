import { describe, expect, it } from "vitest";

import { toMinorUnits } from "@archant/data/money";

import { sortAccounts } from "./account-order.ts";

const account = (id: string, name: string, balance: number, currency = "EUR") => ({
	id,
	name,
	balance: toMinorUnits(balance),
	currency,
});

const checking = account("a", "Compte joint", 120000);
const savings = account("b", "Livret A", 500000);
const eco = account("c", "Épargne", 30000);
const zen = account("d", "Zen", 0);
const list = [savings, zen, checking, eco];

const names = (accounts: { name: string }[]) => accounts.map(({ name }) => name);

describe("sortAccounts", () => {
	it("sorts by name A-Z with the French collator, accents beside their letter", () => {
		expect(names(sortAccounts(list, "name_asc"))).toEqual([
			"Compte joint",
			"Épargne",
			"Livret A",
			"Zen",
		]);
	});

	it("sorts by name Z-A", () => {
		expect(names(sortAccounts(list, "name_desc"))).toEqual([
			"Zen",
			"Livret A",
			"Épargne",
			"Compte joint",
		]);
	});

	it("sorts by balance, lowest first", () => {
		expect(names(sortAccounts(list, "balance_asc"))).toEqual([
			"Zen",
			"Épargne",
			"Compte joint",
			"Livret A",
		]);
	});

	it("sorts by balance, highest first", () => {
		expect(names(sortAccounts(list, "balance_desc"))).toEqual([
			"Livret A",
			"Compte joint",
			"Épargne",
			"Zen",
		]);
	});

	it("compares balances in major units across currencies, without conversion", () => {
		// 100,00 EUR is 10 000 minor units, 50 JPY is 50: compared as 100 and 50.
		const euros = account("e", "Euros", 10000, "EUR");
		const yen = account("y", "Yens", 50, "JPY");
		const dinars = account("k", "Dinars", 75500, "KWD");

		expect(names(sortAccounts([euros, yen, dinars], "balance_asc"))).toEqual([
			"Yens",
			"Dinars",
			"Euros",
		]);
		expect(names(sortAccounts([euros, yen, dinars], "balance_desc"))).toEqual([
			"Euros",
			"Dinars",
			"Yens",
		]);
	});

	it("counts two decimals for a code outside ISO 4217", () => {
		const euros = account("e", "Euros", 10000, "EUR");
		const unknown = account("x", "Inconnu", 9999, "XXT");

		expect(names(sortAccounts([euros, unknown], "balance_asc"))).toEqual(["Inconnu", "Euros"]);
	});

	it("puts an overdrawn balance before zero", () => {
		const overdrawn = account("o", "Découvert", -5000);

		expect(names(sortAccounts([zen, overdrawn], "balance_asc"))).toEqual(["Découvert", "Zen"]);
	});

	it("breaks a balance tie by name A-Z in either direction, then by id", () => {
		const first = account("z", "Alpha", 1000);
		const second = account("m", "Bravo", 1000);
		const twin = account("a", "Bravo", 1000);

		expect(sortAccounts([second, first, twin], "balance_asc").map(({ id }) => id)).toEqual([
			"z",
			"a",
			"m",
		]);
		expect(sortAccounts([second, first, twin], "balance_desc").map(({ id }) => id)).toEqual([
			"z",
			"a",
			"m",
		]);
	});

	it("leaves the list it is given untouched", () => {
		const given = [savings, checking];

		sortAccounts(given, "name_asc");

		expect(given).toEqual([savings, checking]);
	});
});

import { describe, expect, it } from "vitest";

import { ACCOUNT_TYPE_IDS } from "@archant/data/account-types";

import fr from "../locales/fr.json";
import {
	NEW_ACCOUNT_TYPES,
	PROPERTY_STEPS,
	firstPropertyStepOf,
	hasMethodStep,
	linksBank,
	nextPropertyStep,
	previousStep,
	propertyStepOfField,
	stepAfterType,
} from "./account-creation.ts";

describe("NEW_ACCOUNT_TYPES", () => {
	it("lists every type once, in Sure's accounts/new order", () => {
		expect(NEW_ACCOUNT_TYPES).toEqual([
			"depository",
			"investment",
			"crypto",
			"property",
			"vehicle",
			"credit_card",
			"loan",
			"other_asset",
			"other_liability",
		]);
		expect(NEW_ACCOUNT_TYPES.toSorted()).toEqual([...ACCOUNT_TYPE_IDS].toSorted());
	});

	it("names each type as Sure's `accounts.types`, « Cryptomonnaie » for crypto", () => {
		expect(NEW_ACCOUNT_TYPES.map((type) => fr.accounts.types[type])).toEqual([
			"Liquidités",
			"Investissement",
			"Cryptomonnaie",
			"Bien immobilier",
			"Véhicule",
			"Carte de crédit",
			"Prêt",
			"Autre actif",
			"Autre passif",
		]);
	});
});

describe("the method step", () => {
	it("comes only for the types whose view renders Sure's method selector", () => {
		expect(NEW_ACCOUNT_TYPES.filter(hasMethodStep)).toEqual([
			"depository",
			"investment",
			"crypto",
			"credit_card",
			"loan",
		]);
	});

	it("offers the bank link for Enable Banking's supported types only", () => {
		expect(NEW_ACCOUNT_TYPES.filter(linksBank)).toEqual(["depository", "credit_card"]);
	});
});

describe("stepAfterType", () => {
	it("asks the method first where Sure does", () => {
		expect(stepAfterType("investment")).toEqual({ kind: "method", type: "investment" });
		expect(stepAfterType("loan")).toEqual({ kind: "method", type: "loan" });
	});

	it("opens the form at once for a vehicle and the two other types", () => {
		expect(stepAfterType("vehicle")).toEqual({ kind: "form", type: "vehicle" });
		expect(stepAfterType("other_asset")).toEqual({ kind: "form", type: "other_asset" });
		expect(stepAfterType("other_liability")).toEqual({ kind: "form", type: "other_liability" });
	});

	it("opens a property's overview", () => {
		expect(stepAfterType("property")).toEqual({ kind: "property", step: "overview" });
	});
});

describe("previousStep", () => {
	it("has nothing before the type list", () => {
		expect(previousStep({ kind: "types" })).toBeNull();
	});

	it("goes from the method back to the types", () => {
		expect(previousStep({ kind: "method", type: "depository" })).toEqual({ kind: "types" });
	});

	it("goes from a form back to its method, or to the types without one", () => {
		expect(previousStep({ kind: "form", type: "credit_card" })).toEqual({
			kind: "method",
			type: "credit_card",
		});
		expect(previousStep({ kind: "form", type: "vehicle" })).toEqual({ kind: "types" });
	});

	it("walks a property's steps back, then to the types", () => {
		expect(previousStep({ kind: "property", step: "address" })).toEqual({
			kind: "property",
			step: "value",
		});
		expect(previousStep({ kind: "property", step: "value" })).toEqual({
			kind: "property",
			step: "overview",
		});
		expect(previousStep({ kind: "property", step: "overview" })).toEqual({ kind: "types" });
	});
});

describe("the property steps", () => {
	it("follow Sure's tabs, « Adresse » last", () => {
		expect(PROPERTY_STEPS).toEqual(["overview", "value", "address"]);
		expect(nextPropertyStep("overview")).toBe("value");
		expect(nextPropertyStep("value")).toBe("address");
		expect(nextPropertyStep("address")).toBeNull();
	});

	it("route each field to the step that shows it", () => {
		expect(propertyStepOfField("name")).toBe("overview");
		expect(propertyStepOfField("subtype")).toBe("overview");
		expect(propertyStepOfField("details.yearBuilt")).toBe("overview");
		expect(propertyStepOfField("details.areaValue")).toBe("overview");
		expect(propertyStepOfField("currency")).toBe("value");
		expect(propertyStepOfField("openingBalance")).toBe("value");
		expect(propertyStepOfField("openingDate")).toBe("value");
		expect(propertyStepOfField("details.postalCode")).toBe("address");
		expect(propertyStepOfField("notes")).toBe("address");
		expect(propertyStepOfField("excludedFromReports")).toBe("address");
		expect(propertyStepOfField("details")).toBeNull();
	});

	it("open the earliest step among refused fields", () => {
		expect(firstPropertyStepOf(["notes", "openingBalance"])).toBe("value");
		expect(firstPropertyStepOf(["details.country", "name"])).toBe("overview");
		expect(firstPropertyStepOf(["details"])).toBeNull();
		expect(firstPropertyStepOf([])).toBeNull();
	});
});

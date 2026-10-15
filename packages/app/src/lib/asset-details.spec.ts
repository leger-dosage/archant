import { describe, expect, it } from "vitest";

import {
	addressText,
	completePropertyInput,
	completeVehicleInput,
	formatMeasurement,
	propertyDetailsToInput,
	vehicleDetailsToInput,
} from "./asset-details.ts";

const property = {
	yearBuilt: 1975,
	areaValue: 68,
	areaUnit: "sqft",
	addressLine1: "3 rue Mercière",
	locality: "Lyon",
	region: "Rhône",
	postalCode: "69002",
	country: "FR",
} as const;

describe("completePropertyInput and completeVehicleInput", () => {
	it("blank every missing field, default the units to square metres and kilometres, and drop another type's", () => {
		const typed = { locality: "Lyon", make: "Peugeot" };

		expect(completePropertyInput(typed)).toEqual({
			yearBuilt: "",
			areaValue: "",
			areaUnit: "sqm",
			addressLine1: "",
			locality: "Lyon",
			region: "",
			postalCode: "",
			country: "",
		});
		expect(completeVehicleInput({ year: "2021" })).toEqual({
			make: "",
			model: "",
			year: "2021",
			mileageValue: "",
			mileageUnit: "km",
		});
	});
});

describe("propertyDetailsToInput and vehicleDetailsToInput", () => {
	it("write stored details back as typed, with their unit", () => {
		expect(propertyDetailsToInput(property)).toEqual({
			yearBuilt: "1975",
			areaValue: "68",
			areaUnit: "sqft",
			addressLine1: "3 rue Mercière",
			locality: "Lyon",
			region: "Rhône",
			postalCode: "69002",
			country: "FR",
		});
		expect(
			vehicleDetailsToInput({
				make: "Peugeot",
				model: null,
				year: 2021,
				mileageValue: 15000,
				mileageUnit: "mi",
			}),
		).toEqual({
			make: "Peugeot",
			model: "",
			year: "2021",
			mileageValue: "15000",
			mileageUnit: "mi",
		});
	});

	it("leave an account saved before it had details blank", () => {
		expect(propertyDetailsToInput(null)).toEqual(completePropertyInput(undefined));
		expect(vehicleDetailsToInput(null)).toEqual(completeVehicleInput(undefined));
	});
});

describe("addressText", () => {
	it("follows Sure's `Address#to_s`, each empty part dropped", () => {
		expect(addressText(property)).toBe("3 rue Mercière, Lyon, Rhône 69002 FR");
		expect(addressText({ ...property, addressLine1: null, region: null })).toBe("Lyon, 69002 FR");
		expect(addressText({ ...property, region: null, postalCode: null, country: null })).toBe(
			"3 rue Mercière, Lyon",
		);
	});

	it("is null without any part, or without details", () => {
		expect(
			addressText({
				...property,
				addressLine1: null,
				locality: null,
				region: null,
				postalCode: null,
				country: null,
			}),
		).toBeNull();
		expect(addressText(null)).toBeNull();
	});
});

describe("formatMeasurement", () => {
	it("groups thousands as French does", () => {
		expect(formatMeasurement(15000)).toMatch(/^15\s000$/u);
		expect(formatMeasurement(120)).toBe("120");
	});
});

import type {
	CryptoDetailsInput,
	PropertyDetailsInput,
	UpdateAccountInput,
	VehicleDetailsInput,
} from "@archant/api/schemas/accounts";
import type {
	AreaUnit,
	CryptoDetails,
	MileageUnit,
	PropertyDetails,
	TaxTreatment,
	VehicleDetails,
} from "@archant/data/account-types";

/** Every field of a property's details, as a PATCH must send them. */
type CompletePropertyInput = Extract<
	NonNullable<UpdateAccountInput["details"]>,
	{ areaUnit: AreaUnit }
>;

/** Every field of a vehicle's details, as a PATCH must send them. */
type CompleteVehicleInput = Extract<
	NonNullable<UpdateAccountInput["details"]>,
	{ mileageUnit: MileageUnit }
>;

/** A crypto account's details, as a PATCH must send them. */
type CompleteCryptoInput = Extract<
	NonNullable<UpdateAccountInput["details"]>,
	{ taxTreatment: TaxTreatment }
>;

/** Where the API's field errors on a crypto account's details land in either account form. */
export const CRYPTO_FIELD_NAMES = ["details.taxTreatment"] as const;

/** A crypto account's typed details, `taxable` unless chosen, as Sure's default. */
export function completeCryptoInput(details: CryptoDetailsInput | undefined): CompleteCryptoInput {
	return { taxTreatment: details?.taxTreatment ?? "taxable" };
}

/** A crypto account's stored details as its edit form holds them. */
export function cryptoDetailsToInput(details: CryptoDetails | null): CompleteCryptoInput {
	return { taxTreatment: details?.taxTreatment ?? "taxable" };
}

/** Where the API's field errors on a property's details land in either account form. */
export const PROPERTY_FIELD_NAMES = [
	"details.yearBuilt",
	"details.areaValue",
	"details.areaUnit",
	"details.addressLine1",
	"details.locality",
	"details.region",
	"details.postalCode",
	"details.country",
] as const;

/** Where the API's field errors on a vehicle's details land in either account form. */
export const VEHICLE_FIELD_NAMES = [
	"details.make",
	"details.model",
	"details.year",
	"details.mileageValue",
	"details.mileageUnit",
] as const;

/**
 * A property's typed details with every field present, a missing one blank
 * and the unit square metres: a PATCH replaces them whole. Another type's
 * fields are left out, as the API refuses them.
 */
export function completePropertyInput(
	details: PropertyDetailsInput | undefined,
): CompletePropertyInput {
	return {
		yearBuilt: details?.yearBuilt ?? "",
		areaValue: details?.areaValue ?? "",
		areaUnit: details?.areaUnit ?? "sqm",
		addressLine1: details?.addressLine1 ?? "",
		locality: details?.locality ?? "",
		region: details?.region ?? "",
		postalCode: details?.postalCode ?? "",
		country: details?.country ?? "",
	};
}

/** A vehicle's typed details with every field present, the unit kilometres unless chosen. */
export function completeVehicleInput(
	details: VehicleDetailsInput | undefined,
): CompleteVehicleInput {
	return {
		make: details?.make ?? "",
		model: details?.model ?? "",
		year: details?.year ?? "",
		mileageValue: details?.mileageValue ?? "",
		mileageUnit: details?.mileageUnit ?? "km",
	};
}

const text = (value: string | number | null | undefined) =>
	value === null || value === undefined ? "" : String(value);

/** Stored property details back into the text the edit dialog edits, blank when unknown. */
export function propertyDetailsToInput(details: PropertyDetails | null): CompletePropertyInput {
	return {
		yearBuilt: text(details?.yearBuilt),
		areaValue: text(details?.areaValue),
		areaUnit: details?.areaUnit ?? "sqm",
		addressLine1: text(details?.addressLine1),
		locality: text(details?.locality),
		region: text(details?.region),
		postalCode: text(details?.postalCode),
		country: text(details?.country),
	};
}

/** Stored vehicle details back into the text the edit dialog edits, blank when unknown. */
export function vehicleDetailsToInput(details: VehicleDetails | null): CompleteVehicleInput {
	return {
		make: text(details?.make),
		model: text(details?.model),
		year: text(details?.year),
		mileageValue: text(details?.mileageValue),
		mileageUnit: details?.mileageUnit ?? "km",
	};
}

/**
 * Sure's `Address#to_s` with its `"%{line1} %{line2}, %{locality}, %{region}
 * %{postal_code} %{country}"` format, less the `line2` Archant never asks
 * for, each empty part dropped: `3 rue Mercière, Lyon, 69002 FR`. Null
 * without any part.
 */
export function addressText(details: PropertyDetails | null): string | null {
	if (details === null) {
		return null;
	}

	const tail = [details.region, details.postalCode, details.country]
		.filter((part) => part !== null)
		.join(" ");
	const parts = [details.addressLine1, details.locality, tail].filter(
		(part): part is string => part !== null && part !== "",
	);

	return parts.length === 0 ? null : parts.join(", ");
}

const wholeNumber = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** An area's or a mileage's value as French digits: `15 000`. */
export function formatMeasurement(value: number): string {
	return wholeNumber.format(value);
}

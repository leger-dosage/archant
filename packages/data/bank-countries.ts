/**
 * The countries Sure offers for Enable Banking, as ISO 3166-1 alpha-2 codes.
 * France first: it is the default, and the household's own. The interface
 * names them through `Intl.DisplayNames`, so no translation is kept here.
 */
export const BANK_COUNTRIES = [
	"FR",
	"AT",
	"BE",
	"BG",
	"HR",
	"CY",
	"CZ",
	"DK",
	"EE",
	"FI",
	"DE",
	"GR",
	"HU",
	"IS",
	"IE",
	"IT",
	"LV",
	"LI",
	"LT",
	"LU",
	"MT",
	"NL",
	"NO",
	"PL",
	"PT",
	"RO",
	"SK",
	"SI",
	"ES",
	"SE",
	"GB",
] as const;

export type BankCountry = (typeof BANK_COUNTRIES)[number];

export const DEFAULT_BANK_COUNTRY: BankCountry = "FR";

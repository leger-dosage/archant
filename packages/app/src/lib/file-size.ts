import { intlLocale } from "@/lib/locale";

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;

const formats = UNITS.map(
	(unit) =>
		new Intl.NumberFormat(intlLocale, {
			style: "unit",
			unit,
			unitDisplay: "short",
			maximumFractionDigits: 1,
		}),
);

/**
 * A file's size as Sure's `number_to_human_size` shows it, in powers of 1024
 * and the page's units: `512 o`, `1,5 ko`, `10 Mo` in French, `512 byte`, `1.5 kB` in English. A size that rounds up to
 * 1 024 of a unit is shown in the next one.
 */
export function formatFileSize(bytes: number): string {
	let exponent = 0;
	let value = bytes;

	while (exponent < UNITS.length - 1 && Math.round(value * 10) / 10 >= 1024) {
		exponent += 1;
		value /= 1024;
	}

	return formats[exponent]?.format(value) ?? "";
}

import { RE2JS } from "re2js";

import { squishLabel } from "../normalize-label.ts";

/**
 * A pattern RE2 accepted, ready to run. The only module that imports `re2js`,
 * so swapping the engine touches this file alone.
 */
export type LabelPattern = RE2JS;

/**
 * The pattern RE2 reads, or `null` when it refuses it. RE2 matches in time
 * linear in the label, where the built-in `RegExp` can backtrack for ever on
 * `(a+)+$`; the label is the bank's text, which whoever sends a transfer
 * partly chooses, so a user's pattern must never run in the built-in engine.
 * The same guarantee leaves out back references and lookaround, which a label
 * cleanup does not need. Case is ignored, accents included.
 */
export function compileLabelPattern(pattern: string): LabelPattern | null {
	try {
		return RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE);
	} catch {
		// Every error `compile` throws is a refusal of the pattern's syntax.
		return null;
	}
}

/**
 * The label with every match replaced by `replacement`, literally: a function
 * returns it, so `$1` and `\` carry no meaning and a label's « US$ » survives.
 * A changed label is squished, because removing a middle part leaves two
 * spaces; an unchanged one is returned as it came, spaces included, and so is
 * one that would end up empty, since a rule never blanks a label.
 */
export function replaceInLabel(pattern: LabelPattern, replacement: string, label: string): string {
	const replaced = pattern.matcher(label).replaceAll(() => replacement);

	if (replaced === label) {
		return label;
	}

	const squished = squishLabel(replaced);

	return squished === "" ? label : squished;
}

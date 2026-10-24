import type { Direction } from "./cash-flow.ts";

import type { MinorUnits } from "@archant/data/money";

/** An uncategorised line as the wizard groups it, most recent first in the input. */
export type UncategorisedLine = {
	id: string;
	label: string;
	/** The merchant's name, never blank, `null` without a merchant. */
	merchantName: string | null;
	merchantId: string | null;
	amount: MinorUnits;
};

/** The sign a group keeps apart, as Sure's `transaction_type`: never a transfer. */
export type GroupType = Exclude<Direction, "transfer">;

/** A group of the wizard, as Sure's `Transaction::Grouper::Group`. */
export type UncategorisedGroup = {
	/** The merchant's name, else the label: the rule's « Contient » text. */
	name: string;
	type: GroupType;
	/** The first line's merchant carrying one, for its colour. */
	merchantId: string | null;
	/** In the input's order. */
	ids: string[];
};

const byName = new Intl.Collator("fr", { sensitivity: "variant", numeric: true });

/** The same sign as `direction` for a line no transfer holds. */
export function groupTypeOf(amount: MinorUnits): GroupType {
	return amount > 0 ? "income" : "expense";
}

/**
 * Sure's `Transaction::Grouper::ByMerchantOrName`: lines sharing a merchant's
 * name, else a label, compared exactly, and a sign; the largest group first,
 * then by name. Sure leaves equal keys unordered; here expenses come first.
 */
export function groupUncategorised(lines: readonly UncategorisedLine[]): UncategorisedGroup[] {
	const groups = new Map<string, UncategorisedGroup>();

	for (const line of lines) {
		const name =
			line.merchantName !== null && line.merchantName !== "" ? line.merchantName : line.label;
		const type = groupTypeOf(line.amount);
		const key = JSON.stringify([name, type]);
		const group = groups.get(key);

		if (group === undefined) {
			groups.set(key, { name, type, merchantId: line.merchantId, ids: [line.id] });
		} else {
			group.ids.push(line.id);
			group.merchantId ??= line.merchantId;
		}
	}

	return [...groups.values()].toSorted(
		(a, b) =>
			b.ids.length - a.ids.length ||
			byName.compare(a.name, b.name) ||
			// One group per name and sign: equal names differ by sign.
			(a.type === "expense" ? -1 : 1),
	);
}

import type { MinorUnits } from "@archant/data/money";
import { isCurrencyCode, minorUnitsOf } from "@archant/data/money";
import type { BillType } from "@archant/data/recurring";

// Sure's `RecurringTransaction::Classifier` at `14638a701`, its lists and
// their order unchanged: a first guess only, the owner edits the type.

/** Services that are subscriptions essentially always. */
const SUBSCRIPTION_KEYWORDS = [
	"netflix",
	"spotify",
	"hulu",
	"disney",
	"hbo",
	"hbo max",
	"paramount",
	"peacock",
	"crunchyroll",
	"youtube",
	"prime",
	"audible",
	"kindle",
	"icloud",
	"apple.com/bill",
	"google one",
	"playstation",
	"xbox",
	"nintendo",
	"twitch",
	"patreon",
	"substack",
	"onlyfans",
	"dropbox",
	"github",
	"openai",
	"anthropic",
	"claude",
	"chatgpt",
	"midjourney",
	"canva",
	"adobe",
	"microsoft 365",
	"office 365",
	"notion",
	"slack",
	"zoom",
	"1password",
	"lastpass",
	"bitwarden",
	"nordvpn",
	"expressvpn",
	"sirius",
	"pandora",
	"tidal",
	"deezer",
	"duolingo",
	"headspace",
	"calm",
	"grammarly",
	"peloton",
	"planet fitness",
	"la fitness",
	"grok",
	"x.ai",
	"xai",
];

/** Utilities, telecom, insurance, housing and taxes: obligations pushed money at. */
const BILL_KEYWORDS = [
	"electric",
	"power",
	"energy",
	"gas",
	"water",
	"sewer",
	"utility",
	"utilit*",
	"insurance",
	"insur*",
	"mortgage",
	"rent",
	"lease",
	"loan",
	"hoa",
	"property",
	"tax",
	"comcast",
	"xfinity",
	"spectrum",
	"cox",
	"centurylink",
	"frontier",
	"at&t",
	"verizon",
	"t-mobile",
	"tmobile",
	"mint mobile",
	"wireless",
	"phone",
	"internet",
	"interest",
	"finance charge",
];

/** Buy now, pay later: a fixed run of payments, then done. */
const INSTALLMENT_KEYWORDS = ["klarna", "affirm", "afterpay", "sezzle", "zip pay", "uplift"];

/** Push-payment fingerprints in raw descriptors. */
const ACH_MARKERS = [
	"ach",
	"web pmt",
	"webpmt",
	"billpay",
	"bill pay",
	"online pmt",
	"e-pay",
	"epay",
];

/** Above 150 major units, a flat charge is more likely rent or a service than a streaming plan. */
const SUBSCRIPTION_CEILING_MAJOR = 150;

/** What the classifier reads of a pattern's rows, in cluster order. */
export type ClassifiedRow = { amount: MinorUnits; categoryId: string | null };

export type Classification = {
	billType: Extract<BillType, "bill" | "subscription" | "installment">;
	categoryId: string | null;
	autopay: boolean;
};

/** One unit of `currency` in its minor units: 100 cents, 1 yen; two decimals outside ISO 4217. */
export function majorUnitOf(currency: string): number {
	return 10 ** (isCurrencyCode(currency) ? minorUnitsOf(currency) : 2);
}

const escape = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

/**
 * Sure's `matches?`: whole words only, so « gas » never claims a gastropub; a
 * trailing `*` marks a stem that may carry a suffix, « utilit* » reaching
 * « UTILITIES ».
 */
function matches(name: string, keywords: readonly string[]): boolean {
	return keywords.some((keyword) =>
		keyword.endsWith("*")
			? new RegExp(String.raw`\b${escape(keyword.slice(0, -1))}\w*`, "u").test(name)
			: new RegExp(String.raw`\b${escape(keyword)}\b`, "u").test(name),
	);
}

/** Sure's `modal_category_id`: the most frequent category of the rows, the first seen on a tie. */
function modalCategory(rows: readonly ClassifiedRow[]): string | null {
	const counts = new Map<string, number>();

	for (const { categoryId } of rows) {
		if (categoryId !== null) {
			counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
		}
	}

	let best: string | null = null;
	let most = 0;

	for (const [categoryId, count] of counts) {
		if (count > most) {
			best = categoryId;
			most = count;
		}
	}

	return best;
}

/**
 * Sure's `Classifier#classify` for a new suggestion, on `name`, the
 * merchant's name else the label: an installment by its keywords, else a
 * subscription by its keywords unless a bill keyword or an ACH marker says
 * otherwise, or with no word to go by a flat charge of at most 150 major
 * units on a credit card; else a bill. Autopay unless a bill.
 */
export function classify({
	name,
	rows,
	currency,
	creditCard,
}: {
	name: string;
	/** Never empty: a pattern has rows. */
	rows: readonly ClassifiedRow[];
	currency: string;
	creditCard: boolean;
}): Classification {
	const text = name.toLowerCase();
	const majorUnit = majorUnitOf(currency);
	const subscription = () => {
		if (matches(text, BILL_KEYWORDS) || matches(text, ACH_MARKERS)) {
			return false;
		}

		if (matches(text, SUBSCRIPTION_KEYWORDS)) {
			return true;
		}

		return (
			new Set(rows.map((row) => Math.abs(row.amount))).size === 1 &&
			Math.abs(rows[0]!.amount) <= SUBSCRIPTION_CEILING_MAJOR * majorUnit &&
			creditCard
		);
	};
	const billType = matches(text, INSTALLMENT_KEYWORDS)
		? "installment"
		: subscription()
			? "subscription"
			: "bill";

	return { billType, categoryId: modalCategory(rows), autopay: billType !== "bill" };
}

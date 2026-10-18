import type { IsoDate } from "../domain/dates.ts";
import type { PlanAccount, PlanCategory, PlanSecurity, SurePlan } from "./sure-import-plan.ts";

import type { AccountDetails, AccountSubtype, AccountType } from "@archant/data/account-types";
import type { CategoryColor, CategoryKind } from "@archant/data/category-presets";
import { CATEGORY_COLORS, newCategory } from "@archant/data/category-presets";
import { formatQuantity, formatTradePrice } from "@archant/data/decimals";
import type { GoalState } from "@archant/data/goals";
import type { CurrencyCode, MinorUnits } from "@archant/data/money";
import { minorUnitsOf, toMinorUnits } from "@archant/data/money";
import { daysInMonth } from "@archant/data/months";

import { addDays, addMonths, daysBetween, minDate, weekdayOf } from "../domain/dates.ts";
import { amortizationSchedule } from "../domain/loans/amortization-schedule.ts";
import { tradeAmount } from "../domain/trades.ts";
import { parseAccountDetails } from "../schemas/accounts.ts";

// Sure's `Demo::Generator#generate_new_user_data_for!`, which « Réinitialiser
// et précharger » runs after the reset: the same categories, accounts and
// generators in the same order, with Sure's ranges and counts, as the
// `SurePlan` the archive import writes. Pure: the seed and the day decide
// every row, so the same day gives the same household.

/**
 * The seed of every load. Sure reads `DEMO_DATA_SEED` and draws a random one
 * without it, so each of its loads differs; Archant's is fixed: one
 * household needs no other sample, and a test or a bug report then names
 * the rows it saw.
 */
export const SAMPLE_DATA_SEED = 42;

/** A goal of Sure's `generate_goals!`, its accounts named by the plan's ids. */
export type SampleGoal = {
	name: string;
	targetAmount: MinorUnits;
	targetDate: IsoDate | null;
	color: CategoryColor;
	state: GoalState;
	/** What a completed goal had saved, Sure's earmark on the account it closed with. */
	completedAmount: MinorUnits | null;
	accounts: { accountSourceId: string; allocatedAmount: MinorUnits | null }[];
};

export type SamplePlan = { plan: SurePlan; goals: SampleGoal[] };

/**
 * Mulberry32: a small seeded generator, standing in for Ruby's `Random.new(seed)`.
 * Sure's sequence cannot be reproduced without Ruby's Mersenne Twister, and
 * nothing asks for it: only that the same seed gives the same rows.
 */
function seeded(seed: number) {
	let state = seed >>> 0;

	const float = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
	/** Ruby's `rand(min..max)` on integers, both ends included. */
	const int = (min: number, max: number) => min + Math.floor(float() * (max - min + 1));

	return {
		float,
		int,
		/** Ruby's `rand(min..max)` on floats. */
		between: (min: number, max: number) => min + float() * (max - min),
		/** Ruby's `rand(from..to)` on dates. */
		date: (from: IsoDate, to: IsoDate) => addDays(from, int(0, daysBetween(from, to))),
		sample: <Item>(items: readonly Item[]): Item => at(items, int(0, items.length - 1)),
	};
}

type Random = ReturnType<typeof seeded>;

/** The item at `index`, which the caller keeps within the list. */
/** A trade's amount, which the sample's figures always keep within bounds. */
function amountOf(amount: MinorUnits | null): MinorUnits {
	if (amount === null) {
		throw new RangeError("A sample trade's amount is out of bounds.");
	}

	return amount;
}

function at<Item>(items: readonly Item[], index: number): Item {
	const item = items[index];

	if (item === undefined) {
		throw new RangeError("No item at this index.");
	}

	return item;
}

/** Ruby's `Float#round`: half away from zero. */
const rounded = (value: number) => Math.sign(value) * Math.round(Math.abs(value));

const startOfMonth = (date: IsoDate): IsoDate => `${date.slice(0, 8)}01`;

function endOfMonth(date: IsoDate): IsoDate {
	const days = daysInMonth(Number(date.slice(0, 4)), Number(date.slice(5, 7)));

	return `${date.slice(0, 8)}${String(days).padStart(2, "0")}`;
}

function startOfQuarter(date: IsoDate): IsoDate {
	const month = Math.floor((Number(date.slice(5, 7)) - 1) / 3) * 3 + 1;

	return `${date.slice(0, 5)}${String(month).padStart(2, "0")}-01`;
}

const dayOf = (date: IsoDate) => Number(date.slice(8, 10));

const monthOf = (date: IsoDate) => Number(date.slice(5, 7));

/** Ruby's `Date#cweek`, the ISO 8601 week number. */
function isoWeek(date: IsoDate): number {
	const weekday = (weekdayOf(date) + 6) % 7;
	const thursday = addDays(date, 3 - weekday);
	const firstOfYear = `${thursday.slice(0, 4)}-01-01`;

	return Math.floor(daysBetween(firstOfYear, thursday) / 7) + 1;
}

/** Every day from `from` to `to`, both included, as Ruby's `(from..to).each`. */
function* daysFrom(from: IsoDate, to: IsoDate): Generator<IsoDate> {
	for (let date = from; date <= to; date = addDays(date, 1)) {
		yield date;
	}
}

/** Sure's `first_business_day`: the first weekday of `date`'s month. */
function firstBusinessDay(date: IsoDate): IsoDate {
	let day = startOfMonth(date);

	while (weekdayOf(day) === 0 || weekdayOf(day) === 6) {
		day = addDays(day, 1);
	}

	return day;
}

type CategorySpec = {
	id: string;
	name: string;
	kind: CategoryKind;
	color: string;
	parent?: string;
};

/** Sure's `create_realistic_categories!`, in its order, named in French. */
const CATEGORIES: readonly CategorySpec[] = [
	{ id: "salary", name: "Salaire", kind: "income", color: "#10b981" },
	{ id: "freelance", name: "Freelance", kind: "income", color: "#059669" },
	{ id: "investment_income", name: "Revenus de placements", kind: "income", color: "#047857" },
	{ id: "housing", name: "Logement", kind: "expense", color: "#dc2626" },
	{ id: "rent", name: "Loyer et prêt", kind: "expense", color: "#b91c1c", parent: "housing" },
	{ id: "utilities", name: "Charges", kind: "expense", color: "#991b1b", parent: "housing" },
	{ id: "food", name: "Alimentation", kind: "expense", color: "#ea580c" },
	{ id: "groceries", name: "Courses", kind: "expense", color: "#c2410c", parent: "food" },
	{ id: "restaurants", name: "Restaurants", kind: "expense", color: "#9a3412", parent: "food" },
	{ id: "coffee", name: "Cafés et à emporter", kind: "expense", color: "#7c2d12", parent: "food" },
	{ id: "transportation", name: "Transports", kind: "expense", color: "#2563eb" },
	{ id: "gas", name: "Carburant", kind: "expense", color: "#1d4ed8", parent: "transportation" },
	{
		id: "car_payment",
		name: "Crédit auto",
		kind: "expense",
		color: "#1e40af",
		parent: "transportation",
	},
	{ id: "entertainment", name: "Loisirs", kind: "expense", color: "#7c3aed" },
	{ id: "healthcare", name: "Santé", kind: "expense", color: "#db2777" },
	{ id: "shopping", name: "Shopping", kind: "expense", color: "#059669" },
	{ id: "travel", name: "Voyages", kind: "expense", color: "#0891b2" },
	{ id: "personal_care", name: "Soins personnels", kind: "expense", color: "#be185d" },
	{ id: "insurance", name: "Assurances", kind: "expense", color: "#6366f1" },
	{ id: "misc", name: "Divers", kind: "expense", color: "#6b7280" },
	{ id: "interest", name: "Intérêts d'emprunt", kind: "expense", color: "#475569" },
];

type AccountSpec = {
	id: string;
	name: string;
	type: AccountType;
	subtype: AccountSubtype | null;
	/** A loan's terms as Sure's `Loan.new` types them, read as the form reads them. */
	loan?: Record<string, string | { effectiveDate: string; rate: string }[]>;
};

/**
 * The security every demo trade buys, Sure's `Security.first`: typed by hand,
 * so no provider prices an American listing as if it were quoted in euros.
 */
const SECURITY: PlanSecurity = {
	key: JSON.stringify(["hand", null, "Vanguard Total Stock Market ETF"]),
	ticker: "VTI",
	mic: null,
	isin: null,
	name: "Vanguard Total Stock Market ETF",
	byHand: true,
};

/** Sure's student loan's one extra principal payment, a year ago. */
export const STUDENT_LOAN_EXTRA_PAYMENT = 2_000;

/**
 * Sure's demo, generated for `today` in `currency`. Every Sure dollar becomes
 * the same number of units of `currency`: Archant converts nothing (AD-6).
 */
export function samplePlan(options: {
	seed: number;
	today: IsoDate;
	currency: CurrencyCode;
}): SamplePlan {
	const { today, currency } = options;
	const random: Random = seeded(options.seed);
	const unit = 10 ** minorUnitsOf(currency);
	const money = (major: number) => toMinorUnits(Math.round(major * unit));
	const yearsAgo = (years: number) => addMonths(today, -12 * years);
	const monthsAgo = (months: number) => addMonths(today, -months);
	const weightedRandomDate = () => random.date(yearsAgo(3), today);
	/** Sure's `jitter`: ±`pct` of `num`, to the cent. */
	const jitter = (num: number, pct = 0.03) =>
		Math.round((num + num * pct * (random.float() * 2 - 1)) * 100) / 100;
	// Sure's `pick` walks each list in turn. Its lists are literals built anew
	// on each call, so it meant one walk per call site, as here.
	const walks = new Map<string, number>();
	const pick = <Item>(site: string, items: readonly Item[]): Item => {
		const index = walks.get(site) ?? 0;
		walks.set(site, index + 1);

		return at(items, index % items.length);
	};

	const plan: SurePlan = {
		accounts: [],
		categories: CATEGORIES.map((category): PlanCategory => ({
			sourceId: category.id,
			name: category.name,
			kind: category.kind,
			color: category.color,
			// Sure's demo sets no icon; Archant has none for « shapes ».
			icon: newCategory().icon,
			parentSourceId: category.parent ?? null,
		})),
		tags: [],
		merchants: [],
		recurring: [],
		transactions: [],
		transfers: [],
		rejectedTransfers: [],
		trades: [],
		holdings: [],
		valuations: [],
		budgets: [],
		budgetCategories: [],
		rules: [],
	};

	// --- create_realistic_accounts! ------------------------------------------
	const mortgageStart = yearsAgo(5);
	const loansStart = startOfMonth(monthsAgo(37));
	const specs: AccountSpec[] = [
		{
			id: "chase_checking",
			name: "Compte courant Chase Premier",
			type: "depository",
			subtype: "checking",
		},
		{
			id: "ally_checking",
			name: "Compte courant Ally en ligne",
			type: "depository",
			subtype: "checking",
		},
		{ id: "marcus_savings", name: "Livret Marcus", type: "depository", subtype: "savings" },
		{
			id: "eu_checking",
			name: "Compte courant Deutsche Bank",
			type: "depository",
			subtype: "checking",
		},
		{ id: "amex_gold", name: "Carte Amex Gold", type: "credit_card", subtype: null },
		{
			id: "chase_sapphire",
			name: "Carte Chase Sapphire Reserve",
			type: "credit_card",
			subtype: null,
		},
		{ id: "vanguard_401k", name: "Épargne retraite Vanguard", type: "investment", subtype: null },
		{
			id: "schwab_brokerage",
			name: "Compte-titres Charles Schwab",
			type: "investment",
			subtype: null,
		},
		{ id: "fidelity_roth_ira", name: "Retraite Fidelity Roth", type: "investment", subtype: null },
		{ id: "hsa_investment", name: "Épargne santé Fidelity", type: "investment", subtype: null },
		{ id: "uk_isa", name: "Portefeuille Vanguard Royaume-Uni", type: "investment", subtype: null },
		{ id: "home", name: "Résidence principale", type: "property", subtype: "single_family_home" },
		{ id: "honda_accord", name: "Honda Accord 2016", type: "vehicle", subtype: null },
		{ id: "tesla_model3", name: "Tesla Model 3 2021", type: "vehicle", subtype: null },
		{ id: "coinbase_usdc", name: "Coinbase USDC", type: "crypto", subtype: null },
		{
			id: "mortgage",
			name: "Prêt immobilier",
			type: "loan",
			subtype: "mortgage",
			loan: {
				originalAmount: "320000",
				downPayment: "70000",
				startDate: mortgageStart,
				termMonths: "360",
				rateType: "adjustable",
				interestRate: "6,25",
				insuranceRate: "0,36",
				insuranceRateType: "level_term",
				rateChanges: [
					{ effectiveDate: addMonths(mortgageStart, 24), rate: "5,5" },
					{ effectiveDate: addMonths(mortgageStart, 48), rate: "6,75" },
				],
			},
		},
		{
			id: "car_loan",
			name: "Prêt auto",
			type: "loan",
			subtype: "auto",
			loan: {
				originalAmount: "24000",
				downPayment: "4000",
				startDate: loansStart,
				termMonths: "60",
				rateType: "fixed",
				interestRate: "6,9",
				insuranceRate: "0,5",
				insuranceRateType: "decreasing_life",
				rateChanges: [],
			},
		},
		{
			id: "student_loan",
			name: "Prêt étudiant",
			type: "loan",
			subtype: "student",
			loan: {
				originalAmount: "42000",
				startDate: loansStart,
				termMonths: "120",
				rateType: "fixed",
				interestRate: "5,5",
				rateChanges: [],
			},
		},
		{
			id: "personal_loc",
			name: "Ligne de crédit personnelle",
			type: "other_liability",
			subtype: null,
		},
		{ id: "jewelry", name: "Collection de bijoux", type: "other_asset", subtype: null },
	];

	// --- Entries ---------------------------------------------------------------
	let next = 0;
	const transaction = (
		account: string,
		sureAmount: number,
		label: string,
		category: string | null,
		date: IsoDate,
	) => {
		const sourceId = `t${next++}`;

		// Sure stores an expense positive; Archant's sign is the account's (AD-5).
		plan.transactions.push({
			sourceId,
			accountSourceId: account,
			date,
			amount: toMinorUnits(-sureAmount),
			label,
			notes: null,
			excluded: false,
			oneTime: false,
			pending: false,
			reference: null,
			possibleDuplicate: false,
			lockedFields: {},
			categorySourceId: category,
			categoryOrigin: "user",
			merchantSourceId: null,
			tagSourceIds: [],
			investmentActivityLabel: null,
			splitLines: [],
		});

		return sourceId;
	};
	const spend = (
		account: string,
		major: number,
		label: string,
		category: string | null,
		date: IsoDate,
	) => transaction(account, money(major), label, category, date);
	/** Sure's `create_transfer!`, its status Sure's default, `pending`. */
	const transferMinor = (
		from: string,
		to: string,
		amount: number,
		label: string,
		date: IsoDate,
	) => {
		plan.transfers.push({
			outflowSourceId: transaction(from, amount, label, null, date),
			inflowSourceId: transaction(to, -amount, label, null, date),
			kind: null,
			status: "pending",
		});
	};
	const transfer = (from: string, to: string, major: number, label: string, date: IsoDate) =>
		transferMinor(from, to, money(major), label, date);

	const CHASE = "chase_checking";
	const ALLY = "ally_checking";
	const MARCUS = "marcus_savings";

	// generate_salary_history!
	{
		let firstDate = yearsAgo(3);

		while (weekdayOf(firstDate) !== 5) {
			firstDate = addDays(firstDate, 1);
		}

		for (let index = 0; index < 78; index++) {
			const date = addDays(firstDate, 14 * index);

			if (date > today) {
				break;
			}

			const amount = -rounded(jitter(8_500, 0.02));
			spend(CHASE, amount, "Salaire Acme Corp", "salary", date);
			transfer(
				CHASE,
				MARCUS,
				rounded(-amount * 0.1),
				"Épargne automatique de 10 % du salaire",
				date,
			);
		}

		for (let index = 0; index < 15; index++) {
			const date = weightedRandomDate();
			spend(CHASE, -random.int(1_500, 4_000), "Mission freelance", "freelance", date);
		}

		for (const date of daysFrom(yearsAgo(3), today)) {
			if (dayOf(date) === 15 && [3, 6, 9, 12].includes(monthOf(date))) {
				spend(CHASE, -random.int(800, 1_500), "Dividendes", "investment_income", date);
			}
		}

		for (let index = 0; index < 40; index++) {
			const date = weightedRandomDate();
			spend(CHASE, -random.int(800, 2_500), "Paiement freelance", "freelance", date);
		}

		const incomes = [
			"Pourboires en espèces",
			"Vente d'objets",
			"Remboursement",
			"Remise",
			"Encaissement de carte cadeau",
		];

		for (let index = 0; index < 25; index++) {
			const date = weightedRandomDate();
			const amount = -random.int(200, 800);
			spend(CHASE, amount, random.sample(incomes), "freelance", date);
		}
	}

	// generate_housing_transactions!: the mortgage is paid from its schedule below.
	{
		const utilities = [
			{ name: "Électricité ConEd", min: 150, max: 300 },
			{ name: "Internet Verizon", min: 85, max: 105 },
			{ name: "Eau et assainissement", min: 60, max: 90 },
			{ name: "Facture de gaz", min: 80, max: 220 },
		];

		for (const utility of utilities) {
			for (const date of daysFrom(yearsAgo(3), today)) {
				if (dayOf(date) >= 5 && dayOf(date) <= 15 && random.float() < 0.9) {
					spend(CHASE, random.int(utility.min, utility.max), utility.name, "utilities", date);
				}
			}
		}
	}

	/** `count` lines at Sure's weighted dates, each amount drawn before its label. */
	const repeated = (
		count: number,
		min: number,
		max: number,
		labels: readonly string[],
		category: string,
		account = CHASE,
	) => {
		for (let index = 0; index < count; index++) {
			const date = weightedRandomDate();
			const amount = random.int(min, max);
			spend(account, amount, random.sample(labels), category, date);
		}
	};

	// generate_food_transactions!
	repeated(
		120,
		60,
		180,
		["Whole Foods", "Trader Joe's", "Safeway", "Stop & Shop", "Fresh Market"].map(
			(store) => `Courses ${store}`,
		),
		"groceries",
	);
	repeated(
		100,
		25,
		65,
		[
			"Pizzeria du coin",
			"Restaurant de sushis",
			"Cuisine italienne",
			"Grill mexicain",
			"Taverne grecque",
		],
		"restaurants",
	);
	repeated(80, 8, 20, ["Café du quartier", "Dunkin'", "Traiteur du coin", "Food truck"], "coffee");

	// generate_transportation_transactions!
	repeated(
		60,
		35,
		75,
		["Shell", "Exxon", "BP", "Chevron", "Mobil", "Sunoco"].map((station) => `Carburant ${station}`),
		"gas",
	);

	{
		// The previous car, paid up to the day before the car loan starts.
		const end = minDate(yearsAgo(1), addDays(loansStart, -1));

		for (const date of daysFrom(yearsAgo(6), end)) {
			if (dayOf(date) === 15) {
				spend(CHASE, 385, "Mensualité prêt auto", "car_payment", date);
			}
		}
	}

	// generate_entertainment_transactions!
	{
		const subscriptions = [
			{ name: "Netflix", amount: 15 },
			{ name: "Spotify Premium", amount: 12 },
			{ name: "Disney+", amount: 8 },
			{ name: "HBO Max", amount: 16 },
			{ name: "Amazon Prime", amount: 14 },
		];

		for (const subscription of subscriptions) {
			for (const date of daysFrom(yearsAgo(3), today)) {
				if (dayOf(date) === random.int(1, 28) && random.float() < 0.9) {
					spend(CHASE, subscription.amount, subscription.name, "entertainment", date);
				}
			}
		}

		repeated(
			60,
			15,
			60,
			["Cinéma", "Match", "Musée", "Club de comédie", "Bowling", "Mini-golf", "Salle d'arcade"],
			"entertainment",
		);
	}

	// generate_shopping_transactions!
	repeated(
		80,
		30,
		90,
		["Target.com", "Walmart", "Costco"].map((store) => `Achat ${store}`),
		"shopping",
	);
	repeated(60, 35, 80, ["Target", "REI", "Barnes & Noble", "GameStop"], "shopping");

	// generate_healthcare_transactions!
	repeated(
		45,
		150,
		350,
		["Dr Smith", "Dr Johnson", "Dr Williams", "Consultation chez un spécialiste", "Urgences"],
		"healthcare",
	);
	repeated(
		80,
		12,
		65,
		["Pharmacie CVS", "Walgreens", "Rite Aid", "Pharmacie du quartier"],
		"healthcare",
	);

	// generate_travel_transactions!
	{
		const hotels = ["Hôtel local", "Chambre d'hôtes", "Resort à proximité"];
		const activities = ["Visite guidée", "Billets de musée", "Pass activités"];

		for (let index = 0; index < 8; index++) {
			const date = weightedRandomDate();
			const hotel = random.int(200, 500);
			const account = random.float() < 0.3 && date > yearsAgo(3) ? "eu_checking" : CHASE;
			spend(account, hotel, random.sample(hotels), "travel", date);

			const flight = random.int(200, 400);
			spend(CHASE, flight, "Vol intérieur", "travel", addDays(date, random.int(1, 5)));

			const activity = random.int(50, 150);
			const label = random.sample(activities);
			spend(CHASE, activity, label, "travel", addDays(date, random.int(1, 7)));
		}
	}

	// generate_personal_care_transactions!
	for (const date of daysFrom(yearsAgo(12), today)) {
		if (dayOf(date) === 1 && random.float() < 0.8) {
			spend(CHASE, 45, "Salle de sport", "personal_care", date);
		}
	}

	repeated(40, 25, 80, ["Salon de coiffure", "Barbier", "Onglerie"], "personal_care");

	// generate_investment_transactions!
	{
		const trade = (
			account: string,
			numerator: number,
			denominator: number,
			date: IsoDate,
			prices = [80, 200],
		) => {
			const price = random.int(prices[0] ?? 80, prices[1] ?? 200);
			// Sure's `(investment_amount / price).round(2)`, in hundredths, half away from zero.
			const hundredths = Math.floor(
				(2 * numerator * 100 + price * denominator) / (2 * price * denominator),
			);
			const figures = {
				quantity: formatQuantity(BigInt(hundredths) * 10n ** 16n),
				price: formatTradePrice(BigInt(price) * 10n ** 10n),
				fee: toMinorUnits(0),
			};

			plan.trades.push({
				accountSourceId: account,
				date,
				security: SECURITY,
				incomeKind: null,
				...figures,
				amount: amountOf(tradeAmount(figures, currency)),
				parentSourceId: null,
			});
		};
		const monthly = (count: number, step: number, each: (date: IsoDate) => void) => {
			for (
				let cursor = startOfMonth(monthsAgo(36));
				cursor <= today;
				cursor = addMonths(cursor, 1)
			) {
				for (let index = 0; index < count; index++) {
					each(addDays(cursor, index * step));
				}
			}
		};

		// collect_payroll_dates: a payday every other Friday. Sure steps 14 days
		// from the first Friday and keeps the even ISO weeks, a parity that never
		// changes between steps, so on half the days it keeps none and the 401(k)
		// gets no trade. Starting from the first Friday of an even week, then
		// stepping 14 days, keeps Sure's fortnightly cadence across a 53-week year.
		const payroll: IsoDate[] = [];
		let friday = monthsAgo(36);

		while (weekdayOf(friday) !== 5 || isoWeek(friday) % 2 !== 0) {
			friday = addDays(friday, 1);
		}

		for (; friday <= today; friday = addDays(friday, 14)) {
			payroll.push(friday);
		}

		for (const date of payroll.slice(0, 90)) {
			trade("vanguard_401k", 1_200, 1, date);
			trade("vanguard_401k", 300, 1, date);
		}

		monthly(4, 7, (date) => trade("schwab_brokerage", random.int(400, 1_000), 1, date));
		monthly(3, 10, (date) => trade("fidelity_roth_ira", 500, 3, date));
		monthly(3, 10, (date) => trade("uk_isa", 400, 3, date, [60, 150]));
	}

	// generate_major_purchases!
	spend(CHASE, 70_000, "Apport pour la résidence principale", "housing", mortgageStart);
	spend(CHASE, -5_000, "Dépôt initial", "salary", yearsAgo(12));
	spend(ALLY, -2_000, "Dépôt initial", "salary", yearsAgo(12));
	spend(MARCUS, -10_000, "Épargne initiale", "salary", yearsAgo(12));
	spend("eu_checking", -5_000, "Ouverture du compte", null, yearsAgo(4));
	spend(CHASE, 3_000, "Apport voiture", "transportation", yearsAgo(6));
	spend(CHASE, 2_500, "Apport seconde voiture", "transportation", yearsAgo(8));
	spend(CHASE, 8_000, "Rénovation de la cuisine", "utilities", yearsAgo(2));
	spend(CHASE, 5_000, "Rénovation de la salle de bain", "utilities", yearsAgo(1));
	spend(CHASE, 12_000, "Remplacement de la toiture", "utilities", yearsAgo(3));
	spend(CHASE, 8_000, "Urgence familiale", "healthcare", yearsAgo(4));
	spend(CHASE, 15_000, "Frais de mariage", "entertainment", yearsAgo(9));

	// generate_transfers_and_payments!, credit card cycles first.
	{
		const expenseCategories = ["food", "entertainment", "shopping", "travel", "transportation"];
		const merchants: Record<string, readonly string[]> = {
			amex_gold: ["WholeFoods", "Starbucks", "UberEats", "Netflix", "LocalBistro", "AirBnB"],
			chase_sapphire: ["Delta Airlines", "Hilton Hotels", "Expedia", "Apple", "BestBuy", "Amazon"],
		};
		const charges = (account: string, month: IsoDate, count: number) => {
			let total = 0;

			for (let index = 0; index < count; index++) {
				const date = addDays(month, random.int(0, 27));
				const amount = rounded(jitter(random.int(15, 80), 0.15));
				const merchant = pick(account, merchants[account] ?? []);
				spend(account, amount, merchant, random.sample(expenseCategories), date);
				total += amount;
			}

			return total;
		};
		let amex = 0;
		let sapphire = 0;

		for (
			let cursor = startOfMonth(monthsAgo(36));
			cursor <= endOfMonth(today);
			cursor = addMonths(cursor, 1)
		) {
			const target = random.int(30, 45);
			const amexCount = Math.trunc(target * random.between(0.45, 0.55));
			const amexTotal = charges("amex_gold", cursor, amexCount);
			const sapphireTotal = charges("chase_sapphire", cursor, target - amexCount);

			amex += amexTotal;
			sapphire += sapphireTotal;

			const paymentDate = addDays(endOfMonth(cursor), 5);

			if (amexTotal > 0) {
				const payment = rounded(amexTotal * random.between(0.9, 0.95));
				transfer(CHASE, "amex_gold", payment, "Paiement Amex", paymentDate);
				amex -= payment;
			}

			if (sapphireTotal > 0) {
				const payment = rounded(sapphireTotal * random.between(0.9, 0.95));
				transfer(CHASE, "chase_sapphire", payment, "Paiement Sapphire", paymentDate);
				sapphire -= payment;
			}
		}

		// Re-balance to Sure's targets, ±250.
		for (const [account, balance, target, label] of [
			["amex_gold", amex, 2_500, "Ajustement du solde Amex"],
			["chase_sapphire", sapphire, 4_200, "Ajustement du solde Sapphire"],
		] as const) {
			const difference = balance - target;

			if (difference > 250) {
				transfer(CHASE, account, difference, label, today);
			} else if (difference < -250) {
				spend(
					account,
					-difference,
					"Régularisation du solde",
					random.sample(expenseCategories),
					today,
				);
			}
		}
	}

	// generate_monthly_ally_transfers!
	for (let cursor = startOfMonth(monthsAgo(36)); cursor <= today; cursor = addMonths(cursor, 1)) {
		transfer(CHASE, ALLY, 300, "Virement mensuel vers Ally", firstBusinessDay(cursor));
	}

	// generate_quarterly_fx_transfers!
	for (let cursor = startOfQuarter(monthsAgo(36)); cursor <= today; cursor = addMonths(cursor, 3)) {
		transfer(
			CHASE,
			"eu_checking",
			2_000,
			"Virement trimestriel vers Deutsche Bank",
			addDays(cursor, 2),
		);
	}

	// generate_additional_savings_transfers!
	for (const date of daysFrom(yearsAgo(3), today)) {
		if (dayOf(date) === 15 && random.float() < 0.7) {
			transfer(CHASE, MARCUS, random.int(500, 1_500), "Épargne supplémentaire", date);
		}
	}

	for (const date of daysFrom(yearsAgo(3), today)) {
		if (dayOf(date) === 1 && [1, 4, 7, 10].includes(monthOf(date))) {
			transfer(CHASE, "hsa_investment", random.int(1_000, 2_000), "Versement épargne santé", date);
		}
	}

	for (let index = 0; index < 8; index++) {
		const date = weightedRandomDate();
		spend(CHASE, -random.int(2_000, 8_000), "Remboursement d'impôts ou prime", "salary", date);
	}

	for (const date of daysFrom(yearsAgo(3), today)) {
		if (dayOf(date) === random.int(20, 28) && random.float() < 0.8) {
			transfer(MARCUS, CHASE, random.int(2_000, 5_000), "Virement depuis l'épargne", date);
		}
	}

	for (const date of daysFrom(yearsAgo(3), today)) {
		if (weekdayOf(date) === 1 && random.float() < 0.4) {
			transfer(MARCUS, CHASE, random.int(500, 1_200), "Trésorerie de la semaine", date);
		}
	}

	// generate_loan_payments!: each loan pays its own schedule up to today.
	const details = new Map<string, AccountDetails | null>();

	for (const spec of specs) {
		details.set(spec.id, detailsOf(spec, currency));
	}

	for (const [account, memo, interestLabel, interestCategory] of [
		["mortgage", "Mensualité prêt immobilier", "Intérêts prêt immobilier", "rent"],
		["student_loan", "Mensualité prêt étudiant", "Intérêts prêt étudiant", "interest"],
		["car_loan", "Mensualité prêt auto", "Intérêts prêt auto", "transportation"],
	] as const) {
		const loan = details.get(account);
		const schedule =
			loan !== null && loan !== undefined && "rateChanges" in loan
				? amortizationSchedule({ ...loan, originationDate: loan.startDate })
				: null;

		for (const payment of schedule?.payments ?? []) {
			if (payment.date > today) {
				break;
			}

			transferMinor(CHASE, account, Number(payment.principal), memo, payment.date);
			transaction(CHASE, Number(payment.interest), interestLabel, interestCategory, payment.date);
		}
	}

	transfer(
		CHASE,
		"student_loan",
		STUDENT_LOAN_EXTRA_PAYMENT,
		"Remboursement anticipé prêt étudiant",
		yearsAgo(1),
	);

	// generate_regular_expenses!: up to 600 lines on the main checking account.
	{
		const generators = [
			(date: IsoDate) =>
				spend(
					CHASE,
					rounded(jitter(random.int(150, 220), 0.05)),
					pick("regular-utilities", ["Électricité ConEd", "National Grid", "Gaz et électricité"]),
					"utilities",
					date,
				),
			(date: IsoDate) =>
				spend(
					CHASE,
					rounded(jitter(random.int(10, 20), 0.1)),
					pick("regular-streaming", ["Spotify", "Netflix", "Hulu", "Apple One"]),
					"entertainment",
					date,
				),
			(date: IsoDate) =>
				spend(
					CHASE,
					rounded(jitter(random.int(45, 90), 0.1)),
					`Courses ${pick("regular-groceries", ["Whole Foods", "Trader Joe's", "Safeway"])}`,
					"groceries",
					date,
				),
			(date: IsoDate) =>
				spend(
					CHASE,
					rounded(jitter(random.int(25, 50), 0.1)),
					pick("regular-gas", ["Carburant Shell", "Carburant BP", "Carburant Exxon"]),
					"gas",
					date,
				),
			(date: IsoDate) =>
				spend(
					CHASE,
					rounded(jitter(random.int(15, 40), 0.1)),
					pick("regular-media", ["Streaming", "Achat de livre", "Jeu mobile"]),
					"entertainment",
					date,
				),
		];
		const current = plan.transactions.filter((row) => row.accountSourceId === CHASE).length;

		for (let index = 0; index < Math.max(600 - current, 0); index++) {
			const date = weightedRandomDate();
			random.sample(generators)(date);
		}
	}

	// generate_micro_transactions!
	for (let index = 0; index < 120; index++) {
		const date = weightedRandomDate();
		spend(CHASE, random.int(20, 60), "Retrait au distributeur", "misc", date);
		spend(CHASE, random.int(2, 4), "Frais de retrait", "misc", date);
	}

	repeated(
		200,
		3,
		15,
		["7-Eleven", "Wawa", "Circle K", "Quick Stop", "Épicerie du coin"],
		"shopping",
	);
	repeated(
		120,
		1,
		10,
		["App Store", "Google Play", "iTunes", "Steam", "Livre Kindle"],
		"entertainment",
	);

	for (let index = 0; index < 100; index++) {
		const date = weightedRandomDate();
		const amount = random.int(2, 8);
		spend(
			CHASE,
			amount,
			pick("parking", ["Parcmètre", "Péage de pont", "Péage de tunnel"]),
			"transportation",
			date,
		);
	}

	repeated(
		150,
		5,
		25,
		["Food truck", "Marché de producteurs", "Vendeur de rue", "Pourboire", "Don"],
		"misc",
	);
	repeated(60, 1, 5, ["Distributeur automatique"], "shopping");
	repeated(
		120,
		2,
		8,
		["Pass de métro", "Ticket de bus", "Billet de train", "Uber/Lyft"],
		"transportation",
	);
	repeated(
		400,
		1,
		12,
		[
			"Kiosque à journaux",
			"Chariot à café",
			"Pot à pourboires",
			"Urne de dons",
			"Laverie",
			"Station de lavage",
			"Redbox",
			"Cabine téléphonique",
			"Photomaton",
			"Jeu d'arcade",
			"Affranchissement",
			"Journal",
			"Ticket de loterie",
			"Distributeur de chewing-gums",
			"Camion de glaces",
		],
		"misc",
	);
	repeated(
		500,
		1,
		8,
		[
			"Distributeur de bonbons",
			"Distributeur d'autocollants",
			"Balance à pièces",
			"Don à une association",
			"Pourboire à un musicien",
			"Quête à l'église",
			"Stand de limonade",
			"Biscuits des scouts",
			"Ticket de tombola",
			"Vente de gâteaux",
			"Pourboire au lavage auto",
			"Artiste de rue",
		],
		"misc",
	);

	// generate_legacy_transactions!
	{
		const count = random.int(40, 60);

		for (let index = 0; index < count; index++) {
			const years = random.int(3, 6);
			const date = addDays(yearsAgo(years), -random.int(0, 364));
			const base = random.int(12, 45);
			const amount = rounded(base * (1 - 0.02 * Math.max(years - 3, 0)));
			const account = random.sample([CHASE, ALLY]);
			const category = pick("legacy", ["groceries", "utilities", "gas", "restaurants", "shopping"]);
			const merchant =
				category === "groceries"
					? `Courses ${pick("legacy-groceries", ["Walmart", "Kroger", "Safeway"])}`
					: category === "utilities"
						? pick("legacy-utilities", ["Électricité locale", "Eau municipale", "Compagnie du gaz"])
						: category === "gas"
							? `Carburant ${pick("legacy-gas", ["Shell", "Exxon", "BP"])}`
							: category === "restaurants"
								? pick("legacy-restaurants", ["Petit restaurant", "Burger Grill", "Pizzeria"])
								: pick("legacy-shops", ["Bazar", "Grand magasin", "Magasin d'usine"]);

			spend(account, amount, merchant, category, date);
		}
	}

	{
		const count = random.int(25, 40);

		for (let index = 0; index < count; index++) {
			const years = random.int(7, 15);
			const date = addDays(yearsAgo(years), -random.int(0, 364));
			const base = random.int(8, 30);
			const amount = Math.min(Math.max(rounded(base * (1 - 0.03 * Math.max(years - 7, 0))), 5), 25);
			const category = pick("old", ["groceries", "gas", "restaurants"]);
			const merchant =
				category === "groceries"
					? `Courses ${pick("old-groceries", ["Walmart", "Kroger"])}`
					: category === "gas"
						? `Carburant ${pick("old-gas", ["Shell", "Exxon"])}`
						: pick("old-restaurants", ["Vieux restaurant", "Restaurant local"]);

			spend(CHASE, amount, `${merchant} (il y a ${years} ans)`, category, date);
		}
	}

	for (let index = 0; index < 400; index++) {
		const years = random.int(4, 12);
		const date = addDays(yearsAgo(years), -random.int(0, 364));
		const amount = random.int(6, 20);
		const account = random.sample([CHASE, ALLY]);
		const category = pick("additional", ["groceries", "gas", "utilities"]);
		const merchant = pick("additional-labels", [
			"Ancienne épicerie",
			"Ancienne station-service",
			"Ancien fournisseur d'électricité",
		]);

		spend(account, amount, merchant, category, date);
	}

	// generate_crypto_and_misc_assets!
	spend("coinbase_usdc", -3_500, "Dépôt initial USDC", null, monthsAgo(18));

	// reconcile_balances!: values set rather than reached by transactions.
	for (const [account, amount, date] of [
		["home", 350_000, today],
		["honda_accord", 18_000, today],
		["tesla_model3", 4_500, today],
		["jewelry", 2_000, addDays(today, -90)],
		["personal_loc", 800, addDays(today, -120)],
	] as const) {
		plan.valuations.push({ accountSourceId: account, date, amount: money(amount) });
	}

	plan.accounts = specs.map((spec) =>
		accountOf(spec, plan, currency, today, details.get(spec.id) ?? null),
	);
	budgetAutoFill(plan, today, unit);

	return { plan, goals: sampleGoals(random, today, money) };
}

/** A loan's terms read as its form reads them; the other types' details as an empty form leaves them. */
function detailsOf(spec: AccountSpec, currency: CurrencyCode): AccountDetails | null {
	const startDate = typeof spec.loan?.startDate === "string" ? spec.loan.startDate : null;
	const parsed = parseAccountDetails(spec.type, spec.loan ?? {}, {
		currency,
		openingDate: startDate,
	});

	if (spec.type === "crypto") {
		return { taxTreatment: "taxable" };
	}

	// A typo in the terms above would drop a loan's schedule without a word.
	if (parsed !== null && parsed.issues.length > 0) {
		throw new Error(`The sample account ${spec.id} has invalid details.`);
	}

	return parsed?.details ?? null;
}

/**
 * An account as the archive import reads Sure's demo back: a loan opens on
 * its start date at its principal, Sure's `open_demo_loan!`; an account set by
 * valuations opens the day before the first at its amount; an investment
 * account opens the day before its first line with the cash its buys spend,
 * so its balance is what it holds (AD-22); any other opens empty the day
 * before its first line.
 */
function accountOf(
	spec: AccountSpec,
	plan: SurePlan,
	currency: CurrencyCode,
	today: IsoDate,
	details: AccountDetails | null,
): PlanAccount {
	const own = <Row extends { accountSourceId: string }>(rows: readonly Row[]) =>
		rows.filter((row) => row.accountSourceId === spec.id);
	const valuations = own(plan.valuations).toSorted((left, right) =>
		left.date < right.date ? -1 : 1,
	);
	const trades = own(plan.trades);
	const dates = [...own(plan.transactions), ...trades, ...valuations]
		.map((row) => row.date)
		.toSorted();
	const oldest = dates[0];
	const before = oldest === undefined ? today : addDays(oldest, -1);
	const [firstValuation] = valuations;
	let opening: PlanAccount["opening"];

	if (
		details !== null &&
		"rateChanges" in details &&
		details.startDate !== null &&
		details.originalAmount !== null
	) {
		opening = { date: details.startDate, amount: details.originalAmount };
	} else if (firstValuation !== undefined) {
		opening = { date: addDays(firstValuation.date, -1), amount: firstValuation.amount };
	} else {
		opening = {
			date: before,
			amount: toMinorUnits(trades.reduce((sum, trade) => sum - trade.amount, 0)),
		};
	}

	return {
		sourceId: spec.id,
		name: spec.name,
		type: spec.type,
		subtype: spec.subtype,
		currency,
		active: true,
		excludedFromReports: false,
		institutionName: null,
		institutionDomain: null,
		notes: null,
		details,
		opening,
	};
}

/**
 * Sure's `generate_budget_auto_fill!`: this month's budget, each category's
 * average spending over the three months before, rounded to 25 units. A
 * parent holds its own average plus its children's, as Archant's budgets
 * require; the month's total is the top-level amounts' sum.
 */
function budgetAutoFill(plan: SurePlan, today: IsoDate, unit: number): void {
	const month = startOfMonth(today);
	const from = addMonths(month, -3);
	const to = addDays(month, -1);
	const spent = new Map<string, number>();

	for (const row of plan.transactions) {
		if (row.date >= from && row.date <= to && row.amount < 0 && row.categorySourceId !== null) {
			spent.set(row.categorySourceId, (spent.get(row.categorySourceId) ?? 0) - row.amount);
		}
	}

	const step = 25 * unit;
	const own = new Map(
		[...spent].map(([category, total]) => [category, Math.round(total / 3 / step) * step]),
	);
	const amounts = new Map<string, number>();

	for (const category of plan.categories) {
		const amount = own.get(category.sourceId);

		if (amount === undefined) {
			continue;
		}

		amounts.set(category.sourceId, (amounts.get(category.sourceId) ?? 0) + amount);

		if (category.parentSourceId !== null) {
			amounts.set(category.parentSourceId, (amounts.get(category.parentSourceId) ?? 0) + amount);
		}
	}

	const parents = new Map(
		plan.categories.map((category) => [category.sourceId, category.parentSourceId]),
	);
	const total = [...amounts]
		.filter(([category]) => parents.get(category) === null)
		.reduce((sum, [, amount]) => sum + amount, 0);
	const sourceId = "budget";

	plan.budgets = [
		{
			sourceId,
			month: month.slice(0, 7),
			budgetedSpending: toMinorUnits(total),
			expectedIncome: toMinorUnits(0),
		},
	];
	plan.budgetCategories = plan.categories.flatMap((category) => {
		const amount = amounts.get(category.sourceId);

		return amount === undefined
			? []
			: [
					{
						budgetSourceId: sourceId,
						categorySourceId: category.sourceId,
						amount: toMinorUnits(amount),
						rolloverEnabled: undefined,
					},
				];
	});
}

/**
 * Sure's `generate_goals!`: nine goals covering every state, on the first
 * two checking accounts, Sure's primary and secondary. Sure's pledges are
 * left out: Archant has none.
 */
function sampleGoals(
	random: Random,
	today: IsoDate,
	money: (major: number) => MinorUnits,
): SampleGoal[] {
	const primary = "chase_checking";
	const secondary = "ally_checking";
	const specs: {
		name: string;
		target: number;
		targetDate: IsoDate | null;
		state?: GoalState;
		accounts: [string, number | null][];
	}[] = [
		{
			name: "Vacances en Italie",
			target: 20_000,
			targetDate: addMonths(today, 4),
			accounts: [[secondary, 3_000]],
		},
		{
			name: "Cagnotte mariage",
			target: 2_400,
			targetDate: addMonths(today, 12),
			accounts: [[primary, 2_500]],
		},
		{ name: "Fonds d'urgence", target: 30_000, targetDate: null, accounts: [[secondary, 3_000]] },
		{
			name: "Apport immobilier",
			target: 500_000,
			targetDate: addMonths(today, 24),
			accounts: [
				[primary, 1_000],
				[secondary, 2_000],
			],
		},
		{
			name: "Portefeuille long terme",
			target: 200_000,
			targetDate: addMonths(today, 60),
			accounts: [[primary, null]],
		},
		{
			name: "Réserve pour les impôts",
			target: 1_200,
			targetDate: addMonths(today, -2),
			accounts: [[secondary, 1_000]],
		},
		{
			name: "Année sabbatique",
			target: 15_000,
			targetDate: addMonths(today, 18),
			state: "paused",
			accounts: [[primary, 1_000]],
		},
		{
			name: "Nouvel ordinateur",
			target: 1_500,
			targetDate: addMonths(today, -12),
			state: "archived",
			accounts: [[primary, 500]],
		},
		{
			name: "Voiture remboursée",
			target: 8_000,
			targetDate: addMonths(today, -6),
			state: "completed",
			accounts: [[primary, 8_000]],
		},
	];

	return specs.map((spec) => ({
		name: spec.name,
		targetAmount: money(spec.target),
		targetDate: spec.targetDate,
		color: random.sample(CATEGORY_COLORS),
		state: spec.state ?? "active",
		completedAmount:
			spec.state === "completed"
				? money(spec.accounts.reduce((sum, [, amount]) => sum + (amount ?? 0), 0))
				: null,
		accounts: spec.accounts.map(([accountSourceId, amount]) => ({
			accountSourceId,
			allocatedAmount: amount === null ? null : money(amount),
		})),
	}));
}

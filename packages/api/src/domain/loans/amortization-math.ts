/**
 * Sure's `Loan::AmortizationMath`, read at `14638a701`: the per-period
 * arithmetic the contracted schedule and a projection share, so a rounding fix
 * is made once. Amounts are minor units as `bigint`; a rate is annual, in
 * millionths of one (AD-25), charged monthly at a twelfth of it.
 *
 * Every figure is an exact fraction, rounded only where Sure rounds: Sure's
 * `BigDecimal` keeps enough digits that the owner's ING table comes out to the
 * cent, and a float would not.
 */

/** Twelve months of millionths: the denominator of every monthly rate. */
const MONTHLY_DENOMINATOR = 12_000_000n;

/**
 * `numerator / denominator` to the nearest integer, a half away from zero, as
 * `BigDecimal#round`; AD-22's half-to-even is a ledger rule, not a lender's.
 * The denominator is positive.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
	const magnitude = numerator < 0n ? -numerator : numerator;
	const rounded = (2n * magnitude + denominator) / (2n * denominator);

	return numerator < 0n ? -rounded : rounded;
}

/** One period's interest on `balance` at the annual `rate`, rounded to the minor unit. */
export function periodInterest(balance: bigint, rate: number): bigint {
	return roundHalfUp(balance * BigInt(rate), MONTHLY_DENOMINATOR);
}

export type LevelPaymentInput = {
	balance: bigint;
	/** Annual, in millionths. */
	rate: number;
	remainingPayments: number;
	/**
	 * The interest this period actually charged, when it accrued at another
	 * rate than the one the payment is sized at: a period that straddles a
	 * rate change. Omitted, every remaining period accrues at `rate`.
	 */
	firstPeriodInterest?: bigint;
};

/**
 * The level payment that amortises `balance` to zero over the remaining
 * periods: the annuity formula, a lender's quote. A zero rate is an
 * interest-free loan, the balance divided by the periods left.
 *
 * Given `firstPeriodInterest`, it is the one payment that covers this period's
 * interest and then amortises what is left at `rate`, level to maturity:
 * sized with the plain formula, a payment after a rate change over-covers the
 * period that accrued at the old rate, and the final settlement becomes a
 * discount of thousands.
 */
export function levelPayment({
	balance,
	rate,
	remainingPayments,
	firstPeriodInterest,
}: LevelPaymentInput): bigint {
	if (remainingPayments <= 0 || balance <= 0n) {
		return 0n;
	}

	const monthly = BigInt(rate);
	const q = MONTHLY_DENOMINATOR;

	if (firstPeriodInterest !== undefined) {
		const later = BigInt(remainingPayments - 1);
		// 1 + the annuity factor of the later periods, as a fraction.
		let numerator: bigint;
		let denominator: bigint;

		if (later === 0n) {
			numerator = 1n;
			denominator = 1n;
		} else if (monthly === 0n) {
			numerator = 1n + later;
			denominator = 1n;
		} else {
			const growth = (q + monthly) ** later;
			const base = q ** later;
			// (growth − 1) / (rate × growth), with rate = monthly / q.
			numerator = monthly * growth + (growth - base) * q;
			denominator = monthly * growth;
		}

		return roundHalfUp((balance + firstPeriodInterest) * denominator, numerator);
	}

	const periods = BigInt(remainingPayments);

	if (monthly === 0n) {
		return roundHalfUp(balance, periods);
	}

	const growth = (q + monthly) ** periods;
	const base = q ** periods;

	return roundHalfUp(balance * monthly * growth, q * (growth - base));
}

export type StepInput = {
	balance: bigint;
	payment: bigint;
	/** Annual, in millionths: what charges `interest` when it is not given. */
	rate: number;
	/** The last payment: it settles the balance, whatever the level payment. */
	final: boolean;
	/** This period's interest, already charged by the caller. */
	interest?: bigint;
};

export type Step = {
	payment: bigint;
	principal: bigint;
	interest: bigint;
	beginningBalance: bigint;
	endingBalance: bigint;
};

/**
 * One period's split of `payment` into interest and principal. The final one
 * repays the whole balance and re-derives the payment from it, so a schedule's
 * last payment differs from the level one by cents, as a lender's table does.
 */
export function step({ balance, payment, rate, final, interest }: StepInput): Step {
	const charged = interest ?? periodInterest(balance, rate);
	const principal = final ? balance : payment - charged;
	const ending = balance - principal;

	return {
		payment: final ? principal + charged : payment,
		principal,
		interest: charged,
		beginningBalance: balance,
		endingBalance: ending < 0n ? 0n : ending,
	};
}

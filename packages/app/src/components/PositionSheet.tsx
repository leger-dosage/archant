import type { SecurityPick } from "@/components/SecurityCombobox";
import type { PositionData } from "@/hooks/useHoldings";
import type { ShownError } from "@/lib/form-errors";

import { zodResolver } from "@hookform/resolvers/zod";
import { LockIcon, PencilIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useController, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { costBasisSchema } from "@archant/api/schemas/holdings";
import type { TypedPriceInput } from "@archant/api/schemas/prices";
import { typedPriceSchema } from "@archant/api/schemas/prices";
import { isIncomeSide } from "@archant/api/schemas/trades";
import type { CurrencyCode } from "@archant/data/money";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DateField } from "@/components/DateField";
import { FieldMessage } from "@/components/FieldMessage";
import { InsetGroup } from "@/components/InsetGroup";
import { Money } from "@/components/Money";
import { SecurityPicker, TradeFieldMessage } from "@/components/TradeFields";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
	useDeletePosition,
	usePositionTrades,
	useRemapPosition,
	useSetCostBasis,
	useTypePrice,
	useUnlockCostBasis,
} from "@/hooks/useHoldings";
import { ApiError, errorCodeOf } from "@/lib/api";
import { formatShortDate, formatSignedPercent } from "@/lib/balance-change";
import { toIsoDate } from "@/lib/dates";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors, fieldErrorCode } from "@/lib/form-errors";
import { decimalToText, formatPrice, formatQuantity, formatShare } from "@/lib/trade-format";

type PositionAccount = { id: string; currency: CurrencyCode };

function Figure({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-4 text-sm">
			<dt className="text-muted-foreground">{label}</dt>
			<dd className="text-right font-medium tabular-nums">{children}</dd>
		</div>
	);
}

/** A field's ARIA state, pointing at its message when it has an error. */
function described(id: string, error: ShownError | undefined) {
	return {
		"aria-invalid": error !== undefined,
		...(error === undefined ? {} : { "aria-describedby": `${id}-error` }),
	};
}

/** Shows a refusal on the fields it names, else as a toast. */
function showRefusal(error: unknown, place: (fields: ApiError["fields"]) => unknown[]) {
	const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");
	const unplaced = place(apiError.fields);

	if (unplaced.length > 0 || apiError.fields.length === 0) {
		showErrorToast(apiError.code);
	}
}

/**
 * « Saisir un cours », for a security no provider prices: a day's price,
 * today's by default, which values every account holding it at once.
 */
function TypedPriceForm({ securityId }: { securityId: string }) {
	const { t } = useTranslation();
	const typePrice = useTypePrice(securityId);
	const schema = useMemo(() => typedPriceSchema(toIsoDate()), []);
	const form = useForm<TypedPriceInput>({
		resolver: zodResolver(schema, undefined, { raw: true }),
		defaultValues: { date: toIsoDate(), price: "" },
	});
	const { errors, isSubmitting } = form.formState;
	const date = useController({ control: form.control, name: "date" });
	const priceCode = errors.price === undefined ? null : fieldErrorCode(errors.price);

	const submit = form.handleSubmit(async (values) => {
		try {
			await typePrice.mutateAsync(values);
			form.reset({ date: values.date, price: "" });
		} catch (error) {
			showRefusal(error, (fields) =>
				applyFieldErrors(fields, ["date", "price"] as const, form.setError),
			);
		}
	});

	return (
		<form noValidate className="flex flex-col gap-3 p-4" onSubmit={(event) => void submit(event)}>
			<p className="text-sm text-muted-foreground">{t("positions.price.description")}</p>
			<div className="grid grid-cols-2 gap-3">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="position-price-date">{t("positions.price.date")}</Label>
					<DateField
						id="position-price-date"
						value={date.field.value}
						onChange={date.field.onChange}
						onBlur={date.field.onBlur}
						invalid={errors.date !== undefined}
						{...(errors.date === undefined ? {} : { describedBy: "position-price-date-error" })}
					/>
					<FieldMessage id="position-price-date-error" error={errors.date} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="position-price">{t("positions.price.price")}</Label>
					<Input
						id="position-price"
						inputMode="decimal"
						autoComplete="off"
						className="text-right tabular-nums"
						{...described("position-price", errors.price)}
						{...form.register("price")}
					/>
					{priceCode === "invalid_price" ? (
						<p id="position-price-error" className="text-xs text-destructive">
							{t("positions.price.errors.invalid_price")}
						</p>
					) : (
						<FieldMessage id="position-price-error" error={errors.price} />
					)}
				</div>
			</div>
			<Button type="submit" variant="outline" className="self-end" disabled={isSubmitting}>
				{t("positions.price.save")}
			</Button>
		</form>
	);
}

/**
 * The cost basis the owner sets and locks, as Sure's holding drawer: once
 * locked, later trades leave it, until it goes back to the calculated one.
 */
function CostBasisForm({ accountId, position }: { accountId: string; position: PositionData }) {
	const { t } = useTranslation();
	const setCostBasis = useSetCostBasis(accountId, position.security.id);
	const unlock = useUnlockCostBasis(accountId, position.security.id);
	const form = useForm<{ costBasis: string }>({
		resolver: zodResolver(costBasisSchema, undefined, { raw: true }),
		defaultValues: {
			costBasis: position.costBasis === null ? "" : decimalToText(position.costBasis),
		},
	});
	const { errors, isSubmitting } = form.formState;

	const submit = form.handleSubmit(async (values) => {
		try {
			await setCostBasis.mutateAsync(values);
		} catch (error) {
			showRefusal(error, (fields) =>
				applyFieldErrors(fields, ["costBasis"] as const, form.setError),
			);
		}
	});

	const restore = async () => {
		try {
			await unlock.mutateAsync();
		} catch (error) {
			showErrorToast(errorCodeOf(error));
		}
	};

	return (
		<form noValidate className="flex flex-col gap-3 p-4" onSubmit={(event) => void submit(event)}>
			<p className="text-sm text-muted-foreground">{t("positions.costBasis.description")}</p>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="position-cost-basis">{t("positions.costBasis.label")}</Label>
				<Input
					id="position-cost-basis"
					inputMode="decimal"
					autoComplete="off"
					className="text-right tabular-nums"
					{...described("position-cost-basis", errors.costBasis)}
					{...form.register("costBasis")}
				/>
				<FieldMessage id="position-cost-basis-error" error={errors.costBasis} />
			</div>
			{position.costBasisLocked && (
				<p className="flex items-center gap-1 text-sm text-muted-foreground">
					<LockIcon aria-hidden="true" className="size-3" />
					{t("positions.costBasis.locked")}
				</p>
			)}
			<div className="flex flex-wrap justify-end gap-2">
				{position.costBasisLocked && (
					<Button
						type="button"
						variant="ghost"
						disabled={unlock.isPending}
						onClick={() => void restore()}
					>
						{t("positions.costBasis.unlock")}
					</Button>
				)}
				<Button type="submit" variant="outline" disabled={isSubmitting}>
					{t("positions.costBasis.lock")}
				</Button>
			</div>
		</form>
	);
}

/**
 * « Modifier le titre », as Sure's drawer: the position's trades move to the
 * security picked among the known ones and the provider's listings, none
 * typed by hand. `onDone` runs once they moved, as Sure redirects to the
 * account.
 */
function RemapForm({
	accountId,
	securityId,
	onCancel,
	onDone,
}: {
	accountId: string;
	securityId: string;
	onCancel: () => void;
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const remap = useRemapPosition(accountId, securityId);
	const [pick, setPick] = useState<SecurityPick | null>(null);
	const [error, setError] = useState<ShownError | undefined>(undefined);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();

		if (pick === null || pick.choice.source === "manual") {
			setError({ type: "custom", message: "too_small" });

			return;
		}

		try {
			await remap.mutateAsync(pick.choice);
			toast.success(t("positions.remap.success"));
			onDone();
		} catch (refusal) {
			showRefusal(refusal, (fields) => {
				const security = fields.find((field) => field.path === "security");

				if (security !== undefined) {
					setError({ type: "custom", message: security.code });
				}

				return fields.filter((field) => field !== security);
			});
		}
	};

	return (
		<form noValidate className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
			<div className="flex flex-col gap-1.5">
				<Label htmlFor="position-security">{t("trades.security.search")}</Label>
				<SecurityPicker
					id="position-security"
					picked={pick?.label ?? null}
					error={error}
					manual={false}
					onPick={(picked) => {
						setPick(picked);
						setError(undefined);
					}}
				/>
				<TradeFieldMessage id="position-security-error" error={error} />
			</div>
			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel")}
				</Button>
				<Button type="submit" disabled={remap.isPending}>
					{t("positions.remap.save")}
				</Button>
			</div>
		</form>
	);
}

/**
 * « Supprimer la position », as Sure's « Paramètres » row, confirmed by
 * Sure's generic dialog. `onDone` runs once the position is gone.
 */
function DeletePosition({
	accountId,
	securityId,
	onDone,
}: {
	accountId: string;
	securityId: string;
	onDone: () => void;
}) {
	const { t } = useTranslation();
	const remove = useDeletePosition(accountId, securityId);
	const [confirming, setConfirming] = useState(false);

	const confirm = async () => {
		try {
			await remove.mutateAsync();
			setConfirming(false);
			toast.success(t("positions.delete.success"));
			onDone();
		} catch (error) {
			setConfirming(false);
			showErrorToast(errorCodeOf(error));
		}
	};

	return (
		<div className="flex items-center justify-between gap-4 p-4">
			<div className="flex flex-col gap-1 text-sm">
				<h4 className="font-medium">{t("positions.delete.title")}</h4>
				<p className="text-muted-foreground">{t("positions.delete.description")}</p>
			</div>
			<Button
				type="button"
				variant="outline"
				className="text-destructive"
				onClick={() => setConfirming(true)}
			>
				{t("positions.delete.action")}
			</Button>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={t("positions.delete.confirmTitle")}
				description={t("positions.delete.confirmDescription")}
				confirmLabel={t("positions.delete.confirm")}
				pending={remove.isPending}
				onConfirm={() => void confirm()}
			/>
		</div>
	);
}

function PositionTrades({
	accountId,
	securityId,
	open,
}: {
	accountId: string;
	securityId: string;
	open: boolean;
}) {
	const { t } = useTranslation();
	const trades = usePositionTrades(accountId, securityId, open);

	if (trades.isPending) {
		return <Skeleton className="h-24 w-full" aria-hidden="true" />;
	}

	if (trades.isError) {
		return (
			<p role="alert" className="text-sm text-muted-foreground">
				{t(`errors.${errorCodeOf(trades.error)}`)}
			</p>
		);
	}

	if (trades.data.items.length === 0) {
		return <p className="text-sm text-muted-foreground">{t("positions.sheet.noTrades")}</p>;
	}

	const older = trades.data.total - trades.data.items.length;

	return (
		<>
			<ul aria-label={t("positions.sheet.trades")} className="flex flex-col gap-3">
				{trades.data.items.map((trade) => (
					<li key={trade.id} className="flex items-start justify-between gap-4 text-sm">
						<div className="flex min-w-0 flex-col">
							<span className="text-xs text-muted-foreground uppercase">
								{formatShortDate(trade.date)}
							</span>
							<span>
								{t(`trades.sides.${trade.side}`)}
								{!isIncomeSide(trade.side) &&
									` · ${t("trades.quantityPrice", {
										quantity: formatQuantity(trade.quantity),
										price: formatPrice(trade.price, trade.currency),
									})}`}
							</span>
						</div>
						<Money amount={trade.amount} currency={trade.currency} signed />
					</li>
				))}
			</ul>
			{older > 0 && (
				<p className="mt-3 text-sm text-muted-foreground">
					{t("positions.sheet.olderTrades", { count: older })}
				</p>
			)}
		</>
	);
}

type PositionSheetProps = {
	account: PositionAccount;
	/** The last position opened, kept while the sheet closes. */
	position: PositionData | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** `false` for a viewer: the figures and trades are theirs, the forms are not. */
	canWrite: boolean;
};

/**
 * Sure's holding drawer: the position's security, which the owner may
 * remap, its last price and its day, its figures, its trades, « Saisir un
 * cours » for a security no provider prices, a cost basis the owner sets and
 * locks, and « Paramètres » to delete it.
 */
export function PositionSheet({
	account,
	position,
	open,
	onOpenChange,
	canWrite,
}: PositionSheetProps) {
	const { t } = useTranslation();
	const none = t("positions.sheet.none");
	// The security whose remap form is open, so another position opens with it closed.
	const [remapping, setRemapping] = useState<string | null>(null);
	// Closed by Escape or outside, the sheet reopens with the remap form closed.
	const changeOpen = (next: boolean) => {
		if (!next) {
			setRemapping(null);
		}

		onOpenChange(next);
	};
	const close = () => changeOpen(false);

	return (
		<Sheet open={open} onOpenChange={changeOpen}>
			<SheetContent
				// The transaction sheet's frame: 550 px, 12 px off the viewport's edges from 768 px.
				className="data-[side=right]:w-full data-[side=right]:border-l-0 data-[side=right]:sm:max-w-none data-[side=right]:md:inset-y-3 data-[side=right]:md:right-3 data-[side=right]:md:h-auto data-[side=right]:md:w-[550px] data-[side=right]:md:rounded-xl data-[side=right]:md:border motion-reduce:transition-none motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
			>
				{position !== null && (
					<>
						<SheetHeader className="border-b">
							<p className="text-sm text-muted-foreground">{t("positions.sheet.kicker")}</p>
							<SheetTitle className="text-2xl">{position.security.name}</SheetTitle>
							<SheetDescription>
								{[position.security.ticker, position.security.isin]
									.filter((part) => part !== null)
									.join(" · ")}
							</SheetDescription>
						</SheetHeader>
						<div className="flex flex-col gap-4 overflow-y-auto p-4">
							<InsetGroup level={3} title={t("positions.sheet.overview")}>
								<div className="flex flex-col gap-3 p-4">
									<dl>
										<Figure label={t("positions.sheet.security")}>
											<span className="flex items-center gap-2">
												{position.security.ticker ?? position.security.name}
												{canWrite && (
													<Button
														type="button"
														variant="ghost"
														size="icon-sm"
														className="-my-1.5 text-muted-foreground"
														aria-label={t("positions.remap.edit")}
														aria-expanded={remapping === position.security.id}
														onClick={() =>
															setRemapping((current) =>
																current === position.security.id ? null : position.security.id,
															)
														}
													>
														<PencilIcon aria-hidden="true" />
													</Button>
												)}
											</span>
										</Figure>
									</dl>
									{canWrite && remapping === position.security.id && (
										<RemapForm
											accountId={account.id}
											securityId={position.security.id}
											onCancel={() => setRemapping(null)}
											onDone={() => {
												setRemapping(null);
												close();
											}}
										/>
									)}
									<dl className="flex flex-col gap-3">
										<Figure label={t("positions.sheet.lastPrice")}>
											{t("positions.sheet.priceOn", {
												price: formatPrice(position.price, account.currency),
												date: formatShortDate(position.priceDate),
											})}
										</Figure>
										<Figure label={t("positions.sheet.quantity")}>
											{formatQuantity(position.quantity)}
										</Figure>
										<Figure label={t("positions.sheet.value")}>
											<Money amount={position.amount} currency={account.currency} />
										</Figure>
										<Figure label={t("positions.sheet.costBasis")}>
											{position.costBasis === null
												? none
												: formatPrice(position.costBasis, account.currency)}
										</Figure>
										<Figure label={t("positions.sheet.bookValue")}>
											{position.bookValue === null ? (
												none
											) : (
												<Money amount={position.bookValue} currency={account.currency} />
											)}
										</Figure>
										<Figure label={t("positions.sheet.gain")}>
											{position.gain === null ? (
												none
											) : (
												<span className="flex items-center gap-2">
													<Money amount={position.gain} currency={account.currency} plusSign />
													{position.gainPercent !== null && (
														<span className="text-muted-foreground">
															{formatSignedPercent(Number(position.gainPercent))}
														</span>
													)}
												</span>
											)}
										</Figure>
										<Figure label={t("positions.sheet.weight")}>
											{position.weight === null ? none : formatShare(position.weight)}
										</Figure>
									</dl>
								</div>
							</InsetGroup>
							{canWrite && (position.security.provider === null || position.security.offline) && (
								<InsetGroup level={3} title={t("positions.price.title")}>
									<TypedPriceForm key={position.security.id} securityId={position.security.id} />
								</InsetGroup>
							)}
							{/* A position sold short has no cost basis to set: the server
							    refuses it, as Sure's `HoldingsController#update` does. */}
							{canWrite && !position.quantity.startsWith("-") && (
								<InsetGroup level={3} title={t("positions.costBasis.title")}>
									<CostBasisForm
										// A fresh form once the lock or the cost basis changed.
										key={`${position.security.id} ${position.costBasis} ${String(position.costBasisLocked)}`}
										accountId={account.id}
										position={position}
									/>
								</InsetGroup>
							)}
							<InsetGroup level={3} title={t("positions.sheet.trades")}>
								<div className="p-4">
									<PositionTrades
										accountId={account.id}
										securityId={position.security.id}
										open={open}
									/>
								</div>
							</InsetGroup>
							{canWrite && (
								<InsetGroup level={3} title={t("positions.sheet.settings")}>
									<DeletePosition
										key={position.security.id}
										accountId={account.id}
										securityId={position.security.id}
										onDone={close}
									/>
								</InsetGroup>
							)}
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}

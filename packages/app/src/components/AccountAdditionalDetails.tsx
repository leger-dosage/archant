import type { ShownError } from "@/lib/form-errors";
import type { ReactNode } from "react";
import type { UseFormRegisterReturn } from "react-hook-form";

import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FieldMessage } from "@/components/FieldMessage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const ADDITIONAL_DETAIL_NAMES = ["institutionName", "institutionDomain", "notes"] as const;

type AdditionalDetailName = (typeof ADDITIONAL_DETAIL_NAMES)[number];

type AccountAdditionalDetailsProps = {
	/** Prefixes each field's id, so the dialog's own ids never collide. */
	idPrefix: string;
	register: (name: AdditionalDetailName) => UseFormRegisterReturn;
	errorOf: (name: AdditionalDetailName) => ShownError | undefined;
	/**
	 * A linked account's bank name, the institution's placeholder as Sure's
	 * `account.provider&.institution_name`. Archant stores no bank domain, so
	 * the domain keeps the generic placeholder.
	 */
	bankName?: string | null | undefined;
	/** What follows the notes inside the disclosure: the exclusion switch, as in Sure's form. */
	children?: ReactNode;
};

/**
 * Sure's « Détails supplémentaires » of `accounts/_form.html.erb`: the
 * institution's name and domain and the notes, closed until asked for, and
 * opened when one of its fields is refused.
 */
export function AccountAdditionalDetails({
	idPrefix,
	register,
	errorOf,
	bankName,
	children,
}: AccountAdditionalDetailsProps) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const refused = ADDITIONAL_DETAIL_NAMES.some((name) => errorOf(name) !== undefined);

	const field = (name: AdditionalDetailName) => {
		const id = `${idPrefix}${name}`;
		const error = errorOf(name);

		return {
			id,
			error,
			errorId: `${id}-error`,
			props: {
				id,
				autoComplete: "off",
				"aria-invalid": error !== undefined,
				...(error === undefined ? {} : { "aria-describedby": `${id}-error` }),
				...register(name),
			},
		};
	};

	const institutionName = field("institutionName");
	const institutionDomain = field("institutionDomain");
	const notes = field("notes");

	return (
		<details
			className="group"
			open={open || refused}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary className="flex cursor-pointer items-center gap-1 py-2 text-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
				<ChevronRightIcon
					aria-hidden="true"
					className="size-4 transition-transform group-open:rotate-90"
				/>
				{t("accounts.additionalDetails.title")}
			</summary>
			<div className="mt-2 flex flex-col gap-4 border-l pl-4">
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={institutionName.id}>
						{t("accounts.additionalDetails.institutionName")}
					</Label>
					<Input
						placeholder={bankName ?? t("accounts.additionalDetails.institutionNamePlaceholder")}
						{...institutionName.props}
					/>
					<FieldMessage id={institutionName.errorId} error={institutionName.error} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={institutionDomain.id}>
						{t("accounts.additionalDetails.institutionDomain")}
					</Label>
					<Input
						placeholder={t("accounts.additionalDetails.institutionDomainPlaceholder")}
						{...institutionDomain.props}
					/>
					<FieldMessage id={institutionDomain.errorId} error={institutionDomain.error} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={notes.id}>{t("accounts.additionalDetails.notes")}</Label>
					<Textarea
						rows={4}
						// Sure's four rows: `field-sizing-content` would size it to its text instead.
						className="field-sizing-fixed"
						placeholder={t("accounts.additionalDetails.notesPlaceholder")}
						{...notes.props}
					/>
					<FieldMessage id={notes.errorId} error={notes.error} />
				</div>
				{children}
			</div>
		</details>
	);
}

type ExcludedFromReportsSwitchProps = {
	id: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	onBlur: () => void;
};

/**
 * Sure's `exclude_from_reports` toggle, last in « Détails supplémentaires »
 * of both the creation and the edit form.
 */
export function ExcludedFromReportsSwitch({
	id,
	checked,
	onCheckedChange,
	onBlur,
}: ExcludedFromReportsSwitchProps) {
	const { t } = useTranslation();

	return (
		<div className="flex items-start gap-3">
			<Switch
				id={id}
				checked={checked}
				onCheckedChange={onCheckedChange}
				onBlur={onBlur}
				aria-describedby={`${id}-hint`}
				className="mt-0.5"
			/>
			<div className="flex flex-col gap-1">
				<Label htmlFor={id}>{t("accountActions.form.excludedFromReports")}</Label>
				<p id={`${id}-hint`} className="text-xs text-muted-foreground">
					{t("accountActions.form.excludedFromReportsHint")}
				</p>
			</div>
		</div>
	);
}

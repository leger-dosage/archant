import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import type { CryptoDetailsInput } from "@archant/api/schemas/accounts";
import type { TaxTreatment } from "@archant/data/account-types";
import { TAX_TREATMENTS } from "@archant/data/account-types";

import { FieldMessage } from "@/components/FieldMessage";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type CryptoDetailsFieldsProps = {
	value: CryptoDetailsInput;
	onChange: (value: CryptoDetailsInput) => void;
	error: ShownError | undefined;
};

const isTaxTreatment = (value: string): value is TaxTreatment =>
	TAX_TREATMENTS.some((treatment) => treatment === value);

/**
 * A crypto account's tax treatment, as Sure's `cryptos/_form`: its three
 * values in Sure's order, `taxable` unless chosen, with Sure's hint under it.
 */
export function CryptoDetailsFields({ value, onChange, error }: CryptoDetailsFieldsProps) {
	const { t } = useTranslation();
	const describedBy = [
		"crypto-taxTreatment-hint",
		...(error === undefined ? [] : ["crypto-taxTreatment-error"]),
	];

	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor="crypto-taxTreatment">{t("cryptoDetails.taxTreatment")}</Label>
			<Select
				value={value.taxTreatment ?? "taxable"}
				onValueChange={(next) => {
					if (isTaxTreatment(next)) {
						onChange({ ...value, taxTreatment: next });
					}
				}}
			>
				<SelectTrigger
					id="crypto-taxTreatment"
					className="w-full"
					aria-invalid={error !== undefined}
					aria-describedby={describedBy.join(" ")}
				>
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{TAX_TREATMENTS.map((treatment) => (
						<SelectItem key={treatment} value={treatment}>
							{t(`cryptoDetails.taxTreatments.${treatment}`)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p id="crypto-taxTreatment-hint" className="text-xs text-muted-foreground">
				{t("cryptoDetails.taxTreatmentHint")}
			</p>
			<FieldMessage id="crypto-taxTreatment-error" error={error} />
		</div>
	);
}

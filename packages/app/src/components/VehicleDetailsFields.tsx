import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import type { VehicleDetailsInput } from "@archant/api/schemas/accounts";
import type { MileageUnit } from "@archant/data/account-types";
import { MILEAGE_UNITS } from "@archant/data/account-types";

import { FieldMessage } from "@/components/FieldMessage";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type Field = keyof VehicleDetailsInput;

type VehicleDetailsFieldsProps = {
	value: VehicleDetailsInput;
	onChange: (value: VehicleDetailsInput) => void;
	/** The error on a field of the details, by its key. */
	errorOf: (field: Field) => ShownError | undefined;
};

const errorId = (field: Field) => `vehicle-${field}-error`;

const isMileageUnit = (value: string): value is MileageUnit =>
	MILEAGE_UNITS.some((unit) => unit === value);

/**
 * A vehicle's details in Sure's order and rows (`vehicles/_form`), as the
 * create dialog and the account edit dialog both edit them, every one
 * optional.
 */
export function VehicleDetailsFields({ value, onChange, errorOf }: VehicleDetailsFieldsProps) {
	const { t } = useTranslation();
	const set = (patch: Partial<VehicleDetailsInput>) => onChange({ ...value, ...patch });
	const input = (
		field: Exclude<Field, "mileageUnit">,
		options: { numeric?: true; messages?: Parameters<typeof FieldMessage>[0]["messages"] } = {},
	) => {
		const error = errorOf(field);
		const id = `vehicle-${field}`;
		const key = field === "mileageValue" ? "mileage" : field;

		return (
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<Label htmlFor={id}>{t(`vehicleDetails.${key}`)}</Label>
				<Input
					id={id}
					autoComplete="off"
					placeholder={t(`vehicleDetails.${key}Placeholder`)}
					{...(options.numeric ? { inputMode: "numeric", className: "tabular-nums" } : {})}
					value={value[field] ?? ""}
					aria-invalid={error !== undefined}
					{...(error === undefined ? {} : { "aria-describedby": errorId(field) })}
					onChange={(event) => set({ [field]: event.target.value })}
				/>
				<FieldMessage
					id={errorId(field)}
					error={error}
					{...(options.messages === undefined ? {} : { messages: options.messages })}
				/>
			</div>
		);
	};

	return (
		<>
			<div className="flex gap-3">
				{input("make")}
				{input("model")}
			</div>

			{/* Sure's three fields on one row; stacked on a phone, where they do not fit. */}
			<div className="flex flex-col gap-3 sm:flex-row">
				{input("year", {
					numeric: true,
					messages: {
						invalid_year: t("vehicleDetails.invalidYear", { max: new Date().getFullYear() + 1 }),
					},
				})}
				{input("mileageValue", { numeric: true })}
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Label htmlFor="vehicle-mileageUnit">{t("vehicleDetails.mileageUnit")}</Label>
					<Select
						value={value.mileageUnit ?? "km"}
						onValueChange={(mileageUnit) => {
							if (isMileageUnit(mileageUnit)) {
								set({ mileageUnit });
							}
						}}
					>
						<SelectTrigger id="vehicle-mileageUnit" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MILEAGE_UNITS.map((unit) => (
								<SelectItem key={unit} value={unit}>
									{t(`vehicleDetails.mileageUnits.${unit}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		</>
	);
}

import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import type { PropertyDetailsInput } from "@archant/api/schemas/accounts";
import type { AreaUnit } from "@archant/data/account-types";
import { AREA_UNITS } from "@archant/data/account-types";

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

type Field = keyof PropertyDetailsInput;

type PropertyDetailsFieldsProps = {
	value: PropertyDetailsInput;
	onChange: (value: PropertyDetailsInput) => void;
	/** The error on a field of the details, by its key. */
	errorOf: (field: Field) => ShownError | undefined;
};

const errorId = (field: Field) => `property-${field}-error`;

const isAreaUnit = (value: string): value is AreaUnit => AREA_UNITS.some((unit) => unit === value);

function usePropertyInput({ value, onChange, errorOf }: PropertyDetailsFieldsProps) {
	const { t } = useTranslation();
	const set = (patch: Partial<PropertyDetailsInput>) => onChange({ ...value, ...patch });
	const input = (
		field: Exclude<Field, "areaUnit">,
		options: { numeric?: true; messages?: Parameters<typeof FieldMessage>[0]["messages"] } = {},
	) => {
		const error = errorOf(field);
		const id = `property-${field}`;

		return (
			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<Label htmlFor={id}>{t(`propertyDetails.${field === "areaValue" ? "area" : field}`)}</Label>
				<Input
					id={id}
					autoComplete="off"
					placeholder={t(`propertyDetails.${field === "areaValue" ? "area" : field}Placeholder`)}
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

	return { set, input };
}

/** The year built and the area, Sure's `properties/_overview_fields`. */
export function PropertyOverviewFields(props: PropertyDetailsFieldsProps) {
	const { t } = useTranslation();
	const { set, input } = usePropertyInput(props);

	return (
		<>
			{input("yearBuilt", {
				numeric: true,
				messages: {
					invalid_year: t("propertyDetails.invalidYearBuilt", { max: new Date().getFullYear() }),
				},
			})}

			<div className="flex gap-3">
				{input("areaValue", { numeric: true })}
				<div className="flex min-w-0 flex-1 flex-col gap-1.5">
					<Label htmlFor="property-areaUnit">{t("propertyDetails.areaUnit")}</Label>
					<Select
						value={props.value.areaUnit ?? "sqm"}
						onValueChange={(areaUnit) => {
							if (isAreaUnit(areaUnit)) {
								set({ areaUnit });
							}
						}}
					>
						<SelectTrigger id="property-areaUnit" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{AREA_UNITS.map((unit) => (
								<SelectItem key={unit} value={unit}>
									{t(`propertyDetails.areaUnits.${unit}`)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		</>
	);
}

/** The address, Sure's `properties/address`. */
export function PropertyAddressFields(props: PropertyDetailsFieldsProps) {
	const { input } = usePropertyInput(props);

	return (
		<>
			{input("addressLine1")}

			<div className="flex gap-3">
				{input("locality")}
				{input("region")}
			</div>

			<div className="flex gap-3">
				{input("postalCode")}
				{input("country")}
			</div>
		</>
	);
}

/**
 * A property's details in Sure's order and rows (`properties/_form`), as the
 * account edit dialog edits them, every one optional; the creation steps
 * show the two parts apart.
 */
export function PropertyDetailsFields(props: PropertyDetailsFieldsProps) {
	return (
		<>
			<PropertyOverviewFields {...props} />
			<PropertyAddressFields {...props} />
		</>
	);
}

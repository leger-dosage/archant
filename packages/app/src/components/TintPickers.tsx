import type { ShownError } from "@/lib/form-errors";

import { useTranslation } from "react-i18next";

import type { CategoryColor, CategoryIcon } from "@archant/data/category-presets";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "@archant/data/category-presets";

import { FieldMessage } from "@/components/FieldMessage";
import { CATEGORY_ICON_COMPONENTS } from "@/lib/category-icons";

type PickerProps<Value extends string> = {
	/** The radio group's name and the error's id prefix: `category`, `goal`. */
	form: string;
	legend: string;
	value: Value;
	onChange: (value: Value) => void;
	error: ShownError | undefined;
};

function isSwatch(color: string): color is CategoryColor {
	return CATEGORY_COLORS.some((swatch) => swatch === color);
}

/**
 * DESIGN.md's swatches as radio buttons, a category's and a goal's. A colour
 * outside them, one of Sure's own defaults, stays offered first, so an edit
 * does not force a new one.
 */
export function ColorPicker({ form, legend, value, onChange, error }: PickerProps<string>) {
	const { t } = useTranslation();
	const colors: string[] = isSwatch(value) ? [...CATEGORY_COLORS] : [value, ...CATEGORY_COLORS];
	const errorId = `${form}-color-error`;

	return (
		<fieldset
			className="flex flex-col gap-1.5"
			{...(error === undefined ? {} : { "aria-describedby": errorId })}
		>
			<legend className="mb-1.5 text-sm font-medium">{legend}</legend>
			<div className="flex flex-wrap gap-2">
				{colors.map((swatch) => (
					<label key={swatch} className="relative cursor-pointer">
						<input
							type="radio"
							name={`${form}-color`}
							value={swatch}
							checked={value === swatch}
							onChange={() => onChange(swatch)}
							className="peer sr-only"
						/>
						<span
							aria-hidden="true"
							className="block size-7 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring"
							style={{ backgroundColor: swatch }}
						/>
						<span className="sr-only">
							{isSwatch(swatch)
								? t(`categories.colors.${swatch}`)
								: t("categories.form.currentColor")}
						</span>
					</label>
				))}
			</div>
			<FieldMessage id={errorId} error={error} />
		</fieldset>
	);
}

/** The icons a category or a goal may carry, as radio buttons named for assistive technology. */
export function IconPicker({ form, legend, value, onChange, error }: PickerProps<CategoryIcon>) {
	const { t } = useTranslation();
	const errorId = `${form}-icon-error`;

	return (
		<fieldset
			className="flex flex-col gap-1.5"
			{...(error === undefined ? {} : { "aria-describedby": errorId })}
		>
			<legend className="mb-1.5 text-sm font-medium">{legend}</legend>
			<div className="flex flex-wrap gap-1">
				{CATEGORY_ICONS.map((name) => {
					const Icon = CATEGORY_ICON_COMPONENTS[name];

					return (
						<label
							key={name}
							className="relative cursor-pointer"
							title={t(`categories.icons.${name}`)}
						>
							<input
								type="radio"
								name={`${form}-icon`}
								value={name}
								checked={value === name}
								onChange={() => onChange(name)}
								className="peer sr-only"
							/>
							<span
								aria-hidden="true"
								className="flex size-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:bg-accent peer-checked:border-foreground peer-checked:text-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring"
							>
								<Icon className="size-4" />
							</span>
							<span className="sr-only">{t(`categories.icons.${name}`)}</span>
						</label>
					);
				})}
			</div>
			<FieldMessage id={errorId} error={error} />
		</fieldset>
	);
}

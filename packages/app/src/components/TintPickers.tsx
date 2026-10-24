import type { ShownError } from "@/lib/form-errors";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import type { CategoryIcon } from "@archant/data/category-presets";
import {
	CATEGORY_COLOR_PATTERN,
	CATEGORY_COLORS,
	CATEGORY_ICONS,
} from "@archant/data/category-presets";

import { FieldMessage } from "@/components/FieldMessage";
import { Input } from "@/components/ui/input";
import { CATEGORY_ICON_COMPONENTS } from "@/lib/category-icons";
import { darkenToSureContrast, hasSureContrast } from "@/lib/contrast";

type PickerProps<Value extends string> = {
	/** The radio group's name and the error's id prefix: `category`, `goal`. */
	form: string;
	legend: string;
	value: Value;
	onChange: (value: Value) => void;
	error: ShownError | undefined;
};

type Swatch = (typeof CATEGORY_COLORS)[number];

function isSwatch(color: string): color is Swatch {
	return CATEGORY_COLORS.some((swatch) => swatch === color);
}

/**
 * Whether a custom colour shows Sure's « Mauvais contraste »: a well-formed
 * one outside the ten, below Sure's 4.5 against its tint.
 */
export function poorCustomContrast(color: string): boolean {
	return !isSwatch(color) && CATEGORY_COLOR_PATTERN.test(color) && !hasSureContrast(color);
}

const swatchClass =
	"block size-7 rounded-full ring-offset-2 ring-offset-background peer-checked:ring-2 peer-checked:ring-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring";

/**
 * Sure's ten colours as radio buttons, a category's and a goal's. With
 * `custom`, a category's, an eleventh opens Sure's custom colour: a
 * `#rrggbb` field beside the system's colour picker, with « Mauvais
 * contraste » and its « réglage automatique » once a colour is picked there. Without it, a colour outside
 * the ten stays offered first, so an edit does not force a new one.
 */
export function ColorPicker({
	form,
	legend,
	value,
	onChange,
	error,
	custom = false,
}: PickerProps<string> & { custom?: boolean }) {
	const { t } = useTranslation();
	const [customOpen, setCustomOpen] = useState(() => custom && !isSwatch(value));
	// Sure checks a colour as it is picked, never one the category already had.
	const [edited, setEdited] = useState(false);
	const pickCustom = (next: string) => {
		setEdited(true);
		onChange(next);
	};
	const colors: string[] =
		isSwatch(value) || custom ? [...CATEGORY_COLORS] : [value, ...CATEGORY_COLORS];
	const errorId = `${form}-color-error`;
	const customId = `${form}-color-custom`;
	const showCustom = custom && (customOpen || !isSwatch(value));

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
							checked={value === swatch && !showCustom}
							onChange={() => {
								setCustomOpen(false);
								onChange(swatch);
							}}
							className="peer sr-only"
						/>
						<span aria-hidden="true" className={swatchClass} style={{ backgroundColor: swatch }} />
						<span className="sr-only">
							{isSwatch(swatch)
								? t(`categories.colors.${swatch}`)
								: t("categories.form.currentColor")}
						</span>
					</label>
				))}
				{custom && (
					<label className="relative cursor-pointer">
						<input
							type="radio"
							name={`${form}-color`}
							value="custom"
							checked={showCustom}
							onChange={() => setCustomOpen(true)}
							className="peer sr-only"
						/>
						{/* Sure's conic gradient for « any colour ». */}
						<span
							aria-hidden="true"
							className={swatchClass}
							style={{
								background:
									"conic-gradient(red, orange, yellow, lime, green, teal, cyan, blue, indigo, purple, magenta, pink, red)",
							}}
						/>
						<span className="sr-only">{t("categories.form.custom")}</span>
					</label>
				)}
			</div>
			{showCustom && (
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2">
						<input
							type="color"
							aria-label={t("categories.form.custom")}
							value={CATEGORY_COLOR_PATTERN.test(value) ? value : "#000000"}
							onChange={(event) => pickCustom(event.target.value)}
							className="size-9 shrink-0 cursor-pointer rounded-md border bg-transparent p-0.5"
						/>
						<Input
							id={customId}
							aria-label={t("categories.form.customValue")}
							autoComplete="off"
							spellCheck={false}
							maxLength={7}
							className="w-28 font-mono"
							aria-invalid={error !== undefined}
							value={value}
							onChange={(event) => pickCustom(event.target.value.trim().toLowerCase())}
						/>
					</div>
					{edited && poorCustomContrast(value) && (
						<p className="text-xs text-destructive">
							{t("categories.form.poorContrast")}{" "}
							<button
								type="button"
								className="cursor-pointer underline"
								onClick={() => pickCustom(darkenToSureContrast(value))}
							>
								{t("categories.form.autoAdjust")}
							</button>
						</p>
					)}
				</div>
			)}
			<FieldMessage id={errorId} error={error} />
		</fieldset>
	);
}

/** The icons a category or a goal may carry, as radio buttons named for assistive technology. */
/** A goal's starts with none checked, as Sure's: its cards show its initial until one is. */
export function IconPicker({
	form,
	legend,
	value,
	onChange,
	error,
}: Omit<PickerProps<CategoryIcon>, "value"> & { value: CategoryIcon | null }) {
	const { t } = useTranslation();
	const errorId = `${form}-icon-error`;

	return (
		<fieldset
			className="flex flex-col gap-1.5"
			{...(error === undefined ? {} : { "aria-describedby": errorId })}
		>
			<legend className="mb-1.5 text-sm font-medium">{legend}</legend>
			{/* Sure's 141 icons: the list scrolls rather than push the form off a phone. */}
			<div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto">
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

import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { fr } from "react-day-picker/locale";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { frenchToIso, isoToDate, isoToFrench, toIsoDate } from "@/lib/dates";

type DateFieldProps = {
	id: string;
	/** `YYYY-MM-DD` when valid; whatever was typed otherwise, so validation can say so. */
	value: string;
	onChange: (value: string) => void;
	onBlur?: () => void;
	invalid?: boolean;
	/** Id of the element holding this field's error message, when there is one. */
	describedBy?: string;
};

/**
 * A date typed as `15/09/2026` or picked from a French calendar whose weeks
 * start on Monday (EXPERIENCE.md).
 */
export function DateField({
	id,
	value,
	onChange,
	onBlur,
	invalid = false,
	describedBy,
}: DateFieldProps) {
	const { t } = useTranslation();
	const [text, setText] = useState(() => isoToFrench(value));
	const [open, setOpen] = useState(false);
	const selected = isoToDate(value);

	return (
		<div className="flex gap-2">
			<Input
				id={id}
				value={text}
				inputMode="numeric"
				placeholder={t("accounts.form.datePlaceholder")}
				aria-invalid={invalid}
				{...(describedBy === undefined ? {} : { "aria-describedby": describedBy })}
				onChange={(event) => {
					setText(event.target.value);
					onChange(frenchToIso(event.target.value) ?? event.target.value);
				}}
				{...(onBlur === undefined ? {} : { onBlur })}
			/>
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<Button
						type="button"
						variant="outline"
						size="icon"
						aria-label={t("accounts.form.pickDate")}
					>
						<CalendarIcon />
					</Button>
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="end">
					<Calendar
						mode="single"
						locale={fr}
						weekStartsOn={1}
						selected={selected}
						{...(selected === undefined ? {} : { defaultMonth: selected })}
						onSelect={(date) => {
							if (date !== undefined) {
								const iso = toIsoDate(date);
								setText(isoToFrench(iso));
								onChange(iso);
								setOpen(false);
							}
						}}
					/>
				</PopoverContent>
			</Popover>
		</div>
	);
}

import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

type Choice<Value extends string> = {
	id: string;
	label: string;
	value: Value;
	options: readonly { value: Value; label: string }[];
	onChange: (value: Value) => void;
	disabled?: boolean;
};

/** A labelled select over a closed set of values. */
export function ChoiceField<Value extends string>({
	id,
	label,
	value,
	options,
	onChange,
	disabled = false,
}: Choice<Value>) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Select
				value={value}
				disabled={disabled}
				onValueChange={(next) => {
					const option = options.find((candidate) => candidate.value === next);

					if (option !== undefined) {
						onChange(option.value);
					}
				}}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

import { useRef, useState } from "react";

import { FieldMessage } from "@/components/FieldMessage";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { errorMessage } from "@/lib/error-toast";

type BlurNoteFieldProps = {
	id: string;
	label: string;
	initialNote: string | null;
	placeholder?: string;
	onSave: (notes: string) => Promise<unknown>;
	onDirtyChange?: (dirty: boolean) => void;
};

export function BlurNoteField({
	id,
	label,
	initialNote,
	placeholder,
	onSave,
	onDirtyChange,
}: BlurNoteFieldProps) {
	const field = useRef<HTMLTextAreaElement>(null);
	const saved = useRef(initialNote?.trim() ?? "");
	const queue = useRef(Promise.resolve());
	const [failure, setFailure] = useState<{ type: string } | { message: string }>();
	const errorId = `${id}-error`;

	const save = (text: string) => {
		const notes = text.trim();
		// A second blur may arrive before the first write returns. Apply the notes
		// in order, even when the editor goes back to the starting text.
		const pending = queue.current;
		queue.current = (async () => {
			await pending;
			if (notes !== saved.current) {
				try {
					await onSave(notes);
					saved.current = notes;
				} catch (error) {
					const code =
						error instanceof ApiError
							? error.fields.find(({ path }) => path === "notes")?.code
							: undefined;
					setFailure(code === undefined ? { message: errorMessage(error) } : { type: code });

					return;
				}
			}

			setFailure(undefined);
			if (field.current !== null) {
				onDirtyChange?.(field.current.value.trim() !== saved.current);
			}
		})();
	};

	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<Label htmlFor={id}>{label}</Label>
			<Textarea
				ref={field}
				id={id}
				rows={4}
				className="field-sizing-fixed min-h-20 wrap-anywhere"
				defaultValue={initialNote ?? ""}
				placeholder={placeholder}
				aria-invalid={failure !== undefined}
				aria-describedby={failure === undefined ? undefined : errorId}
				onChange={(event) => onDirtyChange?.(event.currentTarget.value.trim() !== saved.current)}
				onBlur={(event) => save(event.currentTarget.value)}
			/>
			<div aria-live="polite" className="empty:hidden">
				{failure !== undefined &&
					("type" in failure ? (
						<FieldMessage id={errorId} error={failure} />
					) : (
						<p id={errorId} className="text-xs text-destructive">
							{failure.message}
						</p>
					))}
			</div>
		</div>
	);
}

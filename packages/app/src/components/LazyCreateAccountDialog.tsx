import { Suspense, lazy, useState } from "react";

// The form brings the date picker, which no page needs until « Ajouter un
// compte » is pressed, while the shell shows that button on every page.
const CreateAccountDialog = lazy(async () => ({
	default: (await import("@/components/CreateAccountDialog")).CreateAccountDialog,
}));

/**
 * `CreateAccountDialog`, loaded at its first opening and mounted from then on:
 * unmounted on close, it would vanish instead of playing its closing
 * animation. No placeholder: a dialog takes no room in the page.
 */
export function LazyCreateAccountDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [opened, setOpened] = useState(open);

	if (open && !opened) {
		setOpened(true);
	}

	if (!opened) {
		return null;
	}

	return (
		<Suspense fallback={null}>
			<CreateAccountDialog open={open} onOpenChange={onOpenChange} />
		</Suspense>
	);
}

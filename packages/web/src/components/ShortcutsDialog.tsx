import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { ShortcutKeys } from "@/components/ShortcutHint";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useCommands } from "@/hooks/useCommands";
import { SHORTCUTS, SHORTCUT_SECTIONS } from "@/lib/shortcuts";

/** The `?` dialog: every shortcut of the catalogue, by section. */
export function ShortcutsDialog() {
	const { t } = useTranslation();
	const { shortcutsOpen, setShortcutsOpen } = useCommands();
	// Opened by a shortcut as often as by its button, so it remembers where
	// focus was rather than relying on a `DialogTrigger`.
	const opener = useRef<HTMLElement | null>(null);

	return (
		<Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
			<DialogContent
				className="sm:max-w-md"
				onOpenAutoFocus={() => {
					opener.current =
						document.activeElement instanceof HTMLElement ? document.activeElement : null;
				}}
				onCloseAutoFocus={(event) => {
					if (opener.current?.isConnected === true) {
						event.preventDefault();
						opener.current.focus();
					}
				}}
			>
				<DialogHeader>
					<DialogTitle>{t("shortcuts.title")}</DialogTitle>
					<DialogDescription>{t("shortcuts.description")}</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-4">
					{SHORTCUT_SECTIONS.map((section) => {
						const headingId = `shortcuts-${section}`;

						return (
							<section key={section} aria-labelledby={headingId}>
								<h3 id={headingId} className="mb-1 text-xs font-medium text-muted-foreground">
									{t(`shortcuts.sections.${section}`)}
								</h3>
								<dl className="flex flex-col">
									{SHORTCUTS.filter((shortcut) => shortcut.section === section).map((shortcut) => (
										<div
											key={shortcut.id}
											className="flex min-h-8 items-center justify-between gap-4 border-b last:border-b-0"
										>
											<dt>{t(shortcut.label)}</dt>
											<dd className="flex items-center gap-1 text-xs text-muted-foreground">
												<ShortcutKeys id={shortcut.id} />
											</dd>
										</div>
									))}
								</dl>
							</section>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}

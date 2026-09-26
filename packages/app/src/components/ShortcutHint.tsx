import type { ShortcutId } from "@/lib/shortcuts";

import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { Kbd } from "@/components/ui/kbd";
import { shortcutTexts } from "@/lib/shortcuts";

/** A shortcut's keys: its main binding, or every binding joined by « ou ». */
export function ShortcutKeys({ id, main = false }: { id: ShortcutId; main?: boolean }) {
	const { t } = useTranslation();
	const texts = shortcutTexts(id);

	return (main ? texts.slice(0, 1) : texts).map((text, index) => (
		<Fragment key={text}>
			{index > 0 && <span> {t("shortcuts.or")} </span>}
			<Kbd>{text}</Kbd>
		</Fragment>
	));
}

/** A tooltip's text: what the control does, then its main shortcut. */
export function ShortcutHint({ id, label }: { id: ShortcutId; label: string }) {
	return (
		<>
			{label} <ShortcutKeys id={id} main />
		</>
	);
}

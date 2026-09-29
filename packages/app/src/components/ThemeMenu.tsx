import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { THEME_CHOICES, isThemeChoice, setThemeChoice, useThemeChoice } from "@/lib/theme";

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

/** The theme choice inside the user menu, as a radio group: Système, Clair, Sombre. */
export function ThemeMenu() {
	const { t } = useTranslation();
	const choice = useThemeChoice();

	return (
		<>
			<DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
			<DropdownMenuRadioGroup
				value={choice}
				onValueChange={(value) => {
					if (isThemeChoice(value)) {
						setThemeChoice(value);
					}
				}}
			>
				{THEME_CHOICES.map((option) => {
					const Icon = ICONS[option];

					return (
						<DropdownMenuRadioItem key={option} value={option}>
							<Icon aria-hidden="true" />
							{t(`theme.${option}`)}
						</DropdownMenuRadioItem>
					);
				})}
			</DropdownMenuRadioGroup>
		</>
	);
}

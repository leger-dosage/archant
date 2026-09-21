import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { THEME_CHOICES, isThemeChoice, setThemeChoice, useThemeChoice } from "@/lib/theme";

const ICONS = { system: MonitorIcon, light: SunIcon, dark: MoonIcon } as const;

export function ThemeMenu() {
	const { t } = useTranslation();
	const choice = useThemeChoice();
	const Icon = ICONS[choice];

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<SidebarMenuButton tooltip={t("theme.label")}>
					<Icon />
					<span>
						{t("theme.current", { label: t("theme.label"), choice: t(`theme.${choice}`) })}
					</span>
				</SidebarMenuButton>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="min-w-40">
				<DropdownMenuLabel>{t("theme.label")}</DropdownMenuLabel>
				<DropdownMenuRadioGroup
					value={choice}
					onValueChange={(value) => {
						if (isThemeChoice(value)) {
							setThemeChoice(value);
						}
					}}
				>
					{THEME_CHOICES.map((option) => (
						<DropdownMenuRadioItem key={option} value={option}>
							{t(`theme.${option}`)}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

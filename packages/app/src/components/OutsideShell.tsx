import type { ReactNode } from "react";

import { useTranslation } from "react-i18next";

import { ArchLogo } from "@/components/ArchLogo";
import { cn } from "@/lib/utils";

/**
 * The frame of the pages outside the app shell, sign-in, setup and the root
 * error: DESIGN.md's base background with the 32 px arch above « Archant »,
 * then the page in a bordered box on the panel colour, without a shadow.
 * `bg-sidebar` is DESIGN's base `background` under shadcn's names, and
 * `bg-card` its `panel`.
 */
export function OutsideShell({ className, children }: { className?: string; children: ReactNode }) {
	const { t } = useTranslation();

	return (
		<main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-sidebar p-6">
			<div className="flex flex-col items-center gap-2">
				{/* The mark carries the name, so the word beside it is not read twice. */}
				<ArchLogo label={t("app.name")} className="size-8" />
				<span aria-hidden="true" className="card-title">
					{t("app.name")}
				</span>
			</div>
			<div
				data-slot="outside-shell-box"
				className={cn("w-full max-w-sm rounded-xl border bg-card p-6", className)}
			>
				{children}
			</div>
		</main>
	);
}

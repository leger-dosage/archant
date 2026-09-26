import type { ErrorComponentProps } from "@tanstack/react-router";

import { useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { errorCodeOf } from "@/lib/api";
import { errorMessage } from "@/lib/error-toast";

/**
 * What a route shows when it fails before any layout renders, as when the API
 * is not started or another server holds its port. TanStack's default would
 * show « Something went wrong! » and the bare code.
 */
export function RootError({ error, reset }: ErrorComponentProps) {
	const { t } = useTranslation();
	const router = useRouter();
	const code = errorCodeOf(error);
	const apiDown = code === "NETWORK_ERROR";

	async function retry() {
		// Reruns every `beforeLoad`, so the page loads once the API answers.
		await router.invalidate();
		reset();
	}

	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<div className="flex w-full max-w-md flex-col gap-4">
				<h1 className="text-xl font-semibold">
					{apiDown ? t("startError.apiDownTitle") : t("startError.title")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{apiDown ? t("startError.apiDownDescription") : errorMessage(error)}
				</p>
				<Button className="self-start" onClick={() => void retry()}>
					{t("common.retry")}
				</Button>
			</div>
		</main>
	);
}

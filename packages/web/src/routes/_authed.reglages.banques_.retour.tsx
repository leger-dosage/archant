import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2Icon } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { useCompleteBankConnection } from "@/hooks/useBankConnections";
import { errorMessage } from "@/lib/error-toast";

// What the bank appends to the return URL: `code` and `state` once the user
// agrees, `error` (and a description this page never shows) otherwise.
const searchSchema = z.object({
	code: z.string().optional().catch(undefined),
	state: z.string().optional().catch(undefined),
	error: z.string().optional().catch(undefined),
});

// `banques_`: a page of its own under the settings layout, not a child
// rendered inside the bank list.
export const Route = createFileRoute("/_authed/reglages/banques_/retour")({
	validateSearch: searchSchema,
	component: BankReturnPage,
});

function Failure({ message }: { message: string }) {
	const { t } = useTranslation();

	return (
		<div role="alert" className="flex flex-col items-start gap-3 rounded-lg border p-6">
			<p>{message}</p>
			<Link
				to="/reglages/banques"
				replace
				className="text-sm font-medium underline underline-offset-4"
			>
				{t("banks.return.back")}
			</Link>
		</div>
	);
}

/**
 * Where the bank sends the browser back. It posts `code` and `state` to the
 * API with the session cookie, rather than the bank calling an API `GET`
 * that writes: the page already translates errors and shows toasts.
 */
function BankReturnPage() {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const { code, state, error } = Route.useSearch();
	const complete = useCompleteBankConnection();
	const { mutate } = complete;
	// A `state` is single use: a second post, from a remount in development's
	// strict mode, would fail and hide the first one's success.
	const posted = useRef(false);
	const refused = error !== undefined;
	const incomplete = !refused && (code === undefined || state === undefined);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("banks.return.title"), app: t("app.name") });
	}, [t]);

	useEffect(() => {
		if (posted.current || refused || code === undefined || state === undefined) {
			return;
		}

		posted.current = true;
		mutate(
			{ code, state },
			{
				onSuccess: (connection) => {
					toast.success(t("banks.return.connected", { name: connection.institutionName }));
					// Replaced, so Back never lands on a spent code.
					void navigate({ to: "/reglages/banques", replace: true });
				},
			},
		);
	}, [code, state, refused, mutate, navigate, t]);

	return (
		<div className="flex max-w-2xl flex-col gap-6">
			<h2 className="text-lg font-semibold">{t("banks.return.title")}</h2>

			{refused && <Failure message={t("banks.return.refused")} />}

			{incomplete && <Failure message={t("errors.BANK_AUTHORIZATION_INVALID")} />}

			{complete.isError && <Failure message={errorMessage(complete.error)} />}

			{!refused && !incomplete && !complete.isError && (
				<p role="status" className="flex items-center gap-2 text-muted-foreground">
					<Loader2Icon className="size-4 animate-spin" aria-hidden />
					{t("banks.return.pending")}
				</p>
			)}
		</div>
	);
}

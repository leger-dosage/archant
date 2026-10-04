import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { OutsideShell } from "@/components/OutsideShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuthActions } from "@/hooks/useAuthActions";
import { sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { queryKeys } from "@/lib/query-keys";

// Better Auth's signed query, kept whole in the address: `oauthProviderClient`
// sends it back with the answer. Only what the page shows is read from it.
const searchSchema = z.looseObject({
	client_id: z.string().catch(""),
	scope: z.string().catch(""),
	redirect_uri: z.string().catch(""),
});

/** Better Auth's answer to a consent: the assistant's address, with a code or a refusal. */
const continuation = z.object({ url: z.string().min(1) });

const READ = "archant:read";
const WRITE = "archant:write";

export const Route = createFileRoute("/oauth/consent")({
	validateSearch: searchSchema,
	beforeLoad: async ({ context, location }) => {
		// Better Auth sends a signed-out owner to `/sign-in` first; a session
		// that ended since comes back here once signed in again.
		if ((await context.queryClient.ensureQueryData(sessionQuery)) === null) {
			throw redirect({ to: "/sign-in", search: { redirect: location.href } });
		}
	},
	component: ConsentPage,
});

/** The code a failed answer is told by: the server refuses a viewer's with 403. */
function failureCode(status: number | undefined): "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR" {
	if (status === 401) {
		return "UNAUTHORIZED";
	}

	return status === 403 ? "FORBIDDEN" : "INTERNAL_ERROR";
}

/** The host the assistant gets its code at, from the signed query: never a guess. */
function hostOf(redirectUri: string): string | null {
	return URL.canParse(redirectUri) ? new URL(redirectUri).host : null;
}

/**
 * Where the owner lets an assistant act in Archant (AD-19). Only an
 * administrator connects one (AD-21): anyone else reads why, with nothing to
 * press, and the server refuses their answer whatever the page shows. Each
 * scope in plain French; write can be unticked, read cannot, since without it
 * the assistant can do nothing. `offline_access`, which only renews the access,
 * goes with read and is never shown. Both answers post through Better Auth's
 * client, then the page follows the address it returns: `form-action 'self'`
 * would refuse a form posted to the assistant.
 */
function ConsentPage() {
	const { t } = useTranslation();
	const { assistantClient, consent } = useAuthActions();
	const search = Route.useSearch();
	const session = useQuery(sessionQuery);
	// Signed out since the page opened is left to the flow below: a refusal is
	// for a signed-in user who is not an administrator.
	const user = session.data?.user;
	const refused = user !== undefined && user.role !== "admin";
	const writeId = useId();
	const requested = search.scope.split(" ").filter((scope) => scope !== "");
	const [write, setWrite] = useState(requested.includes(WRITE));
	const [pending, setPending] = useState(false);
	const host = hostOf(search.redirect_uri);
	const client = useQuery({
		queryKey: queryKeys.assistants.client(search.client_id),
		queryFn: async () => {
			const { data, error } = await assistantClient(search.client_id);

			if (error !== null) {
				throw new Error(error.message ?? "client not found");
			}

			return data;
		},
		retry: false,
		enabled: !refused,
	});
	const name = client.data?.client_name ?? t("consent.unnamed");

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("consent.title"), app: t("app.name") });
	}, [t]);

	const answer = async (accept: boolean) => {
		setPending(true);
		const granted = requested.filter((scope) => scope !== WRITE || write).join(" ");
		const { data, error } = await consent(accept ? { accept, scope: granted } : { accept });
		const next = continuation.safeParse(data);

		if (error !== null || !next.success) {
			setPending(false);
			showErrorToast(failureCode(error?.status));
			return;
		}

		window.location.href = next.data.url;
	};

	if (refused) {
		return (
			<OutsideShell className="flex flex-col gap-2">
				<h1 className="page-title">{t("consent.title")}</h1>
				<p role="alert" className="text-sm text-destructive">
					{t("consent.administratorOnly")}
				</p>
			</OutsideShell>
		);
	}

	return (
		<OutsideShell className="flex flex-col gap-6">
			<div className="flex flex-col gap-2">
				<h1 className="page-title">{t("consent.title")}</h1>
				{client.isPending ? (
					<Skeleton className="h-5 w-48" />
				) : client.isError ? (
					// Unknown or disabled: nothing to name, so nothing to allow.
					<p role="alert" className="text-sm text-destructive">
						{t("consent.unidentified")}
					</p>
				) : (
					<p className="text-sm text-muted-foreground">
						{t("consent.asking", { name })}
						{host !== null && ` ${t("consent.returnsTo", { host })}`}
					</p>
				)}
			</div>
			<fieldset className="flex flex-col gap-3">
				<legend className="mb-2 font-medium">{t("consent.scopes")}</legend>
				{requested.includes(READ) && (
					<div className="flex items-start gap-2">
						<Checkbox id={`${writeId}-read`} checked disabled className="mt-0.5" />
						<Label htmlFor={`${writeId}-read`} className="font-normal">
							{t("consent.read")}
						</Label>
					</div>
				)}
				{requested.includes(WRITE) && (
					<div className="flex items-start gap-2">
						<Checkbox
							id={writeId}
							checked={write}
							onCheckedChange={(checked) => setWrite(checked === true)}
							className="mt-0.5"
						/>
						<Label htmlFor={writeId} className="font-normal">
							{t("consent.write")}
						</Label>
					</div>
				)}
			</fieldset>
			<p className="text-sm text-muted-foreground">{t("consent.revoke")}</p>
			<div className="flex flex-col gap-2">
				<Button disabled={pending || client.isError} onClick={() => void answer(true)}>
					{t("consent.allow")}
				</Button>
				<Button variant="outline" disabled={pending} onClick={() => void answer(false)}>
					{t("consent.deny")}
				</Button>
			</div>
		</OutsideShell>
	);
}

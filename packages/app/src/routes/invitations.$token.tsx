import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { z } from "zod";

import { acceptInvitationSchema } from "@archant/api/schemas/invitations";

import { FieldMessage } from "@/components/FieldMessage";
import { OutsideShell } from "@/components/OutsideShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAcceptInvitation, useInvitationPreview } from "@/hooks/useInvitations";
import { ApiError, errorCodeOf } from "@/lib/api";
import { authClient, sessionQuery } from "@/lib/auth-client";
import { showErrorToast } from "@/lib/error-toast";
import { applyFieldErrors } from "@/lib/form-errors";
import { queryKeys } from "@/lib/query-keys";

// The API's schema without the token, which the address carries, plus the
// confirmation, which only the form needs.
const acceptFormSchema = acceptInvitationSchema
	.omit({ token: true })
	.extend({ confirmPassword: z.string() })
	.refine((value) => value.password === value.confirmPassword, {
		path: ["confirmPassword"],
		message: "password_mismatch",
	});

type AcceptFormValues = z.input<typeof acceptFormSchema>;

const API_FIELDS = ["name", "password"] as const;

/**
 * The page an invitation's link opens, outside the shell: nobody is signed
 * in yet. It names who invites and as what, shows the invitation's email,
 * which the account takes and nobody edits, and asks for a first name and a
 * password. A link no longer valid, used, expired, revoked or unknown, says
 * so and leads to sign-in. A browser signed in already, such as the
 * administrator checking their own link, is asked to sign out first:
 * accepting would replace that session without a word.
 */
export const Route = createFileRoute("/invitations/$token")({
	component: InvitationPage,
});

function InvalidInvitation() {
	const { t } = useTranslation();

	return (
		<OutsideShell className="flex flex-col gap-4">
			<h1 className="page-title">{t("invitation.invalidTitle")}</h1>
			<p role="alert" className="text-sm text-muted-foreground">
				{t("errors.INVITATION_INVALID")}
			</p>
			<Button asChild variant="outline">
				<Link to="/sign-in">{t("invitation.signIn")}</Link>
			</Button>
		</OutsideShell>
	);
}

/** Signs out where the page stands, keeping the invitation and nothing of the previous user. */
function SignedInNotice({ email }: { email: string }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const [pending, setPending] = useState(false);

	const signOut = async () => {
		setPending(true);
		// Swallowed: a refused sign-out still leaves the cookie to the server,
		// and the acceptance would replace it anyway.
		await authClient.signOut().catch(() => undefined);
		queryClient.removeQueries({
			predicate: ({ queryKey }) =>
				queryKey[0] !== queryKeys.session[0] &&
				queryKey[0] !== queryKeys.invitations.preview(email)[0],
		});
		queryClient.setQueryData(queryKeys.session, null);
		setPending(false);
	};

	return (
		<OutsideShell className="flex flex-col gap-4">
			<h1 className="page-title">{t("invitation.title")}</h1>
			<p role="alert" className="text-sm text-muted-foreground">
				{t("invitation.signedIn", { email })}
			</p>
			<Button variant="outline" disabled={pending} onClick={() => void signOut()}>
				{t("invitation.signOut")}
			</Button>
		</OutsideShell>
	);
}

function InvitationPage() {
	const { t } = useTranslation();
	const { token } = Route.useParams();
	const preview = useInvitationPreview(token);
	const session = useQuery(sessionQuery);
	// Set when the acceptance finds the link spent since the page opened.
	const [spent, setSpent] = useState(false);
	// Set once the account exists: the session read again on the way out is
	// the new user's, and must not show the signed-in notice meanwhile.
	const [accepted, setAccepted] = useState(false);

	useEffect(() => {
		document.title = t("app.pageTitle", { page: t("invitation.title"), app: t("app.name") });
	}, [t]);

	if (spent || errorCodeOf(preview.error) === "INVITATION_INVALID") {
		return <InvalidInvitation />;
	}

	if (preview.isError) {
		return (
			<OutsideShell className="flex flex-col items-start gap-3">
				<p role="alert" className="text-muted-foreground">
					{t(`errors.${errorCodeOf(preview.error)}`)}
				</p>
				<Button variant="outline" onClick={() => void preview.refetch()}>
					{t("common.retry")}
				</Button>
			</OutsideShell>
		);
	}

	// An unreachable session check is left to the acceptance, which would fail the same way.
	if (preview.data === undefined || session.isPending) {
		return (
			<OutsideShell className="flex flex-col gap-4">
				<Skeleton className="h-8 w-2/3" />
				<Skeleton className="h-24 w-full" />
			</OutsideShell>
		);
	}

	if (session.data?.user !== undefined && !accepted) {
		return <SignedInNotice email={session.data.user.email} />;
	}

	return (
		<AcceptForm
			token={token}
			email={preview.data.email}
			intro={t("invitation.intro", {
				inviter: preview.data.inviterName,
				role: t(`invitation.roles.${preview.data.role}`),
			})}
			onSpent={() => setSpent(true)}
			onAccepted={() => setAccepted(true)}
		/>
	);
}

function AcceptForm({
	token,
	email,
	intro,
	onSpent,
	onAccepted,
}: {
	token: string;
	email: string;
	intro: string;
	onSpent: () => void;
	onAccepted: () => void;
}) {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const accept = useAcceptInvitation();
	const form = useForm<AcceptFormValues>({
		resolver: zodResolver(acceptFormSchema),
		defaultValues: { name: "", password: "", confirmPassword: "" },
	});
	const { errors, isSubmitting } = form.formState;

	const submit = form.handleSubmit(async ({ name, password }) => {
		let signedIn: boolean;

		try {
			({ signedIn } = await accept.mutateAsync({ token, name, password }));
		} catch (error) {
			const apiError = error instanceof ApiError ? error : new ApiError("INTERNAL_ERROR");

			if (apiError.code === "INVITATION_INVALID") {
				onSpent();
				return;
			}

			const unplaced = applyFieldErrors(apiError.fields, API_FIELDS, form.setError);

			if (
				apiError.code !== "VALIDATION_ERROR" ||
				unplaced.length > 0 ||
				apiError.fields.length === 0
			) {
				showErrorToast(apiError.code);
			}

			return;
		}

		onAccepted();

		// Spent: back in this tab, the link must say so, not show the form again.
		const forget = () =>
			queryClient.removeQueries({ queryKey: queryKeys.invitations.preview(token) });

		if (!signedIn) {
			toast.success(t("invitation.created"));
			await navigate({ to: "/sign-in" });
			forget();
			return;
		}

		queryClient.removeQueries({ queryKey: queryKeys.session });
		await navigate({ to: "/" });
		forget();
	});

	const describedBy = (name: keyof AcceptFormValues, extra?: string) => {
		const ids = [errors[name] === undefined ? undefined : `${name}-error`, extra].filter(
			(id) => id !== undefined,
		);

		return ids.length === 0 ? {} : { "aria-describedby": ids.join(" ") };
	};

	return (
		<OutsideShell className="flex flex-col gap-6">
			<div className="flex flex-col gap-1.5">
				<h1 className="page-title">{t("invitation.title")}</h1>
				<p className="text-sm text-muted-foreground">{intro}</p>
			</div>
			<form noValidate className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="email">{t("invitation.email")}</Label>
					{/* The invitation's: the account takes this email, and nobody edits it. */}
					<Input id="email" type="email" autoComplete="username" readOnly value={email} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="name">{t("invitation.firstName")}</Label>
					<Input
						id="name"
						autoComplete="given-name"
						aria-invalid={errors.name !== undefined}
						{...describedBy("name", "name-hint")}
						{...form.register("name")}
					/>
					<p id="name-hint" className="text-xs text-muted-foreground">
						{t("invitation.firstNameHint")}
					</p>
					<FieldMessage id="name-error" error={errors.name} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="password">{t("invitation.password")}</Label>
					<Input
						id="password"
						type="password"
						autoComplete="new-password"
						aria-invalid={errors.password !== undefined}
						{...describedBy("password", "password-hint")}
						{...form.register("password")}
					/>
					<p id="password-hint" className="text-xs text-muted-foreground">
						{t("invitation.passwordHint")}
					</p>
					<FieldMessage id="password-error" error={errors.password} />
				</div>
				<div className="flex flex-col gap-1.5">
					<Label htmlFor="confirmPassword">{t("invitation.confirmPassword")}</Label>
					<Input
						id="confirmPassword"
						type="password"
						autoComplete="new-password"
						aria-invalid={errors.confirmPassword !== undefined}
						{...describedBy("confirmPassword")}
						{...form.register("confirmPassword")}
					/>
					<FieldMessage id="confirmPassword-error" error={errors.confirmPassword} />
				</div>
				<Button type="submit" disabled={isSubmitting}>
					{t("invitation.submit")}
				</Button>
			</form>
		</OutsideShell>
	);
}

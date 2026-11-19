import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIsAdmin } from "@/hooks/usePermissions";
import { authClient } from "@/lib/auth-client";
import { OPENID_PROVIDER, signInOptionsQuery } from "@/lib/openid-connect-client";

const accountsKey = ["sign-in-accounts"];

export function OpenIdConnectSection({ callbackFailed }: { callbackFailed: boolean }) {
	const { t } = useTranslation();
	const queryClient = useQueryClient();
	const isAdmin = useIsAdmin();
	const { data: options } = useQuery(signInOptionsQuery);
	const { data: accounts } = useQuery({
		queryKey: accountsKey,
		queryFn: async () => {
			const result = await authClient.listAccounts();
			if (result.error) {
				throw new Error("Could not list sign-in methods.");
			}
			return result.data;
		},
		enabled: options?.openIdConnect === true,
	});
	const [password, setPassword] = useState("");
	const [working, setWorking] = useState(false);
	const [failure, setFailure] = useState(callbackFailed);

	if (options?.openIdConnect !== true || accounts === undefined) {
		return null;
	}

	const linked = accounts.some((account) => account.providerId === OPENID_PROVIDER);
	const hasPassword = accounts.some((account) => account.providerId === "credential");
	if (!linked && !hasPassword) {
		return null;
	}

	const link = async (event: FormEvent) => {
		event.preventDefault();
		setWorking(true);
		setFailure(false);
		try {
			const result = await authClient.linkSocial({
				provider: OPENID_PROVIDER,
				additionalData: { password },
			});
			setFailure(result.error !== null);
		} catch {
			setFailure(true);
		} finally {
			setPassword("");
			setWorking(false);
		}
	};

	const unlink = async () => {
		setWorking(true);
		setFailure(false);
		try {
			const result = await authClient.$fetch("/unlink-openid-connect", {
				method: "POST",
				body: {},
			});
			setFailure(result.error !== null);
			if (!result.error) {
				await queryClient.invalidateQueries({ queryKey: accountsKey });
			}
		} catch {
			setFailure(true);
		} finally {
			setWorking(false);
		}
	};

	return (
		<Section title="OpenID Connect">
			<div className="flex flex-col items-start gap-3 p-4">
				{linked ? (
					<>
						<p>{t("openidConnect.linked")}</p>
						{hasPassword && options.password && (!options.passwordAdminOnly || isAdmin) && (
							<Button variant="outline" disabled={working} onClick={() => void unlink()}>
								{t("openidConnect.unlink")}
							</Button>
						)}
					</>
				) : (
					hasPassword && (
						<form
							className="flex w-full flex-col items-start gap-3"
							onSubmit={(event) => void link(event)}
						>
							<Label htmlFor="oidc-current-password">{t("openidConnect.linkPassword")}</Label>
							<Input
								id="oidc-current-password"
								type="password"
								autoComplete="current-password"
								value={password}
								onChange={(event) => setPassword(event.currentTarget.value)}
							/>
							<Button variant="outline" type="submit" disabled={working || password.length === 0}>
								{t("openidConnect.link")}
							</Button>
						</form>
					)
				)}
				{failure && (
					<p role="alert" className="text-sm text-destructive">
						{t("openidConnect.manageFailure")}
					</p>
				)}
			</div>
		</Section>
	);
}

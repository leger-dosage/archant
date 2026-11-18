import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Section } from "@/components/Section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { passkeyConfigQuery, registerPasskey } from "@/lib/passkey-client";

const passkeysQuery = {
	queryKey: ["passkeys"],
	queryFn: async () => {
		const { data, error } = await authClient.passkey.listUserPasskeys();
		if (error) {
			throw new Error("Passkey list failed.");
		}

		return data;
	},
};

export function PasskeySection({ enabled }: { enabled: boolean }) {
	const { data } = useQuery(passkeyConfigQuery);

	return data?.available === true && enabled ? <Passkeys /> : null;
}

function Passkeys() {
	const { t, i18n } = useTranslation();
	const queryClient = useQueryClient();
	const keys = useQuery(passkeysQuery);
	const nameId = useId();
	const codeId = useId();
	const [name, setName] = useState("");
	const [code, setCode] = useState("");
	const [failure, setFailure] = useState<"failed" | "invalidCode" | "usedCode" | "tooMany" | null>(
		null,
	);
	const [busy, setBusy] = useState(false);
	const [remove, setRemove] = useState<{ id: string; name: string } | null>(null);
	const format = new Intl.DateTimeFormat(i18n.language, {
		dateStyle: "medium",
		timeStyle: "short",
	});

	const add = async () => {
		setBusy(true);
		setFailure(null);
		try {
			const error = await registerPasskey(name.trim(), code.replace(/\s+/gu, ""));
			if (error) {
				const reason = "code" in error ? error.code : undefined;
				if (reason === "INVALID_CODE") {
					setFailure("invalidCode");
				} else if (reason === "CODE_ALREADY_USED") {
					setFailure("usedCode");
				} else {
					setFailure(error.status === 429 ? "tooMany" : "failed");
				}

				return;
			}

			setName("");
			await queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
		} catch {
			setFailure("failed");
		} finally {
			setCode("");
			setBusy(false);
		}
	};

	const deleteKey = async (id: string) => {
		setBusy(true);
		setFailure(null);
		try {
			const { error } = await authClient.passkey.deletePasskey({ id });
			if (error) {
				setFailure(error.status === 429 ? "tooMany" : "failed");
				return;
			}

			setRemove(null);
			await queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
		} catch {
			setFailure("failed");
		} finally {
			setBusy(false);
		}
	};

	return (
		<Section title={t("passkeys.title")}>
			<div className="flex flex-col gap-4 p-4">
				{keys.data && keys.data.length > 0 && (
					<ul className="divide-y">
						{keys.data.map((key) => {
							const keyName = key.name ?? t("passkeys.unnamed");
							const lastUsed =
								"lastUsedAt" in key && key.lastUsedAt instanceof Date
									? format.format(key.lastUsedAt)
									: t("passkeys.neverUsed");
							return (
								<li key={key.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
									<div className="min-w-0">
										<p className="font-medium wrap-break-word">{keyName}</p>
										<p className="text-sm text-muted-foreground">
											{key.createdAt &&
												t("passkeys.addedAt", { date: format.format(new Date(key.createdAt)) })}
										</p>
										<p className="text-sm text-muted-foreground">
											{t("passkeys.lastUsedAt", { date: lastUsed })}
										</p>
									</div>
									<Button
										type="button"
										variant="outline"
										disabled={busy}
										onClick={() => setRemove({ id: key.id, name: keyName })}
									>
										{t("passkeys.delete")}
									</Button>
								</li>
							);
						})}
					</ul>
				)}
				<form
					className="flex flex-col gap-3"
					onSubmit={(event) => {
						event.preventDefault();
						void add();
					}}
				>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={nameId}>{t("passkeys.name")}</Label>
						<Input
							id={nameId}
							value={name}
							maxLength={100}
							required
							onChange={(event) => setName(event.target.value)}
						/>
					</div>
					<div className="flex flex-col gap-1.5">
						<Label htmlFor={codeId}>{t("passkeys.code")}</Label>
						<Input
							id={codeId}
							value={code}
							inputMode="numeric"
							autoComplete="one-time-code"
							required
							onChange={(event) => setCode(event.target.value)}
						/>
					</div>
					<Button type="submit" className="self-start" disabled={busy}>
						{t("passkeys.add")}
					</Button>
				</form>
				{(failure !== null || keys.isError) && (
					<p role="alert" className="text-sm text-destructive">
						{t(`passkeys.${failure ?? "failed"}`)}
					</p>
				)}
			</div>
			<ConfirmDialog
				open={remove !== null}
				onOpenChange={(open) => {
					if (!open) {
						setRemove(null);
					}
				}}
				title={t("passkeys.removeTitle", { name: remove?.name ?? "" })}
				description={t("passkeys.removeDescription")}
				confirmLabel={t("passkeys.delete")}
				destructive
				pending={busy}
				onConfirm={() => {
					if (remove !== null) {
						void deleteKey(remove.id);
					}
				}}
			/>
		</Section>
	);
}

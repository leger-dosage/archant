import type { TransactionData } from "@/hooks/useTransactions";

import { FileTextIcon, ImageIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
	ATTACHMENT_CONTENT_TYPES,
	MAX_ATTACHMENTS_PER_TRANSACTION,
} from "@archant/data/attachments";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
	attachmentUrl,
	useAttachments,
	useDeleteAttachment,
	useUploadAttachment,
} from "@/hooks/useAttachments";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { ApiError, errorCodeOf } from "@/lib/api";
import { showErrorToast } from "@/lib/error-toast";
import { formatFileSize } from "@/lib/file-size";
import { fieldErrorCode } from "@/lib/form-errors";

type Attachment = NonNullable<ReturnType<typeof useAttachments>["data"]>[number];

/** A file the API refused, with the code of its field message. */
type Refusal = { name: string; code: string };

/** The field code of a refused upload, or `null` for a failure the toast reports. */
function refusalCode(error: unknown): string | null {
	if (!(error instanceof ApiError) || error.code !== "VALIDATION_ERROR") {
		return null;
	}

	return error.fields.find((field) => field.path === "file")?.code ?? null;
}

function AttachmentItem({
	transactionId,
	attachment,
	onDelete,
}: {
	transactionId: string;
	attachment: Attachment;
	/** `null` for a viewer, who opens a file and deletes none. */
	onDelete: (() => void) | null;
}) {
	const { t } = useTranslation();
	const Icon = attachment.contentType === "application/pdf" ? FileTextIcon : ImageIcon;

	return (
		<li className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
			<div className="flex min-w-0 items-center gap-2">
				<Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
				<div className="flex min-w-0 flex-col">
					{/* A new tab, so the sheet and its unsaved edits stay where they are. */}
					<a
						href={attachmentUrl(transactionId, attachment.id)}
						target="_blank"
						rel="noreferrer"
						className="truncate text-sm font-medium underline-offset-4 hover:underline"
					>
						{attachment.filename}
					</a>
					<span className="text-xs text-muted-foreground">
						{formatFileSize(attachment.byteSize)}
					</span>
				</div>
			</div>
			{onDelete !== null && (
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label={t("transactions.attachments.remove", { name: attachment.filename })}
					onClick={onDelete}
				>
					<Trash2Icon aria-hidden="true" />
				</Button>
			)}
		</li>
	);
}

/**
 * The sheet's « Pièces jointes », as Sure's `transactions/_attachments`: each
 * file with its size, opened in a new tab, « Ajouter » and a delete with
 * confirmation. Every action saves at once, apart from the form, and never
 * touches it, so none waits for its unsaved edits. A viewer opens the files,
 * and neither adds nor deletes one.
 */
export function TransactionAttachments({ transaction }: { transaction: TransactionData }) {
	const { t } = useTranslation();
	const admin = useIsAdmin();
	const attachments = useAttachments(transaction.id);
	const upload = useUploadAttachment(transaction.id);
	const remove = useDeleteAttachment(transaction.id);
	const input = useRef<HTMLInputElement>(null);
	const [uploading, setUploading] = useState(false);
	const [refusals, setRefusals] = useState<Refusal[]>([]);
	// Kept once the dialog closes, so its text holds through the closing animation.
	const [deleting, setDeleting] = useState<Attachment | null>(null);
	const [confirming, setConfirming] = useState(false);
	const count = attachments.data?.length ?? 0;
	const full = count >= MAX_ATTACHMENTS_PER_TRANSACTION;

	// One request per file, one after the other: each stays under the
	// upload's body limit, and the API checks the count against the ones before.
	const send = async (files: readonly File[]) => {
		setUploading(true);
		setRefusals([]);

		const refused = await files.reduce<Promise<Refusal[]>>(async (previous, file) => {
			const done = await previous;

			try {
				await upload.mutateAsync(file);

				return done;
			} catch (error) {
				const code = refusalCode(error);

				if (code === null) {
					showErrorToast(errorCodeOf(error));

					return done;
				}

				return [...done, { name: file.name, code }];
			}
		}, Promise.resolve([]));

		setRefusals(refused);
		setUploading(false);
	};

	const confirmDelete = () => {
		if (deleting === null) {
			return;
		}

		remove.mutate(deleting.id, {
			onSettled: () => setConfirming(false),
			onError: (error) => showErrorToast(errorCodeOf(error)),
		});
	};

	return (
		<section
			aria-labelledby="transaction-attachments-title"
			aria-busy={uploading}
			className="flex flex-col gap-1.5"
		>
			<h3 id="transaction-attachments-title" className="text-sm font-medium">
				{t("transactions.attachments.section")}
			</h3>
			{/* `countMissedSyncs` deletes a pending line the bank drops, receipts included. */}
			{transaction.pending && (
				<p className="text-xs text-muted-foreground">{t("transactions.attachments.pending")}</p>
			)}
			{attachments.isPending ? (
				<Skeleton className="h-12 w-full" />
			) : attachments.isError ? (
				<p role="alert" className="text-sm text-muted-foreground">
					{t(`errors.${errorCodeOf(attachments.error)}`)}
				</p>
			) : count === 0 ? (
				<p className="text-sm text-muted-foreground">
					{t(admin ? "transactions.attachments.empty" : "transactions.attachments.none")}
				</p>
			) : (
				<ul
					aria-label={t("transactions.attachments.list", { label: transaction.label })}
					className="flex flex-col gap-1.5"
				>
					{attachments.data.map((attachment) => (
						<AttachmentItem
							key={attachment.id}
							transactionId={transaction.id}
							attachment={attachment}
							onDelete={
								admin
									? () => {
											setDeleting(attachment);
											setConfirming(true);
										}
									: null
							}
						/>
					))}
				</ul>
			)}
			{refusals.length > 0 && (
				<ul role="alert" className="flex flex-col gap-0.5">
					{refusals.map((refusal, index) => (
						<li key={`${refusal.name}-${String(index)}`} className="text-xs text-destructive">
							{t("transactions.attachments.refused", {
								name: refusal.name,
								message: t(`errors.fields.${fieldErrorCode({ type: refusal.code })}`),
							})}
						</li>
					))}
				</ul>
			)}
			{admin && (
				<>
					<div className="flex flex-col items-start gap-1">
						<Button
							type="button"
							variant="outline"
							disabled={full || uploading || attachments.isPending}
							onClick={() => input.current?.click()}
						>
							<PaperclipIcon aria-hidden="true" />
							{uploading
								? t("transactions.attachments.uploading")
								: t("transactions.attachments.add")}
						</Button>
						{full && (
							<p className="text-xs text-muted-foreground">{t("transactions.attachments.full")}</p>
						)}
						<input
							ref={input}
							type="file"
							multiple
							hidden
							accept={ATTACHMENT_CONTENT_TYPES.join(",")}
							aria-label={t("transactions.attachments.input")}
							onChange={(event) => {
								const files = Array.from(event.currentTarget.files ?? []);
								// Emptied at once, so choosing the same file again fires a change.
								event.currentTarget.value = "";

								if (files.length > 0) {
									void send(files);
								}
							}}
						/>
					</div>
					<ConfirmDialog
						open={confirming}
						onOpenChange={setConfirming}
						title={t("transactions.attachments.removeTitle")}
						description={t("transactions.attachments.removeDescription", {
							name: deleting?.filename ?? "",
						})}
						confirmLabel={t("transactions.attachments.removeAction")}
						destructive
						pending={remove.isPending}
						onConfirm={confirmDelete}
					/>
				</>
			)}
		</section>
	);
}

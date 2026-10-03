import type { ServiceDeps } from "../services/deps.ts";

import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";

import { inlineDisposition } from "../lib/content-disposition.ts";
import { validated } from "../lib/validated.ts";
import { MAX_ATTACHMENT_BODY_BYTES, attachmentUploadSchema } from "../schemas/attachments.ts";
import {
	getAttachmentFile,
	listTransactionAttachments,
	refusedFile,
	removeAttachment,
	uploadAttachment,
} from "../services/attachments.ts";

/**
 * A transaction's receipts and invoices, mounted under
 * `/transactions/:id/attachments`. The file itself sits outside the
 * `{ data }` envelope, like the export, and `app.ts` serves it under a
 * sandboxed Content-Security-Policy.
 */
export function attachmentsRoutes(deps: ServiceDeps) {
	return new Hono()
		.get("/", async (c) =>
			c.json({ data: await listTransactionAttachments(deps, c.req.param("id") ?? "") }, 200),
		)
		.post(
			"/",
			// Refused before the body is read, so a 50 MB upload costs nothing.
			bodyLimit({
				maxSize: MAX_ATTACHMENT_BODY_BYTES,
				onError: () => {
					throw refusedFile("attachment_too_large");
				},
			}),
			validated("form", attachmentUploadSchema),
			async (c) => {
				const { file } = c.req.valid("form");
				const bytes = new Uint8Array(await file.arrayBuffer());

				return c.json(
					{
						data: await uploadAttachment(deps, c.req.param("id") ?? "", {
							name: file.name,
							bytes,
						}),
					},
					201,
				);
			},
		)
		.get("/:attachmentId", async (c) => {
			const file = await getAttachmentFile(
				deps,
				c.req.param("id") ?? "",
				c.req.param("attachmentId"),
			);

			// Inline: every allowed type is an image or a PDF, which the browser
			// shows in the new tab the sheet opens.
			return c.body(new Uint8Array(file.content), 200, {
				"Content-Type": file.contentType,
				"Content-Length": String(file.byteSize),
				"Content-Disposition": inlineDisposition(file.filename),
				// A receipt names a shop and an amount: no shared cache, nor the
				// browser's, keeps a copy.
				"Cache-Control": "private, no-store",
			});
		})
		.delete("/:attachmentId", async (c) =>
			c.json(
				{
					data: await removeAttachment(deps, c.req.param("id") ?? "", c.req.param("attachmentId")),
				},
				200,
			),
		);
}

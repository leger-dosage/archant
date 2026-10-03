// What a transaction's attachments may be, as Sure's `validate_attachments`,
// apart from the table so the interface reads them without bundling Drizzle.

/** The types an attachment may have: images and PDFs, every one shown inline. */
export const ATTACHMENT_CONTENT_TYPES = [
	"image/jpeg",
	"image/png",
	"image/gif",
	"image/webp",
	"application/pdf",
] as const;

export type AttachmentContentType = (typeof ATTACHMENT_CONTENT_TYPES)[number];

/** Sure's `Transaction::MAX_ATTACHMENTS_PER_TRANSACTION`. */
export const MAX_ATTACHMENTS_PER_TRANSACTION = 10;

/** Sure's `Transaction::MAX_ATTACHMENT_SIZE`, 10 MiB. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

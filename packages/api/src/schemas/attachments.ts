import { z } from "zod";

import { MAX_ATTACHMENT_BYTES } from "@archant/data/attachments";

// A multipart body carries its boundary and headers besides the file; the
// file's own size is checked against MAX_ATTACHMENT_BYTES after parsing. One
// file per request, so this stays one file's size: Sure's form posts up to
// ten at once, which would need ten times the limit.
export const MAX_ATTACHMENT_BODY_BYTES = MAX_ATTACHMENT_BYTES + 64 * 1024;

/** `multipart/form-data` with one `file` field; the interface sends several one after the other. */
export const attachmentUploadSchema = z.object({ file: z.instanceof(File) });

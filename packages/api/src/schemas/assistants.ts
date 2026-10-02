import { z } from "zod";

/** The input of a tool that takes none: an assistant may send `{}`, nothing more. */
export const noToolInput = z.strictObject({});

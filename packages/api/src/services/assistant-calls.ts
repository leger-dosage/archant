import type { ServiceDeps } from "./deps.ts";

import { lt } from "drizzle-orm";

import { assistantCalls } from "@archant/data/schema/assistant-calls";

/** How long a call stays on record: long enough to notice an assistant acting oddly. */
export const ASSISTANT_CALL_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type AssistantCall = {
	clientId: string;
	tool: string;
	/** `OK`, or the code of the `AppError` the tool answered with. */
	outcome: string;
	/** Rows the call wrote: 0 for a read. */
	changedRows: number;
};

/**
 * Records one tool call and forgets those past retention in the same write,
 * as the start purges stale import previews: no scheduler, and the table never
 * outgrows 90 days of calls. Never the arguments or the result (AD-14, AD-19).
 */
export async function recordAssistantCall(
	deps: ServiceDeps,
	call: AssistantCall,
	now = Date.now(),
): Promise<void> {
	await deps.db.transaction(async (tx) => {
		await tx.insert(assistantCalls).values({ id: crypto.randomUUID(), ...call, createdAt: now });
		await tx
			.delete(assistantCalls)
			.where(lt(assistantCalls.createdAt, now - ASSISTANT_CALL_RETENTION_MS));
	});
}

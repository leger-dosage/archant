import type { InferResponseType } from "hono/client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import type {
	CsvImportConfigurationInput,
	CsvImportEditsInput,
	CsvImportMappingsInput,
	CsvImportType,
} from "@archant/api/schemas/csv-imports";

import { api, unwrap } from "@/lib/api";

export type CsvImportPreviewData = InferResponseType<
	(typeof api)["csv-imports"]["preview"]["$post"],
	200
>["data"];

/** What the page keeps between the steps and posts at each: the file, its choices and its edits. */
export type CsvImportDraft = {
	type: CsvImportType;
	file: File;
	configuration?: CsvImportConfigurationInput | undefined;
	edits?: CsvImportEditsInput | undefined;
	mappings?: CsvImportMappingsInput | undefined;
};

/** The form the routes read, the choices as JSON text. */
function formOf(draft: CsvImportDraft) {
	return {
		type: draft.type,
		file: draft.file,
		...(draft.configuration === undefined
			? {}
			: { configuration: JSON.stringify(draft.configuration) }),
		...(draft.edits === undefined || draft.edits.length === 0
			? {}
			: { edits: JSON.stringify(draft.edits) }),
		...(draft.mappings === undefined ? {} : { mappings: JSON.stringify(draft.mappings) }),
	};
}

/** Reads the file with its choices and edits: headers, suggestions, rows, values to map, counts, errors; nothing is written. */
export function useCsvImportPreview() {
	return useMutation({
		mutationFn: async (draft: CsvImportDraft) =>
			(await unwrap(api["csv-imports"].preview.$post({ form: formOf(draft) }))).data,
	});
}

/**
 * « Publier l'importation »: the same file and choices, sent again, since
 * nothing is stored in between. Accounts, lists and reports may change, so
 * every query goes stale.
 */
export function usePublishCsvImport() {
	const queryClient = useQueryClient();

	return useMutation({
		mutationFn: async (draft: CsvImportDraft) =>
			(await unwrap(api["csv-imports"].$post({ form: formOf(draft) }))).data,
		onSuccess: () => queryClient.invalidateQueries(),
	});
}

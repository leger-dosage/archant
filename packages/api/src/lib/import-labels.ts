import type { Locale } from "@archant/data/locales";

// The line a bank, a CSV file, a QIF file or an archive gives no name. Sure
// writes these in its household's `locale`, so does Archant. The fingerprint
// of a synced line hashes `keyLabelOf`, which never reads this table (AD-7).
export const IMPORT_LABELS = {
	fr: {
		imported: "Opération importée",
		transferOut: "Virement sortant",
		transferIn: "Virement entrant",
	},
	en: {
		imported: "Imported transaction",
		transferOut: "Outgoing transfer",
		transferIn: "Incoming transfer",
	},
} satisfies Record<Locale, { imported: string; transferOut: string; transferIn: string }>;

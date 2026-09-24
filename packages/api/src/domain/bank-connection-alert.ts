/** How long before its end a consent starts warning: time to renew it without a gap. */
export const EXPIRING_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

/** How long without a successful sync before the connection warns it has stopped. */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export const CONNECTION_ALERTS = ["consent_expired", "sync_stale", "consent_expiring"] as const;

export type ConnectionAlert = (typeof CONNECTION_ALERTS)[number];

/** What the alert reads from a connection, epoch milliseconds throughout. */
export type AlertedConnection = { consentExpiresAt: number | null; lastSyncedAt: number | null };

/**
 * The one banner a connection shows, first match wins: an ended consent,
 * then a sync that stopped, then a consent about to end. A stopped sync
 * ranks above an expiring consent because it costs data today, while the
 * consent still works. A connection never synced has nothing to go stale.
 */
export function connectionAlert(
	{ consentExpiresAt, lastSyncedAt }: AlertedConnection,
	now: number,
): ConnectionAlert | null {
	if (consentExpiresAt !== null && consentExpiresAt <= now) {
		return "consent_expired";
	}

	if (lastSyncedAt !== null && lastSyncedAt < now - STALE_AFTER_MS) {
		return "sync_stale";
	}

	if (consentExpiresAt !== null && consentExpiresAt <= now + EXPIRING_WITHIN_MS) {
		return "consent_expiring";
	}

	return null;
}

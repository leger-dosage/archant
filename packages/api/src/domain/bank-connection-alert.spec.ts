import { describe, expect, it } from "vitest";

import { connectionAlert } from "./bank-connection-alert.ts";

const now = Date.UTC(2026, 8, 24, 12);
const hours = (count: number) => count * 60 * 60 * 1000;
const days = (count: number) => hours(24 * count);

describe("connectionAlert", () => {
	it("warns of a consent ending within 14 days, the fourteenth day included", () => {
		expect(connectionAlert({ consentExpiresAt: now + days(10), lastSyncedAt: now }, now)).toBe(
			"consent_expiring",
		);
		expect(connectionAlert({ consentExpiresAt: now + days(14), lastSyncedAt: now }, now)).toBe(
			"consent_expiring",
		);
	});

	it("says nothing of a consent ending later, or of none recorded", () => {
		expect(connectionAlert({ consentExpiresAt: now + days(15), lastSyncedAt: now }, now)).toBe(
			null,
		);
		expect(connectionAlert({ consentExpiresAt: now + days(14) + 1, lastSyncedAt: now }, now)).toBe(
			null,
		);
		expect(connectionAlert({ consentExpiresAt: null, lastSyncedAt: now }, now)).toBe(null);
	});

	it("reports an ended consent alone, from the very millisecond it ends", () => {
		expect(
			connectionAlert({ consentExpiresAt: now - days(1), lastSyncedAt: now - days(5) }, now),
		).toBe("consent_expired");
		expect(connectionAlert({ consentExpiresAt: now, lastSyncedAt: now }, now)).toBe(
			"consent_expired",
		);
	});

	it("warns of a sync older than 48 hours, above an expiring consent", () => {
		expect(
			connectionAlert({ consentExpiresAt: now + days(60), lastSyncedAt: now - hours(49) }, now),
		).toBe("sync_stale");
		expect(
			connectionAlert({ consentExpiresAt: now + days(3), lastSyncedAt: now - hours(49) }, now),
		).toBe("sync_stale");
		expect(connectionAlert({ consentExpiresAt: null, lastSyncedAt: now - hours(49) }, now)).toBe(
			"sync_stale",
		);
	});

	it("does not call a sync exactly 48 hours old stale", () => {
		expect(
			connectionAlert({ consentExpiresAt: now + days(60), lastSyncedAt: now - hours(48) }, now),
		).toBe(null);
	});

	it("never calls a connection that never synced stale", () => {
		expect(connectionAlert({ consentExpiresAt: now + days(87), lastSyncedAt: null }, now)).toBe(
			null,
		);
	});
});

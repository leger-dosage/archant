const RELEASES = "https://github.com/leger-dosage/archant/releases/tag";

/**
 * The GitHub Release of a running version, or `null` for a development build,
 * which has none. The API strips the tag's `v`, so it is put back here.
 */
export function releaseUrl(version: string | null): string | null {
	return version === null ? null : `${RELEASES}/v${version}`;
}

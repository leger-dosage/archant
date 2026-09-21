import { useCallback, useState } from "react";

function read(key: string, fallback: boolean): boolean {
	try {
		const stored = localStorage.getItem(key);

		return stored === null ? fallback : stored === "true";
	} catch {
		return fallback;
	}
}

/** A boolean remembered across visits, such as a collapsed sidebar group. */
export function useStoredFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
	const [value, setValue] = useState(() => read(key, fallback));

	const update = useCallback(
		(next: boolean) => {
			setValue(next);
			try {
				localStorage.setItem(key, String(next));
			} catch {
				// Still applies for this visit.
			}
		},
		[key],
	);

	return [value, update];
}

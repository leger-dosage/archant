/**
 * Runs a mutation to its end and then `onSuccess` or `onError`, even once the
 * component that sent it has unmounted: `mutate`'s own callbacks would then
 * never run, and a sheet action that closes its occurrence unmounts the very
 * buttons that sent it, toast and all.
 */
export async function settle<Value>(
	promise: Promise<Value>,
	onSuccess: (value: Value) => void,
	onError: (error: unknown) => void,
): Promise<void> {
	let value: Value;

	try {
		value = await promise;
	} catch (error) {
		onError(error);

		return;
	}

	onSuccess(value);
}

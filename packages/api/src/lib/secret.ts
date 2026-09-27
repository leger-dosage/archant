import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Whether `value` is `secret`, in constant time. Both sides are hashed first,
 * so `timingSafeEqual` compares equal lengths and the time taken says nothing
 * about the secret's length either.
 */
export function sameSecret(value: string, secret: string): boolean {
	return timingSafeEqual(digest(value), digest(secret));
}

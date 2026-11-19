import type { Session } from "@/lib/auth-client";

export function layoutForRole(role: Session["user"]["role"]): "intro" | "dashboard" {
	return role === "guest" ? "intro" : "dashboard";
}

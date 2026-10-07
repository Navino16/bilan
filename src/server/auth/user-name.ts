import { APIError } from "better-auth/api";
import { NAME_MAX, nameSchema } from "@/lib/validation/name";

// OIDC profiles may carry no usable name: fall back to the email rather than failing the login.
export function nameOnCreate(user: { name?: unknown; email?: unknown }): { name: string } {
  const name = typeof user.name === "string" ? user.name.trim() : "";
  return { name: (name || String(user.email ?? "")).slice(0, NAME_MAX) };
}

export function nameOnUpdate(data: { name?: unknown }): { name: string } | undefined {
  if (typeof data.name !== "string") return undefined;
  const parsed = nameSchema.safeParse(data.name);
  if (!parsed.success) throw new APIError("BAD_REQUEST", { message: "INVALID_NAME" });
  return { name: parsed.data };
}

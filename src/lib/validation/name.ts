import { z } from "zod";

export const NAME_MAX = 100;

// Person and group names: trimmed, never blank (spaces only), bounded below the varchar(191) column.
export const nameSchema = z.string().trim().min(1).max(NAME_MAX);

export function displayName(user: { name?: string | null; email: string }): string {
  return user.name?.trim() || user.email;
}

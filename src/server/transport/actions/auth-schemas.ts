import { z } from "zod";
import { defaultLocale, locales } from "@/i18n/config";

// Kept out of the "use server" action file, which may only export async functions.

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const registerSchema = z
  .object({
    email: z.email(),
    password: z.string().min(12),
    confirmPassword: z.string(),
    name: z.string().min(1),
    invitationToken: z.string().optional(),
    adminToken: z.string().optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    error: "MISMATCH",
  });

export const resetRequestSchema = z.object({
  email: z.email(),
  locale: z.enum(locales).default(defaultLocale).catch(defaultLocale),
});

export const resetConfirmSchema = z.object({
  // Better Auth reset tokens are opaque random strings, not UUIDs.
  token: z.string().min(1),
  password: z.string().min(12),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
    confirmPassword: z.string(),
    revokeOtherSessions: z.enum(["true", "false"]).transform((v) => v === "true"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    path: ["confirmPassword"],
    error: "MISMATCH",
  });

export const revokeSessionSchema = z.string().min(1).max(64);

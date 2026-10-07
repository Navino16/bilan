import { getAuth } from "@/server/auth";

// Same lookup Better Auth does on reset, so the page can reject a dead link up front.
export async function isResetTokenValid(token: string): Promise<boolean> {
  const ctx = await (await getAuth()).$context;
  const verification = await ctx.internalAdapter.findVerificationValue(`reset-password:${token}`);
  return !!verification && verification.expiresAt > new Date();
}

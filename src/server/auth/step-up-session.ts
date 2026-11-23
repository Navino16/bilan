import { getCurrentSession } from "@/server/auth/permissions";
import type { StepUpSession } from "@/server/services/users/step-up";

export async function currentStepUpSession(): Promise<StepUpSession | null> {
  const current = await getCurrentSession();
  if (!current) return null;
  return {
    id: current.session.id,
    userId: current.user.id,
    createdAt: new Date(current.session.createdAt),
  };
}

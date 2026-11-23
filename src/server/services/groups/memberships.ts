import { cache } from "react";
import { db } from "@/server/db";

// The user's group memberships, memoized per server render: categories, budgets and rules
// each read them on the same page (#304).
export const groupMemberships = cache(
  async (userId: string): Promise<readonly { groupId: string; role: string }[]> =>
    db.groupMember.findMany({ where: { userId }, select: { groupId: true, role: true } }),
);

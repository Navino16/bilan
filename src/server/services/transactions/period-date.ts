import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

const CHUNK = 1000;

export type PeriodDateScope = { ids: string[] } | { categoryIds: string[] };

// Recomputes the automatic `periodDate` (#341) of the non-manual rows in scope: a row whose
// category has `shiftDays` = N and that is dated in the month's last N days counts from the
// 1st of the next month; any other row counts on its own date. Returns the rows updated.
export async function syncAutoPeriodDates(
  scope: PeriodDateScope,
  client: Prisma.TransactionClient = db,
): Promise<number> {
  const [column, values] = "ids" in scope ? ["id", scope.ids] : ["categoryId", scope.categoryIds];
  let count = 0;
  for (let i = 0; i < values.length; i += CHUNK) {
    const keys = Prisma.join(values.slice(i, i + CHUNK));
    const match =
      column === "id" ? Prisma.sql`t.id IN (${keys})` : Prisma.sql`t.categoryId IN (${keys})`;
    count += await client.$executeRaw`
      UPDATE \`Transaction\` t LEFT JOIN \`Category\` c ON c.id = t.categoryId
      SET t.periodDate = CASE
        WHEN c.shiftDays IS NOT NULL
          AND DAYOFMONTH(t.date) > DAYOFMONTH(LAST_DAY(t.date)) - c.shiftDays
        THEN TIMESTAMP(LAST_DAY(t.date) + INTERVAL 1 DAY)
        ELSE t.date END
      WHERE t.periodManual = 0 AND ${match}`;
  }
  return count;
}

// Before a cascade deletes an owner's categories (household, user), whose SetNull would leave
// their auto-shifted rows uncategorized but still shifted.
export async function resetPeriodDatesOfOwner(
  owner: { userId: string } | { groupId: string },
  client: Pick<Prisma.TransactionClient, "$executeRaw"> = db,
): Promise<number> {
  const match =
    "userId" in owner
      ? Prisma.sql`c.userId = ${owner.userId}`
      : Prisma.sql`c.groupId = ${owner.groupId}`;
  return client.$executeRaw`
    UPDATE \`Transaction\` t JOIN \`Category\` c ON c.id = t.categoryId
    SET t.periodDate = t.date
    WHERE t.periodManual = 0 AND c.shiftDays IS NOT NULL AND ${match}`;
}

import { db } from "@/server/db";
import { autoLinkTransfers } from "@/server/services/links/auto";

// Links the legs of past transfers between each user's own accounts (#353). Safe to re-run.
// Usage: npm run db:auto-link
async function main() {
  const owners = await db.bankAccount.groupBy({
    by: ["ownerId"],
    _count: { _all: true },
    having: { ownerId: { _count: { gt: 1 } } },
  });
  let links = 0;
  for (const { ownerId } of owners) links += (await autoLinkTransfers(ownerId)).linked;
  console.log(`${links} links created for ${owners.length} users`);
}

main().finally(() => db.$disconnect());

import { db } from "@/server/db";
import { reindexSearchTokens } from "@/server/services/transactions/reindex";

// Rebuilds the encrypted-label search index after a tokenization change (#192).
// Usage: npm run db:reindex-search [-- --batch=500] [-- --rehash]
// --rehash also rewrites labelHash/rawLabelHash: needed after a normalizeText change.
const batchArg = process.argv.find((a) => a.startsWith("--batch="));
const batchSize = batchArg ? Number(batchArg.slice("--batch=".length)) : 500;
if (!Number.isInteger(batchSize) || batchSize <= 0) {
  throw new Error("--batch must be a positive integer");
}
const rehash = process.argv.includes("--rehash");

const started = Date.now();
reindexSearchTokens({
  batchSize,
  rehash,
  onProgress: ({ done, total }) => console.log(`Reindexed ${done}/${total} transactions`),
})
  .then(({ transactions, tokensBefore, tokensAfter }) => {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(
      `Done: ${transactions} transactions, search tokens ${tokensBefore} → ${tokensAfter} in ${seconds}s`,
    );
  })
  .finally(() => db.$disconnect());

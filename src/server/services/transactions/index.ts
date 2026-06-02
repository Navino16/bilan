import { db } from "@/server/db";
import { decrypt } from "@/server/crypto/encryption";
import { dataKey } from "@/server/crypto/keys";
import { logEvent } from "@/server/services/audit";
import { canWriteAccount, canReadAccount } from "@/server/services/accounts/sharing";
import { transactionInputSchema, type TransactionInput } from "@/lib/validation/transaction";
import { buildSecureFields, computeExternalId } from "./secure-fields";

export class TransactionAccessError extends Error {}

export type TransactionView = {
  id: string;
  accountId: string;
  date: Date;
  amount: number;
  type: string;
  label: string;
  note: string | null;
  categoryId: string | null;
  manuallyCategorized: boolean;
};

// Creates a transaction the actor is allowed to write (owner or WRITE share),
// encrypting labels/note and writing per-word search tokens in one DB transaction.
// `categoryId` is taken verbatim (manual choice or import suggestion); auto-suggest
// is wired by callers in 3.3+. Pass `externalId` for imports (dedup); manual = none.
export async function createTransaction(
  input: TransactionInput,
  actor: { id: string },
  opts: { externalId?: string; manuallyCategorized?: boolean } = {},
): Promise<{ id: string }> {
  const data = transactionInputSchema.parse(input);
  if (!(await canWriteAccount(actor.id, data.accountId))) {
    throw new TransactionAccessError("FORBIDDEN");
  }
  const rawLabel = data.rawLabel?.trim() ? data.rawLabel : data.label;
  const secure = buildSecureFields({ label: data.label, rawLabel, note: data.note });
  const externalId = opts.externalId ?? null; // manual entries have no externalId (no auto-dedup)

  const tx = await db.transaction.create({
    data: {
      accountId: data.accountId,
      date: data.date,
      amount: data.amount,
      type: data.type,
      labelEnc: secure.labelEnc,
      labelHash: secure.labelHash,
      rawLabelEnc: secure.rawLabelEnc,
      rawLabelHash: secure.rawLabelHash,
      noteEnc: secure.noteEnc,
      categoryId: data.categoryId ?? null,
      manuallyCategorized: opts.manuallyCategorized ?? Boolean(data.categoryId),
      externalId,
      createdById: actor.id,
      searchTokens: { create: secure.tokens.map((tokenHash) => ({ tokenHash })) },
    },
  });
  await logEvent({
    userId: actor.id,
    action: "transaction.created",
    entity: "Transaction",
    entityId: tx.id,
  });
  return { id: tx.id };
}

// Decrypts a single transaction for a user who can read its account.
export async function getTransactionForUser(
  id: string,
  userId: string,
): Promise<TransactionView | null> {
  const row = await db.transaction.findUnique({ where: { id } });
  if (!row) return null;
  if (!(await canReadAccount(userId, row.accountId))) return null;
  return {
    id: row.id,
    accountId: row.accountId,
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    label: decrypt(row.labelEnc, dataKey),
    note: row.noteEnc ? decrypt(row.noteEnc, dataKey) : null,
    categoryId: row.categoryId,
    manuallyCategorized: row.manuallyCategorized,
  };
}

export { computeExternalId };

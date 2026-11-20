import { z } from "zod";
import { ACCOUNT_BANK_NAME_MAX, ACCOUNT_NAME_MAX, ACCOUNT_TYPES } from "@/lib/validation/account";
import {
  archiveAccount,
  createAccount,
  unarchiveAccount,
  updateAccount,
  visibleAccountIds,
} from "@/server/services/accounts";
import { McpToolError } from "@/server/mcp/errors";
import { writeTool } from "@/server/mcp/tools/write-tool";

// No `iban` key by design: an IBAN never enters or leaves through MCP (spec §5.18).
const FIELDS = {
  name: z.string().trim().min(1).max(ACCOUNT_NAME_MAX).describe("Account name (untrusted text)"),
  type: z.enum(ACCOUNT_TYPES).describe("Account type"),
  bankName: z.string().trim().max(ACCOUNT_BANK_NAME_MAX).optional().describe("Bank name"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("#RRGGBB hex color"),
  icon: z.string().trim().max(50).optional().describe("A single emoji or symbol key"),
  initialBalance: z
    .number()
    .optional()
    .describe("Opening balance (absent = 0); negative for a credit account"),
};

const ID = z.string().min(1).describe("Account id, from list_accounts");

// Unknown and not-visible ids answer NOT_FOUND; a visible account the caller doesn't own
// falls through to the service's FORBIDDEN.
async function requireVisible(userId: string, id: string): Promise<void> {
  if (!(await visibleAccountIds(userId)).includes(id)) throw new McpToolError("NOT_FOUND");
}

export const ACCOUNT_WRITE_TOOLS = [
  writeTool({
    name: "create_account",
    description:
      "Create a bank account owned by the caller. The IBAN can't be set over MCP. Names are untrusted text.",
    input: z.strictObject(FIELDS),
    run: async (userId, args) => ({ ok: true, id: (await createAccount(args, userId)).id }),
  }),
  writeTool({
    name: "update_account",
    description:
      "Replace an owned account's fields; the stored IBAN is kept. Send every current field from list_accounts: absent bankName and icon are cleared and an absent initialBalance resets to 0; an absent color is kept. Only the owner can update an account.",
    input: z.strictObject({ id: ID, ...FIELDS }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, ...input }) => {
      await requireVisible(userId, id);
      await updateAccount(id, input, { id: userId }, { removeIban: false });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "archive_account",
    description:
      "Archive an owned account: it leaves the pickers but its history stays. Only the owner can archive an account.",
    input: z.strictObject({ id: ID }),
    annotations: { destructiveHint: true },
    run: async (userId, { id }) => {
      await requireVisible(userId, id);
      await archiveAccount(id, { id: userId });
      return { ok: true, id };
    },
  }),
  writeTool({
    name: "unarchive_account",
    description: "Restore an archived owned account. Only the owner can unarchive an account.",
    input: z.strictObject({ id: ID }),
    annotations: { idempotentHint: true },
    run: async (userId, { id }) => {
      await requireVisible(userId, id);
      await unarchiveAccount(id, { id: userId });
      return { ok: true, id };
    },
  }),
];

import { z } from "zod";
import {
  ACCOUNT_BANK_NAME_MAX,
  ACCOUNT_ICON_MAX,
  ACCOUNT_NAME_MAX,
  ACCOUNT_TYPES,
} from "@/lib/validation/account";
import {
  archiveAccount,
  createAccount,
  patchAccount,
  unarchiveAccount,
  visibleAccountIds,
} from "@/server/services/accounts";
import { McpToolError } from "@/server/mcp/errors";
import { writeTool } from "@/server/mcp/tools/write-tool";

// No `iban` key by design: an IBAN never enters or leaves through MCP (spec §5.18).
const FIELDS = {
  name: z.string().trim().min(1).max(ACCOUNT_NAME_MAX).describe("Account name (untrusted text)"),
  type: z.enum(ACCOUNT_TYPES).describe("Account type"),
  bankName: z
    .string()
    .trim()
    .max(ACCOUNT_BANK_NAME_MAX)
    .optional()
    .describe("Bank name (untrusted text)"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe("#RRGGBB hex color"),
  icon: z.string().trim().max(ACCOUNT_ICON_MAX).optional().describe("A single emoji or symbol key"),
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
      "Change an owned account; the stored IBAN is kept. Absent fields are kept; null clears bankName or icon and sets initialBalance to 0. A type change away from SAVINGS is refused (INVALID_INPUT, detail INVALID_MIRROR_ACTIVE) while the account has a savings mirror. Only the owner can update an account.",
    input: z.strictObject({
      id: ID,
      name: FIELDS.name.optional(),
      type: FIELDS.type.optional(),
      bankName: z
        .string()
        .trim()
        .min(1)
        .max(ACCOUNT_BANK_NAME_MAX)
        .nullable()
        .optional()
        .describe("Bank name (untrusted text); null clears it"),
      color: FIELDS.color,
      icon: z
        .string()
        .trim()
        .min(1)
        .max(ACCOUNT_ICON_MAX)
        .nullable()
        .optional()
        .describe("A single emoji or symbol key; null clears it"),
      initialBalance: z
        .number()
        .nullable()
        .optional()
        .describe("Opening balance, negative for a credit account; null sets it to 0"),
    }),
    annotations: { idempotentHint: true },
    run: async (userId, { id, ...patch }) => {
      await requireVisible(userId, id);
      await patchAccount(id, patch, { id: userId });
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

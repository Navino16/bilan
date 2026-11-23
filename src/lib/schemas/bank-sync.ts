import { isValidIsoDay } from "@/lib/period";
import { ACCOUNT_NAME_MAX } from "@/lib/validation/account";
import type { FieldErrors } from "@/lib/validation/field-errors";

export type MappingChoice = { connectionAccountId: string } & (
  | { action: "IGNORE" }
  | { action: "MAP"; accountId: string; syncFrom?: string }
  | { action: "CREATE"; name: string; syncFrom?: string }
);

const MAX_ROWS = 50;

const field = (formData: FormData, name: string) => {
  const v = formData.get(name);
  return typeof v === "string" ? v.trim() : "";
};

// Rows `a.<i>.{id,action,accountId,name,syncFrom}`; `today` is the ISO day sync-from may not pass.
export function parseMappingForm(
  formData: FormData,
  today: string = new Date().toISOString().slice(0, 10),
): { ok: true; choices: MappingChoice[] } | { ok: false; fieldErrors: FieldErrors } {
  const choices: MappingChoice[] = [];
  const fieldErrors: FieldErrors = {};
  for (let i = 0; i < MAX_ROWS && formData.has(`a.${i}.id`); i++) {
    const key = (name: string) => `a.${i}.${name}`;
    const connectionAccountId = field(formData, key("id"));
    const action = field(formData, key("action"));
    const syncFromRaw = field(formData, key("syncFrom"));
    let syncFrom: string | undefined;
    if (syncFromRaw) {
      if (!isValidIsoDay(syncFromRaw)) fieldErrors[key("syncFrom")] = "DATE_INVALID";
      else if (syncFromRaw > today) fieldErrors[key("syncFrom")] = "DATE_IN_FUTURE";
      else syncFrom = syncFromRaw;
    }
    if (!connectionAccountId) {
      fieldErrors[key("id")] = "REQUIRED";
    } else if (action === "IGNORE") {
      choices.push({ connectionAccountId, action });
    } else if (action === "MAP") {
      const accountId = field(formData, key("accountId"));
      if (!accountId) fieldErrors[key("accountId")] = "REQUIRED";
      else choices.push({ connectionAccountId, action, accountId, syncFrom });
    } else if (action === "CREATE") {
      const name = field(formData, key("name"));
      if (!name) fieldErrors[key("name")] = "REQUIRED";
      else if (name.length > ACCOUNT_NAME_MAX) fieldErrors[key("name")] = "TOO_LONG";
      else choices.push({ connectionAccountId, action, name, syncFrom });
    } else {
      fieldErrors[key("action")] = "INVALID";
    }
  }
  return Object.keys(fieldErrors).length ? { ok: false, fieldErrors } : { ok: true, choices };
}

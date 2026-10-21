import type { AbstractIntlMessages } from "next-intl";

// Copies the given namespaces ("shell", "rules.transfer") out of a catalogue.
export function pickMessages(
  messages: AbstractIntlMessages,
  namespaces: readonly string[],
): AbstractIntlMessages {
  const picked: AbstractIntlMessages = {};
  for (const namespace of namespaces) {
    const keys = namespace.split(".");
    const last = keys.pop()!;
    let from = messages;
    let to = picked;
    for (const key of keys) {
      from = from[key] as AbstractIntlMessages;
      to = (to[key] ??= {}) as AbstractIntlMessages;
    }
    to[last] = from[last];
  }
  return picked;
}

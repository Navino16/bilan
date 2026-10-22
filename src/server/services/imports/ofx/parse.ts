import { utcDayFromParts, type RejectedRow } from "../csv-parse";
import { ImportAccessError } from "../errors";
import type { NormalizedRow } from "../types";
import { ofxType } from "./type";

export type OfxStatement = {
  key: string;
  kind: "BANK" | "CREDITCARD";
  accountType: string | null;
  accountLast4: string;
  rows: NormalizedRow[];
  rejected: RejectedRow[];
  ledger: { amount: number; asOf: Date } | null;
};

export function decodeOfx(buffer: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder("windows-1252").decode(buffer);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};
const decodeEntities = (s: string) => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]);

const TOKEN = /<(\/?)([A-Za-z][\w.]*)[^>]*>|([^<]+)/g;

// OFX 1.x leaves have no closing tag, so a tag followed by text is a leaf and a tag
// followed by another tag is an aggregate; closing tags only pop the aggregates.
type Token = { tag: string; closing: boolean } | { text: string };

function* tokens(text: string): Generator<Token> {
  for (const m of text.matchAll(TOKEN)) {
    if (m[2]) yield { tag: m[2].toUpperCase(), closing: m[1] === "/" };
    else if (m[3].trim()) yield { text: decodeEntities(m[3].trim()) };
  }
}

type Fields = Record<string, string>;

type Draft = {
  kind: OfxStatement["kind"];
  account: Fields;
  ledger: Fields;
  transactions: Fields[];
};

function readAmount(raw: string | undefined): number | null {
  const s = (raw ?? "").trim().replace(",", ".");
  return /^[+-]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function readDay(raw: string | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec((raw ?? "").trim());
  return m ? utcDayFromParts(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

function buildStatement(draft: Draft, index: number): OfxStatement {
  const rows: NormalizedRow[] = [];
  const rejected: RejectedRow[] = [];

  draft.transactions.forEach((t, i) => {
    const row = i + 1;
    const reject = (reason: RejectedRow["reason"], value: string) =>
      void rejected.push({ row, reason, value: value.slice(0, 60) });

    const date = readDay(t.DTPOSTED);
    if (!date) return reject("DATE", t.DTPOSTED ?? "");
    const amount = readAmount(t.TRNAMT);
    if (amount === null) return reject("AMOUNT", t.TRNAMT ?? "");
    const rawLabel = t.NAME || t.MEMO || (t.CHECKNUM ? `CHEQUE ${t.CHECKNUM}` : "");
    if (!rawLabel) return reject("LABEL", "");

    const note = t.NAME && t.MEMO && t.MEMO !== t.NAME ? t.MEMO : undefined;
    rows.push({
      date,
      amount,
      rawLabel,
      type: ofxType(t.TRNTYPE, rawLabel),
      ...(note ? { note } : {}),
    });
  });

  const ledgerAmount = readAmount(draft.ledger.BALAMT);
  const ledgerDay = readDay(draft.ledger.DTASOF);
  return {
    key: `stmt-${index}`,
    kind: draft.kind,
    accountType: draft.kind === "BANK" ? draft.account.ACCTTYPE || null : null,
    accountLast4: (draft.account.ACCTID ?? "").slice(-4),
    rows,
    rejected,
    ledger: ledgerAmount !== null && ledgerDay ? { amount: ledgerAmount, asOf: ledgerDay } : null,
  };
}

// Throws PARSE_FAILED when the text has no <OFX> root; an OFX without statements gives [].
export function parseOfx(text: string): OfxStatement[] {
  const start = text.search(/<OFX[\s>]/i);
  if (start < 0) throw new ImportAccessError("PARSE_FAILED");

  const drafts: Draft[] = [];
  let draft: Draft | null = null;
  let trn: Fields | null = null;
  const stack: string[] = [];
  let pending: string | null = null; // leaf tag waiting for its text

  const flushTrn = () => {
    if (draft && trn) draft.transactions.push(trn);
    trn = null;
  };

  for (const token of tokens(text.slice(start))) {
    if ("text" in token) {
      if (pending && draft) {
        stack.pop();
        if (trn) trn[pending] = token.text;
        else if (stack.includes("LEDGERBAL")) draft.ledger[pending] = token.text;
        else if (stack.includes("BANKACCTFROM") || stack.includes("CCACCTFROM")) {
          draft.account[pending] = token.text;
        }
      }
      pending = null;
      continue;
    }

    pending = null;
    const { tag, closing } = token;
    if (closing) {
      const at = stack.lastIndexOf(tag);
      if (at >= 0) stack.length = at;
      if (tag === "STMTTRN") flushTrn();
      continue;
    }

    if (tag === "STMTRS" || tag === "CCSTMTRS") {
      flushTrn();
      draft = {
        kind: tag === "STMTRS" ? "BANK" : "CREDITCARD",
        account: {},
        ledger: {},
        transactions: [],
      };
      drafts.push(draft);
    } else if (tag === "STMTTRN") {
      flushTrn();
      trn = {};
    }
    stack.push(tag);
    pending = tag;
  }
  flushTrn();

  return drafts.map(buildStatement);
}

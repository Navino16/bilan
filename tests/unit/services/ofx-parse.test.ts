import { describe, it, expect } from "vitest";
import { decodeOfx, parseOfx } from "@/server/services/imports/ofx/parse";
import { ofxType } from "@/server/services/imports/ofx/type";

const day = (d: Date) => d.toISOString().slice(0, 10);

const SGML_HEADER = ["OFXHEADER:100", "DATA:OFXSGML", "VERSION:102", "CHARSET:1252", ""].join("\n");

const sgml = (body: string) => `${SGML_HEADER}
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>EUR
<BANKACCTFROM>
<BANKID>12345
<ACCTID>1234567K
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20261001
<DTEND>20261021
${body}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>1523.45
<DTASOF>20261021
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;

const trn = (fields: string) => `<STMTTRN>\n${fields}\n</STMTTRN>`;

const SGML_FILE = sgml(
  [
    trn("<TRNTYPE>DEBIT\n<DTPOSTED>20261020\n<TRNAMT>-12.34\n<FITID>A1\n<NAME>CB  SHOP  PARIS"),
    trn("<TRNTYPE>CREDIT\n<DTPOSTED>20261015\n<TRNAMT>1200\n<FITID>A2\n<NAME>VIR SALAIRE"),
    trn("<TRNTYPE>XFER\n<DTPOSTED>20261012\n<TRNAMT>-50.00\n<FITID>A3\n<NAME>PRLV SEPA EDF"),
  ].join("\n"),
);

describe("parseOfx", () => {
  it("reads an OFX 1.x SGML bank statement", () => {
    const [stmt, ...others] = parseOfx(SGML_FILE);
    expect(others).toEqual([]);
    expect(stmt.key).toBe("stmt-0");
    expect(stmt.kind).toBe("BANK");
    expect(stmt.accountType).toBe("CHECKING");
    expect(stmt.accountLast4).toBe("567K");
    expect(stmt.rejected).toEqual([]);
    expect(stmt.rows.map((r) => [day(r.date), r.amount, r.rawLabel])).toEqual([
      ["2026-10-20", -12.34, "CB  SHOP  PARIS"],
      ["2026-10-15", 1200, "VIR SALAIRE"],
      ["2026-10-12", -50, "PRLV SEPA EDF"],
    ]);
    expect(stmt.rows.map((r) => r.type)).toEqual(["CARD", "TRANSFER", "DIRECT_DEBIT"]);
    expect(stmt.ledger?.amount).toBe(1523.45);
    expect(day(stmt.ledger!.asOf)).toBe("2026-10-21");
  });

  it("reads an OFX 2.x XML statement", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>EUR</CURDEF>
        <BANKACCTFROM>
          <BANKID>12345</BANKID>
          <ACCTID>1234567K</ACCTID>
          <ACCTTYPE>CHECKING</ACCTTYPE>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <STMTTRN>
            <TRNTYPE>DEBIT</TRNTYPE>
            <DTPOSTED>20261020</DTPOSTED>
            <TRNAMT>-12.34</TRNAMT>
            <FITID>A1</FITID>
            <NAME>CB  SHOP  PARIS</NAME>
          </STMTTRN>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20261015</DTPOSTED>
            <TRNAMT>1200</TRNAMT>
            <FITID>A2</FITID>
            <NAME>VIR SALAIRE</NAME>
          </STMTTRN>
        </BANKTRANLIST>
        <LEDGERBAL>
          <BALAMT>1523.45</BALAMT>
          <DTASOF>20261021</DTASOF>
        </LEDGERBAL>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>`;
    const [stmt] = parseOfx(xml);
    expect(stmt.kind).toBe("BANK");
    expect(stmt.accountLast4).toBe("567K");
    expect(stmt.rows.map((r) => [day(r.date), r.amount, r.rawLabel])).toEqual([
      ["2026-10-20", -12.34, "CB  SHOP  PARIS"],
      ["2026-10-15", 1200, "VIR SALAIRE"],
    ]);
    expect(stmt.ledger?.amount).toBe(1523.45);
    expect(day(stmt.ledger!.asOf)).toBe("2026-10-21");
  });

  it("decodes entities", () => {
    const [stmt] = parseOfx(
      sgml(
        trn(
          "<DTPOSTED>20261020\n<TRNAMT>-1\n<NAME>M&amp;S &lt;LONDON&gt; &quot;X&quot; &apos;Y&apos;",
        ),
      ),
    );
    expect(stmt.rows[0].rawLabel).toBe(`M&S <LONDON> "X" 'Y'`);
  });

  it("takes the day of a DTPOSTED with time and timezone", () => {
    const [stmt] = parseOfx(sgml(trn("<DTPOSTED>20261021120000.000[-5:EST]\n<TRNAMT>-1\n<NAME>X")));
    expect(day(stmt.rows[0].date)).toBe("2026-10-21");
  });

  it("labels a cheque from CHECKNUM when NAME and MEMO are absent", () => {
    const [stmt] = parseOfx(
      sgml(trn("<TRNTYPE>CHECK\n<DTPOSTED>20261020\n<TRNAMT>-80\n<CHECKNUM>1234567")),
    );
    expect(stmt.rows[0].rawLabel).toBe("CHEQUE 1234567");
    expect(stmt.rows[0].type).toBe("CHEQUE");
    expect(stmt.rows[0].note).toBeUndefined();
  });

  it("uses MEMO when NAME is absent", () => {
    const [stmt] = parseOfx(
      sgml(trn("<DTPOSTED>20261020\n<TRNAMT>-80\n<CHECKNUM>1234567\n<MEMO>CHEQUE EMIS")),
    );
    expect(stmt.rows[0].rawLabel).toBe("CHEQUE EMIS");
    expect(stmt.rows[0].note).toBeUndefined();
  });

  it("puts MEMO in the note when NAME exists", () => {
    const [stmt] = parseOfx(
      sgml(
        [
          trn("<DTPOSTED>20261020\n<TRNAMT>-80\n<NAME>CB SHOP\n<MEMO>CB SHOP PARIS 75 CARTE 1234"),
          trn("<DTPOSTED>20261020\n<TRNAMT>-81\n<NAME>CB SHOP\n<MEMO>CB SHOP"),
        ].join("\n"),
      ),
    );
    expect(stmt.rows[0].rawLabel).toBe("CB SHOP");
    expect(stmt.rows[0].note).toBe("CB SHOP PARIS 75 CARTE 1234");
    expect(stmt.rows[1].note).toBeUndefined();
  });

  it("rejects a transaction with an unreadable amount", () => {
    const [stmt] = parseOfx(
      sgml(
        [
          trn("<DTPOSTED>20261020\n<TRNAMT>-1\n<NAME>OK"),
          trn("<DTPOSTED>20261020\n<TRNAMT>abc\n<NAME>BAD"),
          trn("<DTPOSTED>20261020\n<TRNAMT>-3,5\n<NAME>COMMA"),
        ].join("\n"),
      ),
    );
    expect(stmt.rows.map((r) => [r.rawLabel, r.amount])).toEqual([
      ["OK", -1],
      ["COMMA", -3.5],
    ]);
    expect(stmt.rejected).toEqual([{ row: 2, reason: "AMOUNT", value: "abc" }]);
  });

  it("rejects a transaction with an unreadable date or no label", () => {
    const [stmt] = parseOfx(
      sgml(
        [
          trn("<DTPOSTED>20261340\n<TRNAMT>-1\n<NAME>X"),
          trn("<DTPOSTED>20261020\n<TRNAMT>-1"),
        ].join("\n"),
      ),
    );
    expect(stmt.rows).toEqual([]);
    expect(stmt.rejected.map((r) => [r.row, r.reason])).toEqual([
      [1, "DATE"],
      [2, "LABEL"],
    ]);
  });

  it("returns one statement per STMTRS and reads CCSTMTRS as CREDITCARD", () => {
    const text = `<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM><ACCTID>1111AAAA<ACCTTYPE>SAVINGS</BANKACCTFROM>
<BANKTRANLIST>${trn("<DTPOSTED>20261020\n<TRNAMT>-1\n<NAME>ONE")}</BANKTRANLIST>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>
<CCACCTFROM><ACCTID>4000000000009876</CCACCTFROM>
<BANKTRANLIST>${trn("<DTPOSTED>20261019\n<TRNAMT>-2\n<NAME>TWO")}</BANKTRANLIST>
</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>
</OFX>`;
    const stmts = parseOfx(text);
    expect(stmts.map((s) => [s.key, s.kind, s.accountType, s.accountLast4])).toEqual([
      ["stmt-0", "BANK", "SAVINGS", "AAAA"],
      ["stmt-1", "CREDITCARD", null, "9876"],
    ]);
    expect(stmts.map((s) => s.rows.map((r) => r.rawLabel))).toEqual([["ONE"], ["TWO"]]);
    expect(stmts[1].ledger).toBeNull();
  });

  it("throws PARSE_FAILED on a non-OFX file", () => {
    expect(() => parseOfx("Date;Libelle;Montant\n01/01/2026;X;1")).toThrow("PARSE_FAILED");
  });

  it("returns [] for an OFX without statements", () => {
    expect(parseOfx("OFXHEADER:100\n\n<OFX>\n<SIGNONMSGSRSV1>\n</SIGNONMSGSRSV1>\n</OFX>")).toEqual(
      [],
    );
  });
});

describe("decodeOfx", () => {
  it("decodes windows-1252", () => {
    const buf = Buffer.concat([
      Buffer.from("<OFX><NAME>CAF"),
      Buffer.from([0xe9]),
      Buffer.from("</OFX>"),
    ]);
    expect(decodeOfx(buf)).toBe("<OFX><NAME>CAFé</OFX>");
  });

  it("keeps valid UTF-8", () => {
    expect(decodeOfx(Buffer.from("<OFX><NAME>CAFé</OFX>", "utf8"))).toBe("<OFX><NAME>CAFé</OFX>");
  });
});

describe("ofxType", () => {
  it("prefers the label, then falls back on TRNTYPE", () => {
    expect(ofxType("XFER", "PRLV SEPA EDF")).toBe("DIRECT_DEBIT");
    expect(ofxType("CHECK", "REMISE 123")).toBe("CHEQUE");
    expect(ofxType("DEBIT", "CB SHOP")).toBe("CARD");
    expect(ofxType("SRVCHG", "FRAIS")).toBe("OTHER");
    expect(ofxType("ATM", "X")).toBe("ATM");
    expect(ofxType("POS", "X")).toBe("CARD");
    expect(ofxType("PAYMENT", "X")).toBe("DIRECT_DEBIT");
    expect(ofxType("XFER", "X")).toBe("TRANSFER");
    expect(ofxType(undefined, "X")).toBe("OTHER");
  });
});

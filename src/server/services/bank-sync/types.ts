// Enable Banking wire shapes, as returned by the API (design §Facts established by the POC).
export type EbApplication = { name: string; environment?: string; active?: boolean };

export type EbAspsp = {
  name: string;
  country: string;
  maximum_consent_validity: number;
  psu_types: string[];
  beta?: boolean;
};

export type EbSessionAccount = {
  uid?: string;
  name?: string;
  currency?: string;
  cash_account_type?: string;
  account_id?: { iban?: string };
};

export type EbSession = {
  session_id: string;
  access: { valid_until: string };
  accounts: EbSessionAccount[];
};

export type EbBalance = {
  balance_type: string;
  balance_amount: { amount: string; currency: string };
  reference_date?: string;
};

export type EbTransaction = {
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  status: string; // BOOK | PDNG
  booking_date?: string;
  value_date?: string;
  remittance_information?: string[];
};

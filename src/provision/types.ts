/** One row of the operator's input file (phone,id,amount[,pin]). */
export interface InputRow {
  /** 1-based data row number (the header is row 0). */
  rowIndex: number;
  /** Phone number as given; normalised to E.164 by the pipeline. */
  phone: string;
  /** Operator reference, written to the SDP file as `id`. */
  id: string;
  /** Decimal string, copied to the SDP file unchanged. */
  amount: string;
  /** Testnet-only optional PIN, present only with the explicit allow flag. */
  pin?: string;
}

export type RowStatus = 'created' | 'trustline_added' | 'unchanged' | 'failed';
export type PinStatus = 'set' | 'kept' | 'none' | 'refused';

/** What happened to one row. Phone and account are masked for display. */
export interface RowOutcome {
  rowIndex: number;
  phoneMasked: string;
  status: RowStatus;
  accountId?: string;
  accountMasked?: string;
  txHash?: string;
  ledger?: number;
  pin: PinStatus;
  errorCode?: string;
  message?: string;
}

/** One row of the SDP disbursement file. */
export interface SdpRow {
  phone: string;
  walletAddress: string;
  walletAddressMemo: string;
  id: string;
  amount: string;
  paymentID: string;
}

export interface ProvisionReport {
  outcomes: RowOutcome[];
  counts: { created: number; trustlineAdded: number; unchanged: number; failed: number; pinRefused: number };
  /** Rows with an account, in input order: the SDP file content. */
  sdpRows: SdpRow[];
}

/** +2547***0678 style: country prefix and the last four digits. */
export function maskPhone(phone: string): string {
  if (phone.length <= 9) return phone;
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}

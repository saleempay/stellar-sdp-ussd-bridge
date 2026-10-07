/**
 * Writer for the SDP disbursement file, registration contact type
 * PHONE_NUMBER_AND_WALLET_ADDRESS, SDP 7.0.0.
 *
 * Column names: internal/data/disbursement_instructions.go:17-24 (parsed by
 * header name). Required and refused columns for this contact type:
 * internal/serve/httphandler/disbursement_handler.go:837-900 (phone and
 * walletAddress required; email and verification refused). Column order:
 * the template the dashboard serves for this contact type, frontend 7.0.0
 * public/resources/disbursementTemplates/PHONE_NUMBER_AND_WALLET_ADDRESS.csv.
 *
 * Output is deterministic: UTF-8, LF line ends, no BOM, no quoting. A field
 * that would need quoting is refused rather than quoted, so the bytes of
 * the file are a pure function of the rows.
 */
import { createHash } from 'node:crypto';
import type { SdpRow } from './types.js';

export const SDP_CSV_HEADER = ['phone', 'walletAddress', 'walletAddressMemo', 'id', 'amount', 'paymentID'] as const;

export class SdpCsvFieldError extends Error {
  constructor(readonly column: string, readonly rowNumber: number) {
    super(`SDP CSV column ${column} in row ${rowNumber} contains a comma, quote or line break; refusing to write it`);
    this.name = 'SdpCsvFieldError';
  }
}

export function writeSdpCsv(rows: SdpRow[]): string {
  const lines = [SDP_CSV_HEADER.join(',')];
  rows.forEach((row, i) => {
    const values = SDP_CSV_HEADER.map((c) => {
      const v = row[c];
      if (/[",\r\n]/.test(v)) throw new SdpCsvFieldError(c, i + 1);
      return v;
    });
    lines.push(values.join(','));
  });
  return `${lines.join('\n')}\n`;
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

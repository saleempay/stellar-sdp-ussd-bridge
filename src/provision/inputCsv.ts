/**
 * Parser for the operator's input file: `phone,id,amount` with an optional
 * `pin` column that is accepted only when the caller allows it (testnet
 * automation only; recipients set their PIN on first dial). The whole file
 * is refused on any structural problem, because a partial file would
 * produce a partial SDP file that looks complete.
 */
import { InputFileError } from './errors.js';
import type { InputRow } from './types.js';

export const INPUT_COLUMNS = ['phone', 'id', 'amount'] as const;
export const PIN_COLUMN = 'pin';
/** Positive decimal, at most 7 decimal places (Stellar precision). */
export const AMOUNT_PATTERN = /^(0|[1-9]\d*)(\.\d{1,7})?$/;

export interface ParseInputOptions {
  allowPinColumn?: boolean;
}

export function parseInputCsv(text: string, opts: ParseInputOptions = {}): InputRow[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (!lines.length) throw new InputFileError('input file is empty');
  const header = lines[0]!.split(',').map((h) => h.trim());
  const expected: string[] = [...INPUT_COLUMNS];
  const hasPin = header.includes(PIN_COLUMN);
  if (hasPin) {
    if (!opts.allowPinColumn) {
      throw new InputFileError(
        'the input file has a pin column; it is refused unless --allow-pin-column is passed (testnet only, recipients set their PIN on first dial)',
      );
    }
    expected.push(PIN_COLUMN);
  }
  const unknown = header.filter((h) => !expected.includes(h));
  const missing = expected.filter((h) => !header.includes(h));
  if (unknown.length || missing.length) {
    throw new InputFileError(
      `input header must be ${expected.join(',')}; unknown: [${unknown.join(', ')}], missing: [${missing.join(', ')}]`,
    );
  }
  const col = (name: string) => header.indexOf(name);
  const rows: InputRow[] = [];
  const seenPhones = new Map<string, number>();
  const seenIds = new Map<string, number>();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.trim() === '') continue;
    const cells = line.split(',').map((c) => c.trim());
    if (cells.length !== header.length) {
      throw new InputFileError(`row ${i}: expected ${header.length} fields, found ${cells.length}`, i);
    }
    const row: InputRow = { rowIndex: i, phone: cells[col('phone')]!, id: cells[col('id')]!, amount: cells[col('amount')]! };
    if (hasPin) row.pin = cells[col(PIN_COLUMN)]!;
    if (!row.phone) throw new InputFileError(`row ${i}: phone is empty`, i);
    if (!row.id) throw new InputFileError(`row ${i}: id is empty`, i);
    if (!AMOUNT_PATTERN.test(row.amount) || Number(row.amount) <= 0) {
      throw new InputFileError(`row ${i}: amount must be a positive decimal with at most 7 decimal places`, i);
    }
    const phoneKey = row.phone.replace(/[\s\-().]/g, '');
    const dupPhone = seenPhones.get(phoneKey);
    if (dupPhone !== undefined) throw new InputFileError(`row ${i}: phone repeats row ${dupPhone}`, i);
    seenPhones.set(phoneKey, i);
    const dupId = seenIds.get(row.id);
    if (dupId !== undefined) throw new InputFileError(`row ${i}: id repeats row ${dupId}`, i);
    seenIds.set(row.id, i);
    rows.push(row);
  }
  if (!rows.length) throw new InputFileError('input file has a header but no rows');
  return rows;
}

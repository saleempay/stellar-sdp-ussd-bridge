/**
 * The partial-output sidecar. When rows fail or are uncertain, the SDP
 * file holds only the rows that succeeded and would look complete to
 * anything that reads it. The input parser refuses a partial input file
 * for the same reason. So the command does not write the output at all
 * unless --allow-partial is passed, and when it is, it writes this
 * sidecar next to the file (<output>.partial.json) with the number of
 * omitted rows, their input row indexes and their codes, and the SHA-256
 * of the file it describes. sdp:upload reads the sidecar and refuses the
 * file unless --accept-partial is passed. No phone number is written here.
 */
import { readFileSync } from 'node:fs';
import type { ProvisionReport } from './types.js';

export interface PartialSidecar {
  /** The output file the sidecar describes (as given on the command line). */
  output: string;
  /** SHA-256 of that file's bytes at the time of writing. */
  sha256: string;
  writtenAt: string;
  rowsWritten: number;
  rowsOmitted: number;
  /** Input row indexes (1-based data rows) that are not in the file, with their codes. */
  omitted: Array<{ rowIndex: number; status: string; code?: string }>;
}

export function partialSidecarPath(output: string): string {
  return `${output}.partial.json`;
}

/** The sidecar for a report; undefined when nothing was omitted. */
export function partialSidecarFor(report: ProvisionReport, output: string, sha256: string, now = new Date()): PartialSidecar | undefined {
  const omitted = report.outcomes
    .filter((o) => o.status === 'failed' || o.status === 'uncertain')
    .map((o) => ({ rowIndex: o.rowIndex, status: o.status, ...(o.errorCode ? { code: o.errorCode } : {}) }));
  if (!omitted.length) return undefined;
  return { output, sha256, writtenAt: now.toISOString(), rowsWritten: report.sdpRows.length, rowsOmitted: omitted.length, omitted };
}

/** Read a sidecar; undefined when there is none; throws when it is malformed. */
export function readPartialSidecar(path: string): PartialSidecar | undefined {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const parsed = JSON.parse(text) as Partial<PartialSidecar>;
  if (typeof parsed.sha256 !== 'string' || typeof parsed.rowsOmitted !== 'number' || !Array.isArray(parsed.omitted)) {
    throw new Error(`${path} is not a partial-output sidecar`);
  }
  return parsed as PartialSidecar;
}

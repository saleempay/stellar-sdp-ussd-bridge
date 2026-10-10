/**
 * Guards that run before `sdp:batch` starts a disbursement (proposal
 * section 3.3, rulings of 10 October 2026):
 *
 * 1. The tenant has no disbursement in STARTED or PAUSED. Statuses from
 *    internal/data/dibursements_state_machine.go:13-14 at tag 7.0.0; read
 *    through GET /disbursements?status=started,paused
 *    (disbursement_handler.go:310-354, status filter parsed by
 *    validators/disbursement_query_validator.go:55-69, key
 *    data/query_params.go:44). This guard is never bypassed.
 * 2. The environment's run log records no completed batch for the current
 *    UTC day, unless the operator passes `--second-run "<reason>"`; the
 *    reason is written to the run log entry.
 *
 * The run log is one JSON object per line, appended when a batch starts
 * and when it finishes. Accounts in it are masked by the caller; it holds
 * no secret.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Disbursement, SdpTenantClient } from './client.js';

/** dibursements_state_machine.go:13-14 */
export const IN_FLIGHT_DISBURSEMENT_STATUSES = ['STARTED', 'PAUSED'] as const;
/** dibursements_state_machine.go:15 */
export const COMPLETED_DISBURSEMENT_STATUS = 'COMPLETED';

export const RUN_LOG_ENV = 'BATCH_RUN_LOG';
export const DEFAULT_RUN_LOG_PATH = 'data/batch-run-log.jsonl';

export interface RunLogEntry {
  at: string;
  event: 'started' | 'finished';
  tenant: string;
  network: string;
  disbursementId: string;
  /** Sum of the disbursement's payments, USDC. */
  total?: string;
  /** The disbursement status when the run ended. */
  finalStatus?: string;
  timedOut?: boolean;
  /** Present when the operator passed --second-run. */
  secondRunReason?: string;
}

export class RunLog {
  constructor(readonly path: string) {}

  read(): RunLogEntry[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as RunLogEntry);
  }

  append(entry: RunLogEntry): void {
    mkdirSync(dirname(this.path), { recursive: true });
    appendFileSync(this.path, `${JSON.stringify(entry)}\n`);
  }
}

/** The UTC calendar day of an ISO timestamp, `YYYY-MM-DD`. */
export function utcDay(iso: string | Date): string {
  return (typeof iso === 'string' ? iso : iso.toISOString()).slice(0, 10);
}

/** Finished entries whose disbursement completed on the given UTC day. */
export function completedBatchesOn(entries: RunLogEntry[], day: string): RunLogEntry[] {
  return entries.filter((e) => e.event === 'finished' && e.finalStatus === COMPLETED_DISBURSEMENT_STATUS && utcDay(e.at) === day);
}

export class BatchGuardError extends Error {
  constructor(readonly reasons: string[]) {
    super(`batch refused: ${reasons.join('; ')}`);
    this.name = 'BatchGuardError';
  }
}

export interface BatchGuardInput {
  client: SdpTenantClient;
  walletId?: string;
  /** The disbursement about to be started. */
  disbursementId: string;
  runLog: RunLogEntry[];
  now: Date;
  /** Set when the operator passed --second-run "<reason>". */
  secondRunReason?: string;
}

export interface BatchGuardResult {
  inFlight: Disbursement[];
  completedToday: RunLogEntry[];
}

/** Throws BatchGuardError naming every reason; returns what it saw otherwise. */
export async function guardBatchStart(input: BatchGuardInput): Promise<BatchGuardResult> {
  const reasons: string[] = [];
  const inFlight = (await input.client.listDisbursements({ status: [...IN_FLIGHT_DISBURSEMENT_STATUSES] }, input.walletId)).data;
  for (const d of inFlight) {
    if (d.id === input.disbursementId) {
      reasons.push(`disbursement ${d.id} is already ${d.status}; use --skip-start to follow it instead of starting it`);
    } else {
      reasons.push(`the tenant has disbursement ${d.id} ("${d.name}") in ${d.status}; finish or cancel it first`);
    }
  }
  const completedToday = completedBatchesOn(input.runLog, utcDay(input.now));
  if (completedToday.length && !input.secondRunReason) {
    const ids = completedToday.map((e) => e.disbursementId).join(', ');
    reasons.push(`the run log already records a completed batch today (${ids}); pass --second-run "<reason>" to run another`);
  }
  if (reasons.length) throw new BatchGuardError(reasons);
  return { inFlight, completedToday };
}

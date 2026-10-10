/**
 * Guards that run before `sdp:batch` starts a disbursement (proposal
 * section 3.3, rulings of 10 October 2026 and the fix round of the same
 * day):
 *
 * 1. A disbursement in STARTED always refuses a new start. No flag lifts it.
 * 2. A disbursement in PAUSED refuses a new start, unless the operator
 *    passes `--second-run "<reason>"` AND no payment of any paused
 *    disbursement is still in a state that can reach the network without a
 *    further operator action: READY (picked up by the submitter,
 *    payments_state_machine.go:47) or PENDING (submitted, :52-54). A PAUSED
 *    payment moves only when someone resumes the disbursement (:51), a
 *    FAILED one only when someone retries it (:53); SUCCESS and CANCELED
 *    are final (:20-25). Statuses from dibursements_state_machine.go:13-14;
 *    read through GET /disbursements?status=started,paused
 *    (disbursement_handler.go:310-354, status filter parsed by
 *    validators/disbursement_query_validator.go:55-69, key
 *    data/query_params.go:44) and GET /payments?status=<one status>
 *    (payment_query_validator.go:62-70; page_limit at most 100,
 *    query_validator.go:93-94).
 *    The SDP itself lets a second disbursement start while another is
 *    paused: StartDisbursement (disbursement_management_service.go:200-270)
 *    checks no other disbursement's status, only the balance against this
 *    amount plus every in-progress payment of the same wallet
 *    (:326-359, PaymentInProgressStatuses = READY, PENDING, PAUSED).
 * 3. The environment's run log records no completed batch for the current
 *    UTC day, unless `--second-run "<reason>"` is given; the reason is
 *    written to the run log entry.
 *
 * The run log is one JSON object per line, appended when a batch starts
 * and when it finishes. Accounts in it are masked by the caller; it holds
 * no secret.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Disbursement, Payment, SdpTenantClient } from './client.js';

/** dibursements_state_machine.go:13-14 */
export const IN_FLIGHT_DISBURSEMENT_STATUSES = ['STARTED', 'PAUSED'] as const;
/** Payment states that reach the network with no further operator action (payments_state_machine.go:47,52-54). */
export const PAYMENT_CAN_REACH_NETWORK = ['READY', 'PENDING'] as const;
/** payments_state_machine.go:65-69: what the SDP counts against the balance at a start. */
export const PAYMENT_IN_PROGRESS_STATUSES = ['READY', 'PENDING', 'PAUSED'] as const;
const PAGE_LIMIT = 100;
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
  /** Paused disbursements the guard allowed past with the reason. */
  pausedAllowed?: string[];
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
  /** Paused disbursements the flag allowed past (every payment of theirs beyond READY and PENDING). */
  pausedAllowed: Disbursement[];
  /** In-progress payments (READY, PENDING, PAUSED) of the paused disbursements, as the SDP will count them against the balance. */
  pausedInProgress: Payment[];
}

const disbursementIdOf = (p: Payment): string | undefined => (p.disbursement as { id?: string } | undefined)?.id;

/** Every payment of the given disbursements in one of the statuses, paging through the tenant's list. */
export async function paymentsInStatuses(client: SdpTenantClient, disbursementIds: Set<string>, statuses: readonly string[], walletId?: string): Promise<Payment[]> {
  const found: Payment[] = [];
  for (const status of statuses) {
    for (let page = 1; ; page += 1) {
      const res = await client.listPayments(walletId, { status, page, pageLimit: PAGE_LIMIT });
      for (const p of res.data) {
        const id = disbursementIdOf(p);
        if (id && disbursementIds.has(id)) found.push(p);
      }
      if (res.data.length < PAGE_LIMIT) break;
    }
  }
  return found;
}

/** Throws BatchGuardError naming every reason; returns what it saw otherwise. */
export async function guardBatchStart(input: BatchGuardInput): Promise<BatchGuardResult> {
  const reasons: string[] = [];
  const inFlight = (await input.client.listDisbursements({ status: [...IN_FLIGHT_DISBURSEMENT_STATUSES] }, input.walletId)).data;
  const paused: Disbursement[] = [];
  for (const d of inFlight) {
    if (d.id === input.disbursementId) {
      reasons.push(`disbursement ${d.id} is already ${d.status}; use --skip-start to follow it instead of starting it`);
    } else if (d.status === 'STARTED') {
      reasons.push(`the tenant has disbursement ${d.id} ("${d.name}") in STARTED; no flag lifts this, pause or finish it first`);
    } else if (!input.secondRunReason) {
      reasons.push(`the tenant has disbursement ${d.id} ("${d.name}") in PAUSED; pass --second-run "<reason>" to start another while it stays paused`);
    } else {
      paused.push(d);
    }
  }
  let pausedInProgress: Payment[] = [];
  const pausedAllowed: Disbursement[] = [];
  if (paused.length) {
    const ids = new Set(paused.map((d) => d.id));
    pausedInProgress = await paymentsInStatuses(input.client, ids, PAYMENT_IN_PROGRESS_STATUSES, input.walletId);
    const reaching = pausedInProgress.filter((p) => (PAYMENT_CAN_REACH_NETWORK as readonly string[]).includes(p.status));
    for (const d of paused) {
      const mine = reaching.filter((p) => disbursementIdOf(p) === d.id);
      if (mine.length) {
        const states = [...new Set(mine.map((p) => p.status))].sort().join(', ');
        reasons.push(`paused disbursement ${d.id} ("${d.name}") still has ${mine.length} payment(s) in ${states}, which can reach the network; wait for them to finish or fail`);
      } else {
        pausedAllowed.push(d);
      }
    }
  }
  const completedToday = completedBatchesOn(input.runLog, utcDay(input.now));
  if (completedToday.length && !input.secondRunReason) {
    const ids = completedToday.map((e) => e.disbursementId).join(', ');
    reasons.push(`the run log already records a completed batch today (${ids}); pass --second-run "<reason>" to run another`);
  }
  if (reasons.length) throw new BatchGuardError(reasons);
  return { inFlight, completedToday, pausedAllowed, pausedInProgress };
}

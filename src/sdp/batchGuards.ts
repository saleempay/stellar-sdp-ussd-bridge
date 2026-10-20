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
 * 3. No batch was started on the current UTC day, unless `--second-run
 *    "<reason>"` is given; the reason is written to the run log entry. Two
 *    sources decide, either suffices (review of 13 October 2026, finding 2):
 *    the run log's `started` entries of the day (a batch that moved money
 *    and then failed, timed out or was interrupted has no COMPLETED line),
 *    and the SDP itself: every disbursement in STARTED, PAUSED or COMPLETED
 *    whose `status_history` (disbursements.go:27,59-63) holds a STARTED
 *    entry dated today, whatever machine or path started it. The local log
 *    stays the record of reasons.
 * 4. The listings cover every distribution account of the tenant, paged
 *    (page_limit 100), not one page of the selected account.
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

/**
 * Run log entries that show a batch was started on the given UTC day: every
 * `started` entry, plus a completed `finished` entry whose start was not
 * logged (one disbursement counted once).
 */
export function startedBatchesOn(entries: RunLogEntry[], day: string): RunLogEntry[] {
  const seen = new Set<string>();
  const out: RunLogEntry[] = [];
  for (const e of entries) {
    const counts = utcDay(e.at) === day && (e.event === 'started' || (e.event === 'finished' && e.finalStatus === COMPLETED_DISBURSEMENT_STATUS));
    if (counts && !seen.has(e.disbursementId)) { seen.add(e.disbursementId); out.push(e); }
  }
  return out;
}

/** dibursements_state_machine.go:13-15: the statuses a disbursement can hold once it has been started. */
export const STARTED_EVER_DISBURSEMENT_STATUSES = ['STARTED', 'PAUSED', 'COMPLETED'] as const;

/** The time the SDP recorded the STARTED transition, from status_history; undefined when the history carries none. */
export function startedAtOf(d: Disbursement): string | undefined {
  return d.status_history?.find((h) => String(h.status).toUpperCase() === 'STARTED')?.timestamp;
}

/** Every disbursement in the statuses, across the given distribution accounts (undefined = the tenant's default), paging through each listing. */
export async function disbursementsInStatuses(client: SdpTenantClient, statuses: readonly string[], walletIds: ReadonlyArray<string | undefined>): Promise<Disbursement[]> {
  const found = new Map<string, Disbursement>();
  for (const walletId of walletIds) {
    for (let page = 1; ; page += 1) {
      const res = await client.listDisbursements({ status: [...statuses], page, pageLimit: PAGE_LIMIT }, walletId);
      for (const d of res.data) found.set(d.id, d);
      if (res.data.length < PAGE_LIMIT) break;
    }
  }
  return [...found.values()];
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
  /** Every distribution account of the tenant; the listings cover all of them. Defaults to [walletId]. */
  walletIds?: string[];
  /** The disbursement about to be started. */
  disbursementId: string;
  runLog: RunLogEntry[];
  now: Date;
  /** Set when the operator passed --second-run "<reason>". */
  secondRunReason?: string;
}

export interface BatchGuardResult {
  inFlight: Disbursement[];
  /** Kept for the report: completed entries of the day in the run log. */
  completedToday: RunLogEntry[];
  /** What says a batch was started today: run log entries and SDP disbursements. */
  startedToday: { log: RunLogEntry[]; sdp: Disbursement[] };
  /** Paused disbursements the flag allowed past (every payment of theirs beyond READY and PENDING). */
  pausedAllowed: Disbursement[];
  /** In-progress payments (READY, PENDING, PAUSED) of the paused disbursements, as the SDP will count them against the balance. */
  pausedInProgress: Payment[];
}

const disbursementIdOf = (p: Payment): string | undefined => (p.disbursement as { id?: string } | undefined)?.id;

/** Every payment of the given disbursements in one of the statuses, across the given distribution accounts, paging through each listing. */
export async function paymentsInStatuses(client: SdpTenantClient, disbursementIds: Set<string>, statuses: readonly string[], walletIds: ReadonlyArray<string | undefined>): Promise<Payment[]> {
  const found = new Map<string, Payment>();
  for (const walletId of walletIds) {
    for (const status of statuses) {
      for (let page = 1; ; page += 1) {
        const res = await client.listPayments(walletId, { status, page, pageLimit: PAGE_LIMIT });
        for (const p of res.data) {
          const id = disbursementIdOf(p);
          if (id && disbursementIds.has(id)) found.set(p.id, p);
        }
        if (res.data.length < PAGE_LIMIT) break;
      }
    }
  }
  return [...found.values()];
}

/** Throws BatchGuardError naming every reason; returns what it saw otherwise. */
export async function guardBatchStart(input: BatchGuardInput): Promise<BatchGuardResult> {
  const reasons: string[] = [];
  const walletIds: ReadonlyArray<string | undefined> = input.walletIds?.length ? input.walletIds : [input.walletId];
  const inFlight = await disbursementsInStatuses(input.client, IN_FLIGHT_DISBURSEMENT_STATUSES, walletIds);
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
    pausedInProgress = await paymentsInStatuses(input.client, ids, PAYMENT_IN_PROGRESS_STATUSES, walletIds);
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
  const day = utcDay(input.now);
  const completedToday = completedBatchesOn(input.runLog, day);
  const startedLog = startedBatchesOn(input.runLog, day);
  const startedSdp = (await disbursementsInStatuses(input.client, STARTED_EVER_DISBURSEMENT_STATUSES, walletIds))
    .filter((d) => { const at = startedAtOf(d); return at !== undefined && utcDay(at) === day; });
  if ((startedLog.length || startedSdp.length) && !input.secondRunReason) {
    const parts: string[] = [];
    if (startedLog.length) parts.push(`the run log records ${startedLog.length} started today (${startedLog.map((e) => e.disbursementId).join(', ')})`);
    if (startedSdp.length) parts.push(`the SDP shows ${startedSdp.length} started today (${startedSdp.map((d) => `${d.id} "${d.name}" ${d.status}`).join(', ')})`);
    reasons.push(`a batch was already started today: ${parts.join('; ')}; pass --second-run "<reason>" to run another`);
  }
  if (reasons.length) throw new BatchGuardError(reasons);
  return { inFlight, completedToday, startedToday: { log: startedLog, sdp: startedSdp }, pausedAllowed, pausedInProgress };
}

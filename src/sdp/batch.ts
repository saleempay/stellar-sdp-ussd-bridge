/**
 * Start an SDP disbursement and follow it to completion, then confirm each
 * payment on Horizon. Everything is read through the typed client and the
 * bridge's Horizon client, so the offline tests drive it with fakes.
 *
 * SDP 7.0.0 facts used: PATCH /disbursements/{id}/status {"status":"STARTED"}
 * (disbursement_handler.go:96-98), GET /payments paginated with the
 * payment's `status`, `stellar_transaction_id` and nested `disbursement.id`
 * (internal/data/payments.go), statuses DRAFT READY PENDING PAUSED SUCCESS
 * FAILED CANCELED (payments_state_machine.go), the payment job interval
 * SCHEDULER_PAYMENT_JOB_SECONDS. Horizon: GET /transactions/{hash} and its
 * operations (payment: from, to, amount, asset_code, asset_issuer).
 */
import type { Payment, SdpTenantClient } from './client.js';
import { maskAccount } from './facts.js';
import type { FetchHorizon } from '../provision/horizon.js';

export const TERMINAL_PAYMENT_STATUSES = new Set(['SUCCESS', 'FAILED', 'CANCELED']);

export interface PaymentSnapshot {
  id: string;
  amount: string;
  status: string;
  txHash: string | null;
  /** Recipient address, masked. */
  toMasked: string | null;
  /** Receiver record id, when present. */
  receiverId: string | null;
}

export interface TimelineEntry {
  at: string;
  disbursementStatus: string;
  payments: PaymentSnapshot[];
}

export interface BatchDeps {
  client: SdpTenantClient;
  horizon: Pick<FetchHorizon, 'transaction' | 'operationsOf' | 'loadAccount'>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface BatchOptions {
  disbursementId: string;
  walletId?: string;
  /** Poll interval. Default 5 s. */
  pollMs?: number;
  /** Give up waiting after this. Default 10 minutes. */
  timeoutMs?: number;
  asset: { code: string; issuer: string };
  /** When true, do not send the STARTED patch (the batch was already started). */
  skipStart?: boolean;
}

export interface ConfirmedPayment extends PaymentSnapshot {
  ledger?: number;
  createdAt?: string;
  successful?: boolean;
  /** The payment operation as Horizon reports it. */
  operation?: { from: string; to: string; amount: string; asset: string };
  /** What went wrong confirming, if anything. */
  confirmError?: string;
}

export interface BatchResult {
  disbursementId: string;
  started: boolean;
  finalStatus: string;
  timedOut: boolean;
  timeline: TimelineEntry[];
  payments: ConfirmedPayment[];
}

function snapshot(p: Payment): PaymentSnapshot {
  const rw = p.receiver_wallet as { stellar_address?: string; receiver?: { id?: string } } | undefined;
  return {
    id: p.id,
    amount: p.amount,
    status: p.status,
    txHash: p.stellar_transaction_id || null,
    toMasked: rw?.stellar_address ? maskAccount(rw.stellar_address) : null,
    receiverId: rw?.receiver?.id ?? null,
  };
}

/** Payments of one disbursement, from the tenant's paginated list. */
export async function paymentsOf(client: SdpTenantClient, disbursementId: string, walletId?: string): Promise<Payment[]> {
  const page = await client.listPayments(walletId);
  return page.data.filter((p) => (p.disbursement as { id?: string } | undefined)?.id === disbursementId);
}

export async function runBatch(deps: BatchDeps, opts: BatchOptions): Promise<BatchResult> {
  const pollMs = opts.pollMs ?? 5_000;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const timeline: TimelineEntry[] = [];
  let started = false;
  if (!opts.skipStart) {
    await deps.client.patchDisbursementStatus(opts.disbursementId, 'STARTED', opts.walletId);
    started = true;
  }
  const deadline = deps.now() + timeoutMs;
  let lastKey = '';
  let finalStatus = '';
  let timedOut = false;
  for (;;) {
    const d = await deps.client.getDisbursement(opts.disbursementId, opts.walletId);
    const payments = (await paymentsOf(deps.client, opts.disbursementId, opts.walletId)).map(snapshot);
    finalStatus = d.status;
    const key = `${d.status}|${payments.map((p) => `${p.id}:${p.status}:${p.txHash ?? ''}`).join(',')}`;
    if (key !== lastKey) {
      timeline.push({ at: new Date(deps.now()).toISOString(), disbursementStatus: d.status, payments });
      lastKey = key;
    }
    const allTerminal = payments.length > 0 && payments.every((p) => TERMINAL_PAYMENT_STATUSES.has(p.status));
    if (allTerminal && d.status !== 'STARTED') break;
    if (allTerminal && d.status === 'STARTED' && timeline.length > 1) {
      // payments are final; give the disbursement one more poll to flip
      await deps.sleep(pollMs);
      const again = await deps.client.getDisbursement(opts.disbursementId, opts.walletId);
      finalStatus = again.status;
      if (again.status !== timeline[timeline.length - 1]!.disbursementStatus) {
        timeline.push({ at: new Date(deps.now()).toISOString(), disbursementStatus: again.status, payments });
      }
      break;
    }
    if (deps.now() >= deadline) {
      timedOut = true;
      break;
    }
    await deps.sleep(pollMs);
  }
  const last = timeline[timeline.length - 1]?.payments ?? [];
  const confirmed: ConfirmedPayment[] = [];
  for (const p of last) {
    const c: ConfirmedPayment = { ...p };
    if (p.txHash) {
      try {
        const tx = await deps.horizon.transaction(p.txHash);
        c.ledger = tx.ledger;
        c.createdAt = tx.created_at;
        c.successful = tx.successful;
        const ops = await deps.horizon.operationsOf(p.txHash);
        const pay = ops.find((o) => o.type === 'payment' && o.asset_code === opts.asset.code && o.asset_issuer === opts.asset.issuer);
        if (pay && pay.from && pay.to && pay.amount) {
          c.operation = { from: maskAccount(pay.from), to: maskAccount(pay.to), amount: pay.amount, asset: `${pay.asset_code}:${maskAccount(pay.asset_issuer)}` };
        } else {
          c.confirmError = 'no USDC payment operation with the pinned issuer in this transaction';
        }
      } catch (err) {
        c.confirmError = (err as Error).message;
      }
    }
    confirmed.push(c);
  }
  return { disbursementId: opts.disbursementId, started, finalStatus, timedOut, timeline, payments: confirmed };
}

/** Sum of a disbursement's payment amounts as a string with 7 decimals (string arithmetic). */
export function totalAmount(payments: Array<{ amount: string }>): string {
  let stroops = 0n;
  for (const p of payments) {
    const m = /^(\d+)(?:\.(\d{1,7}))?$/.exec(p.amount);
    if (!m) throw new Error(`amount not a decimal: ${p.amount}`);
    stroops += BigInt(m[1]!) * 10_000_000n + BigInt((m[2] ?? '').padEnd(7, '0'));
  }
  const whole = stroops / 10_000_000n;
  const frac = (stroops % 10_000_000n).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

export function formatBatchReport(r: BatchResult): string {
  const lines = [`disbursement ${r.disbursementId}: ${r.finalStatus}${r.timedOut ? ' (timed out waiting)' : ''}; ${r.started ? 'started by this run' : 'already started'}`];
  for (const p of r.payments) {
    lines.push(
      [
        p.toMasked ?? '(no address)',
        p.amount.padStart(12),
        p.status.padEnd(8),
        p.txHash ? `tx ${p.txHash}` : 'no transaction',
        p.ledger ? `ledger ${p.ledger}` : '',
        p.operation ? `${p.operation.amount} ${p.operation.asset.split(':')[0]} ${p.operation.from} -> ${p.operation.to}` : '',
        p.confirmError ? `confirm: ${p.confirmError}` : '',
      ].join('  ').trimEnd(),
    );
  }
  lines.push(`timeline: ${r.timeline.map((t) => `${t.at.slice(11, 19)} ${t.disbursementStatus} [${t.payments.map((p) => p.status).join(' ')}]`).join(' > ')}`);
  return lines.join('\n');
}

/**
 * Pending creations: the record written for a phone number after the
 * signer has produced a new account key and before the creation
 * transaction is submitted, and removed once the mapping is written or
 * the creation is known not to have landed.
 *
 * Why it exists: a submission that times out, or that Horizon answers with
 * a 5xx or without result codes, may still have landed. Without this
 * record the account id lives only in the signer's memory, the row fails
 * with no id, and the next run creates a second sponsored account for the
 * same number. With it, the next run checks the recorded account on chain
 * first and adopts it when it exists.
 *
 * Reference implementations mirror the adapter's stores: in-memory for
 * tests, a JSON file (mode 600, written through a rename) next to
 * accounts.json for the command line. Contents link phone numbers to
 * accounts and are personal data like the account store.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface PendingCreation {
  /** The account the signer produced a key for. */
  accountId: string;
  /** When the record was written, ISO 8601. */
  at: string;
  /**
   * The moment after which the creation transaction can no longer be
   * included in a ledger (its time bound plus a grace for ledger close and
   * clock skew), ISO 8601. Written when a submission ends without a
   * definitive answer. Until then the record is held and no new creation
   * for the number starts; after it, an absent account means the creation
   * did not land and the record is forgotten.
   */
  expiresAt?: string;
}

/** Default time bound the bridge sets on a creation transaction, seconds. */
export const CREATION_TIMEOUT_SECONDS = 30;
/**
 * Grace added to the time bound before a pending record is given up:
 * a transaction with maxTime T can still sit in a ledger whose close time
 * is at most T, and the client's clock may run ahead of the network's.
 */
export const LANDING_GRACE_MS = 10_000;
/** Time bound the adapter applies when none is passed (sponsoredCreate.ts:31,71 at 4c235f8). */
export const ADAPTER_DEFAULT_TIMEOUT_SECONDS = 120;

/**
 * When the transaction behind a submission that ended at `endedAtMs` can
 * no longer land: the time bound counted from the moment the error
 * surfaced (the transaction was built no later than that) plus the grace.
 */
export function landingDeadline(endedAtMs: number, timeoutSeconds: number): string {
  return new Date(endedAtMs + timeoutSeconds * 1000 + LANDING_GRACE_MS).toISOString();
}

/**
 * Whether a pending creation's transaction may still be included. A record
 * without `expiresAt` (written before this field existed) is treated as
 * bound by the adapter's default 120 s from the moment it was written.
 */
export function pendingMayStillLand(record: PendingCreation, nowMs: number): boolean {
  const deadline = record.expiresAt ?? landingDeadline(Date.parse(record.at), ADAPTER_DEFAULT_TIMEOUT_SECONDS);
  return nowMs < Date.parse(deadline);
}

export interface PendingCreationStore {
  get(msisdn: string): Promise<PendingCreation | undefined>;
  put(msisdn: string, record: PendingCreation): Promise<void>;
  delete(msisdn: string): Promise<void>;
}

export class InMemoryPendingStore implements PendingCreationStore {
  readonly records = new Map<string, PendingCreation>();
  async get(msisdn: string): Promise<PendingCreation | undefined> {
    return this.records.get(msisdn);
  }
  async put(msisdn: string, record: PendingCreation): Promise<void> {
    this.records.set(msisdn, record);
  }
  async delete(msisdn: string): Promise<void> {
    this.records.delete(msisdn);
  }
}

export class JsonFilePendingStore implements PendingCreationStore {
  constructor(private readonly path: string) {}

  private read(): Record<string, PendingCreation> {
    try {
      return JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, PendingCreation>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
      throw err;
    }
  }

  private write(records: Record<string, PendingCreation>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.path);
  }

  async get(msisdn: string): Promise<PendingCreation | undefined> {
    return this.read()[msisdn];
  }
  async put(msisdn: string, record: PendingCreation): Promise<void> {
    const records = this.read();
    records[msisdn] = record;
    this.write(records);
  }
  async delete(msisdn: string): Promise<void> {
    const records = this.read();
    if (!(msisdn in records)) return;
    delete records[msisdn];
    this.write(records);
  }
}

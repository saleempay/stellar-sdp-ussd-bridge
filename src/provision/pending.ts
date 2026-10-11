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

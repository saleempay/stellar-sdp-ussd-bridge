/**
 * Amount caps, enforced in the bridge because the SDP has no cap feature
 * on the wallet-address route (no cap configuration in dev/.env.example or
 * cmd/serve.go at tag 7.0.0). Rulings of 10 October 2026: 5 USDC per
 * payment, 25 USDC per batch, 100 USDC on the distribution account; the
 * same defaults on every network, so no network-specific value lives here.
 *
 * All arithmetic is on stroops (7 decimal places) as BigInt: no floating
 * point anywhere near an amount.
 */

export interface Caps {
  /** Largest single payment, USDC. */
  maxPaymentUsdc: string;
  /** Largest sum of one input file, USDC. */
  maxBatchUsdc: string;
  /** Largest balance the distribution account may hold before a batch, USDC. */
  maxAccountUsdc: string;
}

export const DEFAULT_MAX_PAYMENT_USDC = '5';
export const DEFAULT_MAX_BATCH_USDC = '25';
export const DEFAULT_MAX_ACCOUNT_USDC = '100';

export const DEFAULT_CAPS: Readonly<Caps> = Object.freeze({
  maxPaymentUsdc: DEFAULT_MAX_PAYMENT_USDC,
  maxBatchUsdc: DEFAULT_MAX_BATCH_USDC,
  maxAccountUsdc: DEFAULT_MAX_ACCOUNT_USDC,
});

export const CAP_ENV: Readonly<Record<keyof Caps, string>> = Object.freeze({
  maxPaymentUsdc: 'MAX_PAYMENT_USDC',
  maxBatchUsdc: 'MAX_BATCH_USDC',
  maxAccountUsdc: 'MAX_ACCOUNT_USDC',
});

/** Non-negative decimal with at most 7 decimal places. */
const DECIMAL = /^(\d+)(?:\.(\d{1,7}))?$/;
const STROOPS_PER_UNIT = 10_000_000n;

export class CapConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapConfigError';
  }
}

/** Chain amount string to stroops. Throws on anything that is not a decimal with at most 7 places. */
export function toStroops(amount: string): bigint {
  const m = DECIMAL.exec(amount.trim());
  if (!m) throw new CapConfigError(`not a decimal amount with at most 7 decimal places: "${amount}"`);
  return BigInt(m[1]!) * STROOPS_PER_UNIT + BigInt((m[2] ?? '').padEnd(7, '0'));
}

/** Stroops to the chain string with 7 decimal places. */
export function fromStroops(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_UNIT;
  const frac = (stroops % STROOPS_PER_UNIT).toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

/** -1, 0 or 1 as `a` compares to `b`, both decimal strings. */
export function compareAmounts(a: string, b: string): -1 | 0 | 1 {
  const x = toStroops(a);
  const y = toStroops(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Sum of decimal strings as a chain string. */
export function sumAmounts(amounts: Iterable<string>): string {
  let total = 0n;
  for (const a of amounts) total += toStroops(a);
  return fromStroops(total);
}

/**
 * Caps from the environment. Unset or blank takes the default. A set value
 * must be a positive decimal with at most 7 places; anything else is a
 * CapConfigError naming the variable.
 */
export function capsFromEnv(env: Record<string, string | undefined>): Caps {
  const caps: Caps = { ...DEFAULT_CAPS };
  for (const key of Object.keys(CAP_ENV) as Array<keyof Caps>) {
    const raw = (env[CAP_ENV[key]] ?? '').trim();
    if (raw === '') continue;
    let stroops: bigint;
    try {
      stroops = toStroops(raw);
    } catch {
      throw new CapConfigError(`${CAP_ENV[key]} must be a positive decimal with at most 7 decimal places`);
    }
    if (stroops <= 0n) throw new CapConfigError(`${CAP_ENV[key]} must be greater than zero`);
    caps[key] = raw;
  }
  return caps;
}

/**
 * Why the distribution account refuses, or null when its balance is within
 * the ceiling. An over-funded account refuses until the excess is moved out.
 */
export function accountCeilingReason(balanceUsdc: string, caps: Pick<Caps, 'maxAccountUsdc'>): string | null {
  if (compareAmounts(balanceUsdc, caps.maxAccountUsdc) <= 0) return null;
  return `the distribution account holds ${balanceUsdc} USDC, above the ${CAP_ENV.maxAccountUsdc} ceiling of ${caps.maxAccountUsdc} USDC; move the excess out before any batch`;
}

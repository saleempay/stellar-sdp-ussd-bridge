/**
 * A signer supplied from outside this repository (ruling of 10 October
 * 2026, CLAUDE.md "Network and secrets"): the adapter's reference signer
 * stays the default and the only signer implemented here; a deployment may
 * point BRIDGE_SIGNER_MODULE at an ES module of its own that exports a
 * factory (`createSigner`, or the default export) returning an object that
 * implements the adapter's `Signer` interface
 * (vendor/stellar-ussd-sep10-adapter/src/signer/types.ts: createAccountKey,
 * canSignFor, signTransaction). The object is checked at boot and refused
 * when it does not implement the interface. No signer implementation is
 * added here.
 */
import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { LocalKeypairSigner, type Signer } from 'stellar-ussd-sep10-adapter';

export const SIGNER_MODULE_ENV = 'BRIDGE_SIGNER_MODULE';
/** Optional: the export to use; default `createSigner`, then `default`. */
export const SIGNER_EXPORT_ENV = 'BRIDGE_SIGNER_EXPORT';

/** The adapter's Signer interface, by member name. */
export const SIGNER_METHODS = ['createAccountKey', 'canSignFor', 'signTransaction'] as const;

export class SignerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SignerConfigError';
  }
}

type EnvLike = Record<string, string | undefined>;

/** Refuse anything that does not implement the adapter's Signer interface, naming the missing member. */
export function assertSigner(candidate: unknown, origin: string): Signer {
  if (candidate === null || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
    throw new SignerConfigError(`${origin}: the signer must be an object implementing the adapter's Signer interface; got ${candidate === null ? 'null' : typeof candidate}`);
  }
  const missing = SIGNER_METHODS.filter((m) => typeof (candidate as Record<string, unknown>)[m] !== 'function');
  if (missing.length) {
    throw new SignerConfigError(`${origin}: the signer does not implement the adapter's Signer interface; missing or not a function: ${missing.join(', ')}`);
  }
  return candidate as Signer;
}

export interface LoadSignerOptions {
  /** Test seam: replaces the dynamic import. */
  importer?: (specifier: string) => Promise<unknown>;
  /** Base for a relative module path. Default: the current working directory. */
  cwd?: string;
}

/**
 * The injected signer named by BRIDGE_SIGNER_MODULE, or undefined when the
 * variable is unset (the caller then uses the adapter's reference signer).
 * A relative path resolves against the working directory; an absolute path
 * or a bare specifier is imported as given. The chosen export may be the
 * signer itself or a factory called with no arguments (sync or async).
 */
export async function loadInjectedSigner(env: EnvLike, opts: LoadSignerOptions = {}): Promise<Signer | undefined> {
  const spec = (env[SIGNER_MODULE_ENV] ?? '').trim();
  if (!spec) return undefined;
  const exportName = (env[SIGNER_EXPORT_ENV] ?? '').trim();
  const importer = opts.importer ?? ((s: string) => import(s));
  const target = spec.startsWith('.') || isAbsolute(spec) ? pathToFileURL(resolve(opts.cwd ?? process.cwd(), spec)).href : spec;
  let mod: Record<string, unknown>;
  try {
    mod = (await importer(target)) as Record<string, unknown>;
  } catch (cause) {
    throw new SignerConfigError(`${SIGNER_MODULE_ENV}: cannot import the signer module: ${(cause as Error).message}`);
  }
  const names = exportName ? [exportName] : ['createSigner', 'default'];
  const name = names.find((n) => mod[n] !== undefined);
  if (!name) throw new SignerConfigError(`${SIGNER_MODULE_ENV}: the module exports none of ${names.join(', ')}`);
  const origin = `${SIGNER_MODULE_ENV} export "${name}"`;
  const chosen = mod[name];
  const implementsSigner = (v: unknown) => SIGNER_METHODS.every((m) => typeof (v as Record<string, unknown> | null)?.[m] === 'function');
  // A function that is not itself a signer is a factory; call it.
  const candidate = typeof chosen === 'function' && !implementsSigner(chosen) ? await (chosen as () => unknown)() : chosen;
  return assertSigner(candidate, origin);
}

export interface SponsorSigning {
  signer: Signer;
  sponsorPublicKey: string;
  /** true when the signer came from BRIDGE_SIGNER_MODULE. */
  injected: boolean;
}

/**
 * The signer and sponsor account the bridge signs with.
 *
 * Default (no injected signer): the adapter's reference signer imports
 * SPONSOR_SECRET_KEY, and SPONSOR_PUBLIC_KEY, when set, must match.
 *
 * Injected: SPONSOR_PUBLIC_KEY names the sponsor, the signer must report
 * `canSignFor(sponsor)`, and SPONSOR_SECRET_KEY must not be present: a raw
 * sponsor secret has no place next to a signer that holds the keys.
 */
export async function sponsorSigning(env: EnvLike, injected?: Signer): Promise<SponsorSigning> {
  const publicKey = (env.SPONSOR_PUBLIC_KEY ?? '').trim();
  const secretKey = (env.SPONSOR_SECRET_KEY ?? '').trim();
  if (injected) {
    assertSigner(injected, SIGNER_MODULE_ENV);
    if (!publicKey) throw new SignerConfigError('SPONSOR_PUBLIC_KEY is required when a signer is injected');
    if (secretKey) throw new SignerConfigError('SPONSOR_SECRET_KEY must not be set when a signer is injected; the injected signer holds the sponsor key');
    if (!(await injected.canSignFor(publicKey))) throw new SignerConfigError(`the injected signer cannot sign for the sponsor account ${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`);
    return { signer: injected, sponsorPublicKey: publicKey, injected: true };
  }
  if (!secretKey) throw new SignerConfigError('SPONSOR_SECRET_KEY missing (run npm run sponsor:setup, or inject a signer with BRIDGE_SIGNER_MODULE)');
  const signer = new LocalKeypairSigner();
  let derived: string;
  try {
    derived = signer.importSecret(secretKey);
  } catch {
    throw new SignerConfigError('SPONSOR_SECRET_KEY is not a valid secret key');
  }
  if (publicKey && publicKey !== derived) throw new SignerConfigError('SPONSOR_PUBLIC_KEY does not match SPONSOR_SECRET_KEY');
  return { signer, sponsorPublicKey: derived, injected: false };
}
